# VaultStream — Batch Data Pipeline (PySpark / Databricks Medallion)

A **standalone** batch processing path that runs alongside VaultStream's
real-time Kafka scoring path — without touching it. It recomputes the same
behavioural fraud features over **full historical transaction data** through a
Bronze → Silver → Gold (Medallion) architecture, and produces a retraining
dataset the existing Model Lab can consume.

> One-line story: *real-time Kafka path for live scoring, batch PySpark/Databricks
> path for historical feature backfill and model retraining — the same feature
> logic, two processing paradigms.*

This module is **fully decoupled** from the deployed app:

- Its own [`requirements.txt`](requirements.txt) — **nothing** is added to
  `backend/requirements.txt`, so the Render/Vercel deployment is untouched.
- It is **never imported** by the FastAPI service.
- The only connection to existing VaultStream is additive: the Gold export is a
  drop-in retraining source for the Model Lab (Phase 5).

---

## Architecture

```
 Historical txns ──▶ Bronze ──▶ Silver ──▶ Gold ──▶ Model Lab export
 (IEEE-CIS CSVs)     (raw)     (clean +   (features  (retraining dataset,
                               DQ gate)   + star      schema-matched to the
                                          schema)     existing Model Lab)
```

| Layer | Table(s) | Responsibility |
|---|---|---|
| **Bronze** | `bronze/transactions`, `bronze/identity` | Land raw CSVs as-is (append-only) + lineage columns (ingest ts, source file, checksum). No typing. |
| **Silver** | `silver/transactions_cleaned`, `silver/dq_report` | Type-enforce, dedup on txn id, join identity (flag orphans), derive canonical `account_id` / `device_id` / `merchant_id`, run the **DQ gate**. |
| **Gold** | `gold/fact_transactions`, `gold/dim_account`, `gold/dim_device`, `gold/dim_date` | Recompute the 8 real-time features over history + a Kimball star schema. |
| **Export** | `export/model_lab_training_{csv,parquet}` | Column-matched retraining dataset for the Model Lab. |

Storage is **Delta Lake** by default (ACID + time-travel + schema enforcement),
with an automatic **Parquet fallback** when the Delta jars aren't available, so
it runs anywhere. Point it at S3 for Databricks by setting
`VAULTSTREAM_BATCH_ROOT=s3://vaultstream-batch`.

---

## Feature parity with the real-time path

The Gold layer reproduces exactly the features `backend/api/predict.py` scores,
using PySpark window functions instead of Redis:

| Real-time (online, Redis) | Batch (PySpark) |
|---|---|
| `tx_count_5m` / `1h` / `24h` TTL counters | `count` over `rangeBetween` windows on `event_time_seconds` |
| `sum_amount_1h` → `avg_amount_1h` | `sum` over 1h range window ÷ `tx_count_1h` |
| unique-merchant zset (1h) | `size(collect_set(merchant))` over 1h window |
| device-shift (last-device compare) | `lag(device_id)` over account, time-ordered |
| Welford online amount z-score | expanding sample mean/std, time-ordered |

The z-score parity is the headline claim and is **numerically pinned** by
[`tests/test_feature_parity.py`](tests/test_feature_parity.py): Welford's online
update (read-after-update, `n-1` sample std, `std>0` guard → first-txn z=0)
equals the batch expanding aggregation. That test **runs without Spark or Java**.

The Gold export columns are exactly `backend/ml/trainer.py::FEATURE_NAMES` +
`isFraud`, in order, so it drops into the Model Lab with no code changes there.

---

## Quickstart (local, no external data needed)

Requires **Java 8/11/17** (Spark's only system dependency) and Python 3.10+.

```bash
# 1. isolated env (Python 3.11 — Spark 3.5 / Airflow 2.9 don't support 3.13)
python3.11 -m venv .venv-batch && source .venv-batch/bin/activate
pip install -r batch_pipeline/requirements.txt

# 2. Spark needs Java + the workers must use the SAME interpreter as the driver
export JAVA_HOME="$(/usr/libexec/java_home -v 17)"        # or brew openjdk@17
export PYSPARK_PYTHON="$(pwd)/.venv-batch/bin/python"     # avoids PYTHON_VERSION_MISMATCH
export PYSPARK_DRIVER_PYTHON="$PYSPARK_PYTHON"

# 3. generate IEEE-CIS-shaped sample data (the real CSVs are 652 MB & git-ignored)
python -m batch_pipeline.generate_sample_data --out batch_pipeline/sample_data

# 4. run the full Medallion pipeline on the sample data (writes real Delta tables)
VAULTSTREAM_RAW_DIR=batch_pipeline/sample_data python -m batch_pipeline.run_pipeline
```

> **This has actually been run** — real Spark + Delta end-to-end on both the sample
> and the full 590,540-row IEEE-CIS file (33 s), plus `airflow dags test` with all
> tasks green. See **[RUN_EVIDENCE.md](RUN_EVIDENCE.md)**. For the managed-cluster
> run, see **[DATABRICKS_RUNBOOK.md](DATABRICKS_RUNBOOK.md)** +
> [databricks/vaultstream_medallion_notebook.py](databricks/vaultstream_medallion_notebook.py).
> A note on the one unbounded window function and how to bound it:
> **[WINDOW_FUNCTION_NOTE.md](WINDOW_FUNCTION_NOTE.md)**.

Run one stage at a time with `--stage {bronze,silver,gold,export}`.

**Against the real IEEE-CIS data:** just point at it (default path is already the
repo's `data/raw/`):

```bash
python -m batch_pipeline.run_pipeline          # uses data/raw/train_transaction.csv
```

**Validate feature parity (no Spark/Java required):**

```bash
python -m pytest batch_pipeline/tests/ -q
# or:  python -m batch_pipeline.tests.test_feature_parity
```

---

## Data quality & monitoring (Phase 3 deliverable)

The Silver layer runs a DQ suite on every run and writes an **append-only**
`silver/dq_report` history table plus a JSON snapshot:

- **Null-rate per column**, thresholded — a run **fails** if a critical column
  (`TransactionID`, `TransactionAmt`, `TransactionDT`, `card1`) exceeds its bound.
- **Duplicate-rate** on transaction id.
- **Row-count reconciliation** Bronze → Silver (drops must be intentional; a
  shrink beyond the bound fails the run).
- **Schema-drift** check vs Bronze (advisory alert).
- **Referential check**: orphan identity rows (identity with no transaction) are
  counted, not silently dropped.

A failing DQ gate raises `DataQualityError`, which in the Airflow DAG blocks the
Gold task from running on bad data.

Optional dashboard:

```bash
python -m batch_pipeline.dashboard.dq_dashboard   # http://127.0.0.1:8055
```

The sample generator deliberately seeds a little dirtiness (a few duplicate rows,
some null amounts/accounts, orphan identity rows) so the DQ report catches
something real on the very first run.

---

## Orchestration (Phase 4, optional)

[`airflow/vaultstream_medallion_dag.py`](airflow/vaultstream_medallion_dag.py) is
a daily `bronze → silver → gold → export` DAG. The DQ gate lives in the Silver
task, so a bad run stops before Gold. On Databricks, swap the `PythonOperator`s
for `DatabricksSubmitRunOperator`s pointing at a job cluster — the task graph is
identical.

---

## Configuration

Everything is in [`config.py`](config.py). Common overrides via env var:

| Env var | Default | Purpose |
|---|---|---|
| `VAULTSTREAM_BATCH_ROOT` | `batch_pipeline/warehouse` | Medallion storage root (set to `s3://…` on Databricks) |
| `VAULTSTREAM_RAW_DIR` | `data/raw` | Where the source CSVs live |
| `VAULTSTREAM_BATCH_FORMAT` | `delta` | `delta` or `parquet` |
| `SPARK_MASTER` | `local[*]` | Spark master URL |

---

## What this does NOT touch

Per the design doc's non-goals: no changes to the FastAPI inference endpoints,
the Kafka/Redpanda ingestion, the Redis feature store, the live model artifacts,
the SHAP layer, the rules engine, or RBAC. If a change would require editing an
existing real-time file, it's out of scope — everything here lives in this
module.
