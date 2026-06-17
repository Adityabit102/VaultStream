'use client';
import { useEffect, useState, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import WorkspaceHeader from '@/components/site/WorkspaceHeader';
import AppBackground from '@/components/site/AppBackground';
import { Badge } from '@/components/ui';
import dynamic from 'next/dynamic';
const HeaderAccent = dynamic(() => import('@/components/three/HeaderAccent'), { ssr: false, loading: () => null });
import { useRole } from '@/components/RoleProvider';
import { apiUrl, getToken } from '@/lib/api';

interface HP { label: string; default: number; min: number; max: number; step: number }
interface Algo { id: string; label: string; blurb: string; hyperparams: Record<string, HP> }
interface RunResult {
  run_id: string;
  algorithm: string;
  algorithm_label: string;
  sample_size: number;
  trained_at: string;
  train_time_s: number;
  threshold: number;
  metrics: { auc: number; accuracy: number; precision: number; recall: number; f1: number; fpr: number };
  confusion_matrix: number[][];
  roc_points: { fpr: number; tpr: number }[];
  val_samples?: { s: number; y: number }[];
  feature_importance: { feature: string; importance: number }[];
  champion?: boolean;
}

const ACCENTS: Record<string, string> = {
  xgboost: 'var(--color-violet)',
  random_forest: 'var(--color-mint)',
  logistic_regression: 'var(--color-sky)',
  isolation_forest: 'var(--color-gold)',
};

export default function ModelLabPage() {
  const router = useRouter();
  const { isAdmin, loading: roleLoading } = useRole();

  const [algos, setAlgos] = useState<Algo[]>([]);
  const [selected, setSelected] = useState<string>('xgboost');
  const [hp, setHp] = useState<Record<string, number>>({});
  const [sampleSize, setSampleSize] = useState(8000);

  const [training, setTraining] = useState(false);
  const [progress, setProgress] = useState(0);
  const [stage, setStage] = useState('');
  const [result, setResult] = useState<RunResult | null>(null);
  const [runs, setRuns] = useState<RunResult[]>([]);
  const [drift, setDrift] = useState<{ overall_psi: number; overall_status: string; features: { feature: string; psi: number; status: string }[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const [log, setLog] = useState<string[]>([]);

  useEffect(() => {
    if (roleLoading) return;
    if (!isAdmin) router.push('/');
  }, [roleLoading, isAdmin, router]);

  const loadRuns = useCallback(async () => {
    const token = await getToken('admin');
    const res = await fetch(apiUrl('/v1/lab/runs'), { headers: { Authorization: `Bearer ${token}` } });
    if (res.ok) setRuns((await res.json()).runs);
  }, []);

  useEffect(() => {
    if (!isAdmin) return;
    (async () => {
      const token = await getToken('admin');
      const res = await fetch(apiUrl('/v1/lab/algorithms'), { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) {
        const data = await res.json();
        setAlgos(data.algorithms);
      }
      loadRuns();
      const dres = await fetch(apiUrl('/v1/analytics/drift'), { headers: { Authorization: `Bearer ${token}` } });
      if (dres.ok) setDrift(await dres.json());
    })();
  }, [isAdmin, loadRuns]);

  // Reset hyperparams to defaults when the algorithm (or loaded schema) changes.
  // Intentional derived-state sync from external props.
  useEffect(() => {
    const a = algos.find((x) => x.id === selected);
    if (a) {
      const defaults: Record<string, number> = {};
      Object.entries(a.hyperparams).forEach(([k, v]) => (defaults[k] = v.default));
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setHp(defaults);
    }
  }, [selected, algos]);

  const currentAlgo = algos.find((a) => a.id === selected);

  const train = async () => {
    setTraining(true);
    setProgress(0);
    setStage('Starting…');
    setResult(null);
    setError(null);
    setLog([]);
    try {
      const token = await getToken('admin');
      const res = await fetch(apiUrl('/v1/lab/train'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ algorithm: selected, sample_size: sampleSize, hyperparams: hp }),
      });
      if (!res.body) throw new Error('No response stream');
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split('\n\n');
        buffer = parts.pop() || '';
        for (const part of parts) {
          const line = part.split('\n').find((l) => l.startsWith('data:'));
          if (!line) continue;
          const evt = JSON.parse(line.slice(5).trim());
          if (evt.type === 'progress') {
            setProgress(evt.pct);
            setStage(evt.stage);
            setLog((prev) => [...prev, `${evt.pct}% · ${evt.stage}`]);
          } else if (evt.type === 'result') {
            setResult(evt.result);
            setProgress(100);
            setStage('Complete');
          } else if (evt.type === 'error') {
            setError(evt.detail);
          }
        }
      }
      await loadRuns();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Training failed');
    } finally {
      setTraining(false);
    }
  };

  const promote = async (runId: string) => {
    const token = await getToken('admin');
    await fetch(apiUrl(`/v1/lab/promote/${runId}`), { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
    await loadRuns();
  };

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [log]);

  if (roleLoading) {
    return <div style={{ height: '100vh', display: 'grid', placeItems: 'center', color: 'var(--color-ink-soft)' }}><span className="data">Loading…</span></div>;
  }
  if (!isAdmin) return null;

  const accent = ACCENTS[selected] || 'var(--color-violet)';

  return (
    <div style={{ minHeight: '100vh', padding: 16 }}>
      <AppBackground />
      <WorkspaceHeader />
      <div style={{ maxWidth: 1180, margin: '32px auto 0', padding: '0 8px' }}>
        <div className="eyebrow" style={{ marginBottom: 12 }}>MLOps · model lab</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <HeaderAccent variant="crystal" color="#8aa176" />
          <h1 style={{ fontSize: 40, marginBottom: 10 }}>Train, compare & promote</h1>
        </div>
        <p style={{ color: 'var(--color-ink-soft)', marginBottom: 32, fontSize: 16, maxWidth: 640 }}>
          Train fraud classifiers on demand, watch metrics stream live, and promote the best run
          to production. Models train on a synthetic benchmark for instant iteration.
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: '380px 1fr', gap: 20 }} className="lab-grid">
          {/* ===== Config column ===== */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div className="lux-card" style={{ padding: 22 }}>
              <div className="eyebrow" style={{ marginBottom: 14 }}>Algorithm</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {algos.map((a) => (
                  <button
                    key={a.id}
                    onClick={() => setSelected(a.id)}
                    style={{
                      textAlign: 'left',
                      padding: '13px 15px',
                      borderRadius: 14,
                      cursor: 'pointer',
                      border: `1px solid ${selected === a.id ? ACCENTS[a.id] : 'var(--color-line)'}`,
                      background: selected === a.id ? 'var(--color-surface-2)' : 'var(--color-surface)',
                      boxShadow: selected === a.id ? 'var(--shadow-sm)' : 'none',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                      <span style={{ width: 10, height: 10, borderRadius: 999, background: ACCENTS[a.id] }} />
                      <span style={{ fontWeight: 600, fontSize: 14 }}>{a.label}</span>
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--color-ink-soft)', lineHeight: 1.4 }}>{a.blurb}</div>
                  </button>
                ))}
              </div>
            </div>

            <div className="lux-card" style={{ padding: 22 }}>
              <div className="eyebrow" style={{ marginBottom: 16 }}>Hyperparameters</div>
              <Slider label="Training samples" value={sampleSize} min={2000} max={30000} step={1000} onChange={setSampleSize} fmt={(v) => v.toLocaleString()} accent={accent} />
              {currentAlgo && Object.entries(currentAlgo.hyperparams).map(([k, def]) => (
                <Slider
                  key={k}
                  label={def.label}
                  value={hp[k] ?? def.default}
                  min={def.min}
                  max={def.max}
                  step={def.step}
                  onChange={(v) => setHp((p) => ({ ...p, [k]: v }))}
                  accent={accent}
                />
              ))}
              <button onClick={train} disabled={training} className="btn btn-primary" style={{ width: '100%', marginTop: 10 }}>
                {training ? `Training… ${progress}%` : 'Train model'}
              </button>
            </div>
          </div>

          {/* ===== Results column ===== */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* Progress */}
            <AnimatePresence>
              {(training || log.length > 0) && !result && (
                <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="lux-card" style={{ padding: 22 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
                    <span style={{ fontWeight: 600 }}>{stage}</span>
                    <span className="data" style={{ color: accent }}>{progress}%</span>
                  </div>
                  <div style={{ height: 8, background: 'var(--color-canvas-2)', borderRadius: 999, overflow: 'hidden' }}>
                    <motion.div animate={{ width: `${progress}%` }} style={{ height: '100%', background: 'var(--grad-violet-rose)', borderRadius: 999 }} />
                  </div>
                  <div ref={logRef} className="data" style={{ marginTop: 14, maxHeight: 120, overflowY: 'auto', fontSize: 12, color: 'var(--color-ink-faint)', display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {log.map((l, i) => <div key={i}>→ {l}</div>)}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {error && (
              <div className="lux-card" style={{ padding: 18, borderColor: 'var(--color-alert)', color: '#b23a54' }}>{error}</div>
            )}

            {/* Result */}
            {result && (
              <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div className="lux-card" style={{ padding: 24 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{ width: 12, height: 12, borderRadius: 999, background: accent }} />
                      <h3 style={{ fontSize: 22 }}>{result.algorithm_label}</h3>
                      <span className="data" style={{ fontSize: 12, color: 'var(--color-ink-faint)' }}>· {result.train_time_s}s · {result.sample_size.toLocaleString()} samples</span>
                    </div>
                    <button onClick={() => promote(result.run_id)} className="btn btn-gold" style={{ padding: '9px 18px', fontSize: 13 }}>
                      Promote to production
                    </button>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 12 }}>
                    {([['AUC', result.metrics.auc], ['Accuracy', result.metrics.accuracy], ['Precision', result.metrics.precision], ['Recall', result.metrics.recall], ['F1', result.metrics.f1], ['FPR', result.metrics.fpr]] as [string, number][]).map(([k, v]) => (
                      <div key={k} style={{ textAlign: 'center', background: 'var(--color-surface-2)', borderRadius: 14, padding: '14px 6px', border: '1px solid var(--color-line)' }}>
                        <div className="data" style={{ fontSize: 20, fontWeight: 600, color: accent }}>{v.toFixed(3)}</div>
                        <div className="eyebrow" style={{ fontSize: 9, marginTop: 4 }}>{k}</div>
                      </div>
                    ))}
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }} className="lab-charts">
                  {/* ROC */}
                  <div className="lux-card" style={{ padding: 22 }}>
                    <div className="eyebrow" style={{ marginBottom: 14 }}>ROC curve · AUC {result.metrics.auc}</div>
                    <div style={{ height: 220 }}>
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={result.roc_points} margin={{ top: 6, right: 10, bottom: 4, left: -18 }}>
                          <CartesianGrid strokeDasharray="4 4" stroke="var(--color-line)" />
                          <XAxis dataKey="fpr" type="number" domain={[0, 1]} stroke="var(--color-ink-faint)" tick={{ fontSize: 10, fill: 'var(--color-ink-faint)' }} />
                          <YAxis dataKey="tpr" type="number" domain={[0, 1]} stroke="var(--color-ink-faint)" tick={{ fontSize: 10, fill: 'var(--color-ink-faint)' }} />
                          <Tooltip contentStyle={{ borderRadius: 12, border: '1px solid var(--color-line)', fontSize: 12 }} />
                          <ReferenceLine segment={[{ x: 0, y: 0 }, { x: 1, y: 1 }]} stroke="var(--color-line-strong)" strokeDasharray="3 3" />
                          <Line type="monotone" dataKey="tpr" stroke={accent} strokeWidth={2.5} dot={false} />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  </div>

                  {/* Confusion matrix */}
                  <div className="lux-card" style={{ padding: 22 }}>
                    <div className="eyebrow" style={{ marginBottom: 14 }}>Confusion matrix</div>
                    <ConfusionMatrix cm={result.confusion_matrix} />
                  </div>
                </div>

                {/* Decision threshold tuner */}
                {result.val_samples && result.val_samples.length > 0 && (
                  <ThresholdTuner samples={result.val_samples} initial={result.threshold} accent={accent} />
                )}

                {/* Feature importance */}
                {result.feature_importance.length > 0 && (
                  <div className="lux-card" style={{ padding: 22 }}>
                    <div className="eyebrow" style={{ marginBottom: 16 }}>Feature importance</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                      {result.feature_importance.slice(0, 8).map((f) => (
                        <div key={f.feature} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                          <span className="data" style={{ width: 150, fontSize: 12, color: 'var(--color-ink-soft)' }}>{f.feature}</span>
                          <div style={{ flex: 1, height: 10, background: 'var(--color-canvas-2)', borderRadius: 999, overflow: 'hidden' }}>
                            <div style={{ width: `${f.importance * 100}%`, height: '100%', background: accent, borderRadius: 999 }} />
                          </div>
                          <span className="data" style={{ width: 48, fontSize: 12, textAlign: 'right', color: 'var(--color-ink-soft)' }}>{(f.importance * 100).toFixed(1)}%</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </motion.div>
            )}

            {/* Drift monitoring */}
            {drift && (
              <div className="lux-card" style={{ padding: 22 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                  <div className="eyebrow">Data drift · PSI</div>
                  {(() => {
                    const tone = drift.overall_status === 'stable' ? 'safe' : drift.overall_status === 'warning' ? 'warn' : 'alert';
                    return <span className={`badge badge-${tone}`}>{drift.overall_status} · {drift.overall_psi.toFixed(3)}</span>;
                  })()}
                </div>
                <p style={{ fontSize: 12, color: 'var(--color-ink-faint)', marginBottom: 14, lineHeight: 1.5 }}>
                  Population Stability Index between the older and recent halves of the live feature stream. PSI &lt; 0.1 stable · 0.1–0.25 warning · &gt; 0.25 drift.
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {drift.features.map((f) => {
                    const col = f.status === 'stable' ? 'var(--color-safe)' : f.status === 'warning' ? 'var(--color-warn)' : f.status === 'drift' ? 'var(--color-alert)' : 'var(--color-ink-faint)';
                    const pct = Math.min(100, (f.psi / 0.4) * 100);
                    return (
                      <div key={f.feature} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <span className="data" style={{ width: 130, fontSize: 12, color: 'var(--color-ink-soft)' }}>{f.feature}</span>
                        <div style={{ flex: 1, height: 8, background: 'var(--color-canvas-2)', borderRadius: 999, overflow: 'hidden' }}>
                          <div style={{ width: `${pct}%`, height: '100%', background: col, borderRadius: 999 }} />
                        </div>
                        <span className="data" style={{ width: 48, fontSize: 12, textAlign: 'right', color: col }}>{f.psi.toFixed(3)}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Run registry */}
            <div className="lux-card" style={{ padding: 22 }}>
              <div className="eyebrow" style={{ marginBottom: 14 }}>Run registry · {runs.length}</div>
              {runs.length === 0 ? (
                <p style={{ color: 'var(--color-ink-faint)', fontSize: 13 }}>No runs yet — train a model to populate the registry.</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {runs.map((r) => (
                    <div key={r.run_id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', borderRadius: 12, background: 'var(--color-surface-2)', border: `1px solid ${r.champion ? 'var(--color-gold)' : 'var(--color-line)'}` }}>
                      <span style={{ width: 8, height: 8, borderRadius: 999, background: ACCENTS[r.algorithm] || 'var(--color-violet)' }} />
                      <span style={{ fontWeight: 600, fontSize: 13, width: 150 }}>{r.algorithm_label}</span>
                      <span className="data" style={{ fontSize: 12, color: 'var(--color-ink-soft)' }}>AUC {r.metrics.auc}</span>
                      <span className="data" style={{ fontSize: 12, color: 'var(--color-ink-faint)' }}>F1 {r.metrics.f1}</span>
                      <span className="data" style={{ fontSize: 11, color: 'var(--color-ink-faint)', marginLeft: 'auto' }}>{r.run_id}</span>
                      {r.champion ? (
                        <Badge tone="warn">★ production</Badge>
                      ) : (
                        <button onClick={() => promote(r.run_id)} className="btn btn-ghost" style={{ padding: '6px 12px', fontSize: 11 }}>Promote</button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <style jsx>{`
        @media (max-width: 1000px) {
          .lab-grid { grid-template-columns: 1fr !important; }
          .lab-charts { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </div>
  );
}

function Slider({ label, value, min, max, step, onChange, accent, fmt }: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; accent: string; fmt?: (v: number) => string }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
        <span style={{ fontSize: 13, color: 'var(--color-ink-soft)' }}>{label}</span>
        <span className="data" style={{ fontSize: 13, fontWeight: 600, color: accent }}>{fmt ? fmt(value) : value}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        style={{ width: '100%', accentColor: accent }}
      />
    </div>
  );
}

function ThresholdTuner({ samples, initial, accent }: { samples: { s: number; y: number }[]; initial: number; accent: string }) {
  const [thr, setThr] = useState(initial);
  // Recompute confusion / precision / recall / FPR live from validation scores
  let tp = 0, fp = 0, tn = 0, fn = 0;
  for (const { s, y } of samples) {
    const pred = s >= thr ? 1 : 0;
    if (pred === 1 && y === 1) tp++;
    else if (pred === 1 && y === 0) fp++;
    else if (pred === 0 && y === 0) tn++;
    else fn++;
  }
  const precision = tp + fp ? tp / (tp + fp) : 0;
  const recall = tp + fn ? tp / (tp + fn) : 0;
  const fpr = fp + tn ? fp / (fp + tn) : 0;
  const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;

  const stats: [string, number, string][] = [
    ['Precision', precision, accent],
    ['Recall', recall, accent],
    ['F1', f1, accent],
    ['FPR', fpr, 'var(--color-alert)'],
  ];

  return (
    <div className="lux-card" style={{ padding: 22 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
        <div className="eyebrow">Decision threshold tuner</div>
        <span className="data" style={{ fontSize: 13, fontWeight: 600, color: accent }}>τ = {thr.toFixed(3)}</span>
      </div>
      <p style={{ fontSize: 12, color: 'var(--color-ink-faint)', marginBottom: 16, lineHeight: 1.5 }}>
        Drag to trade precision against recall — banks tune this to balance caught fraud against analyst alert volume. Recomputed live on the validation set.
      </p>
      <input type="range" min={0.02} max={0.98} step={0.01} value={thr} onChange={(e) => setThr(parseFloat(e.target.value))} style={{ width: '100%', accentColor: accent, marginBottom: 18 }} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
        {stats.map(([k, v, c]) => (
          <div key={k} style={{ textAlign: 'center', background: 'var(--color-surface-2)', borderRadius: 12, padding: '12px 6px', border: '1px solid var(--color-line)' }}>
            <div className="data" style={{ fontSize: 18, fontWeight: 600, color: c }}>{(v * 100).toFixed(1)}%</div>
            <div className="eyebrow" style={{ fontSize: 9, marginTop: 3 }}>{k}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ConfusionMatrix({ cm }: { cm: number[][] }) {
  const [[tn, fp], [fn, tp]] = cm;
  const cells = [
    { label: 'True Neg', value: tn, good: true },
    { label: 'False Pos', value: fp, good: false },
    { label: 'False Neg', value: fn, good: false },
    { label: 'True Pos', value: tp, good: true },
  ];
  const max = Math.max(tn, fp, fn, tp, 1);
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
      {cells.map((c) => (
        <div key={c.label} style={{ borderRadius: 14, padding: '16px 14px', textAlign: 'center', background: c.good ? 'var(--color-safe-soft)' : 'var(--color-alert-soft)', border: `1px solid ${c.good ? 'var(--color-safe)' : 'var(--color-alert)'}`, opacity: 0.5 + 0.5 * (c.value / max) }}>
          <div className="data" style={{ fontSize: 24, fontWeight: 600, color: c.good ? '#277a55' : '#b23a54' }}>{c.value}</div>
          <div className="eyebrow" style={{ fontSize: 9, marginTop: 4 }}>{c.label}</div>
        </div>
      ))}
    </div>
  );
}
