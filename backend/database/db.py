"""
Persistence layer — always active, tiered by configuration:

    no DATABASE_URL env   → SQLite file at <project_root>/data/vaultstream.db
                            Zero setup; survives server restarts locally.
    DATABASE_URL set      → Postgres via psycopg2 (Neon, Render, local container)
                            Survives redeploys; use this for production.
    Supabase config       → Supabase (handled separately in api/*); can coexist.

DB_ENABLED is always True — SQLite is the baseline, not an opt-in.
"""
import os
import uuid
import datetime
from typing import Optional

from sqlalchemy import create_engine, String, Float, DateTime, JSON, select, text, inspect as sa_inspect
from sqlalchemy.orm import declarative_base, sessionmaker, Mapped, mapped_column

DATABASE_URL = os.environ.get("DATABASE_URL", "").strip()
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql+psycopg2://", 1)
elif DATABASE_URL.startswith("postgresql://"):
    DATABASE_URL = DATABASE_URL.replace("postgresql://", "postgresql+psycopg2://", 1)

# Auto-fallback: use a local SQLite file when no external DB is configured.
_is_sqlite = False
if not DATABASE_URL:
    # db.py lives at backend/database/db.py; three dirname calls reach project root.
    _DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "data")
    os.makedirs(_DATA_DIR, exist_ok=True)
    DATABASE_URL = f"sqlite:///{os.path.join(_DATA_DIR, 'vaultstream.db')}"
    _is_sqlite = True

DB_ENABLED = True  # always on; SQLite is the zero-config floor

_engine_kwargs: dict = {"pool_pre_ping": True, "future": True}
if _is_sqlite:
    _engine_kwargs["connect_args"] = {"check_same_thread": False}

engine = create_engine(DATABASE_URL, **_engine_kwargs)
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
    status: Mapped[Optional[str]] = mapped_column(String, default="open", nullable=True)
    assignee: Mapped[Optional[str]] = mapped_column(String, default=None, nullable=True)

    def as_dict(self):
        fj = self.feature_json or {}
        # Derive feature_vector list from stored feature_json so all consumers
        # (scatter plot, deep-dive panel) get the same structure as live alerts.
        feature_vector = [
            fj.get("tx_count_5m", 0),
            fj.get("tx_count_1h", 0),
            fj.get("tx_count_24h", 0),
            fj.get("sum_amount_1h", 0.0),
            fj.get("device_shift", 0),
        ]
        return {
            "id": self.id,
            "created_at": self.created_at.isoformat() + "+00:00",
            "transaction_id": self.transaction_id,
            "entity_id": self.entity_id,
            "risk_score": self.risk_score,
            "risk_label": self.risk_label,
            "feature_json": fj,
            "feature_vector": feature_vector,
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
    conditions: Mapped[list] = mapped_column(JSON)
    action: Mapped[str] = mapped_column(String, default="flag")
    enabled: Mapped[bool] = mapped_column(default=True)


class ApiKey(Base):
    __tablename__ = "api_keys"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    created_at: Mapped[datetime.datetime] = mapped_column(DateTime, default=datetime.datetime.utcnow)
    name: Mapped[str] = mapped_column(String)
    prefix: Mapped[str] = mapped_column(String)
    key_hash: Mapped[str] = mapped_column(String, index=True)
    last_used_at: Mapped[Optional[datetime.datetime]] = mapped_column(DateTime, nullable=True)


class Watchlist(Base):
    """Blocklist of entities / devices / merchants. Matched at scoring time for
    an instant DENY that bypasses the model."""
    __tablename__ = "watchlist"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    created_at: Mapped[datetime.datetime] = mapped_column(DateTime, default=datetime.datetime.utcnow)
    kind: Mapped[str] = mapped_column(String, default="entity")  # entity | device | merchant
    value: Mapped[str] = mapped_column(String, index=True)
    reason: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    added_by: Mapped[Optional[str]] = mapped_column(String, nullable=True)


class Feedback(Base):
    """Analyst disposition on an alert — the supervised signal that closes the
    ML loop (confirmed_fraud / false_positive feed the next training run)."""
    __tablename__ = "feedback"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    created_at: Mapped[datetime.datetime] = mapped_column(DateTime, default=datetime.datetime.utcnow)
    alert_id: Mapped[str] = mapped_column(String, index=True)
    label: Mapped[str] = mapped_column(String)  # confirmed_fraud | false_positive | unsure
    analyst: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    note: Mapped[Optional[str]] = mapped_column(String, nullable=True)


_DEMO_USERS = [
    ("00000000-0000-0000-0000-000000000001", "admin@vaultstream.demo", "admin"),
    ("00000000-0000-0000-0000-000000000002", "analyst@vaultstream.demo", "analyst"),
    ("00000000-0000-0000-0000-000000000003", "viewer@vaultstream.demo", "viewer"),
]


def init_db():
    """Create tables and seed demo users (idempotent)."""
    Base.metadata.create_all(engine)
    # Add columns that may be missing in schemas created before case-management was added.
    # Dialect-safe: check existing columns instead of relying on IF NOT EXISTS (SQLite <3.37).
    inspector = sa_inspect(engine)
    existing = {c["name"] for c in inspector.get_columns("fraud_alerts")}
    with engine.begin() as conn:
        if "status" not in existing:
            conn.execute(text("ALTER TABLE fraud_alerts ADD COLUMN status TEXT DEFAULT 'open'"))
        if "assignee" not in existing:
            conn.execute(text("ALTER TABLE fraud_alerts ADD COLUMN assignee TEXT"))
    with SessionLocal() as s:
        for uid, email, role in _DEMO_USERS:
            if not s.get(UserRole, uid):
                s.add(UserRole(user_id=uid, email=email, role=role,
                               last_sign_in_at=datetime.datetime.utcnow()))
        s.commit()
    db_label = f"SQLite ({DATABASE_URL.split('///')[-1]})" if _is_sqlite else DATABASE_URL.split('@')[-1]
    print(f"Persistence enabled: {db_label}")


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
        rows = s.execute(
            select(CaseNote).where(CaseNote.alert_id == alert_id).order_by(CaseNote.created_at.asc())
        ).scalars().all()
        return [{"id": r.id, "author": r.author, "body": r.body,
                 "created_at": r.created_at.isoformat() + "Z"} for r in rows]


# ---- Audit feed ----

def list_audit(limit: int = 100):
    with SessionLocal() as s:
        rows = s.execute(
            select(AuditEvent).order_by(AuditEvent.created_at.desc()).limit(limit)
        ).scalars().all()
        users = {u.user_id: u.email for u in s.execute(select(UserRole)).scalars().all()}
        return [{
            "id": r.id,
            "created_at": r.created_at.isoformat() + "Z",
            "actor": users.get(r.actor_id, r.actor_id),
            "action": r.action,
            "target_id": r.target_id,
            "details": r.details,
        } for r in rows]


def audit_for_target(target_id: str, limit: int = 100):
    with SessionLocal() as s:
        rows = s.execute(
            select(AuditEvent).where(AuditEvent.target_id == target_id)
            .order_by(AuditEvent.created_at.asc()).limit(limit)
        ).scalars().all()
        users = {u.user_id: u.email for u in s.execute(select(UserRole)).scalars().all()}
        return [{"id": r.id, "created_at": r.created_at.isoformat() + "Z",
                 "actor": users.get(r.actor_id, r.actor_id), "action": r.action,
                 "details": r.details} for r in rows]


def alert_timeline(alert_id: str):
    """Unified chronological feed for a case: detection, audit actions, notes
    and analyst dispositions, merged and sorted."""
    alert = get_alert(alert_id)
    events = []
    if alert:
        events.append({"ts": alert["created_at"], "kind": "detected",
                       "actor": "system", "text": f"Transaction scored {alert['risk_label']} "
                       f"({round(alert['risk_score']*100,1)}%)"})
    for a in audit_for_target(alert_id):
        events.append({"ts": a["created_at"], "kind": "action", "actor": a["actor"],
                       "text": a["action"], "details": a.get("details")})
    for n in list_notes(alert_id):
        events.append({"ts": n["created_at"], "kind": "note", "actor": n["author"], "text": n["body"]})
    for f in feedback_for(alert_id):
        events.append({"ts": f["created_at"], "kind": "feedback", "actor": f.get("analyst") or "analyst",
                       "text": f["label"].replace("_", " ")})
    events.sort(key=lambda e: e["ts"])
    return events


# ---- Entity behavioral profile ----

def alerts_for_entity(entity_id: str, limit: int = 200):
    with SessionLocal() as s:
        rows = s.execute(
            select(FraudAlert).where(FraudAlert.entity_id == entity_id)
            .order_by(FraudAlert.created_at.desc()).limit(limit)
        ).scalars().all()
        return [r.as_dict() for r in rows]


def entity_profile(entity_id: str):
    rows = alerts_for_entity(entity_id, 500)
    if not rows:
        return {"entity_id": entity_id, "found": False, "alerts": []}
    from collections import Counter
    labels = Counter(r["risk_label"] for r in rows)
    amounts = [float((r.get("feature_json") or {}).get("sum_amount_1h", 0) or 0) for r in rows]
    scores = [float(r.get("risk_score", 0) or 0) for r in rows]
    vel = [float((r.get("feature_json") or {}).get("tx_count_1h", 0) or 0) for r in rows]
    device_shifts = sum(1 for r in rows if (r.get("feature_json") or {}).get("device_shift") == 1)
    n = len(rows)
    mean_amt = sum(amounts) / n if n else 0.0
    # Deviation of the most recent transaction from the entity's own baseline
    import statistics
    std_amt = statistics.pstdev(amounts) if n > 1 else 0.0
    latest_amt = amounts[0] if amounts else 0.0
    z = (latest_amt - mean_amt) / std_amt if std_amt > 0 else 0.0
    code, country = _entity_geo(entity_id)
    return {
        "entity_id": entity_id,
        "found": True,
        "country": country, "country_code": code,
        "totals": {
            "transactions": n,
            "fraud": labels.get("FRAUD", 0),
            "suspicious": labels.get("SUSPICIOUS", 0),
            "safe": labels.get("SAFE", 0),
            "device_shifts": device_shifts,
        },
        "baseline": {
            "avg_amount": round(mean_amt, 2),
            "std_amount": round(std_amt, 2),
            "avg_velocity_1h": round(sum(vel) / n, 1) if n else 0,
            "avg_risk": round(sum(scores) / n, 3) if n else 0,
            "latest_amount": round(latest_amt, 2),
            "latest_amount_z": round(z, 2),
        },
        "alerts": rows[:60],
    }


# ---- Analytics ----

def analytics_summary(days: int = 14):
    from sqlalchemy import func
    since = datetime.datetime.utcnow() - datetime.timedelta(days=days)
    with SessionLocal() as s:
        by_label = dict(s.query(FraudAlert.risk_label, func.count()).group_by(FraudAlert.risk_label).all())
        total = sum(by_label.values()) or 0
        fraud = by_label.get("FRAUD", 0)
        rows = s.execute(
            select(FraudAlert.created_at, FraudAlert.risk_label, FraudAlert.feature_json)
            .where(FraudAlert.created_at >= since)
        ).all()
        from collections import defaultdict
        day_map = defaultdict(lambda: {"SAFE": 0, "SUSPICIOUS": 0, "FRAUD": 0, "blocked": 0.0})
        for created, label, fj in rows:
            key = created.strftime("%Y-%m-%d")
            day_map[key][label] = day_map[key].get(label, 0) + 1
            if label == "FRAUD" and isinstance(fj, dict):
                day_map[key]["blocked"] += float(fj.get("sum_amount_1h", 0) or 0)
        series = [{"date": k, **v} for k, v in sorted(day_map.items())]
        open_cases = (s.query(func.count()).select_from(FraudAlert)
                      .filter(FraudAlert.status == "open", FraudAlert.risk_label != "SAFE").scalar() or 0)
        blocked_total = s.query(func.coalesce(func.sum(FraudAlert.risk_score), 0)).scalar()
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


def feature_values(column_key: str, limit: int = 2000):
    with SessionLocal() as s:
        rows = s.execute(
            select(FraudAlert.created_at, FraudAlert.feature_json)
            .order_by(FraudAlert.created_at.desc()).limit(limit)
        ).all()
    vals = []
    for created, fj in rows:
        if isinstance(fj, dict) and fj.get(column_key) is not None:
            vals.append((created, float(fj[column_key])))
    return vals


# ---- Rules engine ----

def list_rules():
    with SessionLocal() as s:
        rows = s.execute(select(Rule).order_by(Rule.created_at.desc())).scalars().all()
        return [{"id": r.id, "name": r.name, "conditions": r.conditions, "action": r.action,
                 "enabled": r.enabled, "created_at": r.created_at.isoformat() + "Z"} for r in rows]


def add_rule(name, conditions, action="flag"):
    with SessionLocal() as s:
        r = Rule(name=name, conditions=conditions, action=action, enabled=True)
        s.add(r)
        s.commit()
        return {"id": r.id, "name": r.name, "conditions": r.conditions,
                "action": r.action, "enabled": r.enabled}


def set_rule_enabled(rule_id, enabled):
    with SessionLocal() as s:
        r = s.get(Rule, rule_id)
        if not r:
            return False
        r.enabled = bool(enabled)
        s.commit()
        return True


def delete_rule(rule_id):
    with SessionLocal() as s:
        r = s.get(Rule, rule_id)
        if not r:
            return False
        s.delete(r)
        s.commit()
        return True


def enabled_rules():
    with SessionLocal() as s:
        rows = s.execute(select(Rule).where(Rule.enabled == True)).scalars().all()  # noqa: E712
        return [{"id": r.id, "name": r.name, "conditions": r.conditions, "action": r.action}
                for r in rows]


# ---- API keys ----

def list_keys():
    with SessionLocal() as s:
        rows = s.execute(select(ApiKey).order_by(ApiKey.created_at.desc())).scalars().all()
        return [{"id": k.id, "name": k.name, "prefix": k.prefix,
                 "created_at": k.created_at.isoformat() + "Z",
                 "last_used_at": k.last_used_at.isoformat() + "Z" if k.last_used_at else None}
                for k in rows]


def add_key(name, prefix, key_hash):
    with SessionLocal() as s:
        k = ApiKey(name=name, prefix=prefix, key_hash=key_hash)
        s.add(k)
        s.commit()
        return {"id": k.id, "name": k.name, "prefix": k.prefix}


def delete_key(key_id):
    with SessionLocal() as s:
        k = s.get(ApiKey, key_id)
        if not k:
            return False
        s.delete(k)
        s.commit()
        return True


def verify_key(key_hash):
    with SessionLocal() as s:
        k = s.execute(select(ApiKey).where(ApiKey.key_hash == key_hash)).scalars().first()
        if not k:
            return False
        k.last_used_at = datetime.datetime.utcnow()
        s.commit()
        return True


# ---- Watchlist / blocklist ----

def list_watchlist():
    with SessionLocal() as s:
        rows = s.execute(select(Watchlist).order_by(Watchlist.created_at.desc())).scalars().all()
        return [{"id": w.id, "kind": w.kind, "value": w.value, "reason": w.reason,
                 "added_by": w.added_by, "created_at": w.created_at.isoformat() + "Z"} for w in rows]


def add_watch(kind: str, value: str, reason: Optional[str] = None, added_by: Optional[str] = None):
    with SessionLocal() as s:
        w = Watchlist(kind=kind, value=value, reason=reason, added_by=added_by)
        s.add(w)
        s.commit()
        return {"id": w.id, "kind": w.kind, "value": w.value, "reason": w.reason,
                "added_by": w.added_by, "created_at": w.created_at.isoformat() + "Z"}


def delete_watch(watch_id: str) -> bool:
    with SessionLocal() as s:
        w = s.get(Watchlist, watch_id)
        if not w:
            return False
        s.delete(w)
        s.commit()
        return True


def match_watchlist(entity_id: str, device_fp: Optional[str] = None):
    """Return the first watchlist entry matching this transaction, or None."""
    with SessionLocal() as s:
        rows = s.execute(select(Watchlist)).scalars().all()
        for w in rows:
            if w.kind in ("entity", "merchant") and w.value == entity_id:
                return {"id": w.id, "kind": w.kind, "value": w.value, "reason": w.reason}
            if w.kind == "device" and device_fp and w.value == device_fp:
                return {"id": w.id, "kind": w.kind, "value": w.value, "reason": w.reason}
    return None


# ---- Analyst feedback (supervised loop) ----

def add_feedback(alert_id: str, label: str, analyst: Optional[str] = None, note: Optional[str] = None):
    with SessionLocal() as s:
        fb = Feedback(alert_id=alert_id, label=label, analyst=analyst, note=note)
        s.add(fb)
        s.commit()
        return {"id": fb.id, "alert_id": alert_id, "label": label, "analyst": analyst,
                "note": note, "created_at": fb.created_at.isoformat() + "Z"}


def feedback_for(alert_id: str):
    with SessionLocal() as s:
        rows = s.execute(
            select(Feedback).where(Feedback.alert_id == alert_id).order_by(Feedback.created_at.desc())
        ).scalars().all()
        return [{"id": r.id, "label": r.label, "analyst": r.analyst, "note": r.note,
                 "created_at": r.created_at.isoformat() + "Z"} for r in rows]


def all_feedback_labels():
    """Latest disposition per alert (for rule backtesting joins)."""
    with SessionLocal() as s:
        rows = s.execute(select(Feedback).order_by(Feedback.created_at.desc())).scalars().all()
    seen, out = set(), []
    for r in rows:
        if r.alert_id in seen:
            continue
        seen.add(r.alert_id)
        out.append({"alert_id": r.alert_id, "label": r.label})
    return out


def feedback_stats():
    from sqlalchemy import func
    with SessionLocal() as s:
        by_label = dict(s.query(Feedback.label, func.count()).group_by(Feedback.label).all())
        total = sum(by_label.values()) or 0
        confirmed = by_label.get("confirmed_fraud", 0)
        fp = by_label.get("false_positive", 0)
        recent = s.execute(
            select(Feedback).order_by(Feedback.created_at.desc()).limit(12)
        ).scalars().all()
        # Precision proxy from analyst-labelled alerts
        labelled = confirmed + fp
        precision = round(confirmed / labelled, 3) if labelled else None
        return {
            "total": total,
            "by_label": by_label,
            "confirmed_fraud": confirmed,
            "false_positive": fp,
            "labelled_precision": precision,
            "recent": [{"alert_id": r.alert_id, "label": r.label, "analyst": r.analyst,
                        "created_at": r.created_at.isoformat() + "Z"} for r in recent],
        }


# ---- Cost / impact ----

def impact_summary(days: int = 30):
    """Money framing on the alert stream — value caught, exposure, and an
    estimated cost of false positives."""
    since = datetime.datetime.utcnow() - datetime.timedelta(days=days)
    FP_REVIEW_COST = 12.0  # analyst cost to review one false-positive flag
    with SessionLocal() as s:
        rows = s.execute(
            select(FraudAlert.risk_label, FraudAlert.feature_json)
            .where(FraudAlert.created_at >= since)
        ).all()
    caught = exposure = 0.0
    fraud_n = suspicious_n = 0
    for label, fj in rows:
        amt = float((fj or {}).get("sum_amount_1h", 0) or 0) if isinstance(fj, dict) else 0.0
        if label == "FRAUD":
            caught += amt
            fraud_n += 1
        elif label == "SUSPICIOUS":
            exposure += amt
            suspicious_n += 1
    fp_cost = round(suspicious_n * FP_REVIEW_COST, 2)
    return {
        "value_caught": round(caught, 2),
        "exposure_open": round(exposure, 2),
        "fp_review_cost": fp_cost,
        "net_protected": round(caught - fp_cost, 2),
        "fraud_count": fraud_n,
        "suspicious_count": suspicious_n,
        "days": days,
    }


# ---- Geo (pseudo, derived from entity hash — IEEE-CIS has no geo) ----

_GEO_BUCKETS = [
    ("US", "United States"), ("GB", "United Kingdom"), ("DE", "Germany"),
    ("NG", "Nigeria"), ("BR", "Brazil"), ("IN", "India"), ("RU", "Russia"),
    ("SG", "Singapore"), ("FR", "France"), ("CN", "China"),
]


def _entity_geo(entity_id: str):
    h = int(uuid.uuid5(uuid.NAMESPACE_DNS, str(entity_id)).int)
    return _GEO_BUCKETS[h % len(_GEO_BUCKETS)]


def geo_breakdown(days: int = 30):
    since = datetime.datetime.utcnow() - datetime.timedelta(days=days)
    with SessionLocal() as s:
        rows = s.execute(
            select(FraudAlert.entity_id, FraudAlert.risk_label)
            .where(FraudAlert.created_at >= since)
        ).all()
    from collections import defaultdict
    agg = defaultdict(lambda: {"total": 0, "fraud": 0})
    for entity, label in rows:
        code, name = _entity_geo(entity)
        agg[(code, name)]["total"] += 1
        if label == "FRAUD":
            agg[(code, name)]["fraud"] += 1
    out = [{"code": c, "country": n, "total": v["total"], "fraud": v["fraud"],
            "fraud_rate": round(v["fraud"] / v["total"] * 100, 1) if v["total"] else 0.0}
           for (c, n), v in agg.items()]
    out.sort(key=lambda r: r["fraud"], reverse=True)
    return out


# ---- Outcome monitoring (fraud-rate spike) ----

def fraud_rate_window(hours: int):
    from sqlalchemy import func
    since = datetime.datetime.utcnow() - datetime.timedelta(hours=hours)
    with SessionLocal() as s:
        rows = dict(s.query(FraudAlert.risk_label, func.count())
                    .filter(FraudAlert.created_at >= since)
                    .group_by(FraudAlert.risk_label).all())
    total = sum(rows.values()) or 0
    fraud = rows.get("FRAUD", 0)
    return total, fraud, (fraud / total) if total else 0.0


# ---- Fraud-ring link analysis ----

def ring_graph(min_cluster: int = 2, limit: int = 1500):
    """Connected-components over alerts that share an entity, with device-shift
    and high-velocity edges, to surface coordinated fraud rings."""
    with SessionLocal() as s:
        rows = s.execute(
            select(FraudAlert.id, FraudAlert.entity_id, FraudAlert.risk_label,
                   FraudAlert.risk_score, FraudAlert.feature_json, FraudAlert.transaction_id)
            .where(FraudAlert.risk_label != "SAFE")
            .order_by(FraudAlert.created_at.desc()).limit(limit)
        ).all()
    # Union-find over entities; entities are linked when they share a device-shift
    # signature bucket (proxy for a shared device/card in this synthetic dataset).
    parent: dict = {}

    def find(x):
        parent.setdefault(x, x)
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(a, b):
        parent[find(a)] = find(b)

    ent_stats: dict = {}
    for _id, entity, label, score, fj, txid in rows:
        st = ent_stats.setdefault(entity, {"flags": 0, "fraud": 0, "max_score": 0.0, "device_shift": 0})
        st["flags"] += 1
        st["fraud"] += 1 if label == "FRAUD" else 0
        st["max_score"] = max(st["max_score"], float(score or 0))
        if isinstance(fj, dict) and fj.get("device_shift") == 1:
            st["device_shift"] += 1
    # Link entities that share a device-shift fingerprint bucket
    buckets: dict = {}
    for entity, st in ent_stats.items():
        sig = (st["device_shift"] > 0, round(st["max_score"], 1))
        buckets.setdefault(sig, []).append(entity)
    for sig, members in buckets.items():
        if not sig[0]:  # only ring devices together (device-shift present)
            continue
        for m in members[1:]:
            union(members[0], m)
    # Build clusters
    clusters: dict = {}
    for entity in ent_stats:
        clusters.setdefault(find(entity), []).append(entity)
    rings = []
    for root, members in clusters.items():
        if len(members) < min_cluster:
            continue
        flags = sum(ent_stats[m]["flags"] for m in members)
        fraud = sum(ent_stats[m]["fraud"] for m in members)
        rings.append({
            "id": root,
            "entities": members,
            "size": len(members),
            "flags": flags,
            "fraud": fraud,
            "risk": round(max(ent_stats[m]["max_score"] for m in members), 3),
        })
    rings.sort(key=lambda r: (r["size"], r["fraud"]), reverse=True)
    nodes = [{"id": e, "flags": st["flags"], "fraud": st["fraud"],
              "max_score": round(st["max_score"], 3),
              "ring": find(e) if len(clusters.get(find(e), [])) >= min_cluster else None}
             for e, st in ent_stats.items()]
    return {"rings": rings, "nodes": nodes, "entity_count": len(ent_stats)}


# ---- Demo seed (auto-runs on empty DB) ----

_SEED_FIRST = ["ava", "noah", "mia", "liam", "ivy", "ezra", "luna", "kai", "nora", "omar",
               "zara", "finn", "elif", "rhys", "tara", "jude", "remy", "wren", "cleo", "dax"]
_SEED_MERCHANTS = ["merch_coffee", "merch_retail", "merch_luxury_watches", "merch_travel",
                   "merch_electronics", "merch_grocery", "merch_gaming", "merch_crypto_exch"]
_SEED_RULES = [
    {"name": "High-velocity burst", "conditions": [{"field": "tx_count_5m", "op": ">", "value": 8}], "action": "flag"},
    {"name": "Large single transfer", "conditions": [{"field": "amount", "op": ">", "value": 5000}], "action": "escalate"},
    {"name": "Device shift + high amount", "conditions": [{"field": "device_shift", "op": "==", "value": 1}, {"field": "amount", "op": ">", "value": 1000}], "action": "escalate"},
    {"name": "Rapid hourly spending", "conditions": [{"field": "tx_count_1h", "op": ">", "value": 20}], "action": "flag"},
]


def _seed_label():
    import random
    r = random.random()
    if r < 0.72:
        return "SAFE"
    if r < 0.92:
        return "SUSPICIOUS"
    return "FRAUD"


def _seed_features(label):
    import random
    if label == "FRAUD":
        amt = random.uniform(600, 9000)
        vel = random.randint(10, 58)
        return {"tx_count_5m": random.randint(4, 14), "tx_count_1h": vel,
                "tx_count_24h": vel + random.randint(10, 50), "sum_amount_1h": round(amt, 2),
                "device_shift": random.choice([0, 1, 1])}, round(random.uniform(0.30, 0.95), 4)
    if label == "SUSPICIOUS":
        amt = random.uniform(120, 3200)
        vel = random.randint(5, 38)
        return {"tx_count_5m": random.randint(1, 6), "tx_count_1h": vel,
                "tx_count_24h": vel + random.randint(5, 25), "sum_amount_1h": round(amt, 2),
                "device_shift": random.choice([0, 0, 1])}, round(random.uniform(0.12, 0.19), 4)
    amt = random.uniform(5, 1600)
    vel = random.randint(1, 26)
    return {"tx_count_5m": random.randint(1, 4), "tx_count_1h": vel,
            "tx_count_24h": vel + random.randint(2, 14), "sum_amount_1h": round(amt, 2),
            "device_shift": 0}, round(random.uniform(0.01, 0.09), 4)


def seed_if_empty(n_alerts: int = 600, n_users: int = 20):
    """Populate demo data when the DB is freshly created (idempotent — skips if data exists)."""
    import random
    with SessionLocal() as s:
        if s.query(FraudAlert).count() > 0:
            return  # already seeded
        print(f"Empty database — seeding {n_alerts} demo transactions…")

        # Extra analyst/viewer users beyond the 3 demo accounts
        roles_pool = ["analyst"] * 9 + ["viewer"] * 5 + ["admin"] * 2
        random.shuffle(roles_pool)
        existing_emails = {u.email for u in s.query(UserRole).all()}
        for i in range(n_users):
            name = random.choice(_SEED_FIRST)
            email = f"{name}.{random.randint(10, 999)}@vaultstream.io"
            if email in existing_emails:
                continue
            existing_emails.add(email)
            last = datetime.datetime.utcnow() - datetime.timedelta(hours=random.randint(0, 480))
            s.add(UserRole(user_id=uuid.uuid4().hex, email=email,
                           role=roles_pool[i % len(roles_pool)], last_sign_in_at=last))
        s.flush()

        # Demo rules
        if s.query(Rule).count() == 0:
            for r in _SEED_RULES:
                s.add(Rule(id=uuid.uuid4().hex, name=r["name"],
                           conditions=r["conditions"], action=r["action"], enabled=True))

        # Transactions spread across 30 days for good graph coverage
        entities = [f"acct_{random.choice(_SEED_FIRST)}_{random.randint(100, 999)}" for _ in range(50)]
        now = datetime.datetime.utcnow()
        analysts = [u.user_id for u in s.query(UserRole).filter(
            UserRole.role.in_(["analyst", "admin"])).all()]

        alert_rows, audit_rows = [], []
        for i in range(n_alerts):
            label = _seed_label()
            fj, score = _seed_features(label)
            created = now - datetime.timedelta(minutes=random.randint(0, 30 * 24 * 60))
            entity = random.choice(entities)
            action = None
            if label in ("FRAUD", "SUSPICIOUS") and random.random() < 0.45:
                action = random.choice(["freeze", "escalate"])
            row = FraudAlert(
                id=uuid.uuid4().hex,
                created_at=created,
                transaction_id=f"tx_{label[:2].lower()}_{random.randint(100000, 999999)}",
                entity_id=entity,
                risk_score=score,
                risk_label=label,
                feature_json=fj,
                action_taken=action,
                status="closed" if action else "open",
            )
            alert_rows.append(row)
            if action and analysts:
                audit_rows.append(AuditEvent(
                    id=uuid.uuid4().hex,
                    created_at=created + datetime.timedelta(minutes=random.randint(1, 45)),
                    actor_id=random.choice(analysts),
                    action=action,
                    target_id=row.id,
                    details={"label": label, "score": score},
                ))

        s.bulk_save_objects(alert_rows)
        s.bulk_save_objects(audit_rows)
        s.commit()

        from sqlalchemy import func
        by_label = dict(s.query(FraudAlert.risk_label, func.count()).group_by(FraudAlert.risk_label).all())
        print(f"Seed complete: {s.query(FraudAlert).count()} transactions {by_label}, "
              f"{s.query(AuditEvent).count()} audit events, {s.query(UserRole).count()} users.")
