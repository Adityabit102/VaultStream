<div align="center">

# 🛡️ VaultStream

### Real-time fraud intelligence for modern financial institutions

Streaming transaction scoring in **under ~30ms**, explainable ML decisions, a live analyst
command center, fraud-ring link analysis, and a built-in **Model Lab** with champion/challenger
shadow scoring — wrapped in a pastel, private-bank aesthetic.

![Frontend](https://img.shields.io/badge/Next.js-16-black?logo=nextdotjs)
![React](https://img.shields.io/badge/React-19-61dafb?logo=react)
![Backend](https://img.shields.io/badge/FastAPI-Python-009688?logo=fastapi)
![Model](https://img.shields.io/badge/XGBoost-0.92_AUC-orange)
![Streaming](https://img.shields.io/badge/Redpanda%2FKafka-Redis-red)

</div>

---

## The problem

Card fraud is a needle-in-a-haystack problem under a stopwatch. A bank sees **thousands of
transactions per second**, of which a tiny fraction are fraudulent — and a decision has to be
made in **milliseconds**, before the transaction is authorized. Get it wrong one way and you
let fraud through; get it wrong the other way and you decline a legitimate customer (a "false
positive" that costs trust and revenue).

The hard parts:

- **Latency** — scoring has to happen inline, in real time, not in a nightly batch.
- **Context** — a single transaction looks innocent; fraud only shows up in *behavioral
  patterns* (velocity spikes, device changes, deviation from an account's own baseline).
- **Explainability** — analysts and regulators need to know *why* a transaction was flagged.
- **Coordinated fraud** — rings of "mule" accounts share devices/cards and look benign one
  transaction at a time.
- **Model drift & trust** — fraud patterns shift, so models need monitoring, retraining, and
  a safe way to test a challenger before trusting it.

**VaultStream is an end-to-end platform that addresses all of these:** detection → triage →
investigation → action → model improvement, as a single system.

## What it does

VaultStream ingests transaction events, computes behavioral features in real time, scores each
transaction with a gradient-boosted model, and streams **explainable** alerts to an analyst
workspace where cases can be investigated, frozen, or escalated — then closes the loop by
feeding analyst dispositions back into model training.

| Capability | Detail |
|---|---|
| **Streaming pipeline** | REST/Kafka ingestion → Redpanda → Redis feature store → model → WebSocket alerts |
| **ML model** | XGBoost on the IEEE-CIS benchmark — **~0.92 validation AUC**, ~1.1% FPR at a tuned threshold |
| **Real-time features** | Sliding-window velocity (5m/1h/24h), Welford online amount z-scores, device-shift detection |
| **Explainability** | Per-alert **TreeSHAP** contribution waterfall + entity relationship graph |
| **Hybrid detection** | ML score **+** a deterministic rules engine **+** a hard-block watchlist |
| **Model Lab** | Train XGBoost / Random Forest / Logistic Regression / Isolation Forest on demand — live (SSE) metrics, ROC curve, confusion matrix, feature importance, threshold tuner, run registry, one-click promotion |
| **MLOps loop** | Champion/challenger shadow scoring, PSI drift monitoring, analyst-feedback retraining signal |
| **Auth & RBAC** | Supabase auth with viewer / analyst / admin roles (graceful mock mode for demos) |
| **Resilience** | Degrades gracefully — runs with no Kafka, no Redis, no Supabase, and no LLM key |

## Feature catalog

**Detection & scoring**
- Real-time REST ingestion with per-IP rate limiting and optional API-key auth.
- Hybrid verdicts: ML score combined with a deterministic **rules engine** (flag / escalate).
- **Watchlist / blocklist** — entities, devices, and merchants denied at scoring time (instant FRAUD, bypassing the model).

**Analyst command center** (`/workspace`)
- Live WebSocket threat feed with verdict filters, search, sort, freeze/pause, and a fraud sound ping.
- Stream controls (mock generator vs. database replay), `+Safe / +Fraud / +Custom` injectors.
- Feature-correlation scatter plot, deep-dive inspection panel, keyboard shortcuts (↑/↓/F/E).
- CSV export, pagination, SLA aging badges (on-time / aging / overdue).

**Investigation & workflow**
- Case management (status, assignment, investigator notes).
- **Case timeline** merging detection + actions + notes + dispositions.
- **SAR / case-file export** — a printable, self-contained investigation report.
- **Per-entity behavioral profile** — an account's history, baseline, and σ-deviation of latest activity.

**Intelligence & analytics** (`/analytics`, `/network`)
- KPI dashboard: volume, verdict mix, amount blocked, top risky entities.
- **Cost/impact framing** (value caught, exposure, FP review cost), geo breakdown, outcome-monitoring spike alerts.
- **Fraud-ring link analysis** — connected-component clustering surfaces coordinated rings.

**MLOps — Model Lab** (`/lab`)
- 4 algorithms with live SSE training progress and full evaluation metrics.
- Run registry + one-click promotion (champion).
- **Champion/challenger shadow scoring** — a promoted model is scored in shadow on every live transaction to measure disagreement *before* it's trusted.
- **PSI drift monitoring** and an **analyst-feedback retraining signal** (confirmed-fraud / false-positive labels).
- **Scenario simulator** (`/simulator`) — interactive what-if scoring against the live model.
- **Rule backtesting** — replay a draft rule against history before enabling it.

**Platform & ops**
- RBAC (viewer / analyst / admin), full audit trail.
- Prometheus `/metrics`, Sentry error tracking, multi-channel (Slack/Discord) notifications.
- VaultAI in-app assistant (Groq, optional Anthropic upgrade) with a grounded fallback.

## Tech stack

**Frontend** — Next.js 16 (App Router), React 19, TypeScript, Tailwind v4, Framer Motion,
Recharts, react-three-fiber (3D/WebGL). Custom pastel "Sage & Champagne" design system;
self-hosted fonts; bespoke motion components (no third-party page builder).

**Backend** — FastAPI, XGBoost + scikit-learn, Redpanda/Kafka (`confluent-kafka`), Redis,
Supabase (auth), SlowAPI (rate limiting), Sentry, Server-Sent Events, Prometheus.

**Data** — SQLAlchemy with **3-tier graceful persistence**: SQLite (zero-config local) →
Postgres/Neon (production) → Supabase (optional). Auto-detected from `DATABASE_URL`.

## Architecture

```
                          ┌──────────────────────────────────────────────┐
                          │              Next.js frontend                 │
                          │  Workspace · Analytics · Model Lab · Rings ·  │
                          │  Simulator · Watchlist · Entity profiles      │
                          └───────────────┬─────────────────▲────────────┘
                                REST / SSE │                 │ WebSocket
                                           ▼                 │ /ws/alerts
 client ──REST──▶ FastAPI /v1/ingest ──▶ Redpanda topic ──▶ feature consumer
                       │   (rate-limit,        (best-effort)      │
                       │    API-key)                              ▼
                       │                          Redis feature store
                       │                    (velocity 5m/1h/24h, Welford
                       │                     z-score, device shift, ZSET merchants)
                       ▼                                          │
                  XGBoost score  ◀──────────────────────────────-┘
                       │  + rules engine + watchlist + TreeSHAP
                       ▼
              persist (SQLite / Postgres / Supabase) ──▶ broadcast alert
                       │
                       ▼
          champion/challenger shadow scoring · Prometheus metrics · notifications
```

The Kafka hop is **best-effort**: the API also scores synchronously, so every transaction is
scored, broadcast, and persisted even if the streaming consumer (or Kafka, or Redis) is down.

## The ML model

- **Live model:** XGBoost trained offline on the **IEEE-CIS** fraud benchmark — a 430-feature
  model, **~0.92 validation AUC**, threshold-tuned to **~1.1% false-positive rate**.
- **Labels:** thresholded into **FRAUD** (≥ threshold), **SUSPICIOUS** (≥ half-threshold), **SAFE**.
- **Explainability:** real per-prediction **SHAP** via XGBoost native TreeSHAP (`pred_contribs`),
  with the top-8 contributions stored and rendered as a waterfall.
- **Real-time feature engineering:** sliding-window transaction velocity, **Welford's online
  algorithm** for amount z-scores (no history re-scan), device-shift detection, and a Redis
  ZSET for unique-merchant counts with time-based eviction.

## Quick start (local)

```bash
# 1. infra (optional — the app degrades gracefully without it)
docker compose up -d redpanda          # + redis (see docker-compose.yml)

# 2. backend  →  http://localhost:8000
cd backend && python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000

# 3. frontend →  http://localhost:3000
cd frontend && npm install --legacy-peer-deps
npm run dev
```

With no `DATABASE_URL`, the app auto-creates a local **SQLite** database and **seeds ~600 demo
transactions** on first boot, so every screen has data immediately.

**Demo logins** (mock-auth mode), password **demo1234**:
`admin@vaultstream.demo` · `analyst@vaultstream.demo` · `viewer@vaultstream.demo`

> Tip: in mock-auth mode, sign up/log in with any email containing `admin` to reach admin-only
> screens (Model Lab, Admin), or `analyst` for analyst features (watchlist, feedback, freeze).

## Deployment

| Piece | Host | Notes |
|---|---|---|
| **Frontend** | Vercel | Native Next.js; set `NEXT_PUBLIC_*` vars |
| **Backend** | Render | Dockerfile included (honors `$PORT`, `/health` check, WebSocket-capable) |
| **Postgres** | Neon | `db.py` normalizes the connection string |
| **Redis** | Upstash | REST client (`UPSTASH_REDIS_REST_URL` / `_TOKEN`) |
| **Kafka** | optional | Redpanda Cloud, or skip — app runs in standalone fallback |

A `render.yaml` blueprint and a full env-var reference are in **[DEPLOY.md](DEPLOY.md)**.

## Resilience — graceful degradation

VaultStream is designed to run with **zero managed services**: no Kafka → synchronous scoring;
no Redis → in-memory feature store; no Supabase → mock-auth demo mode; no Groq/Anthropic key →
a grounded assistant responder. *It deploys and demos even if every external dependency is down.*

## Repository layout

```
backend/    FastAPI app
  api/        routers: ingest, predict, alerts, cases, rules, watchlist, feedback,
              network (rings), reports (SAR), simulator, entities, model_lab, insights…
  ml/         training pipeline + Model Lab trainer (trainer.py)
  database/   SQLAlchemy models + 3-tier persistence (db.py)
frontend/   Next.js app — design system, fx/3D components, pages, Model Lab UI
docs/        design system + product/tech docs
```

## Documentation

- **[PROJECT_GUIDE.md](PROJECT_GUIDE.md)** — deep-dive explainer of every subsystem and feature.
- **[DEPLOY.md](DEPLOY.md)** — step-by-step deployment + full env-var reference.

---

<div align="center">
<sub>Crafted as a personal project — real-time fraud intelligence, end to end.</sub>
</div>
