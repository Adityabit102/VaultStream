"""Spark session + storage helpers shared by every layer.

Two design choices worth calling out:

1. Delta Lake is the design-doc default (ACID + time travel + schema
   enforcement). But Delta needs extra jars that aren't always present locally,
   so `get_spark()` tries to wire Delta up and transparently falls back to plain
   Parquet if the Delta package can't be configured. Either way the layer code
   calls `write_table` / `read_table` and doesn't care which format is active.

2. Reading/writing goes through `write_table`/`read_table` so switching between
   local folders and `s3://vaultstream-batch/...` is purely a config change.
"""
from __future__ import annotations

import logging

from pyspark.sql import DataFrame, SparkSession

from . import config

log = logging.getLogger("vaultstream.batch")
if not log.handlers:
    _h = logging.StreamHandler()
    _h.setFormatter(logging.Formatter("%(asctime)s  %(levelname)-5s  %(message)s", "%H:%M:%S"))
    log.addHandler(_h)
log.setLevel(logging.INFO)


_ACTIVE_FORMAT = {"value": None}  # resolved once the session is built


def get_spark(app_name: str = "vaultstream-batch") -> SparkSession:
    """Build (or fetch) the shared SparkSession, wiring Delta Lake when available.

    On Databricks the runtime already provides a Delta-enabled session, so
    `SparkSession.getActiveSession()` short-circuits all of this.
    """
    active = SparkSession.getActiveSession()
    if active is not None:
        # An active session almost always means Databricks (or a notebook whose
        # session is already Delta-enabled). Delta is guaranteed there, so we
        # never downgrade to the Parquet fallback in that environment.
        _ACTIVE_FORMAT["value"] = "delta" if config.on_databricks() else config.STORAGE_FORMAT
        log.info("Reusing active Spark session (format=%s, databricks=%s).",
                 _ACTIVE_FORMAT["value"], config.on_databricks())
        return active

    builder = (
        SparkSession.builder.appName(app_name)
        .master(__import__("os").environ.get("SPARK_MASTER", "local[*]"))
        .config("spark.sql.shuffle.partitions", "8")
        .config("spark.ui.showConsoleProgress", "false")
    )

    if config.STORAGE_FORMAT == "delta":
        try:
            from delta import configure_spark_with_delta_pip

            builder = (
                builder
                .config("spark.sql.extensions", "io.delta.sql.DeltaSparkSessionExtension")
                .config(
                    "spark.sql.catalog.spark_catalog",
                    "org.apache.spark.sql.delta.catalog.DeltaCatalog",
                )
            )
            spark = configure_spark_with_delta_pip(builder).getOrCreate()
            _ACTIVE_FORMAT["value"] = "delta"
            log.info("Spark session ready (Delta Lake enabled).")
            return spark
        except Exception as exc:  # delta-spark missing or jars unresolved
            log.warning("Delta Lake unavailable (%s); falling back to Parquet.", exc)

    spark = builder.getOrCreate()
    _ACTIVE_FORMAT["value"] = "parquet"
    log.info("Spark session ready (Parquet storage).")
    return spark


def active_format() -> str:
    return _ACTIVE_FORMAT["value"] or "parquet"


def confirm_delta(spark: SparkSession) -> bool:
    """Log + return whether writes will actually use Delta (vs the Parquet
    fallback). Call this at the top of a run so the output makes the storage
    format unambiguous -- the whole point of the Databricks run is to exercise
    Delta, not Parquet."""
    fmt = active_format()
    if fmt == "delta":
        # Prove the Delta SQL extension is really wired into this session.
        try:
            wired = "DeltaSparkSessionExtension" in (
                spark.conf.get("spark.sql.extensions", "") or ""
            ) or config.on_databricks()
        except Exception:
            wired = config.on_databricks()
        log.info("STORAGE FORMAT ACTIVE = delta  (extension wired=%s, databricks=%s)",
                 wired, config.on_databricks())
        return True
    log.warning("STORAGE FORMAT ACTIVE = parquet  (Delta fallback in effect -- "
                "this is expected only when the Delta jars are unavailable).")
    return False


def write_table(df: DataFrame, path: str, mode: str = "overwrite",
                partition_by: list[str] | None = None) -> None:
    """Write a DataFrame to `path` in the active storage format."""
    fmt = active_format()
    writer = df.write.format(fmt).mode(mode)
    if partition_by:
        writer = writer.partitionBy(*partition_by)
    if fmt == "delta":
        writer = writer.option("overwriteSchema", "true") if mode == "overwrite" else writer
        writer = writer.option("mergeSchema", "true") if mode == "append" else writer
    writer.save(path)
    log.info("Wrote %s  (%s, mode=%s)", path, fmt, mode)


def read_table(spark: SparkSession, path: str) -> DataFrame:
    return spark.read.format(active_format()).load(path)
