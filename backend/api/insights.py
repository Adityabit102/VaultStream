"""Analytics, model drift monitoring, and the audit feed."""
import math
from fastapi import APIRouter, Depends
from auth import verify_token, require_admin
from database import db

router = APIRouter()


@router.get("/v1/analytics/summary")
async def analytics_summary(days: int = 14, user: dict = Depends(verify_token)):
    if db.DB_ENABLED:
        data = db.analytics_summary(days)
        if data is not None:
            return data
    # mock fallback from the in-memory alert buffer
    from .alerts import mock_alerts
    from collections import Counter
    by_label = Counter(a.get("risk_label", "SAFE") for a in mock_alerts)
    total = sum(by_label.values())
    return {
        "totals": {"transactions": total, "fraud": by_label.get("FRAUD", 0),
                   "fraud_rate": round((by_label.get("FRAUD", 0) / total * 100), 2) if total else 0,
                   "open_cases": by_label.get("FRAUD", 0) + by_label.get("SUSPICIOUS", 0),
                   "amount_blocked": 0},
        "by_label": dict(by_label),
        "series": [],
    }


def _psi(base: list[float], recent: list[float], bins: int = 10) -> float:
    """Population Stability Index between two value lists."""
    if len(base) < 20 or len(recent) < 20:
        return 0.0
    lo, hi = min(base + recent), max(base + recent)
    if hi <= lo:
        return 0.0
    edges = [lo + (hi - lo) * i / bins for i in range(bins + 1)]

    def hist(vals):
        counts = [0] * bins
        for v in vals:
            idx = min(bins - 1, max(0, int((v - lo) / (hi - lo) * bins)))
            counts[idx] += 1
        n = len(vals)
        return [max(c / n, 1e-6) for c in counts]

    b, r = hist(base), hist(recent)
    return float(sum((r[i] - b[i]) * math.log(r[i] / b[i]) for i in range(bins)))


@router.get("/v1/analytics/drift")
async def drift(user: dict = Depends(require_admin)):
    """Compare the older vs recent halves of the live feature stream (PSI)."""
    features = ["tx_count_1h", "sum_amount_1h", "amount_zscore", "tx_count_24h"]
    results = []
    for f in features:
        series = db.feature_values(f, 4000) if db.DB_ENABLED else []
        vals = [v for _, v in series]
        if len(vals) < 60:
            results.append({"feature": f, "psi": 0.0, "status": "insufficient", "n": len(vals)})
            continue
        mid = len(vals) // 2
        recent, base = vals[:mid], vals[mid:]  # series is newest-first
        psi = round(_psi(base, recent), 4)
        status = "stable" if psi < 0.1 else "warning" if psi < 0.25 else "drift"
        results.append({"feature": f, "psi": psi, "status": status, "n": len(vals)})
    overall = max((r["psi"] for r in results), default=0.0)
    return {
        "overall_psi": overall,
        "overall_status": "stable" if overall < 0.1 else "warning" if overall < 0.25 else "drift",
        "features": results,
        "thresholds": {"stable": "<0.1", "warning": "0.1–0.25", "drift": ">0.25"},
    }


@router.get("/v1/analytics/top-entities")
async def top_entities(limit: int = 8, user: dict = Depends(verify_token)):
    if db.DB_ENABLED:
        rows = db.top_entities(limit)
        if rows is not None:
            return {"entities": rows}
    return {"entities": []}


@router.get("/v1/analytics/impact")
async def impact(days: int = 30, user: dict = Depends(verify_token)):
    """Money framing — value caught, open exposure, and estimated FP cost."""
    if db.DB_ENABLED:
        return db.impact_summary(days)
    return {"value_caught": 0, "exposure_open": 0, "fp_review_cost": 0,
            "net_protected": 0, "fraud_count": 0, "suspicious_count": 0, "days": days}


@router.get("/v1/analytics/geo")
async def geo(days: int = 30, user: dict = Depends(verify_token)):
    """Transaction origins by country (pseudo-geo derived from the entity id —
    the IEEE-CIS benchmark ships no geolocation)."""
    if db.DB_ENABLED:
        return {"countries": db.geo_breakdown(days)}
    return {"countries": []}


@router.get("/v1/analytics/monitor")
async def monitor(user: dict = Depends(verify_token)):
    """Outcome monitoring — compares the last hour's fraud rate against the
    trailing 24h baseline and flags a spike."""
    if not db.DB_ENABLED:
        return {"status": "insufficient", "recent_rate": 0, "baseline_rate": 0, "ratio": 0}
    r_total, r_fraud, r_rate = db.fraud_rate_window(1)
    b_total, b_fraud, b_rate = db.fraud_rate_window(24)
    if r_total < 5 or b_total < 20:
        status = "insufficient"
    else:
        ratio = (r_rate / b_rate) if b_rate > 0 else 0
        status = "spike" if ratio >= 1.75 and r_rate > 0.1 else \
                 "elevated" if ratio >= 1.25 else "normal"
    ratio = round((r_rate / b_rate), 2) if b_rate > 0 else 0
    return {
        "status": status,
        "recent_rate": round(r_rate * 100, 2),
        "baseline_rate": round(b_rate * 100, 2),
        "ratio": ratio,
        "recent": {"total": r_total, "fraud": r_fraud},
        "baseline": {"total": b_total, "fraud": b_fraud},
    }


@router.get("/v1/audit")
async def audit_feed(limit: int = 100, user: dict = Depends(require_admin)):
    if db.DB_ENABLED:
        return {"events": db.list_audit(limit) or []}
    return {"events": []}
