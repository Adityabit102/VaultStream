'use client';
/**
 * Knowledge-graph fraud rings — the view per-transaction scoring can't produce.
 *
 * Reads the additive `GET /graph/fraud-rings` endpoint. Every other page is
 * untouched; this one shares only PageShell and the existing design tokens.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import type { ForceGraphMethods, NodeObject, LinkObject } from 'react-force-graph-2d';
import PageShell, { PageHeading } from '@/components/site/PageShell';
import { Card, Badge, StatTile, Skeleton } from '@/components/ui';
import { apiFetch } from '@/lib/api';

// force-graph touches window/canvas on import, so it can never be server-rendered.
const ForceGraph2D = dynamic(() => import('react-force-graph-2d'), {
  ssr: false,
  loading: () => <Skeleton height={520} />,
});

/* ------------------------------- types ------------------------------- */
interface RingEdge { source: string; target: string; shared: number; kinds: string[] }
interface Identifier { id: string; kind: string; label: string; accounts: number; members: string[] }
interface Ring {
  id: string;
  size: number;
  accounts: string[];
  edges: RingEdge[];
  identifiers: Identifier[];
  shared_kinds: Record<string, number>;
  risk_score: number;
  peak_risk: number;
  transactions: number;
  fraud_transactions: number;
  total_amount: number;
}
interface Payload {
  source: 'live' | 'snapshot';
  generated_at: string | null;
  params: Record<string, number>;
  stats: Record<string, number>;
  rings: Ring[];
}

interface GNode { id: string; kind: string; label: string; risk: number; val: number; accounts?: number }
interface GLink { source: string; target: string; kind: string; shared: number }

/* ------------------------------- style ------------------------------- */
const KIND_COLOR: Record<string, string> = {
  Account: '#8aa176',   // sage — the entity under investigation
  Device: '#c0714f',    // terracotta — strongest ring signal
  Card: '#c79a52',      // amber
  Address: '#7d9bb0',   // stone blue
};

const riskColor = (r: number) =>
  r >= 0.5 ? 'var(--color-alert)' : r >= 0.15 ? 'var(--color-warn)' : 'var(--color-safe)';

const riskLabel = (r: number) => (r >= 0.5 ? 'HIGH' : r >= 0.15 ? 'ELEVATED' : 'LOW');

const money = (n: number) =>
  n >= 1000 ? `$${(n / 1000).toFixed(1)}k` : `$${n.toFixed(0)}`;

/* --------------------------- graph rendering -------------------------- */
function RingGraph({ ring }: { ring: Ring }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const fgRef = useRef<ForceGraphMethods<NodeObject, LinkObject> | undefined>(undefined);
  const [width, setWidth] = useState(680);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Accounts plus the identifiers binding them: a bipartite core with the
  // account-to-account links drawn on top, so shared hardware reads as a hub.
  const data = useMemo(() => {
    const nodes: GNode[] = ring.accounts.map((id) => ({
      id,
      kind: 'Account',
      label: id.replace('acct_', ''),
      risk: ring.risk_score,
      val: 6,
    }));
    const links: GLink[] = [];

    for (const ident of ring.identifiers) {
      nodes.push({
        id: ident.id,
        kind: ident.kind,
        label: ident.label,
        risk: 0,
        val: 4,
        accounts: ident.accounts,
      });
      for (const member of ident.members) {
        if (ring.accounts.includes(member)) {
          links.push({ source: member, target: ident.id, kind: ident.kind, shared: 1 });
        }
      }
    }
    for (const e of ring.edges) {
      links.push({ source: e.source, target: e.target, kind: 'Shared', shared: e.shared });
    }
    return { nodes, links };
  }, [ring]);

  // Push the nodes apart: at default strength a ring of 4-8 nodes collapses into
  // an unreadable knot in the middle of the canvas.
  useEffect(() => {
    const fg = fgRef.current;
    if (!fg) return;
    fg.d3Force('charge')?.strength?.(-320);
    fg.d3Force('link')?.distance?.(80);
  }, [ring]);

  return (
    <div
      ref={wrapRef}
      style={{
        borderRadius: 18,
        border: '1px solid var(--color-line)',
        background: 'var(--color-surface-2)',
        overflow: 'hidden',
      }}
    >
      <ForceGraph2D
        ref={fgRef}
        graphData={data}
        width={width}
        height={520}
        backgroundColor="rgba(0,0,0,0)"
        cooldownTicks={90}
        d3VelocityDecay={0.32}
        nodeRelSize={5}
        onEngineStop={() => fgRef.current?.zoomToFit(450, 70)}
        linkWidth={(l: object) => ((l as GLink).kind === 'Shared' ? 2.2 : 1)}
        linkColor={(l: object) =>
          (l as GLink).kind === 'Shared' ? 'rgba(192,113,79,0.45)' : 'rgba(47,55,42,0.16)'
        }
        nodeCanvasObject={(node: object, ctx: CanvasRenderingContext2D, scale: number) => {
          const n = node as GNode & { x: number; y: number };
          const isAccount = n.kind === 'Account';
          const r = isAccount ? 7 : 5.5;
          ctx.beginPath();
          ctx.arc(n.x, n.y, r, 0, 2 * Math.PI);
          ctx.fillStyle = KIND_COLOR[n.kind] ?? '#969b8c';
          ctx.fill();
          if (isAccount) {
            ctx.lineWidth = 1.6;
            ctx.strokeStyle = 'rgba(255,255,255,0.85)';
            ctx.stroke();
          }

          // Divide by the zoom scale so text keeps a constant on-screen size —
          // without this the labels balloon and overlap once zoomToFit runs.
          const fontSize = (isAccount ? 11 : 9.5) / scale;
          const max = isAccount ? 18 : 22;
          const text = n.label.length > max ? `${n.label.slice(0, max - 1)}…` : n.label;
          ctx.font = `${isAccount ? 600 : 400} ${fontSize}px ui-monospace, monospace`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'top';

          // Halo, so labels stay legible where they cross links or each other.
          ctx.lineWidth = 3 / scale;
          ctx.strokeStyle = 'rgba(247,244,236,0.9)';
          ctx.strokeText(text, n.x, n.y + r + 3 / scale);
          ctx.fillStyle = isAccount ? '#2f372a' : '#5f6657';
          ctx.fillText(text, n.x, n.y + r + 3 / scale);
        }}
        nodePointerAreaPaint={(node: object, color: string, ctx: CanvasRenderingContext2D) => {
          const n = node as GNode & { x: number; y: number };
          ctx.fillStyle = color;
          ctx.beginPath();
          ctx.arc(n.x, n.y, 9, 0, 2 * Math.PI);
          ctx.fill();
        }}
        nodeLabel={(node: object) => {
          const n = node as GNode;
          return n.kind === 'Account'
            ? `Account ${n.label}`
            : `${n.kind}: ${n.label} — shared by ${n.accounts} accounts`;
        }}
      />
    </div>
  );
}

/* --------------------------------- page -------------------------------- */
export default function GraphPage() {
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await apiFetch('/graph/fraud-rings?limit=25', { role: 'viewer' });
      if (res.ok) {
        const body: Payload = await res.json();
        setData(body);
        setSelected(body.rings[0]?.id ?? null);
      }
    } catch {
      /* leave the empty state in place */
    }
    setLoading(false);
  }, []);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  const rings = data?.rings ?? [];
  const active = rings.find((r) => r.id === selected) ?? rings[0] ?? null;
  const accountsInRings = rings.reduce((n, r) => n + r.size, 0);

  return (
    <PageShell maxWidth={1240}>
      <PageHeading
        eyebrow="Knowledge graph"
        title="Fraud rings"
        subtitle="Coordinated accounts surfaced by graph traversal rather than per-transaction scoring. Accounts are linked when they share two or more identifiers spanning different kinds — a device and a card, say — then grouped with Weakly Connected Components and Louvain community detection."
        action={
          data && (
            <Badge tone={data.source === 'live' ? 'safe' : 'neutral'}>
              {data.source === 'live' ? 'live graph' : 'batch snapshot'}
            </Badge>
          )
        }
      />

      {loading ? (
        <Skeleton height={420} />
      ) : rings.length === 0 ? (
        <Card hover={false}>
          <h3 style={{ marginBottom: 8 }}>No rings detected</h3>
          <p style={{ color: 'var(--color-ink-soft)', fontSize: 14, lineHeight: 1.6 }}>
            The graph snapshot is empty. Run{' '}
            <code>python scripts/ingest_graph.py</code> in <code>backend/</code> with Neo4j
            running to build it.
          </p>
        </Card>
      ) : (
        <>
          <Card hover={false} style={{ marginBottom: 22 }}>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
                gap: 24,
              }}
            >
              <StatTile value={rings.length} label="Rings detected" />
              <StatTile value={accountsInRings} label="Accounts implicated" accent="var(--color-rose)" />
              <StatTile
                value={(data?.stats.accounts ?? 0).toLocaleString()}
                label="Accounts in graph"
                accent="var(--color-sky)"
              />
              <StatTile
                value={(data?.stats.shared_links ?? 0).toLocaleString()}
                label="Shared-identifier links"
                accent="var(--color-gold)"
              />
            </div>
          </Card>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'minmax(0, 320px) minmax(0, 1fr)',
              gap: 22,
              alignItems: 'start',
            }}
            className="graph-layout"
          >
            {/* ---- ring list ---- */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {rings.map((ring) => {
                const isActive = ring.id === active?.id;
                return (
                  <button
                    key={ring.id}
                    onClick={() => setSelected(ring.id)}
                    style={{
                      textAlign: 'left',
                      padding: '16px 18px',
                      borderRadius: 16,
                      cursor: 'pointer',
                      background: isActive ? 'var(--color-surface)' : 'transparent',
                      border: `1px solid ${isActive ? 'var(--color-line-strong)' : 'var(--color-line)'}`,
                      boxShadow: isActive ? '0 6px 20px rgba(47,55,42,0.07)' : 'none',
                      transition: 'background 160ms ease, border-color 160ms ease',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--color-ink-faint)' }}>
                        {ring.id}
                      </span>
                      <span
                        className="data"
                        style={{ fontSize: 13, fontWeight: 600, color: riskColor(ring.risk_score) }}
                      >
                        {(ring.risk_score * 100).toFixed(0)}%
                      </span>
                    </div>
                    <div style={{ marginTop: 8, fontSize: 14, fontWeight: 600, color: 'var(--color-ink)' }}>
                      {ring.size} accounts · {riskLabel(ring.risk_score)} risk
                    </div>
                    <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {Object.entries(ring.shared_kinds).map(([kind, n]) => (
                        <span
                          key={kind}
                          style={{
                            fontSize: 10,
                            letterSpacing: '0.08em',
                            textTransform: 'uppercase',
                            padding: '3px 8px',
                            borderRadius: 999,
                            color: KIND_COLOR[kind],
                            background: 'var(--color-surface-2)',
                            border: `1px solid ${KIND_COLOR[kind]}33`,
                          }}
                        >
                          {n}× {kind}
                        </span>
                      ))}
                    </div>
                  </button>
                );
              })}
            </div>

            {/* ---- selected ring ---- */}
            {active && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 18, minWidth: 0 }}>
                <RingGraph ring={active} />

                <Card hover={false}>
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
                      gap: 20,
                      marginBottom: 22,
                    }}
                  >
                    <StatTile
                      value={`${(active.risk_score * 100).toFixed(0)}%`}
                      label="Ring risk"
                      accent={riskColor(active.risk_score)}
                      sub="mean of member XGBoost scores"
                    />
                    <StatTile value={active.transactions.toLocaleString()} label="Transactions" accent="var(--color-sky)" />
                    <StatTile
                      value={active.fraud_transactions.toLocaleString()}
                      label="Confirmed fraud"
                      accent="var(--color-alert)"
                      sub="labelled in the source data"
                    />
                    <StatTile value={money(active.total_amount)} label="Total value" accent="var(--color-gold)" />
                  </div>

                  <h3 style={{ fontSize: 14, marginBottom: 12 }}>Shared identifiers</h3>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {active.identifiers.map((ident) => (
                      <div
                        key={ident.id}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 12,
                          padding: '10px 14px',
                          borderRadius: 12,
                          background: 'var(--color-surface-2)',
                          border: '1px solid var(--color-line)',
                        }}
                      >
                        <span
                          style={{
                            width: 8,
                            height: 8,
                            borderRadius: 999,
                            background: KIND_COLOR[ident.kind],
                            flexShrink: 0,
                          }}
                        />
                        <span
                          style={{
                            fontSize: 10,
                            letterSpacing: '0.1em',
                            textTransform: 'uppercase',
                            color: 'var(--color-ink-faint)',
                            width: 62,
                            flexShrink: 0,
                          }}
                        >
                          {ident.kind}
                        </span>
                        <span
                          style={{
                            fontFamily: 'var(--font-mono)',
                            fontSize: 12,
                            color: 'var(--color-ink)',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {ident.label}
                        </span>
                        <span
                          style={{
                            marginLeft: 'auto',
                            fontSize: 12,
                            color: 'var(--color-ink-soft)',
                            flexShrink: 0,
                          }}
                        >
                          {ident.accounts} accounts
                        </span>
                      </div>
                    ))}
                  </div>
                </Card>
              </div>
            )}
          </div>

          <p
            style={{
              marginTop: 26,
              fontSize: 12,
              lineHeight: 1.7,
              color: 'var(--color-ink-faint)',
              maxWidth: 820,
            }}
          >
            IEEE-CIS ships no IP field, so identity here is device, card and address only — there
            is no IP-based clustering. An account is a derived pseudo-identity (card + billing
            address), not a column in the source data.
            {data?.generated_at && ` Snapshot generated ${new Date(data.generated_at).toLocaleString()}.`}
          </p>
        </>
      )}

      <style>{`
        @media (max-width: 900px) {
          .graph-layout { grid-template-columns: minmax(0, 1fr) !important; }
        }
      `}</style>
    </PageShell>
  );
}
