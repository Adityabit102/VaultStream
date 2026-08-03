"""Tests for the knowledge-graph fraud-ring endpoint.

Runs against the committed snapshot with no Neo4j required — NEO4J_URI is
cleared so the suite is hermetic in CI exactly as it is on Render. Nothing here
touches the existing test file or the existing app behaviour.

    cd backend && pytest -q
"""
import os
import sys

# Mock mode + snapshot path (mirrors tests/test_api.py)
os.environ.pop("DATABASE_URL", None)
os.environ.pop("NEO4J_URI", None)
os.environ["SUPABASE_JWT_SECRET"] = "your-jwt-secret"
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest
from fastapi.testclient import TestClient
from main import app

from graph import service
from graph.schema import IDENTIFIER_RELS

client = TestClient(app)

ANALYST = {"Authorization": "Bearer mock-token-analyst"}
VIEWER = {"Authorization": "Bearer mock-token-viewer"}

ENDPOINT = "/graph/fraud-rings"


def test_requires_auth():
    assert client.get(ENDPOINT).status_code in (401, 403)


def test_returns_rings_from_snapshot_without_neo4j():
    """No graph database configured → the batch snapshot answers the request."""
    r = client.get(ENDPOINT, headers=VIEWER)
    assert r.status_code == 200
    body = r.json()
    assert body["source"] == "snapshot"
    assert isinstance(body["rings"], list)


def test_ring_payload_shape():
    body = client.get(ENDPOINT, headers=ANALYST).json()
    assert body["rings"], "snapshot should contain at least one detected ring"
    for ring in body["rings"]:
        assert {"id", "size", "accounts", "edges", "identifiers", "risk_score"} <= ring.keys()
        assert ring["size"] == len(ring["accounts"])
        assert 0.0 <= ring["risk_score"] <= 1.0
        assert ring["fraud_transactions"] <= ring["transactions"]


def test_detected_rings_are_non_trivial():
    """The PRD's success criterion: a real cluster of 3+ accounts bound by 2+
    identifiers spanning more than one identifier kind."""
    rings = client.get(ENDPOINT, headers=ANALYST).json()["rings"]
    assert any(r["size"] >= 3 for r in rings)
    for ring in rings:
        assert len(ring["shared_kinds"]) >= 2, f"{ring['id']} rests on a single identifier kind"
        for edge in ring["edges"]:
            assert edge["shared"] >= 2
            assert edge["source"] in ring["accounts"] and edge["target"] in ring["accounts"]


def test_identifiers_are_known_kinds_and_not_supernodes():
    body = client.get(ENDPOINT, headers=ANALYST).json()
    max_degree = body["params"].get("max_identifier_degree", 20)
    for ring in body["rings"]:
        for ident in ring["identifiers"]:
            assert ident["kind"] in IDENTIFIER_RELS
            assert 2 <= ident["accounts"] <= max_degree


def test_min_size_filter():
    rings = client.get(f"{ENDPOINT}?min_size=4", headers=ANALYST).json()["rings"]
    assert all(r["size"] >= 4 for r in rings)


def test_limit_is_honoured():
    rings = client.get(f"{ENDPOINT}?limit=1", headers=ANALYST).json()["rings"]
    assert len(rings) <= 1


@pytest.mark.parametrize("qs", ["limit=0", "limit=500", "min_size=1", "max_identifier_degree=1"])
def test_out_of_range_params_rejected(qs):
    assert client.get(f"{ENDPOINT}?{qs}", headers=ANALYST).status_code == 422


def test_missing_snapshot_degrades_instead_of_erroring(monkeypatch):
    """A missing snapshot file must read as 'no rings', never a 500."""
    monkeypatch.setattr(service, "SNAPSHOT_PATH", "/nonexistent/fraud_rings.json")
    monkeypatch.setattr(service, "_snapshot_cache", None)
    try:
        r = client.get(ENDPOINT, headers=ANALYST)
        assert r.status_code == 200
        assert r.json()["rings"] == []
    finally:
        service._snapshot_cache = None


def test_unreachable_neo4j_falls_back_to_snapshot(monkeypatch):
    """A configured-but-down graph database must not break the endpoint."""
    from graph import client as graph_client

    monkeypatch.setattr(graph_client, "NEO4J_URI", "bolt://127.0.0.1:1")
    monkeypatch.setattr(graph_client, "_driver", None)
    monkeypatch.setattr(graph_client, "_probe_failed", False)
    try:
        r = client.get(ENDPOINT, headers=ANALYST)
        assert r.status_code == 200
        assert r.json()["source"] == "snapshot"
    finally:
        graph_client._driver = None
        graph_client._probe_failed = False
