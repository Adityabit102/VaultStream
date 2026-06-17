import os
import sentry_sdk
from slowapi.errors import RateLimitExceeded
from slowapi import _rate_limit_exceeded_handler

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from api.ingest import router as ingest_router
from api.predict import router as predict_router
from api.alerts import router as alerts_router
from api.admin import router as admin_router
from api.model_lab import router as model_lab_router
from api.cases import router as cases_router
from api.insights import router as insights_router
from api.batch import router as batch_router
from api.rules import router as rules_router
from api.keys import router as keys_router
from api.status import router as status_router
from observability import router as metrics_router
from limiter import limiter

# Initialize Sentry Error Tracking if DSN is configured
sentry_dsn = os.environ.get("SENTRY_DSN", "")
if sentry_dsn and not "your-sentry-dsn" in sentry_dsn:
    sentry_sdk.init(
        dsn=sentry_dsn,
        traces_sample_rate=1.0,
    )

app = FastAPI(
    title="VaultStream API",
    description=(
        "Real-time fraud detection & decisioning API.\n\n"
        "**Auth:** Bearer token. In local/mock mode use `mock-token-admin` / "
        "`mock-token-analyst` / `mock-token-viewer`.\n\n"
        "Key areas: ingestion & scoring, alerts & case management, the Model Lab, "
        "analytics & drift, and Prometheus metrics at `/metrics`."
    ),
    version="1.0.0",
)

# Initialize local Postgres persistence if DATABASE_URL is configured (else mock mode)
from database.db import init_db, DB_ENABLED
if DB_ENABLED:
    try:
        init_db()
    except Exception as e:
        print(f"Warning: DB init failed, continuing in fallback mode: {e}")

# Mount SlowAPI Limiter state & handlers
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# CORS — lock to configured origins in production, permissive by default for local dev
cors_origins_env = os.environ.get("CORS_ORIGINS", "*")
cors_origins = [o.strip() for o in cors_origins_env.split(",")] if cors_origins_env != "*" else ["*"]
app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(ingest_router)
app.include_router(predict_router)
app.include_router(alerts_router)
app.include_router(admin_router)
app.include_router(model_lab_router)
app.include_router(cases_router)
app.include_router(insights_router)
app.include_router(batch_router)
app.include_router(rules_router)
app.include_router(keys_router)
app.include_router(status_router)
app.include_router(metrics_router)

# Reflect the live model AUC in metrics on boot
try:
    from observability import ACTIVE_MODEL_AUC
    from api.predict import metadata as _model_meta
    ACTIVE_MODEL_AUC.set(float(_model_meta.get("val_auc", 0) or 0))
except Exception:
    pass

@app.get("/health")
def health_check():
    return {"status": "ok"}


