'use client';
import { useEffect, useState, useCallback } from 'react';
import PageShell, { PageHeading } from '@/components/site/PageShell';
import { Skeleton, StatTile } from '@/components/ui';
import { apiFetch } from '@/lib/api';

interface Ring { id: string; entities: string[]; size: number; flags: number; fraud: number; risk: number }
interface NodeT { id: string; flags: number; fraud: number; max_score: number; ring: string | null }
interface RingData { rings: Ring[]; nodes: NodeT[]; entity_count: number }

const RING_COLORS = ['#c084fc', '#f472b6', '#fb923c', '#60a5fa', '#34d399', '#fbbf24', '#f87171', '#a78bfa'];

/** Deterministic radial layout of a ring's entities around a hub. */
function RingGraph({ ring, color }: { ring: Ring; color: string }) {
  const cx = 150, cy = 95, R = 66;
  const members = ring.entities.slice(0, 10);
  const pts = members.map((e, i) => {
    const a = (i / members.length) * Math.PI * 2 - Math.PI / 2;
    return { x: cx + Math.cos(a) * R, y: cy + Math.sin(a) * R, label: e };
  });
  return (
    <svg viewBox="0 0 300 190" style={{ width: '100%', height: 175, background: 'var(--color-surface-2)', borderRadius: 16, border: '1px solid var(--color-line)' }}>
      {pts.map((p, i) => (
        <line key={`l${i}`} x1={cx} y1={cy} x2={p.x} y2={p.y} stroke={color} strokeWidth={1.4} strokeOpacity={0.45} />
      ))}
      {pts.map((p, i) => (
        <g key={`n${i}`}>
          <circle cx={p.x} cy={p.y} r={8} fill={color} fillOpacity={0.85} />
          <text x={p.x} y={p.y - 12} fontSize={8} fill="var(--color-ink-faint)" textAnchor="middle" style={{ fontFamily: 'var(--font-mono)' }}>
            {p.label.replace('acct_', '').slice(0, 10)}
          </text>
        </g>
      ))}
      <circle cx={cx} cy={cy} r={15} fill={color} />
      <text x={cx} y={cy + 4} fontSize={11} fill="#fff" textAnchor="middle" fontWeight={700}>{ring.size}</text>
      <text x={cx} y={cy + 32} fontSize={9} fill="var(--color-ink)" textAnchor="middle" style={{ fontFamily: 'var(--font-mono)' }}>ring</text>
    </svg>
  );
}

export default function NetworkPage() {
  const [data, setData] = useState<RingData | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await apiFetch('/v1/network/rings?min_cluster=2', { role: 'viewer' });
      if (res.ok) setData(await res.json());
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  const rings = data?.rings ?? [];
  const ringedEntities = rings.reduce((n, r) => n + r.size, 0);

  return (
    <PageShell maxWidth={1100}>
      <PageHeading
        eyebrow="Link analysis"
        title="Fraud rings"
        subtitle="Connected-component analysis over flagged entities that share a device-shift signature — surfacing coordinated rings that look benign one transaction at a time."
      />

      {loading ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 16 }}>
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} height={260} radius={24} />)}
        </div>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 24 }} className="kpi-grid">
            <div style={panel}><StatTile value={data?.entity_count ?? 0} label="Flagged entities" /></div>
            <div style={panel}><StatTile value={rings.length} label="Rings detected" accent="var(--color-violet)" /></div>
            <div style={panel}><StatTile value={ringedEntities} label="Entities in rings" accent="var(--color-warn)" /></div>
            <div style={panel}><StatTile value={rings.reduce((n, r) => n + r.fraud, 0)} label="Fraud in rings" accent="var(--color-alert)" /></div>
          </div>

          {rings.length === 0 ? (
            <div className="lux-card" style={{ padding: 40, textAlign: 'center', color: 'var(--color-ink-soft)' }}>
              No multi-entity rings detected in the current alert window.
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(330px, 1fr))', gap: 16 }}>
              {rings.map((r, i) => {
                const color = RING_COLORS[i % RING_COLORS.length];
                return (
                  <div key={r.id} className="lux-card" style={{ padding: 18 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontWeight: 600, fontSize: 15 }}>
                        <span style={{ width: 10, height: 10, borderRadius: 999, background: color }} /> Ring #{i + 1}
                      </span>
                      <span className="badge badge-alert" style={{ fontSize: 10 }}>risk {(r.risk * 100).toFixed(0)}%</span>
                    </div>
                    <RingGraph ring={r} color={color} />
                    <div style={{ display: 'flex', gap: 16, marginTop: 12, fontSize: 12, color: 'var(--color-ink-soft)' }}>
                      <span><b style={{ color: 'var(--color-ink)' }}>{r.size}</b> entities</span>
                      <span><b style={{ color: 'var(--color-ink)' }}>{r.flags}</b> flags</span>
                      <span><b style={{ color: 'var(--color-alert)' }}>{r.fraud}</b> fraud</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      <style jsx>{`
        @media (max-width: 980px) { .kpi-grid { grid-template-columns: repeat(2, 1fr) !important; } }
      `}</style>
    </PageShell>
  );
}

const panel: React.CSSProperties = {
  background: 'var(--color-surface)', border: '1px solid var(--color-line)', borderRadius: 24, padding: 20, boxShadow: 'var(--shadow-sm)',
};
