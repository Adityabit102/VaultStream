"""Watchlist / blocklist — entities, devices and merchants that are denied at
scoring time, bypassing the model for an instant FRAUD verdict."""
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from typing import Optional

from auth import verify_token, require_analyst
from limiter import limiter
from database import db

router = APIRouter()

VALID_KINDS = {"entity", "device", "merchant"}

# In-memory fallback when persistence is unavailable
_mock: list = []


class WatchReq(BaseModel):
    kind: str = "entity"
    value: str
    reason: Optional[str] = None


@router.get("/v1/watchlist")
async def get_watchlist(user: dict = Depends(verify_token)):
    if db.DB_ENABLED:
        return {"items": db.list_watchlist()}
    return {"items": _mock}


@router.post("/v1/watchlist")
@limiter.limit("60/minute")
async def add_watchlist(request: Request, req: WatchReq, user: dict = Depends(require_analyst)):
    if req.kind not in VALID_KINDS:
        raise HTTPException(status_code=400, detail=f"kind must be one of {sorted(VALID_KINDS)}")
    value = (req.value or "").strip()
    if not value:
        raise HTTPException(status_code=400, detail="value is required")
    by = user.get("email", "analyst")
    if db.DB_ENABLED:
        item = db.add_watch(req.kind, value, req.reason, by)
        db.insert_audit(user.get("user_id", "system"), "watchlist:add", value,
                        {"kind": req.kind, "by": by})
        return {"status": "ok", "item": item}
    import uuid
    item = {"id": uuid.uuid4().hex, "kind": req.kind, "value": value,
            "reason": req.reason, "added_by": by}
    _mock.insert(0, item)
    return {"status": "ok", "item": item}


@router.delete("/v1/watchlist/{watch_id}")
async def remove_watchlist(watch_id: str, user: dict = Depends(require_analyst)):
    if db.DB_ENABLED:
        ok = db.delete_watch(watch_id)
        if ok:
            db.insert_audit(user.get("user_id", "system"), "watchlist:remove", watch_id, {})
        return {"status": "ok" if ok else "not_found"}
    global _mock
    _mock = [w for w in _mock if w["id"] != watch_id]
    return {"status": "ok"}
