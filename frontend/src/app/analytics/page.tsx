'use client';
import { useEffect, useState } from 'react';
import { AreaChart, Area, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import WorkspaceHeader from '@/components/site/WorkspaceHeader';
import AppBackground from '@/components/site/AppBackground';
import dynamic from 'next/dynamic';
const HeaderAccent = dynamic(() => import('@/components/three/HeaderAccent'), { ssr: false, loading: () => null });
import { StatTile } from '@/components/ui';
import { useRole } from '@/components/RoleProvider';
import { apiUrl, getToken } from '@/lib/api';

interface Summary {
  totals: { transactions: number; fraud: number; fraud_rate: number; open_cases: number; amount_blocked: number };
  by_label: Record<string, number>;
  series: { date: string; SAFE?: number; SUSPICIOUS?: number; FRAUD?: number; blocked?: number }[];
}

const COLORS: Record<string, string> = { SAFE: 'var(--color-safe)', SUSPICIOUS: 'var(--color-warn)', FRAUD: 'var(--color-alert)' };

const panel: React.CSSProperties = {
  background: 'var(--color-surface)', border: '1px solid var(--color-line)', borderRadius: 24, padding: 24, boxShadow: 'var(--shadow-sm)',
};

export default function AnalyticsPage() {
  const { isAuthenticated, loading } = useRole();
  const { role } = useRole();
  const [data, setData] = useState<Summary | null>(null);
  const [days, setDays] = useState(14);
  const [topEntities, setTopEntities] = useState<{ entity: string; flags: number; max_score: number }[]>([]);

  useEffect(() => {
    (async () => {
      const token = await getToken(role || 'viewer');
      const res = await fetch(apiUrl(`/v1/analytics/summary?days=${days}`), { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) setData(await res.json());
      const te = await fetch(apiUrl('/v1/analytics/top-entities?limit=6'), { headers: { Authorization: `Bearer ${token}` } });
      if (te.ok) setTopEntities((await te.json()).entities || []);
    })();
  }, [role, days]);

  const exportCsv = () => {
    const rows = data?.series ?? [];
    const header = 'date,safe,suspicious,fraud,amount_blocked';
    const body = rows.map((r) => `${r.date},${r.SAFE ?? 0},${r.SUSPICIOUS ?? 0},${r.FRAUD ?? 0},${Math.round(r.blocked ?? 0)}`).join('\n');
    const blob = new Blob([`${header}\n${body}`], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `vaultstream-analytics-${days}d.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  if (loading) return <div style={{ height: '100vh', display: 'grid', placeItems: 'center', color: 'var(--color-ink-soft)' }}><span className="data">Loading…</span></div>;

  const t = data?.totals;
  const pie = data ? Object.entries(data.by_label).map(([k, v]) => ({ name: k, value: v })) : [];

  return (
    <div style={{ minHeight: '100vh', padding: 16 }}>
      <AppBackground />
      <WorkspaceHeader />
      <div style={{ maxWidth: 1180, margin: '32px auto 0', padding: '0 8px' }}>
        <div className="eyebrow" style={{ marginBottom: 12 }}>Intelligence · last {days} days</div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: 12, marginBottom: 28 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <HeaderAccent variant="prism" color="#a7c293" />
            <h1 style={{ fontSize: 38 }}>Fraud analytics</h1>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <div style={{ display: 'flex', borderRadius: 999, border: '1px solid var(--color-line)', overflow: 'hidden' }}>
              {[7, 14, 30].map((d) => (
                <button key={d} onClick={() => setDays(d)} style={{
                  padding: '8px 14px', fontSize: 12, fontWeight: 600, border: 'none', cursor: 'pointer',
                  background: days === d ? 'var(--color-ink)' : 'transparent',
                  color: days === d ? '#fff' : 'var(--color-ink-soft)',
                }}>{d}d</button>
              ))}
            </div>
            <button onClick={exportCsv} className="btn btn-ghost" style={{ padding: '9px 16px', fontSize: 13 }}>↓ Export CSV</button>
          </div>
        </div>

        {!isAuthenticated && (
          <div style={{ ...panel, marginBottom: 20 }}>Sign in to view analytics.</div>
        )}

        {/* KPI tiles */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 20 }} className="kpi-grid">
          <div style={panel} title="Total transactions scored by the model in the selected window."><StatTile value={(t?.transactions ?? 0).toLocaleString()} label="Transactions scored" /></div>
          <div style={panel} title="Share of transactions flagged FRAUD (score above the tuned threshold)."><StatTile value={`${t?.fraud_rate ?? 0}%`} label="Fraud rate" accent="var(--color-alert)" sub={`${t?.fraud ?? 0} flagged`} /></div>
          <div style={panel} title="Non-safe alerts still in 'open' status awaiting investigation."><StatTile value={(t?.open_cases ?? 0).toLocaleString()} label="Open cases" accent="var(--color-warn)" /></div>
          <div style={panel} title="Estimated fraudulent spend stopped (sum of 1h spend on FRAUD alerts)."><StatTile value={`$${Math.round(t?.amount_blocked ?? 0).toLocaleString()}`} label="Amount blocked" accent="var(--color-mint)" /></div>
        </div>

        {/* Charts */}
        <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr', gap: 16, marginBottom: 20 }} className="chart-grid">
          <div style={panel}>
            <div className="eyebrow" style={{ marginBottom: 16 }}>Daily volume by verdict</div>
            <div style={{ height: 280 }}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={data?.series ?? []} margin={{ top: 4, right: 8, bottom: 4, left: -16 }}>
                  <defs>
                    {(['SAFE', 'SUSPICIOUS', 'FRAUD'] as const).map((k) => (
                      <linearGradient key={k} id={`g${k}`} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={COLORS[k]} stopOpacity={0.5} />
                        <stop offset="100%" stopColor={COLORS[k]} stopOpacity={0.05} />
                      </linearGradient>
                    ))}
                  </defs>
                  <CartesianGrid strokeDasharray="4 4" stroke="var(--color-line)" />
                  <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'var(--color-ink-faint)' }} tickFormatter={(d: string) => d.slice(5)} />
                  <YAxis tick={{ fontSize: 10, fill: 'var(--color-ink-faint)' }} />
                  <Tooltip contentStyle={{ borderRadius: 12, border: '1px solid var(--color-line)', fontSize: 12 }} />
                  {(['SAFE', 'SUSPICIOUS', 'FRAUD'] as const).map((k) => (
                    <Area key={k} type="monotone" dataKey={k} stackId="1" stroke={COLORS[k]} fill={`url(#g${k})`} strokeWidth={2} />
                  ))}
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div style={panel}>
            <div className="eyebrow" style={{ marginBottom: 16 }}>Verdict distribution</div>
            <div style={{ height: 280 }}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={pie} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={60} outerRadius={100} paddingAngle={2}>
                    {pie.map((e) => <Cell key={e.name} fill={COLORS[e.name] || 'var(--color-violet)'} />)}
                  </Pie>
                  <Tooltip contentStyle={{ borderRadius: 12, border: '1px solid var(--color-line)', fontSize: 12 }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div style={{ display: 'flex', gap: 16, justifyContent: 'center' }}>
              {pie.map((e) => (
                <span key={e.name} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--color-ink-soft)' }}>
                  <span style={{ width: 9, height: 9, borderRadius: 999, background: COLORS[e.name] || 'var(--color-violet)' }} /> {e.name}
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* Amount blocked trend */}
        <div style={{ ...panel, marginBottom: 40 }}>
          <div className="eyebrow" style={{ marginBottom: 16 }}>Fraud amount blocked / day</div>
          <div style={{ height: 220 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data?.series ?? []} margin={{ top: 4, right: 8, bottom: 4, left: -8 }}>
                <CartesianGrid strokeDasharray="4 4" stroke="var(--color-line)" />
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'var(--color-ink-faint)' }} tickFormatter={(d: string) => d.slice(5)} />
                <YAxis tick={{ fontSize: 10, fill: 'var(--color-ink-faint)' }} tickFormatter={(v: number) => `$${Math.round(v / 1000)}k`} />
                <Tooltip contentStyle={{ borderRadius: 12, border: '1px solid var(--color-line)', fontSize: 12 }} formatter={(v) => [`$${Math.round(Number(v)).toLocaleString()}`, 'blocked']} />
                <Line type="monotone" dataKey="blocked" stroke="var(--color-gold)" strokeWidth={2.5} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Top risky entities */}
        <div style={{ ...panel, marginBottom: 40 }}>
          <div className="eyebrow" style={{ marginBottom: 16 }} title="Accounts with the most non-safe alerts.">Top risky entities</div>
          {topEntities.length === 0 ? (
            <p style={{ color: 'var(--color-ink-faint)', fontSize: 13 }}>No flagged entities yet.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {topEntities.map((e, i) => (
                <div key={e.entity} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '10px 14px', borderRadius: 12, background: 'var(--color-surface-2)', border: '1px solid var(--color-line)' }}>
                  <span className="data" style={{ width: 22, color: 'var(--color-ink-faint)', fontSize: 13 }}>{i + 1}</span>
                  <span className="data" style={{ flex: 1, fontSize: 13, color: 'var(--color-ink)' }}>{e.entity}</span>
                  <span className="badge badge-alert" style={{ fontSize: 11 }}>{e.flags} flags</span>
                  <span className="data" style={{ width: 70, textAlign: 'right', fontSize: 12, color: 'var(--color-ink-soft)' }}>max {(e.max_score * 100).toFixed(0)}%</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <style jsx>{`
        @media (max-width: 980px) {
          .kpi-grid { grid-template-columns: repeat(2, 1fr) !important; }
          .chart-grid { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </div>
  );
}
