#!/bin/bash
# start_all.sh

echo "Starting VaultStream Environment..."

# Start Redis and Redpanda
docker-compose up -d

echo "Starting Backend API..."
cd backend
source .venv/bin/activate
uvicorn main:app --reload --port 8000 &
BACKEND_PID=$!
cd ..

echo "Starting Frontend..."
cd frontend
npm run dev &
FRONTEND_PID=$!
cd ..

echo "VaultStream is running!"
echo "Backend: http://localhost:8000"
echo "Frontend: http://localhost:3000"
echo "Press Ctrl+C to stop."

trap "kill $BACKEND_PID $FRONTEND_PID; docker-compose stop; exit" SIGINT SIGTERM

wait
