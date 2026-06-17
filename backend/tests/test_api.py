"""
API tests for VaultStream — run in mock mode (no DATABASE_URL / Supabase),
so they need no external services. Auth uses the dev `mock-token-{role}` bypass.

    cd backend && pytest -q
"""
import os
import sys

# Ensure mock mode + importability
os.environ.pop("DATABASE_URL", None)
os.environ["SUPABASE_JWT_SECRET"] = "your-jwt-secret"
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest
from fastapi.testclient import TestClient
from main import app

client = TestClient(app)

ADMIN = {"Authorization": "Bearer mock-token-admin"}
ANALYST = {"Authorization": "Bearer mock-token-analyst"}
VIEWER = {"Authorization": "Bearer mock-token-viewer"}


def test_health():
    r = client.get("/health")
    assert r.status_code == 200 and r.json()["status"] == "ok"


def test_metrics_endpoint():
    r = client.get("/metrics")
    assert r.status_code == 200
    assert "vaultstream_verdicts_total" in r.text


def test_predict_requires_auth():
    r = client.post("/v1/predict", json={"transaction_id": "t1", "entity_id": "e1", "amount": 10, "device_fingerprint": "d"})
    assert r.status_code in (401, 403)


def test_ingest_scores_and_returns_label():
    r = client.post("/v1/ingest", json={
        "transaction_id": "t_test", "entity_id": "e_test", "amount": 50,
        "merchant_id": "m", "device_fingerprint": "d", "timestamp": "2026-06-17T00:00:00Z",
    })
    assert r.status_code == 200
    body = r.json()
    assert body["risk_label"] in {"SAFE", "SUSPICIOUS", "FRAUD"}


@pytest.mark.parametrize("profile,expected", [("safe", "SAFE"), ("suspicious", "SUSPICIOUS"), ("fraud", "FRAUD")])
def test_profile_injection_is_deterministic(profile, expected):
    r = client.post("/v1/ingest", json={
        "transaction_id": f"t_{profile}", "entity_id": f"e_{profile}", "amount": 100,
        "merchant_id": "m", "device_fingerprint": "d", "timestamp": "2026-06-17T00:00:00Z",
        "profile": profile,
    })
    assert r.status_code == 200
    assert r.json()["risk_label"] == expected


def test_lab_rbac():
    # viewer denied, admin allowed
    assert client.get("/v1/lab/algorithms", headers=VIEWER).status_code == 403
    r = client.get("/v1/lab/algorithms", headers=ADMIN)
    assert r.status_code == 200
    assert {a["id"] for a in r.json()["algorithms"]} >= {"xgboost", "random_forest"}


def test_admin_users_rbac():
    assert client.get("/v1/admin/users", headers=VIEWER).status_code == 403
    r = client.get("/v1/admin/users", headers=ADMIN)
    assert r.status_code == 200 and isinstance(r.json(), list)


def test_case_actions_rbac_and_flow():
    # analyst can set status; viewer cannot
    assert client.patch("/v1/alerts/abc/status", json={"status": "investigating"}, headers=VIEWER).status_code == 403
    r = client.patch("/v1/alerts/abc/status", json={"status": "investigating"}, headers=ANALYST)
    assert r.status_code == 200 and r.json()["case_status"] == "investigating"
    # invalid status rejected
    assert client.patch("/v1/alerts/abc/status", json={"status": "nope"}, headers=ANALYST).status_code == 400
    # notes
    assert client.post("/v1/alerts/abc/notes", json={"body": "looks bad"}, headers=ANALYST).status_code == 200
    notes = client.get("/v1/alerts/abc/notes", headers=ANALYST).json()["notes"]
    assert any(n["body"] == "looks bad" for n in notes)


def test_analytics_summary():
    r = client.get("/v1/analytics/summary", headers=ANALYST)
    assert r.status_code == 200
    assert "totals" in r.json()


def test_lab_train_xgboost():
    r = client.post("/v1/lab/train", headers=ADMIN, json={"algorithm": "xgboost", "sample_size": 2000})
    assert r.status_code == 200
    # SSE stream — find the final result event
    result = None
    for line in r.text.splitlines():
        if line.startswith("data:"):
            import json
            evt = json.loads(line[5:])
            if evt.get("type") == "result":
                result = evt["result"]
    assert result is not None
    assert 0.5 <= result["metrics"]["auc"] <= 1.0
