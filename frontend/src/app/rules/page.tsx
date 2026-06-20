'use client';
import { useEffect, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import PageShell, { PageHeading } from '@/components/site/PageShell';
import { Skeleton } from '@/components/ui';
import { useRole } from '@/components/RoleProvider';
import { apiFetch } from '@/lib/api';

interface Condition { field: string; op: string; value: number }
interface Rule { id: string; name: string; conditions: Condition[]; action: string; enabled: boolean }
interface BacktestResult {
  total_scanned: number; matched: number; match_rate: number; matched_fraud: number;
  matched_safe: number; confirmed_fraud: number; false_positive: number;
  precision_on_labelled: number | null;
  samples: { transaction_id: string; entity_id: string; risk_label: string; risk_score: number }[];
}

const FIELDS = ['amount', 'tx_count_5m', 'tx_count_1h', 'tx_count_24h', 'sum_amount_1h', 'device_shift', 'risk_score'];
const OPS = ['>', '>=', '<', '<=', '==', '!='];
const ACTIONS = ['flag', 'escalate'];

const FIELD_LABELS: Record<string, string> = {
  amount: 'Amount ($)',
  tx_count_5m: 'Tx count · 5m',
  tx_count_1h: 'Tx count · 1h',
  tx_count_24h: 'Tx count · 24h',
  sum_amount_1h: 'Sum amount · 1h',
  device_shift: 'Device shift (0/1)',
  risk_score: 'ML risk score (0–1)',
};

export default function RulesPage() {
  const { isAdmin } = useRole();
  const [rules, setRules] = useState<Rule[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  const [name, setName] = useState('');
  const [action, setAction] = useState('flag');
  const [conditions, setConditions] = useState<Condition[]>([{ field: 'amount', op: '>', value: 5000 }]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [backtest, setBacktest] = useState<BacktestResult | null>(null);
  const [backtesting, setBacktesting] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await apiFetch('/v1/rules', { role: 'viewer' });
      if (res.ok) setRules((await res.json()).rules || []);
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  const addCondition = () => setConditions((c) => [...c, { field: 'risk_score', op: '>=', value: 0.8 }]);
  const removeCondition = (i: number) => setConditions((c) => c.filter((_, idx) => idx !== i));
  const updateCondition = (i: number, patch: Partial<Condition>) =>
    setConditions((c) => c.map((cond, idx) => (idx === i ? { ...cond, ...patch } : cond)));

  const resetForm = () => {
    setName(''); setAction('flag'); setConditions([{ field: 'amount', op: '>', value: 5000 }]);
    setError(null); setCreating(false); setBacktest(null);
  };

  const submit = async () => {
    setError(null);
    if (!name.trim()) { setError('Give the rule a name.'); return; }
    setSaving(true);
    try {
      const res = await apiFetch('/v1/rules', {
        role: 'admin', method: 'POST',
        body: JSON.stringify({ name: name.trim(), action, conditions }),
      });
      if (!res.ok) { setError((await res.json()).detail || 'Failed to save rule.'); setSaving(false); return; }
      resetForm();
      await load();
    } catch { setError('Network error.'); }
    setSaving(false);
  };

  const runBacktest = async () => {
    setBacktesting(true);
    setBacktest(null);
    try {
      const res = await apiFetch('/v1/rules/backtest', {
        role: 'viewer', method: 'POST',
        body: JSON.stringify({ conditions }),
      });
      if (res.ok) setBacktest(await res.json());
      else setError((await res.json()).detail || 'Backtest failed.');
    } catch { setError('Network error.'); }
    setBacktesting(false);
  };

  const toggle = async (r: Rule) => {
    setRules((prev) => prev.map((x) => (x.id === r.id ? { ...x, enabled: !x.enabled } : x)));
    await apiFetch(`/v1/rules/${r.id}?enabled=${!r.enabled}`, { role: 'admin', method: 'PATCH' });
  };

  const remove = async (r: Rule) => {
    setRules((prev) => prev.filter((x) => x.id !== r.id));
    await apiFetch(`/v1/rules/${r.id}`, { role: 'admin', method: 'DELETE' });
  };

  return (
    <PageShell maxWidth={920}>
      <PageHeading
        eyebrow="Hybrid detection"
        title="Rules engine"
        subtitle="Deterministic rules run alongside the ML score on every transaction. An escalate rule lifts a transaction's verdict; flag rules annotate it. Conditions within a rule are combined with AND."
        action={isAdmin && !creating && (
          <button className="btn btn-primary" onClick={() => setCreating(true)} style={{ fontSize: 13 }}>+ New rule</button>
        )}
      />

      {isAdmin && (
        <AnimatePresence>
          {creating && (
            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
              className="lux-card" style={{ padding: 24, marginBottom: 24, overflow: 'hidden' }}>
              <h3 style={{ fontSize: 18, marginBottom: 18 }}>Create rule</h3>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 200px', gap: 14, marginBottom: 18 }}>
                <label>
                  <span className="eyebrow" style={{ display: 'block', marginBottom: 6, fontSize: 10 }}>Rule name</span>
                  <input value={name} onChange={(e) => setName(e.target.value)} placeholder="High-value device shift" style={inputStyle} />
                </label>
                <label>
                  <span className="eyebrow" style={{ display: 'block', marginBottom: 6, fontSize: 10 }}>Action</span>
                  <select value={action} onChange={(e) => setAction(e.target.value)} style={inputStyle}>
                    {ACTIONS.map((a) => <option key={a} value={a}>{a}</option>)}
                  </select>
                </label>
              </div>

              <span className="eyebrow" style={{ display: 'block', marginBottom: 8, fontSize: 10 }}>Conditions (all must match)</span>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {conditions.map((c, i) => (
                  <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 90px 130px 40px', gap: 8, alignItems: 'center' }}>
                    <select value={c.field} onChange={(e) => updateCondition(i, { field: e.target.value })} style={inputStyle}>
                      {FIELDS.map((f) => <option key={f} value={f}>{FIELD_LABELS[f]}</option>)}
                    </select>
                    <select value={c.op} onChange={(e) => updateCondition(i, { op: e.target.value })} style={{ ...inputStyle, fontFamily: 'var(--font-mono)' }}>
                      {OPS.map((o) => <option key={o} value={o}>{o}</option>)}
                    </select>
                    <input type="number" value={c.value} step="any" onChange={(e) => updateCondition(i, { value: parseFloat(e.target.value) })} style={{ ...inputStyle, fontFamily: 'var(--font-mono)' }} />
                    <button onClick={() => removeCondition(i)} disabled={conditions.length === 1}
                      style={{ ...iconBtn, opacity: conditions.length === 1 ? 0.3 : 1 }} title="Remove condition">×</button>
                  </div>
                ))}
              </div>
              <button onClick={addCondition} className="btn btn-ghost" style={{ fontSize: 12, padding: '8px 14px', marginTop: 12 }}>+ Add condition</button>

              {/* Backtest result */}
              {backtest && (
                <div style={{ marginTop: 18, padding: 18, borderRadius: 16, background: 'var(--color-surface-2)', border: '1px solid var(--color-line)' }}>
                  <div className="eyebrow" style={{ marginBottom: 14 }}>Backtest · {backtest.total_scanned.toLocaleString()} historical alerts</div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: backtest.samples.length ? 14 : 0 }}>
                    {([
                      ['Would flag', backtest.matched.toLocaleString(), 'var(--color-ink)'],
                      ['Match rate', `${backtest.match_rate}%`, 'var(--color-violet)'],
                      ['Of those, fraud', backtest.matched_fraud.toLocaleString(), 'var(--color-alert)'],
                      ['Precision (labelled)', backtest.precision_on_labelled != null ? `${(backtest.precision_on_labelled * 100).toFixed(0)}%` : '—', 'var(--color-safe)'],
                    ] as [string, string, string][]).map(([l, v, c]) => (
                      <div key={l} style={{ textAlign: 'center' }}>
                        <div className="data" style={{ fontSize: 22, fontWeight: 600, color: c }}>{v}</div>
                        <div className="eyebrow" style={{ fontSize: 8.5, marginTop: 4 }}>{l}</div>
                      </div>
                    ))}
                  </div>
                  {backtest.samples.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {backtest.samples.map((s) => (
                        <span key={s.transaction_id} className="data" style={{ fontSize: 10.5, padding: '3px 8px', borderRadius: 7, background: 'var(--color-surface)', border: '1px solid var(--color-line)', color: 'var(--color-ink-soft)' }}>
                          {s.transaction_id} · {(s.risk_score * 100).toFixed(0)}%
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {error && <div style={{ color: 'var(--color-alert)', fontSize: 13, marginTop: 14 }}>{error}</div>}
              <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
                <button className="btn btn-primary" onClick={submit} disabled={saving} style={{ fontSize: 13 }}>{saving ? 'Saving…' : 'Create rule'}</button>
                <button className="btn btn-ghost" onClick={runBacktest} disabled={backtesting} style={{ fontSize: 13 }}>{backtesting ? 'Testing…' : '↻ Backtest'}</button>
                <button className="btn btn-ghost" onClick={resetForm} style={{ fontSize: 13 }}>Cancel</button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      )}

      {loading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} height={84} radius={20} />)}
        </div>
      ) : rules.length === 0 ? (
        <div className="lux-card" style={{ padding: 40, textAlign: 'center', color: 'var(--color-ink-soft)' }}>
          No rules defined yet.{isAdmin ? ' Create one to start flagging transactions deterministically.' : ''}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {rules.map((r) => (
            <div key={r.id} className="lux-card" style={{ padding: '18px 22px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, opacity: r.enabled ? 1 : 0.55 }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                  <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 16 }}>{r.name}</span>
                  <span className={`badge badge-${r.action === 'escalate' ? 'alert' : 'warn'}`} style={{ fontSize: 9 }}>{r.action}</span>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {r.conditions.map((c, i) => (
                    <span key={i} className="data" style={{ fontSize: 11, padding: '4px 9px', borderRadius: 8, background: 'var(--color-surface-2)', border: '1px solid var(--color-line)', color: 'var(--color-ink-soft)' }}>
                      {c.field} {c.op} {c.value}
                    </span>
                  ))}
                </div>
              </div>
              {isAdmin && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
                  <Switch on={r.enabled} onClick={() => toggle(r)} />
                  <button onClick={() => remove(r)} style={iconBtn} title="Delete rule">🗑</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </PageShell>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '10px 12px', borderRadius: 10, border: '1px solid var(--color-line-strong)',
  background: 'var(--color-surface)', color: 'var(--color-ink)', fontSize: 13, outline: 'none',
};
const iconBtn: React.CSSProperties = {
  width: 34, height: 34, borderRadius: 9, border: '1px solid var(--color-line)', background: 'var(--color-surface)',
  color: 'var(--color-ink-soft)', cursor: 'pointer', fontSize: 15, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
};

function Switch({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} aria-label="Toggle rule" title={on ? 'Disable' : 'Enable'}
      style={{ width: 42, height: 24, borderRadius: 999, border: 'none', cursor: 'pointer', padding: 3,
        background: on ? 'var(--color-safe)' : 'var(--color-line-strong)', transition: 'background 0.2s', position: 'relative' }}>
      <motion.span animate={{ x: on ? 18 : 0 }} transition={{ type: 'spring', stiffness: 500, damping: 30 }}
        style={{ display: 'block', width: 18, height: 18, borderRadius: 999, background: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,0.3)' }} />
    </button>
  );
}
