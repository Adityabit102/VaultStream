# Databricks notebook source
# MAGIC %md
# MAGIC # VaultStream — Medallion batch pipeline (Databricks driver)
# MAGIC
# MAGIC Runs Bronze → Silver → Gold → export on a Databricks cluster using **Delta**
# MAGIC as the real storage format. This notebook is UI-edition-agnostic: it works on
# MAGIC classic Community Edition clusters and on serverless Free Edition, because it
# MAGIC only relies on `spark` + environment variables + the paths you set below.
# MAGIC
# MAGIC See `DATABRICKS_RUNBOOK.md` for the manual signup / upload steps that get the
# MAGIC code and the IEEE-CIS files onto the workspace before you run this.

# COMMAND ----------
# MAGIC %md ## 1. Point Python at the uploaded pipeline code
# MAGIC Adjust the path to wherever you uploaded the `batch_pipeline/` folder
# MAGIC (a Volume, a Repo, or an unzipped DBFS path).

# COMMAND ----------
import sys, os

# Where the *parent* of the batch_pipeline/ package lives on the workspace.
# Examples:
#   Repos:   "/Workspace/Repos/you@email/VaultStream"
#   Volume:  "/Volumes/main/vaultstream/code"
#   DBFS:    "/dbfs/FileStore/vaultstream"
CODE_PARENT = "/Workspace/Repos/CHANGE_ME/VaultStream"   # <-- EDIT
if CODE_PARENT not in sys.path:
    sys.path.insert(0, CODE_PARENT)

# COMMAND ----------
# MAGIC %md ## 2. Configure storage + source paths (env-driven — no source edits)
# MAGIC The pipeline reads every path from these env vars (see `batch_pipeline/config.py`).
# MAGIC Delta is the runtime default and is confirmed active below.

# COMMAND ----------
# Medallion warehouse root — a Delta-friendly location on the workspace.
os.environ["VAULTSTREAM_BATCH_ROOT"] = "dbfs:/vaultstream/warehouse"   # or a Volume path
# Where you uploaded train_transaction.csv + train_identity.csv.
os.environ["VAULTSTREAM_RAW_DIR"]    = "dbfs:/vaultstream/raw"          # <-- where you put the CSVs
os.environ["VAULTSTREAM_BATCH_FORMAT"] = "delta"
# Redirect the local convenience artifacts to a writable driver-local path.
os.environ["VAULTSTREAM_DQ_SNAPSHOT"]    = "/tmp/vaultstream_dq_report_latest.json"
os.environ["VAULTSTREAM_EXPORT_MANIFEST"] = "/tmp/vaultstream_export_manifest.json"

# COMMAND ----------
# MAGIC %md ## 3. Confirm Delta is the active format (not the Parquet fallback)

# COMMAND ----------
from batch_pipeline.spark_utils import get_spark, confirm_delta
spark_session = get_spark("vaultstream-medallion-databricks")
assert confirm_delta(spark_session), "Expected Delta to be active on Databricks!"

# COMMAND ----------
# MAGIC %md ## 4. Run the stages in order
# MAGIC Each stage is a separate cell so you can inspect between them. The DQ gate in
# MAGIC Silver raises `DataQualityError` on a bad run and stops here before Gold.

# COMMAND ----------
from batch_pipeline import bronze, silver, gold, export_model_lab

print(bronze.ingest(spark_session))

# COMMAND ----------
print(silver.build(spark_session, enforce_dq=True))   # DQ gate here

# COMMAND ----------
print(gold.build(spark_session))

# COMMAND ----------
print(export_model_lab.export(spark_session))

# COMMAND ----------
# MAGIC %md ## 5. Inspect the outputs as Delta tables (time travel, history)

# COMMAND ----------
display(spark.read.format("delta").load("dbfs:/vaultstream/warehouse/gold/fact_transactions").limit(20))

# COMMAND ----------
# The append-only DQ history — one row per run.
display(spark.read.format("delta").load("dbfs:/vaultstream/warehouse/silver/dq_report"))

# COMMAND ----------
# Delta history proves ACID commits (not plain Parquet).
display(spark.sql("DESCRIBE HISTORY delta.`dbfs:/vaultstream/warehouse/gold/fact_transactions`"))
