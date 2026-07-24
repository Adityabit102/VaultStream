"""Central configuration for the VaultStream batch pipeline.

Every path, threshold, window, and column mapping the pipeline needs lives here
so the Bronze/Silver/Gold code stays declarative. Paths default to a local
`batch_pipeline/warehouse/` folder for local runs, and can be pointed at
`s3://vaultstream-batch/...` on Databricks via the VAULTSTREAM_BATCH_ROOT env var.
"""
from __future__ import annotations

import os
from dataclasses import dataclass, field

# ---------------------------------------------------------------------------
# Storage roots
# ---------------------------------------------------------------------------
_HERE = os.path.dirname(os.path.abspath(__file__))

# Where the medallion layers are written. Locally this is a folder; on Databricks
# set VAULTSTREAM_BATCH_ROOT=s3://vaultstream-batch to match the design doc.
STORAGE_ROOT = os.environ.get(
    "VAULTSTREAM_BATCH_ROOT", os.path.join(_HERE, "warehouse")
)

BRONZE_ROOT = f"{STORAGE_ROOT}/bronze"
SILVER_ROOT = f"{STORAGE_ROOT}/silver"
GOLD_ROOT = f"{STORAGE_ROOT}/gold"
EXPORT_ROOT = f"{STORAGE_ROOT}/export"

# Where raw source CSVs are read from. Defaults to the repo's IEEE-CIS folder;
# the sample generator writes to `sample_data/` which you can point this at.
RAW_DATA_DIR = os.environ.get(
    "VAULTSTREAM_RAW_DIR", os.path.join(os.path.dirname(_HERE), "data", "raw")
)
RAW_TRANSACTION_FILE = "train_transaction.csv"
RAW_IDENTITY_FILE = "train_identity.csv"

# Remote object-store / DBFS schemes. Anything starting with one of these is NOT
# a local filesystem path, so local-only operations (os.path.exists, checksums,
# json snapshots) must be skipped or redirected for it.
REMOTE_PREFIXES = (
    "s3://", "s3a://", "s3n://", "dbfs:/", "gs://",
    "abfss://", "abfs://", "wasbs://", "wasb://", "hdfs://", "adl://",
)


def is_local_path(path: str) -> bool:
    """True when `path` is an ordinary local filesystem path (not S3/DBFS/etc.).

    This is what lets the SAME code run against local, dbfs:/ and s3:// roots:
    Spark read/write handle every scheme, and the small local-only conveniences
    (checksums, the DQ json snapshot, the export manifest) are gated on this.
    """
    return not str(path).startswith(REMOTE_PREFIXES)


# Small local-only convenience artifacts (read by the Plotly dashboard / frontend
# showcase). These are always written to the DRIVER's local disk -- on Databricks
# that's ephemeral, which is fine, they're conveniences not pipeline state. Both
# are env-overridable so a Databricks/CI run can redirect them.
DQ_SNAPSHOT_PATH = os.environ.get(
    "VAULTSTREAM_DQ_SNAPSHOT", os.path.join(_HERE, "dashboard", "dq_report_latest.json")
)
EXPORT_MANIFEST_PATH = os.environ.get(
    "VAULTSTREAM_EXPORT_MANIFEST", os.path.join(_HERE, "export_manifest.json")
)

# Storage format: "delta" (design-doc default) or "parquet" (fallback used
# automatically when delta-spark / the Delta jars aren't available). On
# Databricks the runtime is always Delta-capable, so the fallback never triggers
# there (see spark_utils.get_spark).
STORAGE_FORMAT = os.environ.get("VAULTSTREAM_BATCH_FORMAT", "delta").lower()


def on_databricks() -> bool:
    """Detect a Databricks runtime (the cluster sets DATABRICKS_RUNTIME_VERSION)."""
    return bool(os.environ.get("DATABRICKS_RUNTIME_VERSION"))


# ---------------------------------------------------------------------------
# Source -> canonical column mapping
# ---------------------------------------------------------------------------
# IEEE-CIS has no explicit account / device / merchant / timestamp columns, so
# the Silver layer derives canonical entities from the raw columns. This mirrors
# exactly what the real-time path does (predict.py hashes entity_id -> card1),
# keeping the two paths conceptually aligned. Documented, not silent.
@dataclass(frozen=True)
class ColumnMap:
    transaction_id: str = "TransactionID"
    # Seconds offset from a reference point -- IEEE-CIS's TransactionDT.
    event_time_seconds: str = "TransactionDT"
    amount: str = "TransactionAmt"
    # Canonical entity ("account") -- card1 is the primary card identifier and is
    # what the live scorer uses as the entity proxy.
    account_source: str = "card1"
    # Device identity -- combined from the identity table.
    device_type: str = "DeviceType"
    device_info: str = "DeviceInfo"
    # Merchant proxy -- IEEE-CIS has no merchant id; the payer email domain is the
    # closest stable per-transaction counterparty signal.
    merchant_source: str = "P_emaildomain"
    label: str = "isFraud"


COLUMNS = ColumnMap()


# ---------------------------------------------------------------------------
# Feature windows -- MUST match the real-time path's TTLs (see backend/api
# feature_store_consumer.py / predict.py) so batch features are directly
# comparable to what the live model scored.
# ---------------------------------------------------------------------------
WINDOW_5M_SECONDS = 5 * 60
WINDOW_1H_SECONDS = 60 * 60
WINDOW_24H_SECONDS = 24 * 60 * 60


# ---------------------------------------------------------------------------
# Data-quality thresholds (Silver). A run FAILS if a critical column's null rate
# exceeds its bound -- drops must be intentional and logged, never silent.
# ---------------------------------------------------------------------------
@dataclass(frozen=True)
class DQThresholds:
    # Per-column max acceptable null rate. Columns not listed are advisory only.
    critical_null_rate: dict = field(default_factory=lambda: {
        COLUMNS.transaction_id: 0.0,      # transaction id must never be null
        COLUMNS.amount: 0.0,              # amount is required to score
        COLUMNS.event_time_seconds: 0.0,  # need a time to window on
        COLUMNS.account_source: 0.02,     # allow a small fraction of missing accounts
    })
    # Fail the run if the duplicate rate on transaction id exceeds this.
    max_duplicate_rate: float = 0.01
    # Fail the run if Silver drops more than this fraction of Bronze rows.
    max_rowcount_shrink: float = 0.15


DQ = DQThresholds()


# The 8-feature schema the existing Model Lab expects (see
# backend/ml/trainer.py FEATURE_NAMES). The Gold export is column-matched to
# this so it drops into retraining with no Model Lab code changes.
MODEL_LAB_FEATURES = [
    "tx_count_5m",
    "tx_count_1h",
    "tx_count_24h",
    "avg_amount_1h",
    "amount",
    "unique_merchants_1h",
    "device_shift",
    "amount_zscore",
]
