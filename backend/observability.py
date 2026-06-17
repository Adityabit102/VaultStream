"""Prometheus metrics + fraud notifications for VaultStream."""
import os
import json
import time
import urllib.request

from prometheus_client import Counter, Histogram, Gauge, generate_latest, CONTENT_TYPE_LATEST
from fastapi import APIRouter
from fastapi.responses import Response

router = APIRouter()

SCORE_LATENCY = Histogram(
    "vaultstream_scoring_latency_seconds",
    "End-to-end transaction scoring latency",
    buckets=(0.005, 0.01, 0.02, 0.03, 0.05, 0.1, 0.25, 0.5, 1.0),
)
VERDICTS = Counter("vaultstream_verdicts_total", "Scored transactions by verdict", ["label"])
INGEST_TOTAL = Counter("vaultstream_ingest_total", "Total transactions ingested")
ACTIVE_MODEL_AUC = Gauge("vaultstream_model_val_auc", "Validation AUC of the live model")


@router.get("/metrics")
def metrics():
    return Response(generate_latest(), media_type=CONTENT_TYPE_LATEST)


def observe_score(latency_s: float, label: str):
    try:
        SCORE_LATENCY.observe(latency_s)
        VERDICTS.labels(label=label).inc()
        INGEST_TOTAL.inc()
    except Exception:
        pass


def notify_fraud(alert: dict):
    """Fire a Slack/Discord/webhook notification on a FRAUD verdict if a webhook
    URL is configured (NOTIFY_WEBHOOK_URL). No-op otherwise."""
    url = os.environ.get("NOTIFY_WEBHOOK_URL", "").strip()
    if not url or "your-" in url:
        print(f"[NOTIFY] FRAUD {alert.get('transaction_id')} score={alert.get('risk_score')} (no webhook configured)")
        return
    score = alert.get("risk_score", 0)
    text = (
        f":rotating_light: *VaultStream — FRAUD detected*\n"
        f"> Transaction `{alert.get('transaction_id')}` · entity `{alert.get('entity_id')}`\n"
        f"> Risk score *{round(float(score) * 100, 1)}%* at {time.strftime('%Y-%m-%d %H:%M:%S UTC', time.gmtime())}"
    )
    payload = json.dumps({"text": text}).encode("utf-8")
    try:
        req = urllib.request.Request(url, data=payload, headers={"Content-Type": "application/json"})
        urllib.request.urlopen(req, timeout=4)
    except Exception as e:
        print(f"[NOTIFY] webhook failed: {e}")
