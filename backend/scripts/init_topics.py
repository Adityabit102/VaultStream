import os
from confluent_kafka.admin import AdminClient, NewTopic # type: ignore

def init_topics():
    # In local development via docker-compose, redpanda is on localhost:9092
    broker = os.environ.get("REDPANDA_BROKER", "localhost:9092")
    admin = AdminClient({'bootstrap.servers': broker})
    
    topics = [
        NewTopic("raw-transactions", num_partitions=3, replication_factor=1),
        NewTopic("fraud-alerts", num_partitions=1, replication_factor=1),
        NewTopic("feature-store-updates", num_partitions=3, replication_factor=1),
    ]
    
    fs = admin.create_topics(topics)
    
    for topic, f in fs.items():
        try:
            f.result()  # The result itself is None
            print(f"Topic {topic} created")
        except Exception as e:
            print(f"Failed to create topic {topic}: {e}")

if __name__ == "__main__":
    init_topics()
