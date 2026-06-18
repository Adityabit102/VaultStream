'use client';
import { useState, useRef, useCallback } from 'react';
import { motion } from 'framer-motion';
import PageShell, { PageHeading } from '@/components/site/PageShell';
import { useRole } from '@/components/RoleProvider';
import { apiUrl, getToken } from '@/lib/api';

interface ResultRow {
  transaction_id: string;
  entity_id: string;
  amount: number;
  risk_score: number;
  risk_label: string;
  rules_triggered: string[];
}
interface BatchResponse {
  count: number;
  summary: Record<string, number>;
  results: ResultRow[];
}

const SAMPLE = `transaction_id,entity_id,amount,device_shift,tx_count_1h,profile
tx_001,user_alpha,42.50,0,1,safe
tx_002,user_beta,7800.00,1,9,fraud
tx_003,user_gamma,310.00,0,3,suspicious`;

export default function BatchPage() {
  const { isAdmin, role } = useRole();
  const isAnalyst = role === 'analyst' || isAdmin;
  const [file, setFile] = useState<File | null>(null);
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<BatchResponse | null>(null);
  const [filter, setFilter] = useState<string>('ALL');
  const inputRef = useRef<HTMLInputElement>(null);

  const onScore = useCallback(async () => {
    if (!file) return;
    setBusy(true); setError(null); setData(null);
    try {
      const token = await getToken(role || 'analyst');
      const form = new FormData();
      form.append('file', file);
      const res = await fetch(apiUrl('/v1/batch/score'), {
        method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form,
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setError(j.detail || `Scoring failed (${res.status}).`);
      } else {
        setData(await res.json());
        setFilter('ALL');
      }
    } catch { setError('Network error reaching the scoring endpoint.'); }
    setBusy(false);
  }, [file, role]);

  const downloadCsv = () => {
    if (!data) return;
    const header = ['transaction_id', 'entity_id', 'amount', 'risk_score', 'risk_label', 'rules_triggered'];
    const lines = [header.join(',')];
    for (const r of data.results) {
      lines.push([r.transaction_id, r.entity_id, r.amount, r.risk_score.toFixed(6), r.risk_label, `"${(r.rules_triggered || []).join('; ')}"`].join(','));
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'vaultstream-verdicts.csv'; a.click();
    URL.revokeObjectURL(url);
  };

  const pickFile = (f: File | null) => { setFile(f); setData(null); setError(null); };

  const shown = data ? (filter === 'ALL' ? data.results : data.results.filter((r) => r.risk_label === filter)) : [];

  if (!isAnalyst) {
    return (
      <PageShell maxWidth={700}>
        <PageHeading eyebrow="Batch" title="Batch scoring" />
        <div className="lux-card" style={{ padding: 40, textAlign: 'center', color: 'var(--color-ink-soft)' }}>
          Batch scoring requires an analyst or admin role.
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell maxWidth={1040}>
      <PageHeading
        eyebrow="Batch"
        title="Batch CSV scoring"
        subtitle="Upload a CSV of transactions to score them all through the live model and rules engine. Requires an amount column; optional columns: entity_id, device_shift, tx_count_1h/24h, sum_amount_1h, profile."
      />

      <div
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files?.[0]; if (f) pickFile(f); }}
        onClick={() => inputRef.current?.click()}
        className="lux-card"
        style={{
          padding: 36, textAlign: 'center', cursor: 'pointer', marginBottom: 18,
          border: `2px dashed ${drag ? 'var(--color-violet)' : 'var(--color-line-strong)'}`,
          background: drag ? 'var(--color-violet-soft)' : 'var(--color-surface)',
        }}
      >
        <input ref={inputRef} type="file" accept=".csv,text/csv" hidden onChange={(e) => pickFile(e.target.files?.[0] || null)} />
        <div style={{ fontSize: 32, marginBottom: 8 }}>📄</div>
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 17, marginBottom: 4 }}>
          {file ? file.name : 'Drop a CSV here, or click to browse'}
        </div>
        <div style={{ fontSize: 12, color: 'var(--color-ink-faint)' }}>
          {file ? `${(file.size / 1024).toFixed(1)} KB · up to 5,000 rows` : 'Max 5,000 rows'}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 24, flexWrap: 'wrap' }}>
        <button className="btn btn-primary" onClick={onScore} disabled={!file || busy} style={{ fontSize: 13 }}>
          {busy ? 'Scoring…' : 'Score transactions'}
        </button>
        {file && <button className="btn btn-ghost" onClick={() => pickFile(null)} style={{ fontSize: 13 }}>Clear</button>}
        <details style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--color-ink-soft)' }}>
          <summary style={{ cursor: 'pointer' }}>Need a sample?</summary>
          <pre className="data" style={{ marginTop: 8, padding: 12, borderRadius: 10, background: 'var(--color-surface-2)', border: '1px solid var(--color-line)', fontSize: 11, overflowX: 'auto' }}>{SAMPLE}</pre>
        </details>
      </div>

      {error && <div className="lux-card" style={{ padding: 18, marginBottom: 18, color: 'var(--color-alert)', borderLeft: '3px solid var(--color-alert)' }}>{error}</div>}

      {data && (
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 18 }}>
            <Stat label="Scored" value={data.count} />
            <Stat label="Fraud" value={data.summary.FRAUD || 0} tone="alert" />
            <Stat label="Suspicious" value={data.summary.SUSPICIOUS || 0} tone="warn" />
            <Stat label="Safe" value={data.summary.SAFE || 0} tone="safe" />
            <button className="btn btn-gold" onClick={downloadCsv} style={{ fontSize: 13, marginLeft: 'auto', alignSelf: 'center' }}>↓ Download verdicts</button>
          </div>

          <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
            {['ALL', 'FRAUD', 'SUSPICIOUS', 'SAFE'].map((f) => (
              <button key={f} onClick={() => setFilter(f)} style={{
                padding: '6px 14px', borderRadius: 999, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                border: `1px solid ${filter === f ? 'var(--color-ink)' : 'var(--color-line)'}`,
                background: filter === f ? 'var(--color-ink)' : 'var(--color-surface)',
                color: filter === f ? 'var(--color-canvas)' : 'var(--color-ink-soft)',
              }}>{f}</button>
            ))}
          </div>

          <div className="lux-card" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ overflowX: 'auto', maxHeight: 520 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ position: 'sticky', top: 0, background: 'var(--color-surface-2)', zIndex: 1 }}>
                    {['Transaction', 'Entity', 'Amount', 'Score', 'Verdict', 'Rules'].map((h) => (
                      <th key={h} className="eyebrow" style={{ textAlign: 'left', padding: '12px 16px', fontSize: 10, borderBottom: '1px solid var(--color-line)' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {shown.map((r, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid var(--color-line)' }}>
                      <td className="data" style={{ padding: '10px 16px', fontSize: 12 }}>{r.transaction_id}</td>
                      <td className="data" style={{ padding: '10px 16px', fontSize: 12, color: 'var(--color-ink-soft)' }}>{r.entity_id}</td>
                      <td className="data" style={{ padding: '10px 16px' }}>${r.amount.toFixed(2)}</td>
                      <td className="data" style={{ padding: '10px 16px' }}>{(r.risk_score * 100).toFixed(1)}%</td>
                      <td style={{ padding: '10px 16px' }}>
                        <span className={`badge badge-${r.risk_label === 'FRAUD' ? 'alert' : r.risk_label === 'SUSPICIOUS' ? 'warn' : 'safe'}`} style={{ fontSize: 9 }}>{r.risk_label}</span>
                      </td>
                      <td style={{ padding: '10px 16px', fontSize: 11, color: 'var(--color-ink-soft)' }}>
                        {(r.rules_triggered || []).length ? r.rules_triggered.join(', ') : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </motion.div>
      )}
    </PageShell>
  );
}

function Stat({ label, value, tone = 'neutral' }: { label: string; value: number; tone?: 'neutral' | 'safe' | 'warn' | 'alert' }) {
  const color = tone === 'neutral' ? 'var(--color-ink)' : `var(--color-${tone})`;
  return (
    <div className="lux-card" style={{ padding: '14px 22px', minWidth: 120 }}>
      <div className="data" style={{ fontSize: 28, fontWeight: 600, color }}>{value}</div>
      <div className="eyebrow" style={{ fontSize: 10, marginTop: 4 }}>{label}</div>
    </div>
  );
}
