#!/bin/bash
# start_all.sh — launch the full VaultStream stack.
# This machine remaps ports to avoid conflicts with other local projects:
#   Redpanda :9092 · Redis :6380 · Postgres :5433 · Backend :8000 · Frontend :3000

echo "Starting VaultStream Environment..."

# --- Infrastructure -------------------------------------------------------
# Redpanda via compose; Redis + Postgres as standalone containers on remapped
# host ports. `docker start || docker run` is idempotent — reuses if present.
docker-compose up -d redpanda

docker start vaultstream-redis 2>/dev/null || \
  docker run -d --name vaultstream-redis -p 6380:6379 redis:alpine

docker start vaultstream-postgres 2>/dev/null || \
  docker run -d --name vaultstream-postgres -p 5433:5432 \
    -e POSTGRES_USER=vault -e POSTGRES_PASSWORD=vault -e POSTGRES_DB=vaultstream \
    postgres:16-alpine

echo "Waiting for services..."
sleep 3

# --- Backend (wired to the remapped infra) --------------------------------
echo "Starting Backend API..."
cd backend
source .venv/bin/activate
export DATABASE_URL="postgresql+psycopg2://vault:vault@localhost:5433/vaultstream"
export LOCAL_REDIS_URL="redis://localhost:6380"
export REDPANDA_BROKER="localhost:9092"
uvicorn main:app --reload --port 8000 &
BACKEND_PID=$!
cd ..

# --- Frontend -------------------------------------------------------------
echo "Starting Frontend..."
cd frontend
npm run dev &
FRONTEND_PID=$!
cd ..

echo ""
echo "VaultStream is running!"
echo "Backend:  http://localhost:8000   (health: /health, status: /v1/status)"
echo "Frontend: http://localhost:3000"
echo "Press Ctrl+C to stop."

trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; exit" SIGINT SIGTERM
wait
