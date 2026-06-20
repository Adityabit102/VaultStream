"""Scenario simulator — stateless what-if scoring. Feed a hypothetical
transaction's features and get the live model's score + verdict back, with no
persistence, broadcast or side effects."""
from fastapi import APIRouter, Depends
from pydantic import BaseModel

from auth import verify_token
from . import predict as _predict
from .predict import score_transaction

router = APIRouter()


class SimRequest(BaseModel):
    amount: float = 500.0
    tx_count_5m: int = 1
    tx_count_1h: int = 1
    tx_count_24h: int = 1
    sum_amount_1h: float = 500.0
    device_shift: int = 0
    entity_id: str = "sim-entity"


@router.post("/v1/simulate")
async def simulate(req: SimRequest, user: dict = Depends(verify_token)):
    score, label, live = score_transaction(
        amount=req.amount,
        entity_id=req.entity_id,
        device_shift=1 if req.device_shift else 0,
        tx_count_5m=max(0, int(req.tx_count_5m)),
        tx_count_1h=max(0, int(req.tx_count_1h)),
        tx_count_24h=max(0, int(req.tx_count_24h)),
        sum_amount_1h=req.sum_amount_1h,
    )
    return {
        "risk_score": round(float(score), 4),
        "risk_label": label,
        "threshold": _predict.threshold,
        "features": live,
    }
