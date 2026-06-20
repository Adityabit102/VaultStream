"""Per-entity behavioral profile — an account's history, its own baseline, and
how far the latest activity deviates from that baseline."""
from fastapi import APIRouter, Depends

from auth import verify_token
from database import db

router = APIRouter()


@router.get("/v1/entities/{entity_id}")
async def get_entity(entity_id: str, user: dict = Depends(verify_token)):
    if db.DB_ENABLED:
        return db.entity_profile(entity_id)
    return {"entity_id": entity_id, "found": False, "alerts": []}
