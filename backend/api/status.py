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

    healthy = all(c["ok"] for c in components)
    return {"healthy": healthy, "components": components,
            "env": {"region": os.environ.get("RENDER_REGION", "local")}}
