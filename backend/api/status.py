"""System status — live health of the platform's components."""
import os
from fastapi import APIRouter

router = APIRouter()


@router.get("/v1/status")
async def system_status():
    components = []

    # Model
    try:
        from api.predict import model, metadata
        components.append({
            "name": "ML model", "ok": model is not None,
            "detail": f"AUC {round(metadata.get('val_auc', 0), 3)}" if model is not None else "not loaded",
        })
    except Exception:
        components.append({"name": "ML model", "ok": False, "detail": "error"})

    # Redis feature store
    try:
        from api.ingest import redis as _redis
        ok = False
        if _redis:
            try:
                res = _redis.ping()
                if hasattr(res, "__await__"):
                    res = await res
                ok = bool(res)
            except Exception:
                ok = False
        components.append({"name": "Redis (feature store)", "ok": ok,
                           "detail": "connected" if ok else "standalone fallback"})
    except Exception:
        components.append({"name": "Redis (feature store)", "ok": False, "detail": "unavailable"})

    # Kafka / Redpanda
    try:
        from api.ingest import kafka_available
        components.append({"name": "Kafka / Redpanda", "ok": bool(kafka_available),
                           "detail": "streaming" if kafka_available else "standalone fallback"})
    except Exception:
        components.append({"name": "Kafka / Redpanda", "ok": False, "detail": "unavailable"})

    # Postgres
    try:
        from database import db
        ok = False
        detail = "mock mode (in-memory)"
        if db.DB_ENABLED:
            try:
                db.count_alerts()
                ok = True
                detail = "connected"
            except Exception:
                ok = False
                detail = "error"
        components.append({"name": "Postgres", "ok": ok or not db.DB_ENABLED, "detail": detail})
    except Exception:
        components.append({"name": "Postgres", "ok": False, "detail": "error"})

    # Live platform stats
    stats = {}
    try:
        from database import db
        if db.DB_ENABLED:
            stats["alerts"] = db.count_alerts()
            stats["db_dialect"] = "sqlite" if getattr(db, "_is_sqlite", False) else "postgres"
            try:
                stats["watchlist"] = len(db.list_watchlist())
            except Exception:
                pass
            try:
                stats["feedback"] = db.feedback_stats().get("total", 0)
            except Exception:
                pass
    except Exception:
        pass

    # Model version + champion challenger
    model_info = {}
    try:
        from api.predict import metadata as _meta, threshold as _thr
        model_info = {"val_auc": round(_meta.get("val_auc", 0), 3),
                      "threshold": _thr,
                      "features": len(_meta.get("features", []))}
    except Exception:
        pass
    try:
        import sys
        ml_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "ml")
        if ml_dir not in sys.path:
            sys.path.append(ml_dir)
        import trainer
        sh = trainer.shadow_stats()
        model_info["shadow"] = {"has_challenger": sh.get("has_challenger"),
                                "samples": sh.get("samples"),
                                "agreement_rate": sh.get("agreement_rate")}
    except Exception:
        pass

    healthy = all(c["ok"] for c in components)
    return {"healthy": healthy, "components": components, "stats": stats, "model": model_info,
            "env": {"region": os.environ.get("RENDER_REGION", "local")}}
