# Product Requirements Document (PRD) — VaultStream
**Version 2.0 · June 2026**

---

## 1. Executive Summary & Vision

VaultStream is an enterprise-grade, high-throughput, real-time Fraud Detection System engineered to bridge the gap between high-velocity data engineering streams and sub-millisecond AI/ML inference. The platform intercepts transactional data streams via a Kafka-native broker, computes rolling-window feature aggregations, reads and writes state against a Redis-backed operational Feature Store, evaluates risk via an in-memory XGBoost model, and surfaces telemetry + threat signals through a Neo-Brutalist analytical dashboard delivered over native WebSockets.

### Core Goals

**Sub-50ms Inference Response** — Deliver fraud risk classifications within the execution window of a live transaction pipeline. Features are pre-computed and hot in Redis; model weights reside fully in memory. No disk I/O on the hot path.

**Zero-Downtime Feature Computation** — Calculate complex rolling aggregates (5-min / 1-hr / 24-hr windows) in a fully decoupled background pipeline. The core application path is never blocked by feature computation.

**High-Signal Analyst Workspace** — Provide fraud operations teams with an instant, layout-stable, high-contrast dashboard engineered for sustained shift work: zero animation lag on critical alerts, monospaced data grids, and a brutalist aesthetic that prioritizes signal over decoration.

**Commercialization-Ready Architecture** — Every system component is designed to horizontal-scale, be secured behind production-grade authentication + RLS, and be deployable to free-tier cloud infrastructure so student developers can graduate this project to a funded startup without architectural rewrites.

---

## 2. User Stories

### Fraud Analyst
> *"As a Fraud Analyst, I want a real-time streaming feed of anomalous transactions so I can inspect and freeze compromised accounts before significant financial loss occurs."*

Acceptance criteria: The live threat ticker in the left panel updates within 500ms of ingestion. Alerts crossing the risk threshold flash the card from base to crimson with a 0ms frame-shift — no easing delay. I can click any alert card to open a deep-dive inspection panel showing raw feature vectors, model confidence, rolling window counts, and SHAP value breakdowns.

### Data Engineer
> *"As a Data Engineer, I want an isolated, declarative Feature Store engine to register and update training and inference features without editing production application code."*

Acceptance criteria: Features are registered as Python dataclass schemas. The ingestion consumer reads from the Redpanda topic, computes aggregates, and writes to Upstash Redis atomically. No feature definition lives inside the API handler layer. Feature schemas are versioned via Git.

### System Administrator
> *"As a System Administrator, I want real-time visibility into system health metrics — stream ingestion lag, Redis hit/miss ratio, vector calculation latency, API rate-limit headroom, and inference P95 — to maintain guaranteed high availability."*

Acceptance criteria: The right panel of the dashboard shows a live telemetry bar updated every 2 seconds via WebSocket. Sentry captures unhandled exceptions across both Next.js and FastAPI before they impact SLA.

---

## 3. Comprehensive Feature List

### 3.1 Real-Time Streaming Telemetry Ingestion
A high-velocity HTTP gateway endpoint ingests mock network events — clickstreams, device fingerprint shifts, transaction volumes. Events are published to a Redpanda topic (`raw-transactions`) with producer acknowledgement. The endpoint is protected by token-bucket rate limiting (Upstash Redis) and responds in under 5ms net of ML inference.

### 3.2 Streaming Feature Store Orchestration
A background Redpanda consumer reads the `raw-transactions` topic and computes rolling aggregate features per user entity:
- `tx_count_5m` — transaction count in the last 5 minutes
- `tx_count_1h` — transaction count in the last 1 hour
- `tx_count_24h` — transaction count in the last 24 hours
- `avg_amount_1h` — mean transaction amount over 1 hour
- `unique_merchant_count_1h` — distinct merchant count over 1 hour
- `device_shift_flag` — boolean: device fingerprint changed in last 30 minutes

Features are written to Upstash Redis with a TTL matching the largest window (86400s). Feature reads at inference time are single-key `GET` operations — no joins, no fan-out.

### 3.3 High-Throughput ML Inference Pipeline
A FastAPI endpoint (`POST /v1/predict`) accepts a transaction payload, performs a single Redis `MGET` for the entity's feature vector, runs XGBoost inference in-process (model loaded once at startup), and returns a structured risk response including:
- `risk_score` — float [0.0, 1.0]
- `risk_label` — `SAFE` | `SUSPICIOUS` | `FRAUD`
- `confidence` — float
- `feature_vector` — echoed for audit
- `inference_latency_ms` — measured per request

Model is serialized with `joblib` + `cloudpickle` and pinned to a specific version hash in the repository. A `/v1/model/health` endpoint exposes current model metadata.

### 3.4 Brutalist Analytical Alert Dashboard
A Next.js 15 App Router frontend delivers the analyst workspace over a persistent WebSocket connection. Three-panel asymmetric editorial layout:
- **Left panel** — live streaming threat ticker; new alerts prepend with a crimson flash animation
- **Center panel** — interactive feature correlation chart (Recharts); toggleable by feature dimension
- **Right panel** — deep-dive inspection panel for a selected alert; shows SHAP breakdown, raw features, and account metadata

Dashboard is server-side rendered on first load (RSC) and then hydrated for WebSocket-driven live updates.

---

## 4. Non-Functional Requirements

| Requirement | Target | Measurement Method |
|---|---|---|
| P95 Inference Latency | ≤ 45ms | FastAPI middleware timer; Sentry performance tracing |
| False Positive Rate (FPR) | ≤ 1.2% | Offline validation on held-out historical dataset |
| Stream Lag (ingest → feature store) | < 500ms | Redpanda consumer lag metric exposed via Prometheus |
| Dashboard WebSocket update rate | ≤ 2s cadence | Browser DevTools / WebSocket frame timestamp |
| API uptime (on free tier) | ≥ 99.5% | Koyeb / Render uptime dashboard |
| Rate limit ceiling | 100 req / 60s per IP | Upstash Redis token bucket, returns HTTP 429 |

---

## 5. Out of Scope (v1.0)

- Multi-tenant analyst accounts with per-tenant data isolation (RLS policy structure is in place for future activation)
- SAML / enterprise SSO (Supabase Auth handles email + OAuth for v1)
- Graph Neural Network enrichment layer (XGBoost is the v1 inference model)
- Mobile-native dashboard client
- Automated model retraining pipeline (manual `model.pkl` replacement for v1)

---

## 6. Success Metrics

**P95 Inference Latency** ≤ 45ms under peak simulated workloads of 1,000 events/sec.

**False Positive Rate (FPR)** ≤ 1.2% verified on historical validation data profiles.

**Streaming Lag** — data ingestion-to-feature store synchronization bounded under 500ms.

**Dashboard Time-to-First-Alert** — WebSocket delivers first live alert within 1 second of analyst loading the workspace.

**Zero Secret Exposure** — no `NEXT_PUBLIC_` prefix on server-side keys; source maps disabled in production build; Sentry strips PII before transmission.
