FROM python:3.13-slim

WORKDIR /app

# System deps for xgboost (libomp) and building wheels
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libomp-dev \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Install Python deps first for better layer caching
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# App source (models + encoders included; raw CSVs are excluded via .dockerignore)
COPY . .

# Non-root user
RUN useradd --create-home --uid 1001 appuser && chown -R appuser:appuser /app
USER appuser

ENV PORT=8000
EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=4s --start-period=20s --retries=3 \
    CMD curl -fsS http://localhost:${PORT}/health || exit 1

# Respect the platform-injected $PORT (Render/Railway/Fly), default 8000
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}"]
