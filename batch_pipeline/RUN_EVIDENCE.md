# Run evidence — what actually executed

Captured 2026-07-24 on macOS (Apple Silicon), OpenJDK 17, Python 3.11.15,
PySpark 3.5.1, delta-spark 3.2.0, apache-airflow 2.9.3. Reproduce with the
commands in `README.md` (env: `.venv-batch`, `JAVA_HOME` = brew openjdk@17,
`PYSPARK_PYTHON` pinned to the venv so workers match the driver).

## 1. Full Medallion pipeline through real Spark + Delta

`python -m batch_pipeline.run_pipeline` on 6,010 sample rows:

```
STORAGE FORMAT ACTIVE = delta  (extension wired=True, databricks=False)
=== BRONZE ===  Bronze ingest complete: {'bronze_transaction_rows': 6010, 'bronze_identity_rows': 4298, ...}
=== SILVER ===  DQ passed: shrink=0.0075 dup=0.0000 orphans=30 drift=False
                Silver complete: 5965 rows (dropped 35 null-critical, 30 orphans).
=== GOLD   ===  Gold complete: {'fact_rows': 5965, 'accounts': 241, 'devices': 15, 'dates': 109, 'fraud_rows': 628}
=== EXPORT ===  Model Lab export complete: 5965 rows
Pipeline finished in 14.14s
```

**Delta confirmed (not Parquet fallback):** every layer has a `_delta_log/`, and
`DESCRIBE HISTORY delta.\`.../gold/fact_transactions\`` returns `version 0, WRITE`.

**Export schema == Model Lab schema:**
```
tx_count_5m,tx_count_1h,tx_count_24h,avg_amount_1h,amount,unique_merchants_1h,device_shift,amount_zscore,isFraud
```
(identical to `backend/ml/trainer.py::FEATURE_NAMES + isFraud`.)

**Sample real Gold feature rows** (account 10000, time-ordered) — note row 2's
`amount_zscore = -0.707` = -1/√2, the exact sample-std z-score of the 2nd point, an
independent check that the expanding window math is right:
```
{tx_count_24h: 1, avg_amount_1h: 42.48, device_shift: 0, amount_zscore:  0.000}
{tx_count_24h: 2, avg_amount_1h: 33.57, device_shift: 1, amount_zscore: -0.707}
{tx_count_24h: 1, avg_amount_1h: 27.62, device_shift: 0, amount_zscore: -0.927}
```

## 2. DQ gate actually aborts a bad run

`dq.enforce()` on a report breaching the row-count reconciliation bound:
```
DQ GATE FIRED as expected -> DataQualityError: Critical data-quality failure(s): row-count shrink 0.40 exceeds bound 0.15 ...
Passing report -> no raise (correct)
```

## 3. Airflow DAG — `airflow dags test vaultstream_medallion 2026-07-24`

Airflow 2.9.3, isolated `AIRFLOW_HOME`, SequentialExecutor, DAG discovered with
**zero import errors**. All four tasks ran the real Spark stages:

```
Marking task as SUCCESS ... task_id=bronze_ingest
DQ passed: shrink=0.0075 dup=0.0000 orphans=30 drift=False
Marking task as SUCCESS ... task_id=silver_clean_and_dq
Marking task as SUCCESS ... task_id=gold_features_star_schema
Marking task as SUCCESS ... task_id=export_to_model_lab
Marking run <DagRun vaultstream_medallion ...> successful
DagRun Finished: ... state=success
```

The DQ gate lives inside `silver_clean_and_dq` (`enforce_dq=True`), so a failing run
raises there and blocks `gold_*` downstream — the intended Bronze→Silver→Gold order
is enforced by real task dependencies, not just documented.

## 4. Feature-parity test (no Spark/Java needed)

`python -m pytest batch_pipeline/tests/` → 5 passed (online Welford z-score ==
batch expanding; window-count and device-shift parity).

## 5. Full REAL IEEE-CIS file through Spark + Delta

`VAULTSTREAM_RAW_DIR=data/raw python -m batch_pipeline.run_pipeline` on the real
652 MB / 590,540-row transaction file + 144,233 identity rows:

```
STORAGE FORMAT ACTIVE = delta  (extension wired=True, databricks=False)
Bronze ingest complete: {'bronze_transaction_rows': 590540, 'bronze_identity_rows': 144233, ...}
DQ passed: shrink=0.0000 dup=0.0000 orphans=0 drift=False
Silver complete: 590540 rows (dropped 0 null-critical, 0 orphans).
Gold complete: {'fact_rows': 590540, 'accounts': 13553, 'devices': 1936, 'dates': 183, 'fraud_rows': 20663}
Model Lab export complete: 590540 rows
Pipeline finished in 32.94s        # laptop, local[*], single JVM
```

- **Correctness signal:** fraud_rows / total = 20,663 / 590,540 = **3.5%**, which
  matches IEEE-CIS's documented fraud rate — the label survived the whole pipeline
  intact.
- **Window-function observation (this is the Option-B data point from
  `WINDOW_FUNCTION_NOTE.md`):** the **unbounded** expanding z-score window ran over
  all 13,553 accounts — including the hot 14,932-row `card1` — in **33 s with no OOM
  and no spill errors** on a laptop. So at real IEEE-CIS scale the unbounded window
  is not a problem; the note's concern is about 100× volume, not this dataset.

## What did NOT run here

- **Databricks** — no unattended signup path (email verification + no API token
  until a human signs in). Everything for that run is prepared:
  `DATABRICKS_RUNBOOK.md` + `databricks/vaultstream_medallion_notebook.py`.
```
