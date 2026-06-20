'use client';
import { useEffect, useState, useCallback, useRef } from 'react';
import { motion } from 'framer-motion';
import PageShell, { PageHeading } from '@/components/site/PageShell';
import { apiFetch } from '@/lib/api';

interface SimResult { risk_score: number; risk_label: string; threshold: number }

interface SliderDef { key: keyof Inputs; label: string; min: number; max: number; step: number; fmt?: (v: number) => string }
interface Inputs {
  amount: number; tx_count_5m: number; tx_count_1h: number; tx_count_24h: number;
  sum_amount_1h: number; device_shift: number;
}

const SLIDERS: SliderDef[] = [
  { key: 'amount', label: 'Transaction amount', min: 1, max: 12000, step: 10, fmt: (v) => `$${v.toLocaleString()}` },
  { key: 'sum_amount_1h', label: 'Spend in last 1h', min: 0, max: 20000, step: 50, fmt: (v) => `$${v.toLocaleString()}` },
  { key: 'tx_count_5m', label: 'Tx count · 5m', min: 0, max: 30, step: 1 },
  { key: 'tx_count_1h', label: 'Tx count · 1h', min: 0, max: 80, step: 1 },
  { key: 'tx_count_24h', label: 'Tx count · 24h', min: 0, max: 200, step: 1 },
];

const PRESETS: { name: string; values: Inputs }[] = [
  { name: 'Typical purchase', values: { amount: 80, sum_amount_1h: 120, tx_count_5m: 1, tx_count_1h: 2, tx_count_24h: 6, device_shift: 0 } },
  { name: 'Velocity burst', values: { amount: 600, sum_amount_1h: 5200, tx_count_5m: 11, tx_count_1h: 34, tx_count_24h: 70, device_shift: 0 } },
  { name: 'Account takeover', values: { amount: 7200, sum_amount_1h: 7200, tx_count_5m: 2, tx_count_1h: 4, tx_count_24h: 9, device_shift: 1 } },
];

const toneFor = (label: string) => (label === 'FRAUD' ? 'alert' : label === 'SUSPICIOUS' ? 'warn' : 'safe');

export default function SimulatorPage() {
  const [inputs, setInputs] = useState<Inputs>(PRESETS[0].values);
  const [result, setResult] = useState<SimResult | null>(null);
  const [loading, setLoading] = useState(false);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const run = useCallback(async (payload: Inputs) => {
    setLoading(true);
    try {
      const res = await apiFetch('/v1/simulate', {
        role: 'viewer', method: 'POST',
        body: JSON.stringify({ ...payload, entity_id: 'sim-entity' }),
      });
      if (res.ok) setResult(await res.json());
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => run(inputs), 180);
    return () => { if (debounce.current) clearTimeout(debounce.current); };
  }, [inputs, run]);

  const set = (key: keyof Inputs, value: number) => setInputs((p) => ({ ...p, [key]: value }));

  const tone = result ? toneFor(result.risk_label) : 'safe';
  const accent = tone === 'alert' ? 'var(--color-alert)' : tone === 'warn' ? 'var(--color-warn)' : 'var(--color-safe)';
  const pct = result ? Math.round(result.risk_score * 100) : 0;

  return (
    <PageShell maxWidth={1000}>
      <PageHeading
        eyebrow="What-if analysis"
        title="Scenario simulator"
        subtitle="Dial a hypothetical transaction's behaviour and watch the live model's verdict move in real time. Stateless — nothing here is scored, stored or streamed to the workspace."
      />

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 360px', gap: 20 }} className="sim-grid">
        {/* Controls */}
        <div className="lux-card" style={{ padding: 26 }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 22 }}>
            {PRESETS.map((p) => (
              <button key={p.name} onClick={() => setInputs(p.values)} className="btn btn-ghost" style={{ fontSize: 12, padding: '7px 14px' }}>
                {p.name}
              </button>
            ))}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
            {SLIDERS.map((s) => (
              <div key={s.key}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                  <span style={{ fontSize: 13, color: 'var(--color-ink-soft)' }}>{s.label}</span>
                  <span className="data" style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-ink)' }}>
                    {s.fmt ? s.fmt(inputs[s.key]) : inputs[s.key]}
                  </span>
                </div>
                <input
                  type="range" min={s.min} max={s.max} step={s.step} value={inputs[s.key]}
                  onChange={(e) => set(s.key, parseFloat(e.target.value))}
                  style={{ width: '100%', accentColor: accent }}
                />
              </div>
            ))}

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: 4 }}>
              <span style={{ fontSize: 13, color: 'var(--color-ink-soft)' }}>Device location shift</span>
              <button
                onClick={() => set('device_shift', inputs.device_shift ? 0 : 1)}
                style={{ width: 46, height: 26, borderRadius: 999, border: 'none', cursor: 'pointer', padding: 3, position: 'relative', background: inputs.device_shift ? 'var(--color-alert)' : 'var(--color-line-strong)', transition: 'background 0.2s' }}
              >
                <motion.span animate={{ x: inputs.device_shift ? 20 : 0 }} transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                  style={{ display: 'block', width: 20, height: 20, borderRadius: 999, background: '#fff' }} />
              </button>
            </div>
          </div>
        </div>

        {/* Live verdict */}
        <div className="lux-card" style={{ padding: 26, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', position: 'sticky', top: 90, height: 'fit-content' }}>
          <div className="eyebrow" style={{ marginBottom: 18 }}>Live model verdict</div>
          <Gauge pct={pct} accent={accent} loading={loading} />
          <motion.div key={result?.risk_label} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
            <span className={`badge badge-${tone}`} style={{ fontSize: 14, padding: '8px 18px', marginTop: 22, display: 'inline-block' }}>
              {result?.risk_label ?? '—'}
            </span>
          </motion.div>
          {result && (
            <p style={{ fontSize: 12, color: 'var(--color-ink-faint)', marginTop: 16, lineHeight: 1.5 }}>
              Decision threshold {(result.threshold * 100).toFixed(0)}%. A score at or above flags FRAUD;
              half-threshold flags SUSPICIOUS.
            </p>
          )}
        </div>
      </div>

      <style jsx>{`
        @media (max-width: 860px) { .sim-grid { grid-template-columns: 1fr !important; } }
      `}</style>
    </PageShell>
  );
}

function Gauge({ pct, accent, loading }: { pct: number; accent: string; loading: boolean }) {
  const r = 80;
  const circ = 2 * Math.PI * r;
  const dash = (pct / 100) * circ;
  return (
    <div style={{ position: 'relative', width: 200, height: 200 }}>
      <svg viewBox="0 0 200 200" style={{ transform: 'rotate(-90deg)' }}>
        <circle cx="100" cy="100" r={r} fill="none" stroke="var(--color-surface-2)" strokeWidth="14" />
        <motion.circle
          cx="100" cy="100" r={r} fill="none" stroke={accent} strokeWidth="14" strokeLinecap="round"
          strokeDasharray={circ}
          animate={{ strokeDashoffset: circ - dash }}
          transition={{ type: 'spring', stiffness: 90, damping: 18 }}
        />
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center' }}>
        <div>
          <div className="data" style={{ fontSize: 44, fontWeight: 600, color: accent, lineHeight: 1, opacity: loading ? 0.5 : 1, transition: 'opacity 0.15s' }}>{pct}%</div>
          <div className="eyebrow" style={{ fontSize: 9, marginTop: 6 }}>risk score</div>
        </div>
      </div>
    </div>
  );
}
