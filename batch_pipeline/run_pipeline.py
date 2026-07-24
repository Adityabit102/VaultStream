"""End-to-end Medallion runner: Bronze -> Silver -> Gold -> (export).

Local quickstart (no external data needed):
    python -m batch_pipeline.generate_sample_data --out batch_pipeline/sample_data
    VAULTSTREAM_RAW_DIR=batch_pipeline/sample_data python -m batch_pipeline.run_pipeline

Run a single stage:
    python -m batch_pipeline.run_pipeline --stage silver

On Databricks: import the package and call `run_all()` from a notebook, or wire
each stage as a task in a Databricks Job / the Airflow DAG under airflow/.
"""
from __future__ import annotations

import argparse
import json
import time

from . import bronze, export_model_lab, gold, silver
from .spark_utils import confirm_delta, get_spark, log


def run_all(*, do_export: bool = True, enforce_dq: bool = True) -> dict:
    spark = get_spark("vaultstream-medallion")
    confirm_delta(spark)
    t0 = time.time()

    log.info("=== BRONZE ===")
    b = bronze.ingest(spark)

    log.info("=== SILVER ===")
    s = silver.build(spark, enforce_dq=enforce_dq)

    log.info("=== GOLD ===")
    g = gold.build(spark)

    result = {"bronze": b, "silver": s, "gold": g}
    if do_export:
        log.info("=== EXPORT (Model Lab) ===")
        result["export"] = export_model_lab.export(spark)

    result["elapsed_s"] = round(time.time() - t0, 2)
    log.info("Pipeline finished in %.2fs\n%s", result["elapsed_s"], json.dumps(result, indent=2, default=str))
    return result


def main() -> None:
    ap = argparse.ArgumentParser(description="VaultStream Medallion batch pipeline.")
    ap.add_argument("--stage", choices=["bronze", "silver", "gold", "export", "all"], default="all")
    ap.add_argument("--no-export", action="store_true", help="skip the Model Lab export stage")
    ap.add_argument("--no-enforce-dq", action="store_true", help="log DQ failures but don't abort")
    args = ap.parse_args()

    spark = get_spark("vaultstream-medallion")
    if args.stage == "bronze":
        print(json.dumps(bronze.ingest(spark), indent=2, default=str))
    elif args.stage == "silver":
        print(json.dumps(silver.build(spark, enforce_dq=not args.no_enforce_dq), indent=2, default=str))
    elif args.stage == "gold":
        print(json.dumps(gold.build(spark), indent=2, default=str))
    elif args.stage == "export":
        print(json.dumps(export_model_lab.export(spark), indent=2, default=str))
    else:
        run_all(do_export=not args.no_export, enforce_dq=not args.no_enforce_dq)


if __name__ == "__main__":
    main()
