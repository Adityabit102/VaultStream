-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Fraud alerts table
CREATE TABLE fraud_alerts (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at   TIMESTAMPTZ DEFAULT NOW(),
    analyst_id   UUID REFERENCES auth.users(id),
    transaction_id TEXT NOT NULL,
    entity_id    TEXT NOT NULL,
    risk_score   FLOAT NOT NULL,
    risk_label   TEXT NOT NULL CHECK (risk_label IN ('SAFE', 'SUSPICIOUS', 'FRAUD')),
    feature_json JSONB,
    shap_json    JSONB,
    action_taken TEXT DEFAULT 'none'
);

-- Row Level Security: analysts only see their own assigned alerts
ALTER TABLE fraud_alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY analyst_isolation_policy ON fraud_alerts
    FOR ALL TO authenticated
    USING (analyst_id = auth.uid());

-- Audit log table
CREATE TABLE audit_events (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    actor_id    UUID REFERENCES auth.users(id) NOT NULL,
    action      TEXT NOT NULL,
    target_id   UUID NOT NULL,
    details     JSONB
);

-- Audit log RLS: append-only, no UPDATE/DELETE for any role
ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY audit_insert_only ON audit_events
    FOR INSERT TO authenticated WITH CHECK (actor_id = auth.uid());
    
CREATE POLICY audit_select_only ON audit_events
    FOR SELECT TO authenticated USING (true);
