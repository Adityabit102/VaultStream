"""Hybrid rules engine — analyst-defined rules that flag transactions
alongside the ML score."""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import List, Optional

from auth import require_admin, verify_token
from database import db

router = APIRouter()

FIELDS = ["amount", "tx_count_5m", "tx_count_1h", "tx_count_24h", "sum_amount_1h", "device_shift", "risk_score"]
OPS = {">", ">=", "<", "<=", "==", "!="}


class Condition(BaseModel):
    field: str
    op: str
    value: float


class RuleReq(BaseModel):
    name: str
    conditions: List[Condition]
    action: str = "flag"  # flag | escalate


def _cmp(a: float, op: str, b: float) -> bool:
    if op == ">": return a > b
    if op == ">=": return a >= b
    if op == "<": return a < b
    if op == "<=": return a <= b
    if op == "==": return a == b
    if op == "!=": return a != b
    return False


def evaluate_rules(context: dict) -> list:
    """Return [{id, name, action}] for every enabled rule whose conditions
    (AND) all match the transaction context."""
    rules = db.enabled_rules() if db.DB_ENABLED else db.enabled_rules()
    if not rules:
        return []
    triggered = []
    for r in rules:
        conds = r.get("conditions") or []
        if conds and all(_cmp(float(context.get(c["field"], 0) or 0), c["op"], float(c["value"])) for c in conds):
            triggered.append({"id": r["id"], "name": r["name"], "action": r.get("action", "flag")})
    return triggered


class BacktestReq(BaseModel):
    conditions: List[Condition]


@router.post("/v1/rules/backtest")
async def backtest_rule(req: BacktestReq, user: dict = Depends(verify_token)):
    """Replay a draft rule against historical alerts: how many it would have
    flagged, and how many of those were confirmed fraud vs false positive."""
    for c in req.conditions:
        if c.field not in FIELDS:
            raise HTTPException(400, detail=f"field must be one of {FIELDS}")
        if c.op not in OPS:
            raise HTTPException(400, detail=f"op must be one of {sorted(OPS)}")
    conds = [c.model_dump() for c in req.conditions]
    if not conds:
        raise HTTPException(400, detail="at least one condition required")

    matched = matched_fraud = matched_safe = confirmed = false_pos = 0
    total = 0
    samples = []
    feedback_map = {}
    if db.DB_ENABLED:
        try:
            for fb in db.all_feedback_labels():
                feedback_map[fb["alert_id"]] = fb["label"]
        except Exception:
            feedback_map = {}
    alerts = db.iter_all_alerts() if db.DB_ENABLED else []
    for a in alerts:
        total += 1
        fj = a.get("feature_json") or {}
        ctx = {
            "amount": float(fj.get("sum_amount_1h", 0) or 0),
            "sum_amount_1h": float(fj.get("sum_amount_1h", 0) or 0),
            "tx_count_5m": float(fj.get("tx_count_5m", 0) or 0),
            "tx_count_1h": float(fj.get("tx_count_1h", 0) or 0),
            "tx_count_24h": float(fj.get("tx_count_24h", 0) or 0),
            "device_shift": float(fj.get("device_shift", 0) or 0),
            "risk_score": float(a.get("risk_score", 0) or 0),
        }
        if all(_cmp(ctx.get(c["field"], 0), c["op"], float(c["value"])) for c in conds):
            matched += 1
            if a.get("risk_label") == "FRAUD":
                matched_fraud += 1
            elif a.get("risk_label") == "SAFE":
                matched_safe += 1
            fbl = feedback_map.get(a.get("id"))
            if fbl == "confirmed_fraud":
                confirmed += 1
            elif fbl == "false_positive":
                false_pos += 1
            if len(samples) < 8:
                samples.append({"transaction_id": a.get("transaction_id"),
                                "entity_id": a.get("entity_id"),
                                "risk_label": a.get("risk_label"),
                                "risk_score": round(float(a.get("risk_score", 0) or 0), 3)})
    labelled = confirmed + false_pos
    return {
        "total_scanned": total,
        "matched": matched,
        "match_rate": round(matched / total * 100, 2) if total else 0,
        "matched_fraud": matched_fraud,
        "matched_safe": matched_safe,
        "confirmed_fraud": confirmed,
        "false_positive": false_pos,
        "precision_on_labelled": round(confirmed / labelled, 3) if labelled else None,
        "samples": samples,
    }


@router.get("/v1/rules")
async def get_rules(user: dict = Depends(verify_token)):
    return {"rules": db.list_rules() or []}


@router.post("/v1/rules")
async def create_rule(req: RuleReq, user: dict = Depends(require_admin)):
    for c in req.conditions:
        if c.field not in FIELDS:
            raise HTTPException(400, detail=f"field must be one of {FIELDS}")
        if c.op not in OPS:
            raise HTTPException(400, detail=f"op must be one of {sorted(OPS)}")
    if req.action not in ("flag", "escalate"):
        raise HTTPException(400, detail="action must be 'flag' or 'escalate'")
    rule = db.add_rule(req.name, [c.model_dump() for c in req.conditions], req.action)
    return {"status": "ok", "rule": rule}


@router.patch("/v1/rules/{rule_id}")
async def toggle_rule(rule_id: str, enabled: bool, user: dict = Depends(require_admin)):
    ok = db.set_rule_enabled(rule_id, enabled)
    if not ok:
        raise HTTPException(404, detail="rule not found")
    return {"status": "ok", "id": rule_id, "enabled": enabled}


@router.delete("/v1/rules/{rule_id}")
async def remove_rule(rule_id: str, user: dict = Depends(require_admin)):
    ok = db.delete_rule(rule_id)
    if not ok:
        raise HTTPException(404, detail="rule not found")
    return {"status": "deleted", "id": rule_id}
