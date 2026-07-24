"""Phase 4 (optional) -- Airflow DAG that schedules the Medallion run.

Drop this into your Airflow `dags/` folder. It runs Bronze -> Silver -> Gold ->
export as separate tasks so each stage is independently retryable and the DQ gate
in Silver naturally blocks Gold when a run is bad (the task raises).

This uses the TaskFlow API with PythonOperator-style callables that shell into the
same package the local runner uses, so there is exactly one implementation of the
pipeline. On Databricks you'd swap these for DatabricksSubmitRunOperator tasks
pointing at a job cluster; the task graph is identical.
"""
from __future__ import annotations

from datetime import datetime, timedelta

try:
    from airflow import DAG
    from airflow.operators.python import PythonOperator
    _AIRFLOW = True
except Exception:  # airflow not installed -- keep the file importable for linting
    _AIRFLOW = False


def _bronze(**_):
    from batch_pipeline import bronze
    return bronze.ingest()


def _silver(**_):
    from batch_pipeline import silver
    # enforce_dq=True -> a failing DQ check raises here and blocks Gold downstream.
    return silver.build(enforce_dq=True)


def _gold(**_):
    from batch_pipeline import gold
    return gold.build()


def _export(**_):
    from batch_pipeline import export_model_lab
    return export_model_lab.export()


default_args = {
    "owner": "vaultstream",
    "retries": 2,
    "retry_delay": timedelta(minutes=5),
    "depends_on_past": False,
}

if _AIRFLOW:
    with DAG(
        dag_id="vaultstream_medallion",
        description="Bronze->Silver->Gold historical feature backfill for model retraining",
        schedule="@daily",
        start_date=datetime(2026, 1, 1),
        catchup=False,
        default_args=default_args,
        tags=["vaultstream", "medallion", "pyspark"],
    ) as dag:
        bronze_task = PythonOperator(task_id="bronze_ingest", python_callable=_bronze)
        silver_task = PythonOperator(task_id="silver_clean_and_dq", python_callable=_silver)
        gold_task = PythonOperator(task_id="gold_features_star_schema", python_callable=_gold)
        export_task = PythonOperator(task_id="export_to_model_lab", python_callable=_export)

        bronze_task >> silver_task >> gold_task >> export_task
