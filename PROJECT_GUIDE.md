# VaultStream — Project Explainer

A complete study guide to the system, structured to read top-to-bottom and then
field questions on any layer. Includes the *why* behind decisions.

---

## 1. The one-liner

**VaultStream is a real-time fraud-detection platform: it ingests transaction
events, computes behavioral features on the fly, scores each transaction with a
gradient-boosted ML model in under ~30ms, and streams explainable alerts to a
live analyst command center** — wrapped with a Model Lab for on-demand training,
a rules engine, case management, and an MLOps feedback loop.

Think of it as a miniature version of what a bank's fraud-ops team uses:
detection → triage → investigation → action → model improvement.

## 2. Tech stack (and why)

**Frontend:** Next.js 16 (App Router), React 19, TypeScript, Tailwind v4,
Framer Motion (animation), Recharts (charts), react-three-fiber (3D/WebGL).
Custom pastel "Sage & Champagne" design system; self-hosted fonts via
`next/font`. No third-party page builder — all motion components are bespoke.

**Backend:** FastAPI (Python), XGBoost + scikit-learn, Redpanda/Kafka
(`confluent-kafka`), Redis, Supabase (auth), SlowAPI (rate limiting), Sentry,
Server-Sent Events (SSE), Prometheus.

**Data:** SQLAlchemy with a **3-tier persistence strategy** (see §9).

*Why this stack:* FastAPI is async and fast (good for a low-latency scoring
path), XGBoost is the industry standard for tabular fraud, and Next.js gives a
polished, SEO-able marketing site + an app in one codebase.

## 3. The core data flow (memorize this diagram)

```
client ──REST──▶ FastAPI /v1/ingest ──▶ Redpanda topic ──▶ feature consumer
                      │                                          │
                      ▼                                          ▼
                 XGBoost score ◀──── Redis feature store (velocity, z-score, device)
                      │
                      ▼
            WebSocket /ws/alerts ──▶ Next.js analyst workspace (freeze / escalate)
```

Walk it through as: **ingest → feature store → score → broadcast → act.** The
Kafka hop is "best-effort"; the API also scores synchronously so a transaction
is always scored, broadcast, and persisted even if the streaming consumer is
offline.

## 4. The ML model

- **Live model:** XGBoost trained offline on the **IEEE-CIS** fraud benchmark — a
  **430-feature** model, **~0.92 validation AUC**, threshold-tuned to **~1.1%
  false-positive rate**.
- **Labels:** thresholded into **FRAUD** (score ≥ threshold), **SUSPICIOUS**
  (≥ half-threshold), **SAFE**.
- **The honest nuance to explain:** a live streaming transaction only provides a
  *subset* of those 430 features; the rest are imputed, and categorical fields
  are label-encoded with persisted encoders (`.pkl`). For deterministic demo
  verdicts, the workspace's +Safe/+Fraud injectors pass a `forced_score`, while
  real `/predict` calls run the full model.
- **Explainability:** real **SHAP** values via XGBoost's native **TreeSHAP**
  (`pred_contribs=True`) — the top-8 feature contributions are stored per alert
  and rendered as a waterfall. (Native TreeSHAP was chosen because the `shap`
  library is incompatible with XGBoost 3's base-score-as-array.)

## 5. Real-time feature engineering (a strong talking point)

Computed live in Redis as each event arrives:

- **Sliding-window velocity:** transaction counts over 5m / 1h / 24h (Redis
  counters with TTL expiry).
- **Amount z-score via Welford's online algorithm** — running mean/variance
  updated incrementally, so you never re-scan history. This is the detail that
  signals you understand streaming systems.
- **Device-shift detection:** compares the current device fingerprint to the
  last-seen one for that entity.
- **Unique merchant count:** a Redis sorted-set (ZSET) with time-based eviction.

## 6. The frontend pages (every screen)

- **`/` Landing** — marketing site with 3D WebGL hero scenes (vault core,
  transaction network), animated pipeline explainer, performance stats.
- **`/login`, `/signup`, `/auth/callback`** — Supabase auth with a post-login
  "access granted" scan animation.
- **`/workspace` — the live command center** (3-panel layout):
  - *Left:* live threat feed with **stream controls** (start/pause, Mock vs DB
    replay), **verdict filter chips with counts**, **search**, **sort**
    (time/risk), **freeze/pause** the feed, **sound ping** on fraud, **CSV
    export**, **pagination**, and **+Safe / +Fraud / +Custom** injectors.
  - *Center:* feature-correlation **scatter plot** (amount × velocity, colored
    by verdict).
  - *Right:* **deep-dive inspection** panel (see §7).
  - **Keyboard shortcuts:** ↑/↓ move, F freeze, E escalate. Prefs persist to
    localStorage.
- **`/analytics`** — KPI tiles, daily-volume stacked area, verdict donut,
  amount-blocked trend, top risky entities, plus **cost/impact tiles, geo
  breakdown, and outcome-monitoring banner**.
- **`/lab` — Model Lab** (admin) — train models, live SSE progress, ROC curve +
  confusion matrix + feature importance, **decision-threshold tuner**, **run
  registry** with one-click **promotion**, **drift (PSI)** panel, **feedback
  signal**, and **champion/challenger shadow** stats.
- **`/admin`** — user/role management, audit trail.
- **`/status`** — live component health + platform stats (alert counts, DB
  dialect, model AUC/threshold, shadow status), auto-refreshing.
- **`/batch`** — bulk CSV scoring.
- **`/rules`** — rules engine + **backtesting**.
- **`/watchlist`, `/network`, `/simulator`, `/entity/[id]`, `/alert/[id]`,
  `/settings`** — covered below.
- **Global:** ⌘K command palette, `?` keyboard-shortcuts modal, toast
  notifications, VaultAI assistant.

## 7. The deep-dive panel (per-alert investigation)

For a selected alert: risk score + verdict, **case management** (status pills:
open/investigating/resolved/dismissed, claim/assign, investigator notes),
**risk-factor strip**, **rules triggered**, **entity relationship graph**,
**SHAP waterfall**, **analyst disposition** (confirmed fraud / false positive /
unsure → feeds retraining), **block entity**, **SAR case-file export**, **case
timeline**, and **freeze/escalate** actions (RBAC-gated; viewers can *raise* but
not freeze).

## 8. Feature areas in full (big + small)

**Detection & scoring**
- Streaming ingestion with per-IP rate limiting; optional API-key auth
  (`X-API-Key`).
- Hybrid detection: ML score **+ a deterministic rules engine** (an "escalate"
  rule lifts a verdict; "flag" rules annotate).
- **Watchlist / blocklist** — entities/devices/merchants denied at scoring time
  (instant FRAUD, bypassing the model).

**Investigation & workflow**
- Case management (status, assignment, notes).
- **Case investigation timeline** — merges detection + actions + notes +
  dispositions chronologically.
- **SAR / case-file export** — a printable, self-contained HTML investigation
  report (no PDF dependency, deploy-friendly).
- **SLA aging badges** — open non-safe cases marked on-time / aging / overdue by
  age.
- **Per-entity behavioral profile** (`/entity/[id]`) — an account's history, its
  own rolling baseline, and how many σ the latest activity deviates from that
  baseline.

**Intelligence & analytics**
- Analytics dashboard (volume, verdict mix, amount blocked, top entities).
- **Cost/impact framing** — value caught, open exposure, estimated false-positive
  review cost, net protected.
- **Geo breakdown** — origins by country (pseudo-geo derived from entity ID,
  since IEEE-CIS ships no geolocation — be honest about this).
- **Outcome monitoring** — compares last-hour fraud rate vs 24h baseline and
  flags spikes.
- **Fraud-ring link analysis** (`/network`) — connected-component clustering over
  entities sharing a device-shift signature, to surface coordinated rings that
  look benign one transaction at a time.

**MLOps (the Model Lab story)**
- 4 algorithms: **XGBoost, Random Forest, Logistic Regression, Isolation Forest**
  (the last is unsupervised anomaly detection).
- Trains on a **synthetic** fraud dataset at runtime (deliberate: no multi-GB
  CSVs needed in production → deploy-friendly). Returns AUC, ROC, confusion
  matrix, feature importance, tuned threshold.
- **Run registry + promotion** (champion).
- **Drift monitoring** via **PSI** (Population Stability Index) between older and
  recent halves of the live feature stream.
- **Analyst feedback loop** — dispositions become supervised labels; surfaced as
  a retraining signal with a precision proxy.
- **Champion/challenger shadow scoring** — the live model decides; a promoted Lab
  model is scored *in shadow* on every transaction to measure disagreement rate
  **before** it's ever trusted. (The most "production-grade" feature — emphasize
  it.)
- **Scenario simulator** (`/simulator`) — interactive sliders run live what-if
  scoring against the real model with an animated risk gauge. Stateless; nothing
  persisted.
- **Rule backtesting** — replay a draft rule against historical alerts (joined
  with feedback) to see what it *would* have flagged and at what precision,
  before enabling it.

**Platform & ops**
- **RBAC:** viewer / analyst / admin, enforced per-endpoint.
- **Observability:** Prometheus `/metrics` (scoring-latency histogram, verdict
  counter, model-AUC gauge), Sentry error tracking, full **audit trail**.
- **Notifications:** multi-channel (Slack/Discord/generic webhook) on FRAUD
  verdicts and fraud-rate spikes.
- **VaultAI assistant** — a Groq-powered in-app assistant with a grounded-fallback
  responder when no API key is set.
- **API keys** management, Swagger `/docs`, Postman collection.

## 9. Cross-cutting concepts (interviewers love these)

**3-tier graceful persistence** — the app *always* persists:
1. No `DATABASE_URL` → **SQLite** file (zero-config local).
2. `DATABASE_URL` set → **Postgres** (Neon/Render) via SQLAlchemy.
3. Supabase can coexist.

`db.py` normalizes `postgres://` → `postgresql+psycopg2://` automatically.

**Graceful degradation (the headline resilience story):** the platform runs with
**zero managed services**. No Kafka → synchronous scoring. No Redis → an
in-memory Redis mock. No Supabase → mock-auth mode with demo accounts. No Groq →
grounded assistant. *"It deploys and demos even if every external dependency is
down"* — that single sentence is a great closer.

**Auth:** Supabase JWTs (HS256). In dev, `mock-token-{role}` bypasses for instant
role testing.

## 10. Deployment

Vercel (frontend) + Render (backend, Docker, WebSocket-capable) + Neon (Postgres)
+ Render KV/Upstash (Redis); Kafka optional. One caveat: Render's filesystem is
ephemeral, so the Lab run registry / shadow-scoring models reset on redeploy
unless you attach a persistent disk — alert/case data lives safely in Neon.

## 11. Likely questions — have answers ready

- **"How do you get sub-30ms scoring?"** → Pre-computed features in Redis (no DB
  joins on the hot path), a single XGBoost `predict_proba`, async FastAPI.
- **"How is the model explainable?"** → Native TreeSHAP per prediction, top-8
  contributions stored and rendered as a waterfall.
- **"How do you avoid re-scanning history for the z-score?"** → Welford's online
  mean/variance in Redis.
- **"What's the difference between the live model and the Lab?"** → Live =
  430-feature IEEE-CIS XGBoost; Lab = on-demand training on synthetic data for
  responsiveness/deploy-friendliness; shadow scoring bridges them.
- **"How would you productionize the feedback loop?"** → Dispositions are already
  captured as labels; next step is a scheduled retraining job that pulls
  confirmed-fraud/false-positive labels and challenges the champion via the
  shadow harness.
- **"What did you simplify / what's synthetic?"** → Be upfront: geo is derived
  from entity ID, the Lab trains on synthetic data, demo verdicts use forced
  scores. Honesty here reads as maturity.
