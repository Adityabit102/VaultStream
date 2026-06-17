'use client';
import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

/**
 * LiveFilterStream — a showcase of the model filtering a live transaction
 * stream into SAFE / SUSPICIOUS / FRAUD lanes. Runs entirely client-side
 * (mock mode) so it streams forever without a backend; the model selector
 * shifts the score distribution to illustrate how different models behave.
 */

type Verdict = 'SAFE' | 'SUSPICIOUS' | 'FRAUD';
const LANES: { key: Verdict; tone: string; soft: string; label: string }[] = [
  { key: 'SAFE', tone: 'var(--color-safe)', soft: 'var(--color-safe-soft)', label: 'Safe' },
  { key: 'SUSPICIOUS', tone: 'var(--color-warn)', soft: 'var(--color-warn-soft)', label: 'Suspicious' },
  { key: 'FRAUD', tone: 'var(--color-alert)', soft: 'var(--color-alert-soft)', label: 'Fraud' },
];

const MODELS = [
  { id: 'xgboost', label: 'XGBoost', fraud: 0.18, sus: 0.22 },
  { id: 'random_forest', label: 'Random Forest', fraud: 0.16, sus: 0.26 },
  { id: 'logistic_regression', label: 'Logistic Regression', fraud: 0.2, sus: 0.3 },
  { id: 'isolation_forest', label: 'Isolation Forest', fraud: 0.24, sus: 0.2 },
];

interface Txn {
  id: string;
  user: string;
  amount: number;
  score: number;
  verdict: Verdict;
}

let counter = 0;

export default function LiveFilterStream() {
  const [modelId, setModelId] = useState('xgboost');
  const [scanning, setScanning] = useState<Txn | null>(null);
  const [lanes, setLanes] = useState<Record<Verdict, Txn[]>>({ SAFE: [], SUSPICIOUS: [], FRAUD: [] });
  const [counts, setCounts] = useState<Record<Verdict, number>>({ SAFE: 0, SUSPICIOUS: 0, FRAUD: 0 });
  const [total, setTotal] = useState(0);

  const makeTxn = useCallback((): Txn => {
    const m = MODELS.find((x) => x.id === modelId) ?? MODELS[0];
    const r = Math.random();
    let verdict: Verdict;
    let score: number;
    if (r < m.fraud) {
      verdict = 'FRAUD';
      score = 0.62 + Math.random() * 0.36;
    } else if (r < m.fraud + m.sus) {
      verdict = 'SUSPICIOUS';
      score = 0.32 + Math.random() * 0.28;
    } else {
      verdict = 'SAFE';
      score = Math.random() * 0.28;
    }
    counter += 1;
    return {
      id: `t${counter}`,
      user: `user_${Math.floor(Math.random() * 9000 + 1000)}`,
      amount: verdict === 'FRAUD' ? Math.random() * 8000 + 1500 : verdict === 'SUSPICIOUS' ? Math.random() * 800 + 120 : Math.random() * 110 + 6,
      score,
      verdict,
    };
  }, [modelId]);

  useEffect(() => {
    let alive = true;
    let scanTimer: ReturnType<typeof setTimeout>;
    const tick = () => {
      if (!alive) return;
      const txn = makeTxn();
      setScanning(txn);
      scanTimer = setTimeout(() => {
        if (!alive) return;
        setScanning(null);
        setLanes((prev) => ({ ...prev, [txn.verdict]: [txn, ...prev[txn.verdict]].slice(0, 4) }));
        setCounts((prev) => ({ ...prev, [txn.verdict]: prev[txn.verdict] + 1 }));
        setTotal((t) => t + 1);
      }, 760);
    };
    tick();
    const loop = setInterval(tick, 1500);
    return () => {
      alive = false;
      clearInterval(loop);
      clearTimeout(scanTimer);
    };
  }, [makeTxn]);

  const accent = 'var(--color-violet)';

  return (
    <div className="lux-card" style={{ padding: 28 }}>
      {/* Header + model selector */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, flexWrap: 'wrap', marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ width: 9, height: 9, borderRadius: 999, background: 'var(--color-safe)', animation: 'pulseSoft 1.6s infinite' }} />
          <span className="eyebrow">Live · {total.toLocaleString()} scored</span>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {MODELS.map((m) => (
            <button
              key={m.id}
              onClick={() => setModelId(m.id)}
              style={{
                padding: '7px 13px',
                borderRadius: 999,
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
                border: '1px solid',
                borderColor: modelId === m.id ? 'transparent' : 'var(--color-line)',
                background: modelId === m.id ? 'var(--grad-violet-rose)' : 'var(--color-surface)',
                color: modelId === m.id ? '#fff' : 'var(--color-ink-soft)',
              }}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '180px 1fr', gap: 20, alignItems: 'stretch' }} className="lfs-grid">
        {/* Scanner */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14, background: 'var(--color-surface-2)', border: '1px solid var(--color-line)', borderRadius: 18, padding: 18, position: 'relative', overflow: 'hidden' }}>
          <div className="eyebrow" style={{ fontSize: 9 }}>Model</div>
          <motion.div
            animate={{ scale: scanning ? [1, 1.08, 1] : 1 }}
            transition={{ duration: 0.76 }}
            style={{ width: 64, height: 64, borderRadius: 20, background: 'var(--grad-violet-rose)', display: 'grid', placeItems: 'center', color: '#fff', boxShadow: 'var(--shadow-glow)' }}
          >
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2v4M12 18v4M2 12h4M18 12h4M5 5l2.5 2.5M16.5 16.5L19 19M19 5l-2.5 2.5M7.5 16.5L5 19" strokeLinecap="round"/><circle cx="12" cy="12" r="3.2"/></svg>
          </motion.div>
          <div className="data" style={{ fontSize: 12, textAlign: 'center', color: 'var(--color-ink-soft)' }}>
            {MODELS.find((m) => m.id === modelId)?.label}
          </div>
          <div style={{ minHeight: 46, width: '100%', display: 'grid', placeItems: 'center' }}>
            <AnimatePresence mode="wait">
              {scanning && (
                <motion.div
                  key={scanning.id}
                  initial={{ opacity: 0, y: 8, scale: 0.9 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.85 }}
                  transition={{ duration: 0.25 }}
                  className="data"
                  style={{ fontSize: 11, padding: '6px 10px', borderRadius: 10, background: 'var(--color-surface)', border: '1px solid var(--color-line)', textAlign: 'center', width: '100%' }}
                >
                  scanning {scanning.user}<br />
                  <span style={{ color: accent }}>${scanning.amount.toFixed(2)}</span>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* Lanes */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }} className="lfs-lanes">
          {LANES.map((lane) => (
            <div key={lane.key} style={{ background: lane.soft, border: `1px solid ${lane.tone}`, borderRadius: 18, padding: 14, display: 'flex', flexDirection: 'column', minHeight: 230 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <span style={{ fontWeight: 700, fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.06em', color: lane.tone }}>{lane.label}</span>
                <motion.span key={counts[lane.key]} initial={{ scale: 1.3 }} animate={{ scale: 1 }} className="data" style={{ fontSize: 18, fontWeight: 700, color: lane.tone }}>
                  {counts[lane.key]}
                </motion.span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <AnimatePresence initial={false}>
                  {lanes[lane.key].map((t) => (
                    <motion.div
                      key={t.id}
                      layout
                      initial={{ opacity: 0, x: -16, scale: 0.95 }}
                      animate={{ opacity: 1, x: 0, scale: 1 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
                      style={{ background: 'var(--color-surface)', borderRadius: 10, padding: '8px 10px', boxShadow: 'var(--shadow-sm)' }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span className="data" style={{ fontSize: 11, color: 'var(--color-ink-soft)' }}>{t.user}</span>
                        <span className="data" style={{ fontSize: 11, fontWeight: 700, color: lane.tone }}>{(t.score * 100).toFixed(0)}%</span>
                      </div>
                      <div className="data" style={{ fontSize: 12, fontWeight: 600 }}>${t.amount.toFixed(2)}</div>
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            </div>
          ))}
        </div>
      </div>

      <style jsx>{`
        @media (max-width: 720px) {
          .lfs-grid { grid-template-columns: 1fr !important; }
          .lfs-lanes { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </div>
  );
}
