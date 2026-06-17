import os
import json
import time
import sys
from confluent_kafka import Consumer, Producer, KafkaException

# Sync Redis client for background consumer
redis_url = os.environ.get("UPSTASH_REDIS_REST_URL", "")
redis_token = os.environ.get("UPSTASH_REDIS_REST_TOKEN", "")
redis = None

# Ensure backend/ml is in sys.path and try to import feature_engineering
CONSUMER_DIR = os.path.dirname(os.path.abspath(__file__))
BACKEND_DIR = os.path.dirname(CONSUMER_DIR)
ML_DIR = os.path.join(BACKEND_DIR, "ml")
if ML_DIR not in sys.path:
    sys.path.append(ML_DIR)

try:
    from feature_engineering import engineer_features
    print("Consumer: Successfully imported feature_engineering.")
except ImportError as e:
    print(f"Consumer Warning: Could not import feature_engineering: {e}")

# If Upstash is configured and is NOT a placeholder, use Upstash Redis Client
if redis_url and not "your-redis-url" in redis_url:
    try:
        from upstash_redis import Redis as UpstashRedis
        redis = UpstashRedis(url=redis_url, token=redis_token)
        print("Consumer: Using Upstash Redis Client.")
    except Exception as e:
        print(f"Consumer Warning: Failed to initialize Upstash Redis: {e}")

# Otherwise, try to connect to standard local Redis
if not redis:
    try:
        from redis import Redis as LocalRedis
        local_redis_url = os.environ.get("LOCAL_REDIS_URL", "redis://localhost:6379")
        client = LocalRedis.from_url(local_redis_url, decode_responses=True, socket_connect_timeout=1.0)
        # Verify connection immediately
        client.ping()
        redis = client
        print(f"Consumer: Using standard Local Redis Client at {local_redis_url}")
    except Exception as e:
        print(f"Consumer Warning: Failed to initialize local Redis client: {e}")

# Ultimate fallback
if not redis:
    class InMemoryRedisSync:
        def __init__(self):
            self.data = {}

        def get(self, key):
            return self.data.get(key)

        def set(self, key, value, ex=None):
            self.data[key] = str(value)
            return True

        def setex(self, key, seconds, value):
            self.data[key] = str(value)
            return True

        def incr(self, key):
            val = int(self.data.get(key) or 0) + 1
            self.data[key] = str(val)
            return val

        def incrbyfloat(self, key, amount):
            val = float(self.data.get(key) or 0.0) + amount
            self.data[key] = str(val)
            return val

        def expire(self, key, seconds):
            return True

        def mget(self, *keys):
            return [self.data.get(key) for key in keys]

        # Emulated Redis ZSET methods
        def zadd(self, key, mapping):
            if key not in self.data or not isinstance(self.data[key], dict):
                self.data[key] = {}
            for member, score in mapping.items():
                self.data[key][member] = float(score)
            return len(mapping)

        def zremrangebyscore(self, key, min_score, max_score):
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

        def zcard(self, key):
            if key not in self.data or not isinstance(self.data[key], dict):
                return 0
            return len(self.data[key])

        def pipeline(self):
            return self

        def execute(self):
            return []

        def exec(self):
            return []

    redis = InMemoryRedisSync()
    print("Consumer: Using InMemoryRedisSync mock client.")

broker = os.environ.get("REDPANDA_BROKER", "localhost:9092")

consumer_config = {
    'bootstrap.servers': broker,
    'group.id': 'feature-store-orchestrator',
    'auto.offset.reset': 'latest'
}

producer_config = {
    'bootstrap.servers': broker,
    'client.id': 'feature-store-updater',
    'acks': '1'
}

# Suppress connection warnings
import logging
kafka_logger = logging.getLogger("confluent_kafka")
kafka_logger.setLevel(logging.CRITICAL)

kafka_available = False
try:
    temp_producer = Producer({'bootstrap.servers': broker}, logger=kafka_logger)
    temp_producer.list_topics(timeout=1.0)
    kafka_available = True
except Exception as e:
    print(f"Consumer: Kafka broker is offline/unreachable. Standby mode active.")

consumer = None
producer = None
if kafka_available:
    try:
        consumer = Consumer(consumer_config, logger=kafka_logger)
        producer = Producer(producer_config, logger=kafka_logger)
        consumer.subscribe(['raw-transactions'])
        print("Feature store consumer started. Waiting for events...")
    except Exception as e:
        print(f"Consumer Warning: Kafka consumer/producer initialization failed: {e}")

def process_event(event: dict):
    entity_id = event.get('entity_id')
    amount = event.get('amount', 0.0)
    device_fp = event.get('device_fingerprint', '')
    merchant_id = event.get('merchant_id', '')
    
    if not entity_id or not redis:
        return

    from datetime import datetime
    
    # Parse event timestamp if available, else use current time
    event_time = time.time()
    if 'timestamp' in event:
        try:
            dt = datetime.fromisoformat(event['timestamp'].replace('Z', '+00:00'))
            event_time = dt.timestamp()
        except Exception:
            pass

    try:
        # 1. Update running stats for Welford's algorithm (amount z-score)
        key_count = f"features:{entity_id}:stats:count"
        key_mean = f"features:{entity_id}:stats:mean"
        key_M2 = f"features:{entity_id}:stats:M2"
        
        # Read current stats synchronously
        count = int(redis.get(key_count) or 0)
        mean = float(redis.get(key_mean) or 0.0)
        M2 = float(redis.get(key_M2) or 0.0)
        
        # Update running stats
        count_new = count + 1
        delta = amount - mean
        mean_new = mean + delta / count_new
        delta2 = amount - mean_new
        M2_new = M2 + delta * delta2
        
        pipeline = redis.pipeline()
        
        # Write stats back to Redis
        pipeline.set(key_count, str(count_new))
        pipeline.set(key_mean, str(mean_new))
        pipeline.set(key_M2, str(M2_new))
        pipeline.expire(key_count, 2592000)  # 30 days
        pipeline.expire(key_mean, 2592000)
        pipeline.expire(key_M2, 2592000)
        
        # 2. Update rolling counts
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
        
        # 3. Update device shift logic
        key_last_device = f"features:{entity_id}:last_device"
        last_device = redis.get(key_last_device)
        
        if last_device and last_device != device_fp:
            pipeline.setex(f"features:{entity_id}:device_shift", 1800, "1")
        pipeline.setex(key_last_device, 86400, device_fp)
        
        # 4. Update unique merchant ZSET logic
        key_zset = f"features:{entity_id}:merchants_zset"
        if merchant_id:
            pipeline.zadd(key_zset, {merchant_id: event_time})
            pipeline.zremrangebyscore(key_zset, "-inf", str(event_time - 3600))
            pipeline.expire(key_zset, 3600)
        
        # Execute pipeline compatibility
        if hasattr(pipeline, "exec"):
            pipeline.exec()
        else:
            pipeline.execute()
            
        # Publish update event if producer is available
        if producer:
            update_event = {
                "entity_id": entity_id,
                "timestamp": time.time(),
                "updates_applied": ["tx_count_5m", "tx_count_1h", "tx_count_24h", "amount_1h", "zscore", "merchants_zset"]
            }
            producer.produce(
                topic="feature-store-updates",
                key=entity_id.encode('utf-8'),
                value=json.dumps(update_event).encode('utf-8')
            )
            producer.poll(0)
    except Exception as e:
        print(f"Error processing event for {entity_id}: {e}")

try:
    if consumer:
        while True:
            msg = consumer.poll(1.0)
            
            if msg is None:
                continue
            if msg.error():
                print(f"Consumer error: {msg.error()}")
                continue
                
            try:
                value = msg.value()
                if value is None:
                    continue
                event_data = json.loads(value.decode('utf-8'))
                process_event(event_data)
            except Exception as e:
                print(f"Failed to process message: {e}")
    else:
        print("Kafka consumer is offline. Standby mode active.")
        while True:
            time.sleep(10)

except KeyboardInterrupt:
    print("Consumer stopped manually.")
finally:
    if consumer:
        consumer.close()
    if producer:
        producer.flush()
