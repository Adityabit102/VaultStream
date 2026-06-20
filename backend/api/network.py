"""Fraud-ring / link analysis — surfaces clusters of entities that share a
device/velocity signature, the classic coordinated-fraud view."""
from fastapi import APIRouter, Depends

from auth import verify_token
from database import db

router = APIRouter()


@router.get("/v1/network/rings")
async def rings(min_cluster: int = 2, user: dict = Depends(verify_token)):
    if db.DB_ENABLED:
        data = db.ring_graph(min_cluster=max(2, min_cluster))
        if data is not None:
            return data
    return {"rings": [], "nodes": [], "entity_count": 0}
