"""
Local relational persistence (SQLAlchemy + Postgres).

This is the middle tier of VaultStream's three-tier persistence strategy:

    no config        -> mock mode (in-memory)        [demos, zero setup]
    DATABASE_URL set -> Postgres via this module       [self-hosted, real DB]
    Supabase config  -> Supabase (handled in api/*)    [managed cloud]

Activated purely by the DATABASE_URL env var, so mock mode is always preserved
when it is unset. No external accounts required — works against the local
Postgres container in docker-compose.
"""
import os
import uuid
import datetime
from typing import Optional

DATABASE_URL = os.environ.get("DATABASE_URL", "").strip()
# Managed providers (Render/Heroku) hand out `postgres://`; SQLAlchemy 2.0 needs
# an explicit driver scheme.
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql+psycopg2://", 1)
elif DATABASE_URL.startswith("postgresql://"):
    DATABASE_URL = DATABASE_URL.replace("postgresql://", "postgresql+psycopg2://", 1)
DB_ENABLED = bool(DATABASE_URL)

# Only import SQLAlchemy machinery when a DB is configured, so mock-mode installs
# don't require the driver at runtime.
if DB_ENABLED:
    from sqlalchemy import create_engine, String, Float, DateTime, JSON, select
    from sqlalchemy.orm import declarative_base, sessionmaker, Mapped, mapped_column

    engine = create_engine(DATABASE_URL, pool_pre_ping=True, future=True)
    SessionLocal = sessionmaker(bind=engine, expire_on_commit=False, future=True)
    Base = declarative_base()

    def _uuid() -> str:
        return uuid.uuid4().hex

    class FraudAlert(Base):
        __tablename__ = "fraud_alerts"
        id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
        created_at: Mapped[datetime.datetime] = mapped_column(DateTime, default=datetime.datetime.utcnow)
        transaction_id: Mapped[str] = mapped_column(String)
        entity_id: Mapped[str] = mapped_column(String)
        risk_score: Mapped[float] = mapped_column(Float)
        risk_label: Mapped[str] = mapped_column(String)
        feature_json: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
        shap_json: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
        action_taken: Mapped[Optional[str]] = mapped_column(String, default=None, nullable=True)
        # Case management
        status: Mapped[Optional[str]] = mapped_column(String, default="open", nullable=True)
        assignee: Mapped[Optional[str]] = mapped_column(String, default=None, nullable=True)

        def as_dict(self):
            return {
                "id": self.id,
                "created_at": self.created_at.isoformat() + "+00:00",
                "transaction_id": self.transaction_id,
                "entity_id": self.entity_id,
                "risk_score": self.risk_score,
                "risk_label": self.risk_label,
                "feature_json": self.feature_json,
                "shap_json": self.shap_json,
                "action_taken": self.action_taken,
                "status": self.status or "open",
                "assignee": self.assignee,
            }

    class UserRole(Base):
        __tablename__ = "user_roles"
        user_id: Mapped[str] = mapped_column(String, primary_key=True)
        email: Mapped[str] = mapped_column(String)
        role: Mapped[str] = mapped_column(String, default="viewer")
        last_sign_in_at: Mapped[Optional[datetime.datetime]] = mapped_column(DateTime, nullable=True)

    class AuditEvent(Base):
        __tablename__ = "audit_events"
        id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
        created_at: Mapped[datetime.datetime] = mapped_column(DateTime, default=datetime.datetime.utcnow)
        actor_id: Mapped[str] = mapped_column(String)
        action: Mapped[str] = mapped_column(String)
        target_id: Mapped[str] = mapped_column(String)
        details: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)

    class CaseNote(Base):
        __tablename__ = "case_notes"
        id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
        created_at: Mapped[datetime.datetime] = mapped_column(DateTime, default=datetime.datetime.utcnow)
        alert_id: Mapped[str] = mapped_column(String, index=True)
        author: Mapped[str] = mapped_column(String)
        body: Mapped[str] = mapped_column(String)

    class Rule(Base):
        __tablename__ = "rules"
        id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
        created_at: Mapped[datetime.datetime] = mapped_column(DateTime, default=datetime.datetime.utcnow)
        name: Mapped[str] = mapped_column(String)
        conditions: Mapped[list] = mapped_column(JSON)  # [{field, op, value}] (AND)
        action: Mapped[str] = mapped_column(String, default="flag")  # flag | escalate
        enabled: Mapped[bool] = mapped_column(default=True)

    class ApiKey(Base):
        __tablename__ = "api_keys"
        id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
        created_at: Mapped[datetime.datetime] = mapped_column(DateTime, default=datetime.datetime.utcnow)
        name: Mapped[str] = mapped_column(String)
        prefix: Mapped[str] = mapped_column(String)       # first 8 chars, shown in UI
        key_hash: Mapped[str] = mapped_column(String, index=True)
        last_used_at: Mapped[Optional[datetime.datetime]] = mapped_column(DateTime, nullable=True)

    _DEMO_USERS = [
        ("00000000-0000-0000-0000-000000000001", "admin@vaultstream.demo", "admin"),
        ("00000000-0000-0000-0000-000000000002", "analyst@vaultstream.demo", "analyst"),
        ("00000000-0000-0000-0000-000000000003", "viewer@vaultstream.demo", "viewer"),
    ]

    def init_db():
        """Create tables and seed demo users (idempotent)."""
        Base.metadata.create_all(engine)
        # Lightweight migration: add case-management columns if the table predates them.
        from sqlalchemy import text
        with engine.begin() as conn:
            conn.execute(text("ALTER TABLE fraud_alerts ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'open'"))
            conn.execute(text("ALTER TABLE fraud_alerts ADD COLUMN IF NOT EXISTS assignee TEXT"))
        with SessionLocal() as s:
            for uid, email, role in _DEMO_USERS:
                if not s.get(UserRole, uid):
                    s.add(UserRole(user_id=uid, email=email, role=role,
                                   last_sign_in_at=datetime.datetime.utcnow()))
            s.commit()
        print(f"Postgres persistence enabled at {DATABASE_URL.split('@')[-1]}")

    # ---- Repository helpers ----
    def list_alerts(limit: int = 50, offset: int = 0):
        with SessionLocal() as s:
            rows = s.execute(
                select(FraudAlert).order_by(FraudAlert.created_at.desc()).offset(offset).limit(limit)
            ).scalars().all()
            return [r.as_dict() for r in rows]

    def get_alert(alert_id: str):
        with SessionLocal() as s:
            row = s.get(FraudAlert, alert_id)
            return row.as_dict() if row else None

    def count_alerts():
        from sqlalchemy import func
        with SessionLocal() as s:
            return int(s.query(func.count()).select_from(FraudAlert).scalar() or 0)

    def iter_all_alerts():
        with SessionLocal() as s:
            for r in s.execute(select(FraudAlert).order_by(FraudAlert.created_at.desc())).scalars():
                yield r.as_dict()

    def insert_alert(transaction_id, entity_id, risk_score, risk_label, feature_json=None) -> str:
        with SessionLocal() as s:
            row = FraudAlert(transaction_id=transaction_id, entity_id=entity_id,
                             risk_score=risk_score, risk_label=risk_label, feature_json=feature_json)
            s.add(row)
            s.commit()
            return row.id

    def set_alert_action(alert_id: str, action: str) -> bool:
        with SessionLocal() as s:
            row = s.get(FraudAlert, alert_id)
            if not row:
                return False
            row.action_taken = action
            s.commit()
            return True

    def list_users():
        with SessionLocal() as s:
            rows = s.execute(select(UserRole)).scalars().all()
            return [{
                "id": r.user_id,
                "email": r.email,
                "role": r.role,
                "last_sign_in_at": r.last_sign_in_at.isoformat() + "Z" if r.last_sign_in_at else None,
            } for r in rows]

    def upsert_role(user_id: str, role: str, email: Optional[str] = None):
        with SessionLocal() as s:
            row = s.get(UserRole, user_id)
            if row:
                row.role = role
                if email:
                    row.email = email
            else:
                s.add(UserRole(user_id=user_id, email=email or f"user_{user_id[:8]}@vaultstream.demo", role=role))
            s.commit()

    def insert_audit(actor_id: str, action: str, target_id: str, details: Optional[dict] = None):
        with SessionLocal() as s:
            s.add(AuditEvent(actor_id=actor_id or "system", action=action, target_id=target_id, details=details))
            s.commit()

    def set_alert_shap(alert_id: str, shap_json: dict):
        with SessionLocal() as s:
            row = s.get(FraudAlert, alert_id)
            if row:
                row.shap_json = shap_json
                s.commit()

    # ---- Case management ----
    def set_status(alert_id: str, status: str) -> bool:
        with SessionLocal() as s:
            row = s.get(FraudAlert, alert_id)
            if not row:
                return False
            row.status = status
            s.commit()
            return True

    def set_assignee(alert_id: str, assignee: Optional[str]) -> bool:
        with SessionLocal() as s:
            row = s.get(FraudAlert, alert_id)
            if not row:
                return False
            row.assignee = assignee
            s.commit()
            return True

    def add_note(alert_id: str, author: str, body: str) -> dict:
        with SessionLocal() as s:
            note = CaseNote(alert_id=alert_id, author=author, body=body)
            s.add(note)
            s.commit()
            return {"id": note.id, "alert_id": alert_id, "author": author, "body": body,
                    "created_at": note.created_at.isoformat() + "Z"}

    def list_notes(alert_id: str):
        with SessionLocal() as s:
            rows = s.execute(select(CaseNote).where(CaseNote.alert_id == alert_id).order_by(CaseNote.created_at.asc())).scalars().all()
            return [{"id": r.id, "author": r.author, "body": r.body, "created_at": r.created_at.isoformat() + "Z"} for r in rows]

    # ---- Audit feed ----
    def list_audit(limit: int = 100):
        with SessionLocal() as s:
            rows = s.execute(select(AuditEvent).order_by(AuditEvent.created_at.desc()).limit(limit)).scalars().all()
            # map actor_id -> email for readability
            users = {u.user_id: u.email for u in s.execute(select(UserRole)).scalars().all()}
            return [{
                "id": r.id,
                "created_at": r.created_at.isoformat() + "Z",
                "actor": users.get(r.actor_id, r.actor_id),
                "action": r.action,
                "target_id": r.target_id,
                "details": r.details,
            } for r in rows]

    # ---- Analytics ----
    def analytics_summary(days: int = 14):
        from sqlalchemy import func
        since = datetime.datetime.utcnow() - datetime.timedelta(days=days)
        with SessionLocal() as s:
            by_label = dict(s.query(FraudAlert.risk_label, func.count()).group_by(FraudAlert.risk_label).all())
            total = sum(by_label.values()) or 0
            fraud = by_label.get("FRAUD", 0)
            # per-day series
            rows = s.execute(select(FraudAlert.created_at, FraudAlert.risk_label, FraudAlert.feature_json).where(FraudAlert.created_at >= since)).all()
            from collections import defaultdict
            day_map = defaultdict(lambda: {"SAFE": 0, "SUSPICIOUS": 0, "FRAUD": 0, "blocked": 0.0})
            for created, label, fj in rows:
                key = created.strftime("%Y-%m-%d")
                day_map[key][label] = day_map[key].get(label, 0) + 1
                if label == "FRAUD" and isinstance(fj, dict):
                    day_map[key]["blocked"] += float(fj.get("sum_amount_1h", 0) or 0)
            series = [{"date": k, **v} for k, v in sorted(day_map.items())]
            open_cases = s.query(func.count()).select_from(FraudAlert).filter(FraudAlert.status == "open", FraudAlert.risk_label != "SAFE").scalar() or 0
            blocked_total = s.query(func.coalesce(func.sum(FraudAlert.risk_score), 0)).scalar()  # placeholder
            blocked_amt = sum(d["blocked"] for d in series)
            return {
                "totals": {
                    "transactions": total,
                    "fraud": fraud,
                    "fraud_rate": round((fraud / total * 100), 2) if total else 0,
                    "open_cases": int(open_cases),
                    "amount_blocked": round(blocked_amt, 2),
                },
                "by_label": by_label,
                "series": series,
                "_unused": float(blocked_total or 0),
            }

    def top_entities(limit: int = 8):
        from sqlalchemy import func
        with SessionLocal() as s:
            rows = (s.query(FraudAlert.entity_id, func.count(), func.max(FraudAlert.risk_score))
                    .filter(FraudAlert.risk_label != "SAFE")
                    .group_by(FraudAlert.entity_id)
                    .order_by(func.count().desc())
                    .limit(limit).all())
            return [{"entity": e, "flags": int(c), "max_score": round(float(m), 3)} for e, c, m in rows]

    # ---- Rules engine ----
    def list_rules():
        with SessionLocal() as s:
            rows = s.execute(select(Rule).order_by(Rule.created_at.desc())).scalars().all()
            return [{"id": r.id, "name": r.name, "conditions": r.conditions, "action": r.action,
                     "enabled": r.enabled, "created_at": r.created_at.isoformat() + "Z"} for r in rows]

    def add_rule(name, conditions, action="flag"):
        with SessionLocal() as s:
            r = Rule(name=name, conditions=conditions, action=action, enabled=True)
            s.add(r); s.commit()
            return {"id": r.id, "name": r.name, "conditions": r.conditions, "action": r.action, "enabled": r.enabled}

    def set_rule_enabled(rule_id, enabled):
        with SessionLocal() as s:
            r = s.get(Rule, rule_id)
            if not r:
                return False
            r.enabled = bool(enabled); s.commit(); return True

    def delete_rule(rule_id):
        with SessionLocal() as s:
            r = s.get(Rule, rule_id)
            if not r:
                return False
            s.delete(r); s.commit(); return True

    def enabled_rules():
        with SessionLocal() as s:
            rows = s.execute(select(Rule).where(Rule.enabled == True)).scalars().all()  # noqa: E712
            return [{"id": r.id, "name": r.name, "conditions": r.conditions, "action": r.action} for r in rows]

    # ---- API keys ----
    def list_keys():
        with SessionLocal() as s:
            rows = s.execute(select(ApiKey).order_by(ApiKey.created_at.desc())).scalars().all()
            return [{"id": k.id, "name": k.name, "prefix": k.prefix,
                     "created_at": k.created_at.isoformat() + "Z",
                     "last_used_at": k.last_used_at.isoformat() + "Z" if k.last_used_at else None} for k in rows]

    def add_key(name, prefix, key_hash):
        with SessionLocal() as s:
            k = ApiKey(name=name, prefix=prefix, key_hash=key_hash)
            s.add(k); s.commit()
            return {"id": k.id, "name": k.name, "prefix": k.prefix}

    def delete_key(key_id):
        with SessionLocal() as s:
            k = s.get(ApiKey, key_id)
            if not k:
                return False
            s.delete(k); s.commit(); return True

    def verify_key(key_hash):
        with SessionLocal() as s:
            k = s.execute(select(ApiKey).where(ApiKey.key_hash == key_hash)).scalars().first()
            if not k:
                return False
            k.last_used_at = datetime.datetime.utcnow(); s.commit()
            return True

    def feature_values(column_key: str, limit: int = 2000):
        """Return a list of a single live-feature value across recent alerts (for drift)."""
        with SessionLocal() as s:
            rows = s.execute(select(FraudAlert.created_at, FraudAlert.feature_json).order_by(FraudAlert.created_at.desc()).limit(limit)).all()
        vals = []
        for created, fj in rows:
            if isinstance(fj, dict) and fj.get(column_key) is not None:
                vals.append((created, float(fj[column_key])))
        return vals

else:
    # Mock mode — no-op stubs so callers can import unconditionally.
    def init_db():
        pass

    def list_alerts(limit: int = 50):
        return None

    def insert_alert(*args, **kwargs):
        return None

    def set_alert_action(*args, **kwargs):
        return False

    def list_users():
        return None

    def upsert_role(*args, **kwargs):
        return None

    def insert_audit(*args, **kwargs):
        return None

    def set_alert_shap(*args, **kwargs):
        return None

    def set_status(*args, **kwargs):
        return False

    def set_assignee(*args, **kwargs):
        return False

    def add_note(*args, **kwargs):
        return None

    def list_notes(*args, **kwargs):
        return None

    def list_audit(*args, **kwargs):
        return None

    def analytics_summary(*args, **kwargs):
        return None

    def feature_values(*args, **kwargs):
        return []

    def top_entities(*args, **kwargs):
        return None

    def get_alert(*args, **kwargs):
        return None

    def count_alerts(*args, **kwargs):
        return 0

    def iter_all_alerts(*args, **kwargs):
        return iter(())

    # Rules engine (in-memory fallback)
    _mock_rules: list = []

    def list_rules(*args, **kwargs):
        return list(_mock_rules)

    def add_rule(name, conditions, action="flag"):
        import uuid as _uuid
        r = {"id": _uuid.uuid4().hex, "name": name, "conditions": conditions, "action": action, "enabled": True}
        _mock_rules.append(r)
        return r

    def set_rule_enabled(rule_id, enabled):
        for r in _mock_rules:
            if r["id"] == rule_id:
                r["enabled"] = bool(enabled); return True
        return False

    def delete_rule(rule_id):
        for i, r in enumerate(_mock_rules):
            if r["id"] == rule_id:
                _mock_rules.pop(i); return True
        return False

    def enabled_rules(*args, **kwargs):
        return [r for r in _mock_rules if r.get("enabled")]

    # API keys (in-memory fallback)
    _mock_keys: list = []

    def list_keys(*args, **kwargs):
        return [{k: v for k, v in d.items() if k != "key_hash"} for d in _mock_keys]

    def add_key(name, prefix, key_hash):
        import uuid as _uuid
        rec = {"id": _uuid.uuid4().hex, "name": name, "prefix": prefix, "key_hash": key_hash,
               "created_at": None, "last_used_at": None}
        _mock_keys.append(rec)
        return {"id": rec["id"], "name": name, "prefix": prefix}

    def delete_key(key_id):
        for i, k in enumerate(_mock_keys):
            if k["id"] == key_id:
                _mock_keys.pop(i); return True
        return False

    def verify_key(key_hash):
        return any(k["key_hash"] == key_hash for k in _mock_keys)
