-- 1. Create User Roles Table
CREATE TABLE IF NOT EXISTS user_roles (
  user_id  UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  role     TEXT NOT NULL DEFAULT 'viewer'
           CHECK (role IN ('analyst', 'admin', 'viewer')),
  assigned_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS on User Roles
ALTER TABLE user_roles ENABLE ROW LEVEL SECURITY;

-- Policy: Users can read their own role
DROP POLICY IF EXISTS user_read_own_role ON user_roles;
CREATE POLICY user_read_own_role ON user_roles
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- Policy: Only admins can manage roles (SELECT/INSERT/UPDATE/DELETE)
DROP POLICY IF EXISTS admin_manage_roles ON user_roles;
CREATE POLICY admin_manage_roles ON user_roles
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_id = auth.uid() AND role = 'admin'
    )
  );

-- 2. Update Fraud Alerts Policies
DROP POLICY IF EXISTS analyst_isolation_policy ON fraud_alerts;
DROP POLICY IF EXISTS alerts_read_policy ON fraud_alerts;
DROP POLICY IF EXISTS alerts_write_policy ON fraud_alerts;

-- Policy: All authenticated users can read dashboard alerts
CREATE POLICY alerts_read_policy ON fraud_alerts
  FOR SELECT TO authenticated 
  USING (true);

-- Policy: Only analysts and admins can update alert status (action_taken)
CREATE POLICY alerts_write_policy ON fraud_alerts
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_id = auth.uid()
      AND role IN ('analyst', 'admin')
    )
  );

-- 3. Update Audit Events Policies
DROP POLICY IF EXISTS audit_insert_only ON audit_events;
DROP POLICY IF EXISTS audit_select_only ON audit_events;
DROP POLICY IF EXISTS audit_insert_policy ON audit_events;
DROP POLICY IF EXISTS audit_read_policy ON audit_events;

-- Policy: INSERT audit events (analysts and admins only)
CREATE POLICY audit_insert_policy ON audit_events
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_id = auth.uid()
      AND role IN ('analyst', 'admin')
    )
  );

-- Policy: SELECT audit events (analysts read own logs, admins read all logs)
CREATE POLICY audit_read_policy ON audit_events
  FOR SELECT TO authenticated
  USING (
    actor_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_id = auth.uid() AND role = 'admin'
    )
  );

-- 4. Default Role Trigger on signup
CREATE OR REPLACE FUNCTION assign_default_role()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO user_roles (user_id, role)
  VALUES (NEW.id, 'viewer')
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION assign_default_role();
