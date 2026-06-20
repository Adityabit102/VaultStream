'use client';
import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import PageShell, { PageHeading } from '@/components/site/PageShell';
import { Skeleton, StatTile } from '@/components/ui';
import { apiFetch } from '@/lib/api';

interface AlertRow { id: string; transaction_id: string; risk_label: string; risk_score: number; created_at: string; feature_json?: Record<string, number> }
interface Profile {
  entity_id: string; found: boolean; country?: string; country_code?: string;
  totals?: { transactions: number; fraud: number; suspicious: number; safe: number; device_shifts: number };
  baseline?: { avg_amount: number; std_amount: number; avg_velocity_1h: number; avg_risk: number; latest_amount: number; latest_amount_z: number };
  alerts: AlertRow[];
}

const LABEL_COLOR: Record<string, string> = { FRAUD: 'var(--color-alert)', SUSPICIOUS: 'var(--color-warn)', SAFE: 'var(--color-safe)' };

export default function EntityProfilePage() {
  const params = useParams<{ id: string }>();
  const id = params?.id ? decodeURIComponent(params.id) : '';
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const res = await apiFetch(`/v1/entities/${encodeURIComponent(id)}`, { role: 'viewer' });
      if (res.ok) setProfile(await res.json());
    } catch { /* ignore */ }
    setLoading(false);
  }, [id]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  const t = profile?.totals;
  const b = profile?.baseline;
  // Oldest→newest amount history for the sparkline
  const history = (profile?.alerts ?? []).slice().reverse().map((a, i) => ({
    i, amount: Number(a.feature_json?.sum_amount_1h ?? 0), label: a.risk_label,
  }));
  const zHigh = b ? Math.abs(b.latest_amount_z) >= 2 : false;

  return (
    <PageShell maxWidth={920}>
      <PageHeading
        eyebrow="Behavioral profile"
        title={id}
        subtitle={profile?.country ? `Origin · ${profile.country}` : 'Entity history and baseline deviation.'}
        action={<Link href="/network" className="btn btn-ghost" style={{ fontSize: 13 }}>← Fraud rings</Link>}
      />

      {loading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Skeleton height={90} radius={20} /><Skeleton height={200} radius={20} /><Skeleton height={260} radius={20} />
        </div>
      ) : !profile?.found ? (
        <div className="lux-card" style={{ padding: 40, textAlign: 'center', color: 'var(--color-ink-soft)' }}>
          No transaction history found for <span className="data">{id}</span>.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* Deviation banner */}
          {b && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '16px 20px', borderRadius: 16, background: zHigh ? 'var(--color-alert-soft)' : 'var(--color-surface-2)', border: '1px solid var(--color-line)', color: zHigh ? '#b23a54' : 'var(--color-ink-soft)' }}>
              <span style={{ fontSize: 22 }}>{zHigh ? '⚠️' : '📊'}</span>
              <div>
                <div style={{ fontWeight: 600, fontSize: 14 }}>
                  Latest activity is {Math.abs(b.latest_amount_z).toFixed(1)}σ {b.latest_amount_z >= 0 ? 'above' : 'below'} this entity&apos;s own baseline
                </div>
                <div style={{ fontSize: 12.5, opacity: 0.85 }}>
                  Baseline ${b.avg_amount.toLocaleString()} ± ${b.std_amount.toLocaleString()} · latest ${b.latest_amount.toLocaleString()}
                </div>
              </div>
            </div>
          )}

          {/* Totals */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16 }} className="kpi-grid">
            <div style={panel}><StatTile value={t?.transactions ?? 0} label="Transactions" /></div>
            <div style={panel}><StatTile value={t?.fraud ?? 0} label="Fraud flags" accent="var(--color-alert)" /></div>
            <div style={panel}><StatTile value={t?.device_shifts ?? 0} label="Device shifts" accent="var(--color-warn)" /></div>
            <div style={panel}><StatTile value={`${((b?.avg_risk ?? 0) * 100).toFixed(0)}%`} label="Avg risk" accent="var(--color-violet)" /></div>
          </div>

          {/* Spend history */}
          <div style={panel}>
            <div className="eyebrow" style={{ marginBottom: 16 }}>Spend history (1h window per transaction)</div>
            <div style={{ height: 220 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={history} margin={{ top: 4, right: 8, bottom: 4, left: -8 }}>
                  <XAxis dataKey="i" tick={{ fontSize: 10, fill: 'var(--color-ink-faint)' }} />
                  <YAxis tick={{ fontSize: 10, fill: 'var(--color-ink-faint)' }} tickFormatter={(v: number) => `$${Math.round(v / 1000)}k`} />
                  <Tooltip contentStyle={{ borderRadius: 12, border: '1px solid var(--color-line)', fontSize: 12 }} formatter={(v) => [`$${Math.round(Number(v)).toLocaleString()}`, 'spend']} />
                  <Line type="monotone" dataKey="amount" stroke="var(--color-violet)" strokeWidth={2.5} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Alert history */}
          <div style={panel}>
            <div className="eyebrow" style={{ marginBottom: 16 }}>Recent alerts · {profile.alerts.length}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {profile.alerts.slice(0, 25).map((a) => (
                <Link key={a.id} href={`/alert/${a.id}`} style={{ textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 14, padding: '10px 14px', borderRadius: 12, background: 'var(--color-surface-2)', border: '1px solid var(--color-line)' }}>
                  <span style={{ width: 8, height: 8, borderRadius: 999, background: LABEL_COLOR[a.risk_label] || 'var(--color-ink-faint)' }} />
                  <span className="data" style={{ flex: 1, fontSize: 12.5, color: 'var(--color-ink)' }}>{a.transaction_id}</span>
                  <span style={{ fontSize: 12, color: 'var(--color-ink-faint)' }}>{new Date(a.created_at).toLocaleDateString()}</span>
                  <span className="data" style={{ width: 56, textAlign: 'right', fontSize: 12.5, color: LABEL_COLOR[a.risk_label] || 'var(--color-ink-soft)', fontWeight: 600 }}>{(a.risk_score * 100).toFixed(0)}%</span>
                </Link>
              ))}
            </div>
          </div>
        </div>
      )}

      <style jsx>{`
        @media (max-width: 720px) { .kpi-grid { grid-template-columns: repeat(2, 1fr) !important; } }
      `}</style>
    </PageShell>
  );
}

const panel: React.CSSProperties = {
  background: 'var(--color-surface)', border: '1px solid var(--color-line)', borderRadius: 24, padding: 22, boxShadow: 'var(--shadow-sm)',
};
