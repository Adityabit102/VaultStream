"""Bronze layer -- raw ingestion.

Land the historical transaction + identity CSVs exactly as received: no type
coercion, no cleaning, append-only. The only added columns are lineage metadata
(ingest timestamp, source file, source checksum) so every Bronze row can be
traced back to the file it came from.

Outputs:
    bronze/transactions
    bronze/identity
"""
from __future__ import annotations

import hashlib
import os
import time

from pyspark.sql import SparkSession
from pyspark.sql import functions as F

from . import config
from .spark_utils import get_spark, log, write_table


def _checksum(path: str, limit_bytes: int = 8 * 1024 * 1024) -> str:
    """Cheap lineage checksum over the head of the file (full-file hashing a
    652 MB CSV every run is wasteful; the head is enough to detect a changed
    source for lineage purposes). Skipped for remote (dbfs:/ / s3://) sources,
    where a local `open()` doesn't apply -- lineage there relies on the source
    path + Delta history instead."""
    if not config.is_local_path(path):
        return "remote"
    if not os.path.exists(path):
        return "missing"
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        h.update(fh.read(limit_bytes))
    return h.hexdigest()[:16]


def _source_exists(path: str) -> bool:
    """Local paths are checked directly; for remote schemes we can't stat
    locally, so we defer to Spark's own read (which errors clearly if missing)."""
    return os.path.exists(path) if config.is_local_path(path) else True


def _read_csv(spark: SparkSession, path: str):
    # Bronze preserves source as-is -> read everything as strings; typing is a
    # Silver responsibility. inferSchema is deliberately OFF.
    return (
        spark.read.option("header", True)
        .option("inferSchema", False)
        .csv(path)
    )


def ingest(spark: SparkSession | None = None, raw_dir: str | None = None) -> dict:
    spark = spark or get_spark("vaultstream-bronze")
    raw_dir = raw_dir or config.RAW_DATA_DIR
    tx_file = os.path.join(raw_dir, config.RAW_TRANSACTION_FILE)
    id_file = os.path.join(raw_dir, config.RAW_IDENTITY_FILE)

    if not _source_exists(tx_file):
        raise FileNotFoundError(
            f"Raw transaction file not found: {tx_file}\n"
            f"Generate sample data first:  python -m batch_pipeline.generate_sample_data "
            f"--out {raw_dir}"
        )

    batch_id = time.strftime("%Y%m%dT%H%M%SZ", time.gmtime())
    ingested_at = F.current_timestamp()

    tx = _read_csv(spark, tx_file)
    tx = (
        tx.withColumn("_ingested_at", ingested_at)
        .withColumn("_batch_id", F.lit(batch_id))
        .withColumn("_source_file", F.lit(config.RAW_TRANSACTION_FILE))
        .withColumn("_source_checksum", F.lit(_checksum(tx_file)))
    )
    tx_count = tx.count()
    write_table(tx, f"{config.BRONZE_ROOT}/transactions", mode="append")

    identity_count = 0
    if _source_exists(id_file):
        idf = _read_csv(spark, id_file)
        idf = (
            idf.withColumn("_ingested_at", ingested_at)
            .withColumn("_batch_id", F.lit(batch_id))
            .withColumn("_source_file", F.lit(config.RAW_IDENTITY_FILE))
            .withColumn("_source_checksum", F.lit(_checksum(id_file)))
        )
        identity_count = idf.count()
        write_table(idf, f"{config.BRONZE_ROOT}/identity", mode="append")
    else:
        log.warning("Identity file not found (%s); continuing without it.", id_file)

    summary = {
        "batch_id": batch_id,
        "bronze_transaction_rows": tx_count,
        "bronze_identity_rows": identity_count,
        "source_checksum": _checksum(tx_file),
    }
    log.info("Bronze ingest complete: %s", summary)
    return summary


if __name__ == "__main__":
    ingest()
