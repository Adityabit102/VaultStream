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
