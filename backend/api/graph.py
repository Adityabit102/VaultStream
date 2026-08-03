"""Knowledge-graph fraud rings — coordinated accounts that per-transaction
scoring cannot see.

Read-only and additive. Reuses the existing `verify_token` dependency rather
than introducing a second auth path, and reuses the existing per-transaction
XGBoost scores rather than introducing a second model: a ring's risk is the mean
of its member accounts' mean transaction score.

Served from Neo4j when `NEO4J_URI` points at a reachable instance, otherwise
from the snapshot committed at `graph/snapshot/fraud_rings.json`. Production
runs no Neo4j and serves the snapshot — see graph/service.py.
"""
from fastapi import APIRouter, Depends, Query

from auth import verify_token
from graph import service
from graph.schema import DEFAULT_MAX_IDENTIFIER_DEGREE, DEFAULT_MIN_RING_SIZE

router = APIRouter()


@router.get("/graph/fraud-rings", tags=["graph"])
async def fraud_rings(
    limit: int = Query(25, ge=1, le=200, description="maximum rings to return"),
    min_size: int = Query(DEFAULT_MIN_RING_SIZE, ge=2, le=50, description="minimum accounts per ring"),
    max_identifier_degree: int = Query(
        DEFAULT_MAX_IDENTIFIER_DEGREE, ge=2, le=1000,
        description="identifiers touched by more accounts than this are treated as "
                    "population-level attributes, not ring evidence",
    ),
    user: dict = Depends(verify_token),
):
    """Fraud rings detected by shared-identifier clustering plus Weakly
    Connected Components and Louvain community detection.

    Each ring reports its member accounts, the identifiers that bind them, the
    account-to-account links, and an aggregated risk score. `source` tells you
    whether the answer came from a live graph or the batch snapshot.
    """
    return service.fetch_rings(
        limit=limit, min_ring_size=min_size, max_degree=max_identifier_degree
    )
