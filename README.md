<div align="center">

# VaultStream

### Real-time fraud intelligence for modern financial institutions

Streaming transaction scoring in **under 30ms**, explainable ML decisions, a live analyst
command center, and a built-in **Model Lab** for on-demand training — wrapped in a pastel,
private-bank aesthetic.

</div>

---

## What it does

VaultStream ingests transaction events, computes behavioural features in real time, scores
each transaction with a gradient-boosted model, and streams explainable alerts to an analyst
workspace where cases can be frozen or escalated.

| Capability | Detail |
|---|---|
| **Streaming pipeline** | REST/Kafka ingestion → Redpanda → Redis feature store → model → WebSocket alerts |
| **ML model** | XGBoost on the IEEE-CIS benchmark — **0.92 validation AUC**, ~1.1% FPR at a tuned threshold |
| **Real-time features** | Sliding-window velocity (5m/1h/24h), Welford amount z-scores, device-shift detection |
| **Explainability** | Per-alert SHAP-style contribution waterfall + entity relationship graph |
| **Model Lab** | Train XGBoost / Random Forest / Logistic Regression / Isolation Forest on demand, with live (SSE) metrics, ROC curve, confusion matrix, feature importance, a decision-threshold tuner, a run registry, and one-click promotion |
| **Auth & RBAC** | Supabase auth with viewer / analyst / admin roles (graceful mock mode for demos) |
| **Resilience** | Degrades gracefully — runs with no Kafka, no Redis, and no Supabase |

## Tech stack

**Frontend** — Next.js 16 (App Router), React 19, TypeScript, Tailwind v4, Framer Motion,
Recharts. Custom pastel/luxe design system; bespoke motion components (no third-party page builder).

**Backend** — FastAPI, XGBoost + scikit-learn, Redpanda/Kafka (`confluent-kafka`), Redis,
Supabase, SlowAPI rate limiting, Sentry, SSE streaming.

## Architecture

```
 client ──REST──▶ FastAPI /v1/ingest ──▶ Redpanda topic ──▶ feature consumer
                       │                                          │
                       ▼                                          ▼
                  XGBoost score ◀──── Redis feature store (velocity, z-score, device)
                       │
                       ▼
              WebSocket /ws/alerts ──▶ Next.js analyst workspace (freeze / escalate)
```

## Quick start

```bash
# 1. infra
docker compose up -d redpanda          # + redis (see docker-compose.yml)

# 2. backend  →  http://localhost:8000
cd backend && python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000

# 3. frontend →  http://localhost:3000
cd frontend && npm install --legacy-peer-deps && npm run dev
```

Demo logins (mock mode), password **demo1234**:
`admin@vaultstream.demo` · `analyst@vaultstream.demo` · `viewer@vaultstream.demo`

## Deployment

Frontend → Vercel, backend → Render/Railway/Fly, Redis → Upstash. See **[DEPLOY.md](DEPLOY.md)**.

## Repository layout

```
backend/   FastAPI app, ML pipeline (ml/), Model Lab (api/model_lab.py, ml/trainer.py)
frontend/  Next.js app — design system, fx components, pages, Model Lab UI
docs/      Design system + product/tech docs
```
