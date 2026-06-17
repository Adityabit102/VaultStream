"""Case management — status, assignment and investigator notes on alerts."""
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from typing import Optional

from auth import require_analyst, verify_token
from limiter import limiter
from database import db

router = APIRouter()

VALID_STATUS = {"open", "investigating", "resolved", "dismissed"}

# In-memory fallback when no DB is configured
_mock_notes: dict[str, list] = {}
_mock_case: dict[str, dict] = {}


class StatusReq(BaseModel):
    status: str


class AssignReq(BaseModel):
    assignee: Optional[str] = None


class NoteReq(BaseModel):
    body: str


@router.patch("/v1/alerts/{alert_id}/status")
async def update_status(alert_id: str, req: StatusReq, user: dict = Depends(require_analyst)):
    if req.status not in VALID_STATUS:
        raise HTTPException(status_code=400, detail=f"status must be one of {sorted(VALID_STATUS)}")
    if db.DB_ENABLED:
        db.set_status(alert_id, req.status)
        db.insert_audit(user.get("user_id", "system"), f"status:{req.status}", alert_id, {"by": user.get("email")})
    else:
        _mock_case.setdefault(alert_id, {})["status"] = req.status
    return {"status": "ok", "id": alert_id, "case_status": req.status}


@router.patch("/v1/alerts/{alert_id}/assignee")
async def update_assignee(alert_id: str, req: AssignReq, user: dict = Depends(require_analyst)):
    if db.DB_ENABLED:
        db.set_assignee(alert_id, req.assignee)
        db.insert_audit(user.get("user_id", "system"), "assign", alert_id, {"assignee": req.assignee, "by": user.get("email")})
    else:
        _mock_case.setdefault(alert_id, {})["assignee"] = req.assignee
    return {"status": "ok", "id": alert_id, "assignee": req.assignee}


@router.get("/v1/alerts/{alert_id}/notes")
async def get_notes(alert_id: str, user: dict = Depends(verify_token)):
    if db.DB_ENABLED:
        return {"notes": db.list_notes(alert_id) or []}
    return {"notes": _mock_notes.get(alert_id, [])}


@router.post("/v1/alerts/{alert_id}/notes")
@limiter.limit("60/minute")
async def add_note(request: Request, alert_id: str, req: NoteReq, user: dict = Depends(require_analyst)):
    body = (req.body or "").strip()
    if not body:
        raise HTTPException(status_code=400, detail="note body is required")
    author = user.get("email", "analyst")
    if db.DB_ENABLED:
        note = db.add_note(alert_id, author, body)
        db.insert_audit(user.get("user_id", "system"), "note", alert_id, {"by": author})
        return {"status": "ok", "note": note}
    import uuid, time
    note = {"id": uuid.uuid4().hex, "author": author, "body": body,
            "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
    _mock_notes.setdefault(alert_id, []).append(note)
    return {"status": "ok", "note": note}
