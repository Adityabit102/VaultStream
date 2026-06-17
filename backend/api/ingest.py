from fastapi import APIRouter, Request, HTTPException, BackgroundTasks
from pydantic import BaseModel
from typing import Optional
import os
import json

router = APIRouter()

# InMemoryRedis fallback class for standalone local/offline mode
class InMemoryRedis:
    def __init__(self):
        self.data = {}

    async def get(self, key):
        return self.data.get(key)

    async def set(self, key, value, ex=None):
        self.data[key] = str(value)
        return True

    async def setex(self, key, seconds, value):
        self.data[key] = str(value)
        return True

    async def incr(self, key):
        val = int(self.data.get(key) or 0) + 1
        self.data[key] = str(val)
        return val

    async def incrbyfloat(self, key, amount):
        val = float(self.data.get(key) or 0.0) + amount
        self.data[key] = str(val)
        return val

    async def expire(self, key, seconds):
        return True

    async def mget(self, *keys):
        return [self.data.get(key) for key in keys]

    async def zadd(self, key, mapping):
        if key not in self.data or not isinstance(self.data[key], dict):
            self.data[key] = {}
        for member, score in mapping.items():
            self.data[key][member] = float(score)
        return len(mapping)

    async def zremrangebyscore(self, key, min_score, max_score):
        if key not in self.data or not isinstance(self.data[key], dict):
            return 0
        to_remove = []
        for member, score in self.data[key].items():
            if min_score == '-inf':
                low_ok = True
            else:
                low_ok = (score >= float(min_score))
            if max_score == '+inf':
                high_ok = True
            else:
                high_ok = (score <= float(max_score))
            if low_ok and high_ok:
                to_remove.append(member)
        for m in to_remove:
            del self.data[key][m]
        return len(to_remove)

    async def zcard(self, key):
        if key not in self.data or not isinstance(self.data[key], dict):
            return 0
        return len(self.data[key])

    def pipeline(self):
        return InMemoryRedisPipeline(self)

class InMemoryRedisPipeline:
    def __init__(self, client):
        self.client = client
        self.commands = []

    def set(self, key, value):
        self.commands.append(("set", key, value))
        return self

    def incr(self, key):
        self.commands.append(("incr", key))
        return self

    def incrbyfloat(self, key, amount):
        self.commands.append(("incrbyfloat", key, amount))
        return self

    def expire(self, key, seconds):
        return self

    def setex(self, key, seconds, value):
        self.commands.append(("setex", key, value))
        return self

    def zadd(self, key, mapping):
        self.commands.append(("zadd", key, mapping))
        return self

    def zremrangebyscore(self, key, min_score, max_score):
        self.commands.append(("zremrangebyscore", key, min_score, max_score))
        return self

    async def execute(self):
        for cmd in self.commands:
            if cmd[0] == "set":
                await self.client.set(cmd[1], cmd[2])
            elif cmd[0] == "incr":
                await self.client.incr(cmd[1])
            elif cmd[0] == "incrbyfloat":
                await self.client.incrbyfloat(cmd[1], cmd[2])
            elif cmd[0] == "setex":
                await self.client.set(cmd[1], cmd[2])
            elif cmd[0] == "zadd":
                await self.client.zadd(cmd[1], cmd[2])
            elif cmd[0] == "zremrangebyscore":
                await self.client.zremrangebyscore(cmd[1], cmd[2], cmd[3])
        self.commands = []
        return []

    def exec(self):
        # Sync-compatible exec for feature_store_consumer.py
        for cmd in self.commands:
            if cmd[0] == "set":
                self.client.data[cmd[1]] = str(cmd[2])
            elif cmd[0] == "incr":
                val = int(self.client.data.get(cmd[1]) or 0) + 1
                self.client.data[cmd[1]] = str(val)
            elif cmd[0] == "incrbyfloat":
                val = float(self.client.data.get(cmd[1]) or 0.0) + cmd[2]
                self.client.data[cmd[1]] = str(val)
            elif cmd[0] == "setex":
                self.client.data[cmd[1]] = cmd[2]
            elif cmd[0] == "zadd":
                if cmd[1] not in self.client.data or not isinstance(self.client.data[cmd[1]], dict):
                    self.client.data[cmd[1]] = {}
                for member, score in cmd[2].items():
                    self.client.data[cmd[1]][member] = float(score)
            elif cmd[0] == "zremrangebyscore":
                if cmd[1] in self.client.data and isinstance(self.client.data[cmd[1]], dict):
                    to_remove = []
                    for member, score in self.client.data[cmd[1]].items():
                        if cmd[2] == '-inf':
                            low_ok = True
                        else:
                            low_ok = (score >= float(cmd[2]))
                        if cmd[3] == '+inf':
                            high_ok = True
                        else:
                            high_ok = (score <= float(cmd[3]))
                        if low_ok and high_ok:
                            to_remove.append(member)
                    for m in to_remove:
                        del self.client.data[cmd[1]][m]
        self.commands = []
        return []

# Setup Redis client.
redis_url = os.environ.get("UPSTASH_REDIS_REST_URL", "")
redis_token = os.environ.get("UPSTASH_REDIS_REST_TOKEN", "")
redis = None

# If Upstash is configured and is NOT a placeholder, use Upstash Redis REST client
if redis_url and not "your-redis-url" in redis_url:
    try:
        from upstash_redis.asyncio import Redis as UpstashRedis
        redis = UpstashRedis(url=redis_url, token=redis_token)
        print("Using Upstash Redis HTTP Client.")
    except Exception as e:
        print(f"Warning: Failed to initialize Upstash Redis: {e}")

# Otherwise, try to connect to standard local Redis
if not redis:
    try:
        from redis.asyncio import Redis as LocalRedis
        local_redis_url = os.environ.get("LOCAL_REDIS_URL", "redis://localhost:6379")
        redis = LocalRedis.from_url(local_redis_url, decode_responses=True, socket_connect_timeout=1.0)
        print(f"Using standard Local Redis Client at {local_redis_url}")
    except Exception as e:
        print(f"Warning: Failed to initialize local Redis client: {e}")

# Ultimate fallback to InMemoryRedis
if not redis:
    print("Using InMemoryRedis mock client.")
    redis = InMemoryRedis()

# Setup Kafka Producer with suppressed connection warnings
import logging
kafka_logger = logging.getLogger("confluent_kafka")
kafka_logger.setLevel(logging.CRITICAL)

from confluent_kafka import Producer
producer_config = {
    'bootstrap.servers': os.environ.get("REDPANDA_BROKER", "localhost:9092"),
    'client.id': 'ingest-api',
    'acks': '1'
}
producer = None
kafka_available = False
try:
    producer = Producer(producer_config, logger=kafka_logger)
    # Check if broker is reachable using list_topics with a 1-second timeout
    producer.list_topics(timeout=1.0)
    kafka_available = True
    print("Kafka broker is online. Streaming mode enabled.")
except Exception as e:
    print(f"Warning: Kafka broker is offline or unreachable: {e}. Standalone local fallback will be active.")

@router.on_event("startup")
async def verify_redis_connection():
    global redis
    if redis and not isinstance(redis, InMemoryRedis):
        try:
            if hasattr(redis, "ping"):
                await redis.ping()
                print("Redis connection check: SUCCESS.")
        except Exception as e:
            print(f"Warning: Redis connection check failed: {e}. Falling back to InMemoryRedis.")
            redis = InMemoryRedis()

class TransactionEvent(BaseModel):
    transaction_id: str
    entity_id: str
    amount: float
    merchant_id: str
    device_fingerprint: str
    timestamp: str
    override_features: Optional[dict] = None
    # Optional scenario hint for the workspace injectors / stream:
    # 'safe' | 'suspicious' | 'fraud' → deterministic demo verdict.
    profile: Optional[str] = None


def _profile_score(profile: str) -> Optional[float]:
    import random
    bands = {
        "safe": (0.01, 0.09),
        "suspicious": (0.12, 0.19),
        "fraud": (0.45, 0.92),
    }
    band = bands.get((profile or "").lower())
    return random.uniform(*band) if band else None

async def check_rate_limit(client_ip: str) -> bool:
    if not redis:
        return True # fail open
    key = f"rate:{client_ip}"
    try:
        current = await redis.incr(key)
        if current == 1:
            await redis.expire(key, 60)
        if current > 100:
            return False
        return True
    except Exception as e:
        print(f"Redis rate-limit error (failing open): {e}")
        return True

async def local_process_event_async(event: TransactionEvent):
    """Fallback features processor for standalone running when Kafka/Consumers are offline."""
    if not redis:
        return
    try:
        entity_id = event.entity_id
        amount = event.amount
        device_fp = event.device_fingerprint
        merchant_id = event.merchant_id
        
        # Check if custom overrides are provided (for on-screen custom transaction pitches)
        if event.override_features:
            ov = event.override_features
            await redis.set(f"features:{entity_id}:tx_count_5m", ov.get("tx_count_5m", 1), ex=300)
            await redis.set(f"features:{entity_id}:tx_count_1h", ov.get("tx_count_1h", 1), ex=3600)
            await redis.set(f"features:{entity_id}:tx_count_24h", ov.get("tx_count_24h", 1), ex=86400)
            await redis.set(f"features:{entity_id}:sum_amount_1h", ov.get("sum_amount_1h", amount), ex=3600)
            if ov.get("device_shift") == 1:
                await redis.set(f"features:{entity_id}:device_shift", "1", ex=1800)
            else:
                # Use standard set to 0 or delete to clear previous shift
                await redis.set(f"features:{entity_id}:device_shift", "0", ex=1800)
            await redis.set(f"features:{entity_id}:last_device", device_fp, ex=86400)
            
            # Setup standard fallback stats for overrides
            await redis.set(f"features:{entity_id}:stats:count", "1", ex=2592000)
            await redis.set(f"features:{entity_id}:stats:mean", str(amount), ex=2592000)
            await redis.set(f"features:{entity_id}:stats:M2", "0.0", ex=2592000)
            if merchant_id:
                import time
                await redis.zadd(f"features:{entity_id}:merchants_zset", {merchant_id: time.time()})
            return

        import time
        from datetime import datetime
        
        # Parse timestamp
        event_time = time.time()
        if event.timestamp:
            try:
                dt = datetime.fromisoformat(event.timestamp.replace('Z', '+00:00'))
                event_time = dt.timestamp()
            except Exception:
                pass

        # 1. Update running stats for Welford's algorithm
        key_count = f"features:{entity_id}:stats:count"
        key_mean = f"features:{entity_id}:stats:mean"
        key_M2 = f"features:{entity_id}:stats:M2"
        
        count = int(await redis.get(key_count) or 0)
        mean = float(await redis.get(key_mean) or 0.0)
        M2 = float(await redis.get(key_M2) or 0.0)
        
        count_new = count + 1
        delta = amount - mean
        mean_new = mean + delta / count_new
        delta2 = amount - mean_new
        M2_new = M2 + delta * delta2
        
        # 2. Pipeline write
        pipeline = redis.pipeline()
        pipeline.set(key_count, str(count_new))
        pipeline.set(key_mean, str(mean_new))
        pipeline.set(key_M2, str(M2_new))
        pipeline.expire(key_count, 2592000)
        pipeline.expire(key_mean, 2592000)
        pipeline.expire(key_M2, 2592000)

        # Standard increments
        # tx_count_5m
        key_5m = f"features:{entity_id}:tx_count_5m"
        pipeline.incr(key_5m)
        pipeline.expire(key_5m, 300)
        
        # tx_count_1h
        key_1h = f"features:{entity_id}:tx_count_1h"
        pipeline.incr(key_1h)
        pipeline.expire(key_1h, 3600)
        
        # tx_count_24h
        key_24h = f"features:{entity_id}:tx_count_24h"
        pipeline.incr(key_24h)
        pipeline.expire(key_24h, 86400)
        
        # sum_amount_1h
        key_sum_1h = f"features:{entity_id}:sum_amount_1h"
        pipeline.incrbyfloat(key_sum_1h, amount)
        pipeline.expire(key_sum_1h, 3600)
        
        # device shift logic
        key_last_device = f"features:{entity_id}:last_device"
        last_device = await redis.get(key_last_device)
        if last_device and last_device != device_fp:
            pipeline.setex(f"features:{entity_id}:device_shift", 1800, "1")
        pipeline.setex(key_last_device, 86400, device_fp)
        
        # ZSET unique merchants
        key_zset = f"features:{entity_id}:merchants_zset"
        if merchant_id:
            pipeline.zadd(key_zset, {merchant_id: event_time})
            pipeline.zremrangebyscore(key_zset, "-inf", str(event_time - 3600))
            pipeline.expire(key_zset, 3600)
            
        import inspect
        if hasattr(pipeline, "exec") and inspect.iscoroutinefunction(pipeline.exec):
            await pipeline.exec()
        else:
            await pipeline.execute()
    except Exception as e:
        print(f"Warning: Local features update failed: {e}")

async def trigger_local_prediction(event: TransactionEvent, background_tasks: BackgroundTasks):
    """Invokes prediction directly inside a background task for standalone running."""
    try:
        from .predict import core_predict, PredictRequest
        req = PredictRequest(
            transaction_id=event.transaction_id,
            entity_id=event.entity_id,
            amount=event.amount,
            device_fingerprint=event.device_fingerprint
        )
        await core_predict(req, background_tasks)
    except Exception as e:
        print(f"Warning: Standalone mock prediction failed: {e}")

@router.post("/v1/ingest")
async def ingest_event(request: Request, event: TransactionEvent, background_tasks: BackgroundTasks):
    client_ip = request.client.host if request.client else "unknown"
    if not await check_rate_limit(client_ip):
        raise HTTPException(
            status_code=429, 
            detail="Rate limit exceeded. 100 req/60s."
        )
    
    # Best-effort enqueue to the streaming pipeline (for the real Kafka path).
    if kafka_available and producer:
        try:
            producer.produce(
                topic="raw-transactions",
                key=event.entity_id.encode('utf-8'),
                value=json.dumps(event.model_dump()).encode('utf-8')
            )
            producer.poll(0)
        except Exception as e:
            print(f"Warning: Kafka produce failed: {e}.")

    # Always score synchronously so the transaction is scored, broadcast and
    # persisted immediately — the workspace and stream see it regardless of
    # whether a separate consumer is running.
    await local_process_event_async(event)
    try:
        from .predict import core_predict, PredictRequest
        req = PredictRequest(
            transaction_id=event.transaction_id,
            entity_id=event.entity_id,
            amount=event.amount,
            device_fingerprint=event.device_fingerprint
        )
        res = await core_predict(req, background_tasks, forced_score=_profile_score(event.profile) if event.profile else None)
        return {
            "status": "processed",
            "transaction_id": event.transaction_id,
            "id": res.get("id"),
            "risk_score": res.get("risk_score", 0.0),
            "risk_label": res.get("risk_label", "SAFE"),
            "feature_vector": res.get("feature_vector"),
            "created_at": res.get("created_at"),
        }
    except Exception as e:
        print(f"Warning: Sync prediction failed, deferring to background: {e}")
        background_tasks.add_task(trigger_local_prediction, event, background_tasks)
        return {"status": "enqueued", "transaction_id": event.transaction_id}
