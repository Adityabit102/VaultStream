"""Phase 5 -- the single, additive integration point with existing VaultStream.

`gold.fact_transactions` already carries every feature in the Model Lab's
schema. This exports it as a column-matched retraining dataset (CSV + Parquet)
that the existing Model Lab can be pointed at as an *additional* data source --
no Model Lab code changes, no touching the live inference model.

The exported columns are exactly `backend/ml/trainer.py::FEATURE_NAMES` plus the
`isFraud` label, in order, so a future `train(..., source=...)` reads it directly.
"""
from __future__ import annotations

import os

from pyspark.sql import SparkSession
from pyspark.sql import functions as F

from . import config
from .spark_utils import get_spark, log, read_table


def export(spark: SparkSession | None = None, coalesce_to: int = 1) -> dict:
    spark = spark or get_spark("vaultstream-export")
    fact = read_table(spark, f"{config.GOLD_ROOT}/fact_transactions")

    cols = config.MODEL_LAB_FEATURES + ["isFraud"]
    missing = [c for c in cols if c not in fact.columns]
    if missing:
        raise ValueError(f"Gold fact_transactions is missing expected columns: {missing}")

    out = fact.select(*[F.col(c).cast("double") if c != "isFraud" else F.col(c).cast("int") for c in cols])
    rows = out.count()

    csv_path = f"{config.EXPORT_ROOT}/model_lab_training_csv"
    parquet_path = f"{config.EXPORT_ROOT}/model_lab_training_parquet"
    out.coalesce(coalesce_to).write.mode("overwrite").option("header", True).csv(csv_path)
    out.coalesce(coalesce_to).write.mode("overwrite").parquet(parquet_path)

    manifest = {
        "rows": rows,
        "columns": cols,
        "csv_path": csv_path,
        "parquet_path": parquet_path,
        "note": "Point the Model Lab retraining job at this as an additional source. "
                "Column order matches backend/ml/trainer.py FEATURE_NAMES + isFraud.",
    }
    _write_manifest(manifest)
    log.info("Model Lab export complete: %d rows -> %s", rows, config.EXPORT_ROOT)
    return manifest


def _write_manifest(manifest: dict) -> None:
    # Convenience artifact on the driver's local disk; never fatal.
    import json
    path = config.EXPORT_MANIFEST_PATH
    try:
        if config.is_local_path(path):
            os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
            with open(path, "w") as fh:
                json.dump(manifest, fh, indent=2)
        else:
            log.info("Export manifest path is remote (%s); skipping local manifest.", path)
    except Exception as exc:
        log.warning("Could not write export manifest (%s); continuing.", exc)


if __name__ == "__main__":
    export()
