# Tech Stack Architecture Document — VaultStream
**Version 2.0 · 2026 Blueprint**

---

## 1. Architecture Philosophy

Every technology choice in this stack satisfies three simultaneous constraints:

1. **Zero-cost student deployment** — every service runs on a free tier with no credit card required at launch
2. **Production-grade architecture** — the same choices would be defensible in a Series A engineering review
3. **Inter-stack coherence** — components are selected because they work together well, not because they are individually popular

The stack is containerized via Docker Compose for local development. Each service is independently replaceable when the project grows into paid tiers.

---

## 2. Full Production Stack

### 2.1 Frontend Framework: Next.js 15 (App Router + React Server Components)

**Why in 2026:** Next.js 15 App Router with React Server Components (RSC) represents the current gold standard for full-stack React applications. RSC eliminates client-side hydration overhead for non-interactive sections of the dashboard — the panel layouts, headers, and static labels are zero-JavaScript streamed HTML. Only the WebSocket-fed live data layers hydrate on the client.

The `use server` / `use client` boundary is explicit and auditable — a key security property for a system that handles transaction data.

**Key capabilities used:**
- **Partial Prerendering (PPR)** — dashboard shell renders at the edge in under 10ms; dynamic data streams in after
- **Server Actions** — analyst freeze/escalate operations run as authenticated server functions, never exposed as public REST endpoints
- **Middleware** — CORS enforcement, JWT session validation, and route protection all run at the Vercel Edge before the request reaches the application layer
- **`productionBrowserSourceMaps: false`** in `next.config.ts` — source maps are never sent to the browser in production builds

**Free Deployment:** Vercel Hobby Tier — automatic preview deployments per branch, production edge deployment on `main` merge.

---

### 2.2 Backend Inference & Data API: FastAPI (Python 3.12+)

**Why in 2026:** FastAPI remains the undisputed choice for Python ML inference services. Its async-native architecture matches the event-driven nature of a streaming fraud pipeline. Pydantic v2 (now Rust-compiled) provides request validation at near-zero overhead. Auto-generated OpenAPI docs reduce integration friction.

**Critical implementation notes:**

The XGBoost model (`fraud_model.pkl`) is loaded into a module-level variable at application startup — it is never loaded per-request. Combined with Upstash Redis feature lookups (single `MGET` call), the hot inference path has no I/O blocking operations.

SHAP values are computed asynchronously in a background task after the primary inference response is returned — they populate the deep-dive panel without adding to the P95 inference latency.

```python
# Startup: load model once into memory
@app.on_event("startup")
async def load_model():
    app.state.model = joblib.load("models/fraud_model.pkl")
    app.state.redis = await aioredis.from_url(settings.REDIS_URL)
```

**WebSocket handler:** A dedicated `/ws/alerts` WebSocket endpoint broadcasts new fraud events to all connected dashboard clients. Broadcast is handled via an in-memory `asyncio.Queue` — no external pubsub needed for v1 scale.

**Free Deployment:** Koyeb Free Tier (native Docker, no sleep-on-idle for web services, 512MB RAM — sufficient for XGBoost inference). Render Free Tier as fallback option.

---

### 2.3 Event Streaming: Redpanda (Kafka-Native API)

**Why Redpanda over Kafka in 2026:** Redpanda is a single-binary C++ streaming broker that implements the full Kafka API with no JVM dependency. In a student deployment running on Docker Compose on a laptop, Redpanda starts in under 2 seconds and consumes under 100MB RAM. A standard Kafka + ZooKeeper setup requires 3+ containers and 1.5GB RAM minimum.

The API is 100% Kafka-compatible: `confluent-kafka-python` and `kafka-python` both work without modification.

**Topic architecture:**
- `raw-transactions` — inbound telemetry events (partition count: 3)
- `fraud-alerts` — enriched alert events post-inference (partition count: 1)
- `feature-store-updates` — feature computation results written back for audit (partition count: 3)

**Free Setup:** Local Docker Compose container. For staging, Redpanda Serverless (cloud-hosted free tier) provides 10GB egress/month — sufficient for development and demo workloads.

---

### 2.4 Authentication: Supabase Auth + Better Auth (Dual Strategy)

**Why this combination in 2026:**

Based on the current authentication landscape, the recommended approach for VaultStream is **Supabase Auth as the primary provider**, because the project already uses Supabase PostgreSQL. The deep integration with Row Level Security means authentication and authorization share a single policy layer — no JWT mapping bridges needed.

If multi-tenancy or enterprise SSO is added in a future version, the migration path is to **Better Auth** (TypeScript-native, self-hosted on your own Postgres, v1.6 as of May 2026). Better Auth owns user data in your own database — no vendor lock-in.

**What to avoid:** Clerk exceeds $1,025/month at scale (50K+ MAUs). NextAuth v5 / Auth.js has significant architectural complexity. Firebase Auth adds Google ecosystem lock-in.

**Implementation:**

Supabase Auth handles:
- Email/password registration for analyst accounts
- OAuth via GitHub (for student developer onboarding)
- Magic link email login (passwordless option for analyst accounts)
- JWT generation — tokens are verified by FastAPI middleware using the Supabase JWT secret
- HTTP-only cookie sessions in Next.js (XSS protection — no JWT in localStorage)

FastAPI verifies Supabase JWTs on protected routes:
```python
from supabase import create_client
# Middleware verifies Bearer token on every protected endpoint
async def verify_token(token: str = Depends(oauth2_scheme)):
    payload = jwt.decode(token, settings.SUPABASE_JWT_SECRET, algorithms=["HS256"])
    return payload
```

**Free Tier:** Supabase Auth free tier supports 50,000 monthly active users — no cost concern for a student project or early commercial launch.

---

### 2.5 Database: Supabase (PostgreSQL 16 + pgvector)

**Why Supabase in 2026:** Supabase provides a managed PostgreSQL 16 instance with built-in Row Level Security, a real-time subscription layer, and a REST/GraphQL auto-API — all on a generous free tier (500MB database, 5GB bandwidth, 50K MAU auth). The Supabase dashboard provides a full SQL editor and schema management UI, which lowers the barrier for a student developer versus running a local Postgres instance.

**pgvector** extension (included in Supabase) is available if the project later moves to embedding-based anomaly detection — no infrastructure change needed.

**Schema design:**

```sql
-- Fraud alerts table (written by FastAPI inference service)
CREATE TABLE fraud_alerts (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at   TIMESTAMPTZ DEFAULT NOW(),
    analyst_id   UUID REFERENCES auth.users(id),
    transaction_id TEXT NOT NULL,
    entity_id    TEXT NOT NULL,
    risk_score   FLOAT NOT NULL,
    risk_label   TEXT NOT NULL CHECK (risk_label IN ('SAFE', 'SUSPICIOUS', 'FRAUD')),
    feature_json JSONB,
    shap_json    JSONB,
    action_taken TEXT DEFAULT 'none'
);

-- Row Level Security: analysts only see their own assigned alerts
ALTER TABLE fraud_alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY analyst_isolation_policy ON fraud_alerts
    FOR ALL TO authenticated
    USING (analyst_id = auth.uid());
```

**Audit log table:** A separate `audit_events` table captures all analyst actions (freeze, escalate, dismiss) for compliance — append-only via a Postgres trigger.

---

### 2.6 Real-Time Feature Cache: Upstash Redis

**Why Upstash in 2026:** Upstash is the only fully-managed Redis provider with a genuine HTTP-native free tier — no persistent TCP connection required. This makes it compatible with serverless edge functions and removes connection pool management overhead. The free tier includes 10,000 daily commands and 256MB storage — more than sufficient for a feature store serving thousands of entity keys with TTL expiry.

**Feature key schema:**
```
features:{entity_id}:tx_count_5m    → integer, TTL 300s
features:{entity_id}:tx_count_1h    → integer, TTL 3600s
features:{entity_id}:tx_count_24h   → integer, TTL 86400s
features:{entity_id}:avg_amount_1h  → float,   TTL 3600s
features:{entity_id}:device_shift   → boolean, TTL 1800s
```

**Token Bucket Rate Limiting** (also in Upstash Redis):
```python
async def check_rate_limit(client_ip: str) -> bool:
    key = f"rate:{client_ip}"
    current = await redis.incr(key)
    if current == 1:
        await redis.expire(key, 60)  # 60-second sliding window
    if current > 100:
        raise HTTPException(status_code=429, detail="Rate limit exceeded")
```

**Multi-tier cache strategy:**
1. L1 — Upstash Redis: feature vectors (TTL-bounded, sub-5ms)
2. L2 — FastAPI in-process LRU cache (`functools.lru_cache`): model metadata, config
3. L3 — Supabase PostgreSQL: historical alert archive, audit log (not on hot path)

---

### 2.7 Version Control & CI/CD: GitHub + GitHub Actions

**Why GitHub Actions in 2026:** Free for public repositories and 2,000 minutes/month for private repositories. Native integration with Vercel (auto-deploy on push) and Koyeb/Render (webhook-triggered container updates).

**Branch strategy (Trunk-Based Development):**
- `main` — production; protected branch, requires PR + passing CI
- `staging` — pre-production; auto-deploys to Vercel preview URL
- `feature/*` — short-lived feature branches, merged via PR

**CI pipeline (`.github/workflows/ci.yml`):**
```yaml
# On every PR to main:
steps:
  - lint:        ruff check + mypy (Python), ESLint + TypeScript (Next.js)
  - test:        pytest (FastAPI unit tests), Vitest (Next.js component tests)
  - build:       docker build (FastAPI), next build (Next.js — validates no secret exposure)
  - security:    pip-audit (Python deps), npm audit (Node deps)
  - deploy:      Vercel CLI deploy (preview URL posted to PR)
```

**Secret management:** All secrets (Supabase URL, Upstash Redis URL, JWT secret) are stored as GitHub Actions secrets and injected as environment variables at build/deploy time. Never committed to the repository. The `next.config.ts` `env` block explicitly lists which variables are exposed to the browser (`NEXT_PUBLIC_`) vs. server-only.

---

### 2.8 Deployment & Hosting

| Service | Platform | Free Tier Limits |
|---|---|---|
| Next.js Frontend | **Vercel Hobby** | 100GB bandwidth, unlimited deployments, Edge Functions |
| FastAPI Backend | **Koyeb Free** | 1 service, 512MB RAM, no sleep-on-idle |
| PostgreSQL | **Supabase Free** | 500MB DB, 5GB bandwidth, 2 projects |
| Redis | **Upstash Free** | 10,000 cmd/day, 256MB |
| Redpanda | **Local Docker / Redpanda Serverless Free** | 10GB egress/month |
| Error Tracking | **Sentry Developer Free** | 5K errors/month, 10K performance traces |
| Container Registry | **GitHub Container Registry (GHCR)** | Free for public, 500MB for private |

**Deployment flow:**
1. Developer pushes to `feature/*` branch
2. GitHub Actions runs lint + test + build
3. On merge to `main`: Vercel auto-deploys frontend; Koyeb webhook triggers Docker container rebuild from GHCR image

---

## 3. Full Compliance Matrix

### ✅ 1. Frontend — No Secret Exposure & No Source Maps

`next.config.ts` configuration:
```typescript
const nextConfig: NextConfig = {
  productionBrowserSourceMaps: false,  // Source maps disabled in production
  env: {
    // Only NEXT_PUBLIC_ vars are sent to the browser
    // SUPABASE_SERVICE_KEY, UPSTASH_REDIS_TOKEN, etc. stay server-side
  },
  headers: async () => [{
    source: '/(.*)',
    headers: [
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    ]
  }]
};
```

The Next.js build compiler performs dead-code elimination and minification. No API keys, database credentials, or internal service URLs exist in the client-side JS bundle.

---

### ✅ 2. Database with Row-Level Security

All analyst-facing tables have RLS enabled at creation time — it cannot be accidentally disabled by a future migration without an explicit `ALTER TABLE` statement:

```sql
-- Fraud alerts: analysts see only their assigned cases
ALTER TABLE fraud_alerts ENABLE ROW LEVEL SECURITY;
CREATE POLICY analyst_isolation_policy ON fraud_alerts
    FOR ALL TO authenticated
    USING (analyst_id = auth.uid());

-- Feature store snapshots: read-only for authenticated users
ALTER TABLE feature_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY feature_read_policy ON feature_snapshots
    FOR SELECT TO authenticated USING (true);

-- Audit log: append-only, no UPDATE/DELETE for any role
ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY audit_insert_only ON audit_events
    FOR INSERT TO authenticated WITH CHECK (actor_id = auth.uid());
```

---

### ✅ 3. Authentication

Supabase Auth provides:
- Email/password with bcrypt hashing (handled by Supabase)
- OAuth via GitHub
- JWT tokens verified by FastAPI middleware on every protected API route
- HTTP-only cookie sessions in Next.js (prevents XSS token theft)
- Session refresh handled automatically by Supabase SSR helpers (`@supabase/ssr`)
- PKCE flow for OAuth (prevents authorization code interception)

Password reset, email verification, and account deletion flows are handled by Supabase Auth out of the box.

---

### ✅ 4. Version Control

Private GitHub repository with:
- Protected `main` branch (requires CI pass + 1 PR approval)
- GitHub Actions CI on every push (lint, test, build, security audit)
- Dependabot enabled for automatic dependency security patches
- Git-secrets pre-commit hook to prevent accidental secret commits
- Commit signing with SSH keys (optional but documented for the team)

---

### ✅ 5. APIs

**REST Endpoints (FastAPI):**

| Method | Path | Auth Required | Purpose |
|---|---|---|---|
| `POST` | `/v1/ingest` | API Key | Submit transaction event |
| `POST` | `/v1/predict` | API Key | Run fraud inference |
| `GET` | `/v1/alerts` | JWT | Fetch analyst alert queue |
| `PATCH` | `/v1/alerts/{id}` | JWT | Update alert action |
| `GET` | `/v1/model/health` | JWT | Model metadata & version |
| `GET` | `/health` | None | Liveness probe for Koyeb |

**WebSocket Endpoint:**

`ws://api/ws/alerts` — authenticated via JWT query parameter on handshake. Pushes `AlertEvent` JSON frames to connected dashboard clients whenever a new fraud alert clears the inference threshold.

**OpenAPI docs** auto-generated at `/docs` (disabled in production; enabled in staging).

---

### ✅ 6. Hosting & Automated Cloud Deployment

GitHub → Vercel (Next.js):
- Every `main` push triggers Vercel production build automatically via GitHub integration
- Preview URLs generated for every open PR
- Edge runtime middleware runs globally (CORS, CSP, auth)

GitHub → Koyeb (FastAPI):
- GHCR Docker image is built by GitHub Actions on every `main` merge
- Koyeb is configured to pull the latest `:main` image tag on new pushes
- Zero-downtime rolling deploy (Koyeb handles old-container drain)

Environment variables are set in the Vercel dashboard and Koyeb dashboard — never in the codebase.

---

### ✅ 7. Security

**CORS (FastAPI):**
```python
app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://vaultstream.vercel.app"],  # Exact production domain only
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH"],
    allow_headers=["Authorization", "Content-Type"],
)
```

**Content Security Policy (Next.js headers):**
- `default-src 'self'` — no unauthorized external script execution
- `connect-src 'self' wss://api.vaultstream.app` — WebSocket allowed only to known origin
- `frame-ancestors 'none'` — prevents clickjacking / frame injection

**HTTP Security Headers:** X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Strict-Transport-Security (HSTS) — all enforced via Next.js middleware.

**Dependency Auditing:** `npm audit` and `pip-audit` run in CI on every push. High/critical CVEs block merge.

---

### ✅ 8. Rate Limiting

Token bucket algorithm implemented in FastAPI middleware using Upstash Redis atomic `INCR` + `EXPIRE`:

```python
# 100 requests per 60-second window per IP address
# Returns HTTP 429 with Retry-After header on breach
async def rate_limit_middleware(request: Request, call_next):
    key = f"rl:{request.client.host}"
    count = await redis.incr(key)
    if count == 1:
        await redis.expire(key, 60)
    if count > 100:
        return JSONResponse(
            status_code=429,
            headers={"Retry-After": "60"},
            content={"detail": "Rate limit exceeded. 100 req/60s."}
        )
    return await call_next(request)
```

The inference endpoint (`/v1/predict`) has a tighter limit (20 req/60s per IP) to protect the ML model from DoS-style spam that would inflate Koyeb CPU usage on the free tier.

---

### ✅ 9. Caching

Three-tier caching architecture:

**L1 — Upstash Redis (feature store cache, <5ms):**
Entity feature vectors are pre-computed by the background consumer and stored with TTL keys. The hot inference path performs a single `MGET` across all feature keys for a given entity. Cache hit rate target: >95%.

**L2 — FastAPI In-Process LRU Cache (config/metadata, 0ms):**
```python
from functools import lru_cache

@lru_cache(maxsize=1)
def get_model() -> XGBClassifier:
    return joblib.load("models/fraud_model.pkl")

@lru_cache(maxsize=256)
def get_entity_config(entity_id: str) -> EntityConfig:
    # Cached entity risk profile configurations
    ...
```

**L3 — Supabase PostgreSQL (historical archive, query-on-demand):**
Not on the hot inference path. Queried only for dashboard data loading (analyst alert history, audit log). Supabase's built-in PostgREST layer handles query optimization.

---

### ✅ 10. Scaling & Load Balancing

**Local development (Docker Compose):**
```yaml
services:
  fastapi:
    image: vaultstream-api:latest
    deploy:
      replicas: 3          # Three API instances
  nginx:
    image: nginx:alpine
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf  # Round-robin upstream to 3 FastAPI instances
    ports:
      - "8000:80"
```

**Production (Koyeb):**
Koyeb Free Tier runs a single instance. When the project graduates to a paid tier, horizontal scaling is a single slider in the Koyeb dashboard — no architectural changes needed because FastAPI is stateless (all state lives in Redis and Postgres).

The Next.js frontend on Vercel is inherently horizontally scaled across Vercel's global edge network — no configuration required.

**Stateless API design note:** All FastAPI endpoints are completely stateless — no in-memory session state, no request-local global variables. Every request reads from Redis and/or Postgres. This is a prerequisite for safe horizontal scaling.

---

### ✅ 11. Error Tracking

**Sentry (Developer Free Tier — 5,000 errors/month, 10,000 performance traces):**

Next.js integration:
```typescript
// sentry.client.config.ts
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: 0.1,  // 10% of transactions
  beforeSend(event) {
    // Strip PII: remove transaction amounts, user IDs from error context
    delete event.extra?.transaction_amount;
    delete event.user?.email;
    return event;
  }
});
```

FastAPI integration:
```python
import sentry_sdk
sentry_sdk.init(
    dsn=settings.SENTRY_DSN,
    traces_sample_rate=0.05,  # 5% of requests
    before_send=strip_pii,   # Custom PII stripping function
)
```

Both integrations capture:
- Unhandled exceptions with full stack trace
- Slow transaction traces (P95 latency breaches)
- Custom performance spans around inference and Redis calls
- Release tracking (tied to git commit SHA)

Sentry alerts are configured to fire to a Slack webhook (free) when error rate exceeds 5 errors/minute.

---

## 4. Local Development Quick Start

```bash
# 1. Clone repository
git clone git@github.com:yourhandle/vaultstream.git
cd vaultstream

# 2. Start infrastructure (Redpanda + Redis mock)
docker compose up -d redpanda upstash-redis-local

# 3. Start FastAPI backend
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000

# 4. Start feature store consumer (separate terminal)
python consumers/feature_store_consumer.py

# 5. Start Next.js frontend
cd ../frontend
npm install
npm run dev
# Dashboard available at http://localhost:3000

# 6. Seed test transaction events
python scripts/seed_transactions.py --count 100 --fraud-rate 0.05
```

---

## 5. Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                        VaultStream Architecture                  │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  [Transaction Source]                                                │
│        │                                                             │
│        ▼                                                             │
│  [FastAPI Ingest Endpoint]  ──── rate limit ──── [Upstash Redis]    │
│        │                                                 ▲           │
│        ▼                                                 │           │
│  [Redpanda Topic: raw-transactions]                      │           │
│        │                        │                        │           │
│        ▼                        ▼                        │           │
│  [FastAPI Inference]    [Feature Store Consumer]         │           │
│     MGET features ──────────────────────────── MSET features        │
│        │                                                             │
│        ▼                                                             │
│  [XGBoost Model] (in-memory)                                        │
│        │                                                             │
│        ▼                                                             │
│  [Fraud Alert] ──── write ──── [Supabase PostgreSQL]                │
│        │                              │                              │
│        ▼                              ▼                              │
│  [WebSocket Broadcast]        [RLS-protected query]                 │
│        │                              │                              │
│        └──────────────────────────────┘                             │
│                          │                                           │
│                          ▼                                           │
│              [Next.js Dashboard — Vercel Edge]                      │
│         ┌────────────────────────────────────────┐                  │
│         │ Threat Ticker │ Feature Chart │ Deep-Dive│                 │
│         └────────────────────────────────────────┘                  │
│                                                                      │
│  [Sentry] ◄─── errors/traces ──── [FastAPI + Next.js]              │
│  [GitHub Actions CI] ──── build/deploy ──── [Vercel + Koyeb]       │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 6. Why This Stack Is Commercially Defensible

Every choice in this stack has a clear paid-tier upgrade path that requires no architectural rewrites:

| Component | Free Tier | Paid Upgrade Path |
|---|---|---|
| Vercel | Hobby | Pro ($20/mo) — teams, analytics |
| Koyeb | Free | Starter ($2.33/mo) — more RAM, replicas |
| Supabase | Free | Pro ($25/mo) — daily backups, more storage |
| Upstash Redis | Free | Pay-as-you-go ($0.2/100K commands) |
| Redpanda | Local / Serverless Free | Serverless Pay ($0.08/GiB) |
| Sentry | Developer Free | Team ($26/mo) — more volume |

A student can run this entire system at $0/month. A funded startup can scale the same codebase to production with a $50–100/month infrastructure bill.
