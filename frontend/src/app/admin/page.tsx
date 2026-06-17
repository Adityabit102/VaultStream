'use client';
import { useRole } from '@/components/RoleProvider';
import { useAuth } from '@/components/AuthProvider';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import WorkspaceHeader from '@/components/site/WorkspaceHeader';
import AppBackground from '@/components/site/AppBackground';
import { Badge } from '@/components/ui';
import { Notice } from '@/components/site/AuthShell';
import { apiUrl, getToken } from '@/lib/api';
import dynamic from 'next/dynamic';
const HeaderAccent = dynamic(() => import('@/components/three/HeaderAccent'), { ssr: false, loading: () => null });

type Role = 'analyst' | 'admin' | 'viewer';
type AdminUser = {
  id: string;
  email: string;
  role: Role;
  last_sign_in_at: string | null;
};

export default function AdminPage() {
  const { isAdmin, loading: roleLoading } = useRole();
  const { user } = useAuth();
  const router = useRouter();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [pendingRoles, setPendingRoles] = useState<Record<string, Role>>({});
  const [audit, setAudit] = useState<{ id: string; created_at: string; actor: string; action: string; target_id: string }[]>([]);

  useEffect(() => {
    if (roleLoading) return;
    if (!isAdmin) {
      router.push('/');
      return;
    }
    const fetchUsers = async () => {
      const token = await getToken('admin');
      try {
        const res = await fetch(apiUrl('/v1/admin/users'), { headers: { Authorization: `Bearer ${token}` } });
        if (res.ok) {
          const data: AdminUser[] = await res.json();
          setUsers(data);
          const mapping: Record<string, Role> = {};
          data.forEach((u) => (mapping[u.id] = u.role));
          setPendingRoles(mapping);
        } else {
          setError(`Failed to fetch users: ${res.statusText}`);
        }
        const ares = await fetch(apiUrl('/v1/audit?limit=40'), { headers: { Authorization: `Bearer ${token}` } });
        if (ares.ok) setAudit((await ares.json()).events || []);
      } catch (err) {
        setError(`Failed to fetch users: ${String(err)}`);
      } finally {
        setLoading(false);
      }
    };
    fetchUsers();
  }, [roleLoading, isAdmin, router, user]);

  const handleSaveRole = async (userId: string) => {
    setError(null);
    setSuccess(null);
    const newRole = pendingRoles[userId];
    const token = await getToken('admin');
    try {
      const res = await fetch(apiUrl(`/v1/admin/users/${userId}/role`), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ role: newRole }),
      });
      if (res.ok) {
        setSuccess(`Role updated to ${newRole}`);
        setUsers((prev) => prev.map((u) => (u.id === userId ? { ...u, role: newRole } : u)));
      } else {
        const errData = await res.json();
        setError(`Failed to save role: ${errData.detail || res.statusText}`);
      }
    } catch (err) {
      setError(`Failed to save role: ${String(err)}`);
    }
  };

  if (roleLoading || loading) {
    return (
      <div style={{ height: '100vh', display: 'grid', placeItems: 'center', color: 'var(--color-ink-soft)' }}>
        <span className="data">Loading security context…</span>
      </div>
    );
  }
  if (!isAdmin) return null;

  const toneFor = (r: Role): 'warn' | 'safe' | 'neutral' =>
    r === 'admin' ? 'warn' : r === 'analyst' ? 'safe' : 'neutral';

  return (
    <div style={{ minHeight: '100vh', padding: 16 }}>
      <AppBackground />
      <WorkspaceHeader />
      <div style={{ maxWidth: 1000, margin: '32px auto 0', padding: '0 8px' }}>
        <div className="eyebrow" style={{ marginBottom: 12 }}>Admin · access control</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <HeaderAccent variant="shield" color="#cf9d7e" />
          <h1 style={{ fontSize: 38, marginBottom: 10 }}>User management</h1>
        </div>
        <p style={{ color: 'var(--color-ink-soft)', marginBottom: 28, fontSize: 15 }}>
          Authorization is enforced at both the API and database layers. Update a role and apply.
        </p>

        {error && <Notice tone="error">{error}</Notice>}
        {success && <Notice tone="success">{success}</Notice>}

        <div className="lux-card" style={{ padding: 0, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
            <thead>
              <tr style={{ background: 'var(--color-surface-2)', borderBottom: '1px solid var(--color-line)' }}>
                {['Email', 'Current', 'Last active', 'Assign role', ''].map((h) => (
                  <th key={h} className="eyebrow" style={{ padding: '16px 20px', fontSize: 10 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const changed = pendingRoles[u.id] !== u.role;
                return (
                  <tr key={u.id} style={{ borderBottom: '1px solid var(--color-line)' }}>
                    <td className="data" style={{ padding: '16px 20px', fontSize: 13 }}>{u.email}</td>
                    <td style={{ padding: '16px 20px' }}><Badge tone={toneFor(u.role)}>{u.role}</Badge></td>
                    <td className="data" style={{ padding: '16px 20px', fontSize: 12, color: 'var(--color-ink-soft)' }}>
                      {u.last_sign_in_at ? new Date(u.last_sign_in_at).toLocaleString() : 'Never'}
                    </td>
                    <td style={{ padding: '16px 20px' }}>
                      <select
                        value={pendingRoles[u.id] || u.role}
                        onChange={(e) => setPendingRoles((p) => ({ ...p, [u.id]: e.target.value as Role }))}
                        style={{ padding: '8px 12px', borderRadius: 10, border: '1px solid var(--color-line-strong)', background: 'var(--color-surface)', color: 'var(--color-ink)', fontSize: 13, fontFamily: 'var(--font-sans)' }}
                      >
                        <option value="viewer">Read-Only Viewer</option>
                        <option value="analyst">Fraud Analyst</option>
                        <option value="admin">System Admin</option>
                      </select>
                    </td>
                    <td style={{ padding: '16px 20px', textAlign: 'right' }}>
                      <button onClick={() => handleSaveRole(u.id)} disabled={!changed} className={changed ? 'btn btn-primary' : 'btn btn-ghost'} style={{ padding: '8px 16px', fontSize: 12 }}>
                        Apply
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Activity / audit feed */}
        <div style={{ marginTop: 40 }}>
          <div className="eyebrow" style={{ marginBottom: 12 }}>Activity · audit trail</div>
          <h2 style={{ fontSize: 26, marginBottom: 16 }}>Recent actions</h2>
          <div className="lux-card" style={{ padding: 0, overflow: 'hidden' }}>
            {audit.length === 0 ? (
              <div style={{ padding: 24, color: 'var(--color-ink-faint)', fontSize: 14 }}>No recorded activity yet.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                {audit.map((e) => (
                  <div key={e.id} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '12px 20px', borderBottom: '1px solid var(--color-line)' }}>
                    <Badge tone={e.action.startsWith('status:resolved') ? 'safe' : e.action === 'freeze' || e.action.startsWith('status:open') ? 'alert' : e.action === 'escalate' || e.action.startsWith('role') ? 'warn' : 'neutral'}>
                      {e.action}
                    </Badge>
                    <span className="data" style={{ fontSize: 13, color: 'var(--color-ink)' }}>{e.actor.split('@')[0]}</span>
                    <span className="data" style={{ fontSize: 12, color: 'var(--color-ink-faint)' }}>→ {e.target_id.slice(0, 10)}</span>
                    <span className="data" style={{ fontSize: 12, color: 'var(--color-ink-faint)', marginLeft: 'auto' }}>{new Date(e.created_at).toLocaleString()}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
