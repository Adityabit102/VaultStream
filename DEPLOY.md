# Deploying VaultStream

VaultStream has three deployable pieces:

| Piece | Recommended host | Notes |
|---|---|---|
| **Frontend** (Next.js) | **Vercel** | Zero-config; set `NEXT_PUBLIC_*` env vars |
| **Backend** (FastAPI) | **Render / Railway / Fly.io** | Dockerfile included; respects `$PORT` |
| **Redis** (feature store) | **Upstash** | Code supports `UPSTASH_REDIS_REST_*` |
| **Kafka** (streaming) | Redpanda Cloud / Confluent | Optional — app runs in standalone fallback if unreachable |

The app is designed to **degrade gracefully**: with no Supabase keys it runs in mock-auth
mode (demo accounts), and with no Kafka/Redis it falls back to in-memory processing — so it
deploys and demos even with zero managed services.

---

## 1. Frontend → Vercel

1. Import the repo into Vercel and set the **Root Directory** to `frontend/`.
2. Framework preset: **Next.js** (auto-detected). Build command and output are default.
3. Add environment variables:
   ```
   NEXT_PUBLIC_HTTP_API_URL = https://<your-backend-host>
   NEXT_PUBLIC_WS_API_URL   = wss://<your-backend-host>/ws/alerts
   NEXT_PUBLIC_SUPABASE_URL      = (optional — omit for mock mode)
   NEXT_PUBLIC_SUPABASE_ANON_KEY = (optional)
   NEXT_PUBLIC_SENTRY_DSN        = (optional)
   ```
4. Deploy. Fonts are self-hosted via `next/font` (no external font requests), and the
   build emits a standalone server — both already optimized.

> Note: use `wss://` (not `ws://`) for the WebSocket URL once the backend is on HTTPS.

## 2. Backend → Render / Railway / Fly

The backend ships a production `Dockerfile` (non-root, healthcheck on `/health`, honors `$PORT`).

**Render — one-click Blueprint (recommended):** a [`render.yaml`](render.yaml) at the repo root
provisions the **API + Postgres + Redis** together. Render → New → **Blueprint** → pick the repo.
Then set the `sync:false` secrets (CORS_ORIGINS, Supabase keys, optional `NOTIFY_WEBHOOK_URL`).

**Render (manual Docker):**
1. New → Web Service → Root Directory `backend/`, Runtime **Docker**, health check `/health`.
2. Environment variables — see [`backend/.env.example`](backend/.env.example). Minimum for a
   live (non-mock) deploy:
   ```
   DATABASE_URL                                  (Postgres — enables persistence)
   LOCAL_REDIS_URL  (or UPSTASH_REDIS_REST_URL + _TOKEN)
   SUPABASE_URL, SUPABASE_JWT_SECRET, SUPABASE_SERVICE_KEY   (optional)
   CORS_ORIGINS = https://<your-vercel-app>.vercel.app
   NOTIFY_WEBHOOK_URL                            (optional — FRAUD alerts)
   ```

**Railway / Fly.io:** same image; both inject `$PORT`, which the Dockerfile honors.

## 3. Managed services

- **Database (Postgres):** set `DATABASE_URL` → the app persists alerts, users/roles, case
  notes and the audit trail (3-tier: unset = mock, set = Postgres, Supabase if configured).
  `postgres://` URLs are normalized automatically. Seed demo data with `backend/scripts/seed_db.py`.
- **Redis:** Upstash (`UPSTASH_REDIS_REST_*`) or any `LOCAL_REDIS_URL` (Render Key Value / Railway).
- **Kafka/Redpanda:** optional. Set `REDPANDA_BROKER`; if unreachable the backend uses the
  standalone in-memory path (predictions still work).
- **Supabase:** optional managed auth — run the SQL in [`backend/database/`](backend/database/)
  and set the Supabase env vars on both tiers.

## API docs

Interactive Swagger/OpenAPI is auto-served at **`/docs`** (and `/redoc`). A ready-to-import
Postman collection lives at [`docs/VaultStream.postman_collection.json`](docs/VaultStream.postman_collection.json).
Prometheus metrics are at **`/metrics`**.

## 4. Lock down CORS

By default the backend allows all origins (handy for local dev). In production set
`CORS_ORIGINS` to your Vercel URL (comma-separated for multiple). See `main.py`.

## 5. Local development

```bash
# services
docker compose up -d redpanda            # + a redis (see docker-compose.yml)
# backend
cd backend && python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
# frontend
cd frontend && npm install --legacy-peer-deps
npm run dev                              # http://localhost:3000
```

Demo logins (mock mode): `admin@vaultstream.demo` / `analyst@vaultstream.demo` /
`viewer@vaultstream.demo`, password `demo1234`.

## 6. Model Lab note

The in-app **Model Lab** trains on a synthetic benchmark, so it needs no raw datasets at
runtime and stays fast on modest instances. The full IEEE-CIS offline trainer
(`backend/ml/train.py`) requires the Kaggle CSVs in `data/raw/` and is **not** needed for
deployment — those files are excluded from the image via `.dockerignore`.
