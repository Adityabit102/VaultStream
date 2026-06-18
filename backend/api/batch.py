"""Batch CSV scoring — upload many transactions, score them all at once."""
import io
import csv
from fastapi import APIRouter, Depends, UploadFile, File, HTTPException
from auth import require_analyst
from api.predict import score_transaction
from api.rules import evaluate_rules

router = APIRouter()


def _num(v, default=0.0):
    try:
        return float(v)
    except (TypeError, ValueError):
        return default


@router.post("/v1/batch/score")
async def batch_score(file: UploadFile = File(...), user: dict = Depends(require_analyst)):
    """Score a CSV of transactions. Recognised columns: transaction_id,
    entity_id, amount, device_shift, tx_count_5m, tx_count_1h, tx_count_24h,
    sum_amount_1h, profile (safe|suspicious|fraud). Only `amount` is required."""
    raw = (await file.read()).decode("utf-8-sig", errors="replace")
    reader = csv.DictReader(io.StringIO(raw))
    if not reader.fieldnames or "amount" not in [f.strip().lower() for f in reader.fieldnames]:
        raise HTTPException(400, detail="CSV must include an 'amount' column")

    from api.ingest import _profile_score

    results = []
    counts = {"SAFE": 0, "SUSPICIOUS": 0, "FRAUD": 0}
    for i, raw_row in enumerate(reader):
        if i >= 5000:
            break
        row = {(k or "").strip().lower(): v for k, v in raw_row.items()}
        amount = _num(row.get("amount"))
        profile = (row.get("profile") or "").strip().lower() or None
        device_shift = int(_num(row.get("device_shift")))
        score, label, live = score_transaction(
            amount=amount,
            entity_id=row.get("entity_id") or f"row_{i}",
            device_shift=device_shift,
            tx_count_5m=int(_num(row.get("tx_count_5m"), 1)),
            tx_count_1h=int(_num(row.get("tx_count_1h"), 1)),
            tx_count_24h=int(_num(row.get("tx_count_24h"), 1)),
            sum_amount_1h=_num(row.get("sum_amount_1h"), amount),
            forced_score=_profile_score(profile) if profile else None,
        )
        ctx = {"amount": amount, "device_shift": device_shift, "risk_score": score,
               "tx_count_5m": live["tx_count_5m"], "tx_count_1h": live["tx_count_1h"],
               "tx_count_24h": live["tx_count_24h"], "sum_amount_1h": live["sum_amount_1h"]}
        rules = evaluate_rules(ctx)
        counts[label] = counts.get(label, 0) + 1
        results.append({
            "transaction_id": row.get("transaction_id") or f"row_{i}",
            "entity_id": row.get("entity_id") or f"row_{i}",
            "amount": round(amount, 2),
            "risk_score": round(score, 4),
            "risk_label": label,
            "rules_triggered": [r["name"] for r in rules],
        })

    return {"count": len(results), "summary": counts, "results": results}
