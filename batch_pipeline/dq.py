"""Data-quality checks + the append-only `silver.dq_report` log.

This is the "improve data quality, validation, and monitoring" deliverable. Each
check returns a structured metric with a pass/fail verdict; the run collects them
into a report that is (a) appended to the `silver/dq_report` table for history and
(b) snapshotted to JSON for the dashboard / frontend. Critical failures raise so a
bad run can't silently poison the retraining dataset.
"""
from __future__ import annotations

import json
import os
import time

from pyspark.sql import DataFrame
from pyspark.sql import functions as F

from . import config
from .spark_utils import log, write_table


class DataQualityError(RuntimeError):
    """Raised when a critical DQ check fails -- aborts the run."""


def _null_rates(df: DataFrame, total: int) -> dict:
    if total == 0:
        return {c: 0.0 for c in df.columns}
    exprs = [
        F.sum(F.when(F.col(c).isNull() | (F.trim(F.col(c).cast("string")) == ""), 1).otherwise(0)).alias(c)
        for c in df.columns
    ]
    row = df.agg(*exprs).collect()[0].asDict()
    return {c: round(row[c] / total, 6) for c in df.columns}


def _duplicate_rate(df: DataFrame, key: str, total: int) -> float:
    if total == 0 or key not in df.columns:
        return 0.0
    distinct = df.select(key).where(F.col(key).isNotNull()).distinct().count()
    # duplicate rows = rows with a non-null key minus distinct keys
    non_null = df.where(F.col(key).isNotNull()).count()
    dupes = max(0, non_null - distinct)
    return round(dupes / total, 6)


def _schema_drift(bronze_cols: list[str], silver_input_cols: list[str]) -> dict:
    b, s = set(bronze_cols), set(silver_input_cols)
    return {
        "new_columns": sorted(s - b),
        "missing_columns": sorted(b - s),
        "drift_detected": bool((s - b) or (b - s)),
    }


def run_checks(
    *,
    bronze_df: DataFrame,
    cleaned_df: DataFrame,
    bronze_count: int,
    silver_count: int,
    orphan_count: int,
    schema_drift: dict,
    batch_id: str,
) -> dict:
    """Evaluate every DQ check and assemble the report. Raises DataQualityError
    on any critical failure."""
    failures: list[str] = []

    # 1. Null-rate per column, thresholded on critical columns.
    null_rates = _null_rates(cleaned_df, silver_count)
    null_breaches = []
    for col, bound in config.DQ.critical_null_rate.items():
        rate = null_rates.get(col)
        if rate is not None and rate > bound:
            msg = f"null-rate {col}={rate:.4f} exceeds bound {bound}"
            null_breaches.append(msg)
            failures.append(msg)

    # 2. Duplicate-rate on transaction id.
    dup_rate = _duplicate_rate(cleaned_df, config.COLUMNS.transaction_id, silver_count)
    if dup_rate > config.DQ.max_duplicate_rate:
        failures.append(f"duplicate-rate {dup_rate:.4f} exceeds bound {config.DQ.max_duplicate_rate}")

    # 3. Row-count reconciliation Bronze -> Silver.
    shrink = round((bronze_count - silver_count) / bronze_count, 6) if bronze_count else 0.0
    if shrink > config.DQ.max_rowcount_shrink:
        failures.append(
            f"row-count shrink {shrink:.4f} exceeds bound {config.DQ.max_rowcount_shrink} "
            f"(bronze={bronze_count}, silver={silver_count})"
        )

    # 4. Schema drift (advisory -- alert, don't fail).
    report = {
        "batch_id": batch_id,
        "checked_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "bronze_rows": bronze_count,
        "silver_rows": silver_count,
        "rowcount_shrink_rate": shrink,
        "duplicate_rate": dup_rate,
        "orphan_identity_rows": orphan_count,
        "null_rates": null_rates,
        "null_rate_breaches": null_breaches,
        "schema_drift": schema_drift,
        "passed": len(failures) == 0,
        "failures": failures,
    }

    if failures:
        log.error("DQ FAILED (%d critical issue(s)): %s", len(failures), "; ".join(failures))
    else:
        log.info("DQ passed: shrink=%.4f dup=%.4f orphans=%d drift=%s",
                 shrink, dup_rate, orphan_count, schema_drift["drift_detected"])
    return report


def persist_report(spark, report: dict) -> None:
    """Append the report to `silver/dq_report` and snapshot latest to JSON."""
    # Store null_rates / schema_drift / failures as JSON strings so the table
    # stays a stable, flat, append-friendly shape across runs.
    flat = {
        "batch_id": report["batch_id"],
        "checked_at": report["checked_at"],
        "bronze_rows": int(report["bronze_rows"]),
        "silver_rows": int(report["silver_rows"]),
        "rowcount_shrink_rate": float(report["rowcount_shrink_rate"]),
        "duplicate_rate": float(report["duplicate_rate"]),
        "orphan_identity_rows": int(report["orphan_identity_rows"]),
        "drift_detected": bool(report["schema_drift"]["drift_detected"]),
        "passed": bool(report["passed"]),
        "null_rates_json": json.dumps(report["null_rates"]),
        "schema_drift_json": json.dumps(report["schema_drift"]),
        "failures_json": json.dumps(report["failures"]),
    }
    df = spark.createDataFrame([flat])
    write_table(df, f"{config.SILVER_ROOT}/dq_report", mode="append")
    _write_snapshot(report)


def _write_snapshot(report: dict) -> None:
    # Convenience artifact written to the driver's local disk. Never fatal: a
    # failure here (e.g. read-only path on a cluster) must not fail the run.
    path = config.DQ_SNAPSHOT_PATH
    try:
        if config.is_local_path(path):
            os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
            with open(path, "w") as fh:
                json.dump(report, fh, indent=2)
            log.info("DQ snapshot written -> %s", path)
        else:
            log.info("DQ snapshot path is remote (%s); skipping local snapshot.", path)
    except Exception as exc:
        log.warning("Could not write DQ snapshot (%s); continuing.", exc)


def enforce(report: dict) -> None:
    if not report["passed"]:
        raise DataQualityError(
            "Critical data-quality failure(s): " + "; ".join(report["failures"])
        )
