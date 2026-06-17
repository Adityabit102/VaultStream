"""API key management — generate keys to authenticate ingestion."""
import secrets
import hashlib
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from auth import require_admin
from database import db

router = APIRouter()


def hash_key(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()


class KeyReq(BaseModel):
    name: str


@router.get("/v1/keys")
async def list_keys(user: dict = Depends(require_admin)):
    return {"keys": db.list_keys() or []}


@router.post("/v1/keys")
async def create_key(req: KeyReq, user: dict = Depends(require_admin)):
    raw = "vs_" + secrets.token_urlsafe(32)
    rec = db.add_key(req.name or "API key", raw[:11], hash_key(raw))
    # The full key is returned exactly once.
    return {"status": "ok", "id": rec["id"], "name": rec["name"], "key": raw,
            "note": "Store this now — it won't be shown again."}


@router.delete("/v1/keys/{key_id}")
async def revoke_key(key_id: str, user: dict = Depends(require_admin)):
    ok = db.delete_key(key_id)
    if not ok:
        raise HTTPException(404, detail="key not found")
    return {"status": "revoked", "id": key_id}
