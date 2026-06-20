"""Analyst feedback loop — dispositions on alerts (confirmed fraud / false
positive) that become the supervised signal for the next training run."""
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from typing import Optional

from auth import verify_token, require_analyst
from limiter import limiter
from database import db

router = APIRouter()

VALID_LABELS = {"confirmed_fraud", "false_positive", "unsure"}

_mock: dict[str, list] = {}


class FeedbackReq(BaseModel):
    label: str
    note: Optional[str] = None


@router.get("/v1/alerts/{alert_id}/feedback")
async def get_feedback(alert_id: str, user: dict = Depends(verify_token)):
    if db.DB_ENABLED:
        return {"feedback": db.feedback_for(alert_id)}
    return {"feedback": _mock.get(alert_id, [])}


@router.post("/v1/alerts/{alert_id}/feedback")
@limiter.limit("60/minute")
async def submit_feedback(request: Request, alert_id: str, req: FeedbackReq,
                          user: dict = Depends(require_analyst)):
    if req.label not in VALID_LABELS:
        raise HTTPException(status_code=400, detail=f"label must be one of {sorted(VALID_LABELS)}")
    analyst = user.get("email", "analyst")
    if db.DB_ENABLED:
        fb = db.add_feedback(alert_id, req.label, analyst, req.note)
        db.insert_audit(user.get("user_id", "system"), f"feedback:{req.label}", alert_id, {"by": analyst})
        return {"status": "ok", "feedback": fb}
    import uuid, time
    fb = {"id": uuid.uuid4().hex, "label": req.label, "analyst": analyst, "note": req.note,
          "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
    _mock.setdefault(alert_id, []).insert(0, fb)
    return {"status": "ok", "feedback": fb}


@router.get("/v1/feedback/stats")
async def feedback_stats(user: dict = Depends(verify_token)):
    """Aggregate disposition counts + a precision proxy — surfaced in the Model
    Lab as the live retraining signal."""
    if db.DB_ENABLED:
        return db.feedback_stats()
    flat = [f for lst in _mock.values() for f in lst]
    from collections import Counter
    by = Counter(f["label"] for f in flat)
    return {"total": len(flat), "by_label": dict(by),
            "confirmed_fraud": by.get("confirmed_fraud", 0),
            "false_positive": by.get("false_positive", 0),
            "labelled_precision": None, "recent": []}
