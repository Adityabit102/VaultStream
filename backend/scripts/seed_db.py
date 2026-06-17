"""
Seed the VaultStream database with a realistic body of users, transactions
(fraud alerts) and audit events for demos.

Usage (DATABASE_URL must be set so the DB tier is active):
    DATABASE_URL=postgresql+psycopg2://vault:vault@localhost:5433/vaultstream \
        python scripts/seed_db.py [--alerts 400 --users 16 --reset]
"""
import os
import sys
import uuid
import random
import argparse
import datetime

# make backend importable
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from database import db  # noqa: E402

FIRST = ["ava", "noah", "mia", "liam", "ivy", "ezra", "luna", "kai", "nora", "omar",
         "zara", "finn", "elif", "rhys", "tara", "jude", "remy", "wren", "cleo", "dax"]
MERCHANTS = ["merch_coffee", "merch_retail", "merch_luxury_watches", "merch_travel",
             "merch_electronics", "merch_grocery", "merch_gaming", "merch_crypto_exch"]


def label_for():
    r = random.random()
    if r < 0.72:
        return "SAFE"
    if r < 0.92:
        return "SUSPICIOUS"
    return "FRAUD"


def features_for(label):
    # amount (sum_amount_1h) and velocity (tx_count_1h) are drawn INDEPENDENTLY
    # from wide, overlapping ranges per label so the scatter reads as a real
    # cloud (fraud concentrates upper-right but with genuine spread/overlap),
    # not a straight diagonal line.
    if label == "FRAUD":
        amount = random.uniform(600, 9000)
        velocity = random.randint(10, 58)
        return {
            "tx_count_5m": random.randint(4, 14),
            "tx_count_1h": velocity,
            "tx_count_24h": velocity + random.randint(10, 50),
            "sum_amount_1h": round(amount, 2),
            "device_shift": random.choice([0, 1, 1]),
        }, round(random.uniform(0.30, 0.95), 4)
    if label == "SUSPICIOUS":
        amount = random.uniform(120, 3200)
        velocity = random.randint(5, 38)
        return {
            "tx_count_5m": random.randint(1, 6),
            "tx_count_1h": velocity,
            "tx_count_24h": velocity + random.randint(5, 25),
            "sum_amount_1h": round(amount, 2),
            "device_shift": random.choice([0, 0, 1]),
        }, round(random.uniform(0.12, 0.19), 4)
    amount = random.uniform(5, 1600)
    velocity = random.randint(1, 26)
    return {
        "tx_count_5m": random.randint(1, 4),
        "tx_count_1h": velocity,
        "tx_count_24h": velocity + random.randint(2, 14),
        "sum_amount_1h": round(amount, 2),
        "device_shift": 0,
    }, round(random.uniform(0.01, 0.09), 4)


def main():
    if not db.DB_ENABLED:
        print("DATABASE_URL is not set — DB tier is inactive. Aborting.")
        sys.exit(1)

    ap = argparse.ArgumentParser()
    ap.add_argument("--alerts", type=int, default=400)
    ap.add_argument("--users", type=int, default=16)
    ap.add_argument("--reset", action="store_true", help="wipe existing seed data first")
    args = ap.parse_args()

    db.init_db()
    S = db.SessionLocal

    with S() as s:
        if args.reset:
            s.query(db.AuditEvent).delete()
            s.query(db.FraudAlert).delete()
            # keep the 3 demo users, drop the rest
            s.query(db.UserRole).filter(~db.UserRole.email.like("%@vaultstream.demo")).delete(synchronize_session=False)
            s.commit()
            print("Reset: cleared alerts, audit events and seeded users.")

        # ---- Users ----
        existing_emails = {u.email for u in s.query(db.UserRole).all()}
        roles_pool = ["analyst"] * 9 + ["viewer"] * 5 + ["admin"] * 2
        random.shuffle(roles_pool)
        added_users = 0
        for i in range(args.users):
            name = random.choice(FIRST)
            email = f"{name}.{random.randint(10, 999)}@vaultstream.io"
            if email in existing_emails:
                continue
            existing_emails.add(email)
            role = roles_pool[i % len(roles_pool)]
            last = datetime.datetime.utcnow() - datetime.timedelta(hours=random.randint(0, 240))
            s.add(db.UserRole(user_id=uuid.uuid4().hex, email=email, role=role, last_sign_in_at=last))
            added_users += 1
        s.commit()

        # ---- Entities (accounts that transact) ----
        entities = [f"acct_{random.choice(FIRST)}_{random.randint(100, 999)}" for _ in range(40)]

        # ---- Transactions / fraud alerts ----
        now = datetime.datetime.utcnow()
        alerts = []
        analysts = [u.user_id for u in s.query(db.UserRole).filter(db.UserRole.role.in_(["analyst", "admin"])).all()]
        audit_rows = []
        for i in range(args.alerts):
            label = label_for()
            fj, score = features_for(label)
            created = now - datetime.timedelta(minutes=random.randint(0, 14 * 24 * 60))
            entity = random.choice(entities)
            action = None
            if label in ("FRAUD", "SUSPICIOUS") and random.random() < 0.4:
                action = random.choice(["freeze", "escalate"])
            row = db.FraudAlert(
                id=uuid.uuid4().hex,
                created_at=created,
                transaction_id=f"tx_{label[:2].lower()}_{random.randint(100000, 999999)}",
                entity_id=entity,
                risk_score=score,
                risk_label=label,
                feature_json=fj,
                action_taken=action,
            )
            alerts.append(row)
            if action and analysts:
                audit_rows.append(db.AuditEvent(
                    id=uuid.uuid4().hex,
                    created_at=created + datetime.timedelta(minutes=random.randint(1, 30)),
                    actor_id=random.choice(analysts),
                    action=action,
                    target_id=row.id,
                    details={"label": label, "score": score},
                ))
        s.bulk_save_objects(alerts)
        s.bulk_save_objects(audit_rows)
        s.commit()

        # summary
        total_alerts = s.query(db.FraudAlert).count()
        total_users = s.query(db.UserRole).count()
        total_audit = s.query(db.AuditEvent).count()
        from sqlalchemy import func
        by_label = dict(s.query(db.FraudAlert.risk_label, func.count()).group_by(db.FraudAlert.risk_label).all())

    print(f"Seed complete.")
    print(f"  users:        {total_users} (+{added_users} new)")
    print(f"  transactions: {total_alerts}  {by_label}")
    print(f"  audit events: {total_audit}")


if __name__ == "__main__":
    main()
