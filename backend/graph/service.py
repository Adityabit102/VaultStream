"""Read path for the fraud-ring graph.

Two sources, one shape:

  * **live**     — Neo4j is configured and reachable; rings are read with Cypher.
  * **snapshot** — the committed JSON produced by `scripts/ingest_graph.py`.

The PRD calls for a batch-refreshed snapshot rather than a live graph pipeline,
so the snapshot is the normal production path (Render runs no Neo4j) and the
live path is what you get locally with `docker compose up neo4j`. Both return
the same payload, so the frontend never branches on it.
"""
import json
import os
from typing import Any, Optional

from graph import client, cypher
from graph.schema import (
    DEFAULT_MAX_IDENTIFIER_DEGREE,
    DEFAULT_MIN_RING_SIZE,
)

SNAPSHOT_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "snapshot", "fraud_rings.json")

_snapshot_cache: Optional[dict] = None


def load_snapshot() -> dict:
    """Read the committed snapshot. Cached; returns an empty payload if absent
    so a missing file degrades to 'no rings' instead of a 500."""
    global _snapshot_cache
    if _snapshot_cache is not None:
        return _snapshot_cache
    try:
        with open(SNAPSHOT_PATH, "r") as fh:
            _snapshot_cache = json.load(fh)
    except (OSError, ValueError) as exc:
        print(f"[graph] snapshot unreadable ({exc.__class__.__name__}): serving empty graph")
        _snapshot_cache = {"rings": [], "stats": {}, "generated_at": None, "params": {}}
    return _snapshot_cache


def _ring_from_record(rec: dict[str, Any]) -> dict[str, Any]:
    """Normalise one Cypher row into the API's ring shape."""
    members = rec.get("memberIds") or []
    identifiers = [i for i in (rec.get("identifiers") or []) if i.get("id") is not None]
    kinds: dict[str, int] = {}
    for ident in identifiers:
        kind = ident.get("kind", "Unknown")
        kinds[kind] = kinds.get(kind, 0) + 1
    return {
        "id": f"ring-{rec.get('componentId')}-{rec.get('communityId')}",
        "component_id": rec.get("componentId"),
        "community_id": rec.get("communityId"),
        "size": rec.get("size") or len(members),
        "accounts": members,
        "edges": rec.get("edges") or [],
        "identifiers": identifiers,
        "shared_kinds": kinds,
        "risk_score": round(float(rec.get("ringRisk") or 0.0), 4),
        "peak_risk": round(float(rec.get("peakRisk") or 0.0), 4),
        "transactions": int(rec.get("txCount") or 0),
        "fraud_transactions": int(rec.get("fraudTx") or 0),
        "total_amount": round(float(rec.get("totalAmount") or 0.0), 2),
    }


def fetch_live(
    limit: int,
    min_ring_size: int = DEFAULT_MIN_RING_SIZE,
    max_degree: int = DEFAULT_MAX_IDENTIFIER_DEGREE,
) -> Optional[dict]:
    """Read rings straight out of Neo4j. None when the graph is unavailable —
    that includes 'connected but never ingested', which reads as zero rings and
    is not something we want to serve over a good snapshot."""
    rows = client.run(
        cypher.FETCH_RINGS, minRingSize=min_ring_size, maxDegree=max_degree, limit=limit
    )
    if rows is None:
        return None
    stats_rows = client.run(cypher.GRAPH_STATS)
    stats = stats_rows[0] if stats_rows else {}
    if not rows and not (stats.get("accounts") or 0):
        return None  # empty database: prefer the snapshot
    return {
        "source": "live",
        "generated_at": None,
        "params": {"min_ring_size": min_ring_size, "max_identifier_degree": max_degree},
        "stats": {k: int(v or 0) for k, v in stats.items()},
        "rings": [_ring_from_record(r) for r in rows],
    }


def fetch_rings(
    limit: int = 25,
    min_ring_size: int = DEFAULT_MIN_RING_SIZE,
    max_degree: int = DEFAULT_MAX_IDENTIFIER_DEGREE,
) -> dict:
    """Rings from Neo4j when it is up, otherwise from the snapshot."""
    if client.configured():
        live = fetch_live(limit, min_ring_size, max_degree)
        if live is not None:
            return live

    snap = load_snapshot()
    rings = [r for r in snap.get("rings", []) if r.get("size", 0) >= min_ring_size]
    return {
        "source": "snapshot",
        "generated_at": snap.get("generated_at"),
        "params": snap.get("params", {}),
        "stats": snap.get("stats", {}),
        "rings": rings[:limit],
    }
