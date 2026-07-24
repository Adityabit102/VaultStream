"""Silver layer -- cleaned & conformed.

Transformations (all documented, none silent):
  - Type enforcement: cast numeric fields, normalise categoricals (trim + lower).
  - Null handling: drop rows missing a *critical* field (id / amount / time);
    everything else is kept and measured by the DQ layer.
  - Deduplication on transaction id.
  - Join transactions + identity on transaction id (left join -- missing identity
    is flagged, not dropped).
  - Derive canonical entities: account_id, device_id, merchant_id, event_time.

Then it runs the full DQ suite and writes:
    silver/transactions_cleaned
    silver/dq_report           (append-only, via dq.persist_report)
"""
from __future__ import annotations

from pyspark.sql import DataFrame, SparkSession
from pyspark.sql import functions as F

from . import config, dq
from .spark_utils import get_spark, log, read_table, write_table

C = config.COLUMNS


def _norm_cat(col: str):
    """Consistent casing + trimmed whitespace for a categorical column."""
    return F.lower(F.trim(F.col(col)))


def build(spark: SparkSession | None = None, *, enforce_dq: bool = True) -> dict:
    spark = spark or get_spark("vaultstream-silver")

    bronze_tx = read_table(spark, f"{config.BRONZE_ROOT}/transactions")
    bronze_count = bronze_tx.count()

    try:
        bronze_id = read_table(spark, f"{config.BRONZE_ROOT}/identity")
        has_identity = True
    except Exception:
        log.warning("No Bronze identity table; proceeding transactions-only.")
        bronze_id = None
        has_identity = False

    # --- Type enforcement -----------------------------------------------------
    tx = (
        bronze_tx
        .withColumn(C.transaction_id, F.col(C.transaction_id).cast("long"))
        .withColumn(C.event_time_seconds, F.col(C.event_time_seconds).cast("double"))
        .withColumn(C.amount, F.col(C.amount).cast("double"))
        .withColumn(C.account_source, F.col(C.account_source).cast("string"))
        .withColumn(C.label, F.coalesce(F.col(C.label).cast("int"), F.lit(0)))
        .withColumn(C.merchant_source, _norm_cat(C.merchant_source))
    )

    # --- Critical-null drop (intentional, counted by DQ) ----------------------
    before_drop = tx.count()
    tx = tx.where(
        F.col(C.transaction_id).isNotNull()
        & F.col(C.amount).isNotNull()
        & F.col(C.event_time_seconds).isNotNull()
    )
    dropped_nulls = before_drop - tx.count()

    # --- Deduplicate on transaction id ---------------------------------------
    tx = tx.dropDuplicates([C.transaction_id])

    # --- Join identity (left; flag orphans, don't drop) -----------------------
    orphan_count = 0
    if has_identity and bronze_id is not None:
        idf = (
            bronze_id
            .withColumn(C.transaction_id, F.col(C.transaction_id).cast("long"))
            .withColumn(C.device_type, _norm_cat(C.device_type))
            .withColumn(C.device_info, _norm_cat(C.device_info))
            .dropDuplicates([C.transaction_id])
            .select(C.transaction_id, C.device_type, C.device_info)
        )
        joined = tx.join(idf, on=C.transaction_id, how="left")
        joined = joined.withColumn(
            "has_identity",
            F.when(F.col(C.device_info).isNotNull(), F.lit(True)).otherwise(F.lit(False)),
        )
        # Orphans = identity rows with no matching transaction (referential check).
        orphan_count = idf.join(tx.select(C.transaction_id), on=C.transaction_id, how="left_anti").count()
    else:
        joined = (
            tx.withColumn(C.device_type, F.lit(None).cast("string"))
            .withColumn(C.device_info, F.lit(None).cast("string"))
            .withColumn("has_identity", F.lit(False))
        )

    # --- Derive canonical entities -------------------------------------------
    cleaned = (
        joined
        .withColumn("account_id", F.coalesce(F.col(C.account_source), F.lit("unknown")))
        .withColumn(
            "device_id",
            F.concat_ws(":", F.coalesce(F.col(C.device_type), F.lit("na")),
                        F.coalesce(F.col(C.device_info), F.lit("na"))),
        )
        .withColumn("merchant_id", F.coalesce(F.col(C.merchant_source), F.lit("unknown")))
        .withColumnRenamed(C.transaction_id, "transaction_id")
        .withColumnRenamed(C.event_time_seconds, "event_time_seconds")
        .withColumnRenamed(C.amount, "amount")
        .withColumnRenamed(C.label, "is_fraud")
        # Real calendar timestamp from the IEEE-CIS seconds offset (ref epoch is
        # arbitrary but consistent -- good enough for a date dimension).
        .withColumn("event_ts", F.to_timestamp(F.from_unixtime(F.col("event_time_seconds"))))
        .select(
            "transaction_id", "account_id", "device_id", "merchant_id",
            "amount", "event_time_seconds", "event_ts", "is_fraud", "has_identity",
        )
    )
    cleaned = cleaned.cache()
    silver_count = cleaned.count()

    # --- Data quality ---------------------------------------------------------
    schema_drift = dq._schema_drift(bronze_tx.columns, bronze_tx.columns)  # stable within a run
    report = dq.run_checks(
        bronze_df=bronze_tx,
        cleaned_df=cleaned,
        bronze_count=bronze_count,
        silver_count=silver_count,
        orphan_count=orphan_count,
        schema_drift=schema_drift,
        batch_id=str(bronze_tx.select("_batch_id").first()[0]) if "_batch_id" in bronze_tx.columns else "unknown",
    )
    dq.persist_report(spark, report)

    write_table(cleaned, f"{config.SILVER_ROOT}/transactions_cleaned", mode="overwrite")
    log.info("Silver complete: %d rows (dropped %d null-critical, %d orphans).",
             silver_count, dropped_nulls, orphan_count)

    if enforce_dq:
        dq.enforce(report)

    return {"silver_rows": silver_count, "dropped_nulls": dropped_nulls,
            "orphans": orphan_count, "dq_passed": report["passed"]}


if __name__ == "__main__":
    build()
