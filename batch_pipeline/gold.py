"""Gold layer -- business-ready, feature-engineered.

Recomputes the *same* behavioural features the real-time path scores with, but
over full history in batch. Parity mapping (see the design doc's parity table):

  Real-time (Redis, online)            Batch (PySpark window functions)
  ---------------------------------    ------------------------------------------
  tx_count_5m / 1h / 24h counters      range windows over event_time_seconds
  sum_amount_1h -> avg_amount_1h       sum over 1h range window / tx_count_1h
  unique merchants zset (1h)           size(collect_set(merchant)) over 1h window
  device_shift (last_device compare)   lag(device_id) over account, time-ordered
  Welford online amount z-score        expanding sample mean/std, time-ordered

The z-score uses an *expanding* window that includes the current transaction and
the (n-1) sample-std denominator -- this matches the real-time store's
update-then-read ordering (see backend/api/predict.py), so a batch feature row is
directly comparable to what the live model saw. First-transaction z-score is 0
(std undefined), exactly like the live path's `std > 0` guard.

Outputs a Kimball-style star schema:
    gold/fact_transactions   (one row per txn, all engineered features + label)
    gold/dim_account
    gold/dim_device
    gold/dim_date
"""
from __future__ import annotations

from pyspark.sql import SparkSession, Window
from pyspark.sql import functions as F

from . import config
from .spark_utils import get_spark, log, read_table, write_table


def _add_features(df):
    """Attach the 8 parity features to the cleaned Silver transactions."""
    by_time = Window.partitionBy("account_id").orderBy(F.col("event_time_seconds"))
    # rowsBetween expanding needs a total order -> tie-break on transaction_id.
    #
    # SCALING DECISION (see WINDOW_FUNCTION_NOTE.md): this expanding frame is
    # deliberately left UNBOUNDED to observe real behaviour on the cluster rather
    # than pre-emptively bounding it. Observed so far: the full 590,540-row
    # IEEE-CIS file (13,553 accounts, hottest card1 = 14,932 txns) ran in ~33s
    # with no spill/OOM on a single local JVM. If this is ever pointed at ~100x
    # volume, bound it to a 30-day `rangeBetween(-2_592_000, 0)` window -- that
    # both caps the hot-account frame AND tightens parity with the real-time
    # path, whose Redis Welford stats keys expire after exactly 30 days.
    expanding = (
        Window.partitionBy("account_id")
        .orderBy(F.col("event_time_seconds"), F.col("transaction_id"))
        .rowsBetween(Window.unboundedPreceding, Window.currentRow)
    )
    seq = Window.partitionBy("account_id").orderBy(F.col("event_time_seconds"), F.col("transaction_id"))

    w_5m = by_time.rangeBetween(-config.WINDOW_5M_SECONDS, 0)
    w_1h = by_time.rangeBetween(-config.WINDOW_1H_SECONDS, 0)
    w_24h = by_time.rangeBetween(-config.WINDOW_24H_SECONDS, 0)

    out = (
        df
        .withColumn("tx_count_5m", F.count(F.lit(1)).over(w_5m))
        .withColumn("tx_count_1h", F.count(F.lit(1)).over(w_1h))
        .withColumn("tx_count_24h", F.count(F.lit(1)).over(w_24h))
        .withColumn("sum_amount_1h", F.sum("amount").over(w_1h))
        .withColumn("unique_merchants_1h", F.size(F.collect_set("merchant_id").over(w_1h)))
        # device shift vs the account's previous transaction
        .withColumn("_prev_device", F.lag("device_id").over(seq))
        .withColumn(
            "device_shift",
            F.when(F.col("_prev_device").isNotNull() & (F.col("_prev_device") != F.col("device_id")), 1).otherwise(0),
        )
        # expanding (Welford-equivalent) amount z-score
        .withColumn("_amt_mean", F.avg("amount").over(expanding))
        .withColumn("_amt_std", F.stddev_samp("amount").over(expanding))
    )
    out = (
        out
        .withColumn("avg_amount_1h", F.col("sum_amount_1h") / F.greatest(F.col("tx_count_1h"), F.lit(1)))
        .withColumn("unique_merchants_1h", F.greatest(F.col("unique_merchants_1h"), F.lit(1)))
        .withColumn(
            "amount_zscore",
            F.when((F.col("_amt_std").isNotNull()) & (F.col("_amt_std") > 0),
                   (F.col("amount") - F.col("_amt_mean")) / F.col("_amt_std")).otherwise(F.lit(0.0)),
        )
        .drop("_prev_device", "_amt_mean", "_amt_std")
    )
    return out


def build(spark: SparkSession | None = None) -> dict:
    spark = spark or get_spark("vaultstream-gold")

    silver = read_table(spark, f"{config.SILVER_ROOT}/transactions_cleaned")
    feat = _add_features(silver)

    # date key for the star schema
    feat = feat.withColumn("date_key", F.date_format(F.col("event_ts"), "yyyyMMdd").cast("int"))

    # --- gold.fact_transactions ----------------------------------------------
    fact = feat.select(
        "transaction_id", "account_id", "device_id", "merchant_id", "date_key",
        "amount", "event_ts",
        "tx_count_5m", "tx_count_1h", "tx_count_24h", "avg_amount_1h",
        "unique_merchants_1h", "device_shift", "amount_zscore",
        F.col("is_fraud").alias("isFraud"),
    )
    fact = fact.cache()
    fact_count = fact.count()
    write_table(fact, f"{config.GOLD_ROOT}/fact_transactions", mode="overwrite", partition_by=["date_key"])

    # --- gold.dim_account -----------------------------------------------------
    dim_account = (
        feat.groupBy("account_id").agg(
            F.min("event_ts").alias("first_seen"),
            F.max("event_ts").alias("last_seen"),
            F.count(F.lit(1)).alias("tx_count"),
            F.sum("is_fraud").alias("fraud_count"),
            F.countDistinct("device_id").alias("distinct_devices"),
            F.avg("amount").alias("avg_amount"),
        )
        .withColumn("fraud_rate", F.round(F.col("fraud_count") / F.col("tx_count"), 4))
    )
    write_table(dim_account, f"{config.GOLD_ROOT}/dim_account", mode="overwrite")

    # --- gold.dim_device ------------------------------------------------------
    dim_device = feat.groupBy("device_id").agg(
        F.count(F.lit(1)).alias("tx_count"),
        F.countDistinct("account_id").alias("distinct_accounts"),
        F.sum("is_fraud").alias("fraud_count"),
    )
    write_table(dim_device, f"{config.GOLD_ROOT}/dim_device", mode="overwrite")

    # --- gold.dim_date --------------------------------------------------------
    dim_date = (
        feat.select("date_key", "event_ts").dropDuplicates(["date_key"])
        .withColumn("year", F.year("event_ts"))
        .withColumn("month", F.month("event_ts"))
        .withColumn("day", F.dayofmonth("event_ts"))
        .withColumn("day_of_week", F.dayofweek("event_ts"))
        .withColumn("is_weekend", F.when(F.dayofweek("event_ts").isin(1, 7), 1).otherwise(0))
        .drop("event_ts")
    )
    write_table(dim_date, f"{config.GOLD_ROOT}/dim_date", mode="overwrite")

    summary = {
        "fact_rows": fact_count,
        "accounts": dim_account.count(),
        "devices": dim_device.count(),
        "dates": dim_date.count(),
        "fraud_rows": fact.where(F.col("isFraud") == 1).count(),
    }
    log.info("Gold complete: %s", summary)
    return summary


if __name__ == "__main__":
    build()
