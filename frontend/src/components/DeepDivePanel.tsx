'use client';
import { AlertType } from './ThreatTicker';
import { takeAction } from '../app/actions';
import { useState, useEffect, useCallback } from 'react';
import { useAuth } from './AuthProvider';
import Link from 'next/link';
import { getToken, apiUrl } from '@/lib/api';
import { useRole } from './RoleProvider';
import { useToast } from './ToastProvider';
import dynamic from 'next/dynamic';

const ScannerOrb = dynamic(() => import('@/components/three/ScannerOrb'), { ssr: false, loading: () => null });

const toneFor = (label: string) =>
  label === 'FRAUD' ? 'alert' : label === 'SUSPICIOUS' ? 'warn' : 'safe';

const STATUSES = ['open', 'investigating', 'resolved', 'dismissed'] as const;

interface Note { id: string; author: string; body: string; created_at: string }
interface TimelineEvent { ts: string; kind: string; actor: string; text: string }

const KIND_ICON: Record<string, string> = { detected: '◎', action: '⚑', note: '✎', feedback: '◈' };
const KIND_COLOR: Record<string, string> = {
  detected: 'var(--color-violet)', action: 'var(--color-warn)', note: 'var(--color-sky)', feedback: 'var(--color-alert)',
};

/** Lightweight SVG relationship graph: entity ↔ device / merchant / linked accounts. */
function EntityGraph({ entityId, deviceShift, accent }: { entityId: string; deviceShift: boolean; accent: string }) {
  const cx = 150;
  const cy = 80;
  const nodes = [
    { x: 40, y: 30, label: 'device', tone: deviceShift ? 'var(--color-alert)' : 'var(--color-safe)' },
    { x: 260, y: 34, label: 'merchant', tone: 'var(--color-violet)' },
    { x: 50, y: 132, label: 'card', tone: 'var(--color-sky)' },
    { x: 256, y: 130, label: 'linked', tone: deviceShift ? 'var(--color-warn)' : 'var(--color-mint)' },
  ];
  return (
    <svg viewBox="0 0 300 165" style={{ width: '100%', height: 150, background: 'var(--color-surface-2)', borderRadius: 16, border: '1px solid var(--color-line)' }}>
      {nodes.map((n, i) => (
        <line key={i} x1={cx} y1={cy} x2={n.x} y2={n.y} stroke={n.tone} strokeWidth={1.5} strokeOpacity={0.5} strokeDasharray={n.label === 'linked' && deviceShift ? '4 3' : undefined} />
      ))}
      {nodes.map((n, i) => (
        <g key={i}>
          <circle cx={n.x} cy={n.y} r={7} fill={n.tone} fillOpacity={0.85} />
          <text x={n.x} y={n.y - 12} fontSize={9} fill="var(--color-ink-faint)" textAnchor="middle" style={{ fontFamily: 'var(--font-sans)' }}>{n.label}</text>
        </g>
      ))}
      <circle cx={cx} cy={cy} r={13} fill={accent} />
      <circle cx={cx} cy={cy} r={20} fill="none" stroke={accent} strokeOpacity={0.3} strokeWidth={2} />
      <text x={cx} y={cy + 34} fontSize={10} fill="var(--color-ink)" textAnchor="middle" style={{ fontFamily: 'var(--font-mono)' }}>{entityId.slice(0, 16)}</text>
    </svg>
  );
}

export default function DeepDivePanel({
  alert,
  onActionSuccess,
}: {
  alert: AlertType | null;
  onActionSuccess: (alertId: string, action: 'freeze' | 'escalate') => void;
}) {
  const [loading, setLoading] = useState(false);
  const [notes, setNotes] = useState<Note[]>([]);
  const [timeline, setTimeline] = useState<TimelineEvent[]>([]);
  const [noteBody, setNoteBody] = useState('');
  const [caseStatus, setCaseStatus] = useState<string>('open');
  const [assignee, setAssignee] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [disposition, setDisposition] = useState<string | null>(null);
  const [blocked, setBlocked] = useState(false);
  const [reportLoading, setReportLoading] = useState(false);
  const { user } = useAuth();
  const { isAnalyst, isAdmin, isViewer, isAuthenticated } = useRole();
  const { toast } = useToast();
  const canTakeAction = isAdmin || isAnalyst;

  const alertId = alert?.id;
  const loadNotes = useCallback(async (id: string, role: string) => {
    const token = await getToken(role);
    const res = await fetch(apiUrl(`/v1/alerts/${id}/notes`), { headers: { Authorization: `Bearer ${token}` } });
    if (res.ok) setNotes((await res.json()).notes || []);
    const fb = await fetch(apiUrl(`/v1/alerts/${id}/feedback`), { headers: { Authorization: `Bearer ${token}` } });
    if (fb.ok) {
      const list = (await fb.json()).feedback || [];
      if (list.length) setDisposition(list[0].label);
    }
    const tl = await fetch(apiUrl(`/v1/alerts/${id}/timeline`), { headers: { Authorization: `Bearer ${token}` } });
    if (tl.ok) setTimeline((await tl.json()).timeline || []);
  }, []);

  useEffect(() => {
    if (!alertId) return;
    // Sync local case state to the selected alert (intentional reset on change).
    /* eslint-disable react-hooks/set-state-in-effect */
    setCaseStatus(alert?.status || 'open');
    setAssignee(alert?.assignee || null);
    setNotes([]);
    setTimeline([]);
    setDisposition(null);
    setBlocked(false);
    /* eslint-enable react-hooks/set-state-in-effect */
    loadNotes(alertId, user?.role || 'viewer');
  }, [alertId, alert?.status, alert?.assignee, user?.role, loadNotes]);

  if (!alert) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', textAlign: 'center', padding: 24, color: 'var(--color-ink-faint)' }}>
        <div style={{ width: 150, height: 150, marginBottom: 4 }}>
          <ScannerOrb />
        </div>
        <p style={{ fontSize: 14, maxWidth: 220, lineHeight: 1.5 }}>Select an alert from the live stream to inspect its decision.</p>
      </div>
    );
  }

  // Read-only viewers may *raise* (escalate) suspicious/fraud transactions.
  const canEscalate = canTakeAction || (isViewer && (alert.risk_label === 'SUSPICIOUS' || alert.risk_label === 'FRAUD'));

  let features = alert.feature_vector;
  if (!features && alert.feature_json) {
    const fj = alert.feature_json;
    features = [fj.tx_count_5m ?? 0, fj.tx_count_1h ?? 0, fj.tx_count_24h ?? 0, fj.sum_amount_1h ?? 0.0, fj.device_shift ?? 0];
  }
  if (!features) features = [0, 0, 0, 0.0, 0];

  const velocity = [
    { label: 'Tx · 5m', value: features[0] },
    { label: 'Tx · 1h', value: features[1] },
    { label: 'Tx · 24h', value: features[2] },
    { label: 'Spend 1h', value: `$${Number(features[3]).toFixed(0)}` },
    { label: 'Device shift', value: features[4] === 1 ? 'YES' : 'no' },
  ];

  // Real SHAP (from shap_json) when available, else heuristic from velocity features
  const realShap = alert.shap_json
    ? Object.entries(alert.shap_json)
        .filter(([k]) => k !== '_method')
        .map(([feature, v]) => ({ feature, label: feature, value: Number(v) }))
        .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
        .slice(0, 6)
    : null;
  const shapMethod = (alert.shap_json?._method as string) || 'heuristic';
  const heuristicShap = [
    { feature: 'tx_count_5m', label: 'Tx frequency (5m)', value: parseFloat((features[0] * 0.05).toFixed(3)) },
    { feature: 'tx_count_1h', label: 'Tx frequency (1h)', value: parseFloat((features[1] * 0.01).toFixed(3)) },
    { feature: 'tx_count_24h', label: 'Tx frequency (24h)', value: parseFloat((features[2] * -0.002).toFixed(3)) },
    { feature: 'sum_amount_1h', label: 'Spend volume (1h)', value: parseFloat((features[3] * 0.00015).toFixed(3)) },
    { feature: 'device_shift', label: 'Device location shift', value: features[4] === 1 ? 0.35 : -0.05 },
  ];
  const shapItems = realShap && realShap.length ? realShap : heuristicShap;
  const maxMag = Math.max(...shapItems.map((s) => Math.abs(s.value)), 0.001);

  const handleAction = async (action: 'freeze' | 'escalate') => {
    if (!user) return;
    if (action === 'freeze' && !canTakeAction) return;
    if (action === 'escalate' && !canEscalate) return;
    setLoading(true);
    const token = await getToken(user.role);
    const res = await takeAction(alert.id, action, token, user.email);
    setLoading(false);
    if (res && res.success) {
      onActionSuccess(alert.id, action);
      toast(`${action === 'freeze' ? 'Account frozen' : 'Alert escalated'}`, action === 'freeze' ? 'alert' : 'warn', 'Action recorded');
    } else {
      toast('Failed to record action: ' + (res?.error || 'Unknown error'), 'alert');
    }
  };

  const patchCase = async (path: string, body: object) => {
    if (!user || !canTakeAction) return;
    const token = await getToken(user.role);
    await fetch(apiUrl(`/v1/alerts/${alert.id}/${path}`), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
  };

  const changeStatus = async (s: string) => { setCaseStatus(s); await patchCase('status', { status: s }); };
  const claim = async () => { if (!user) return; setAssignee(user.email); await patchCase('assignee', { assignee: user.email }); };
  const submitNote = async () => {
    if (!user || !canTakeAction || !noteBody.trim()) return;
    const token = await getToken(user.role);
    const res = await fetch(apiUrl(`/v1/alerts/${alert.id}/notes`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ body: noteBody.trim() }),
    });
    if (res.ok) {
      const { note } = await res.json();
      setNotes((prev) => [...prev, note]);
      setNoteBody('');
    }
  };

  const copyText = (key: string, value: string) => {
    navigator.clipboard?.writeText(value).then(() => {
      setCopied(key);
      setTimeout(() => setCopied(null), 1200);
    }).catch(() => {});
  };

  const exportCase = () => {
    const payload = {
      alert: {
        id: alert.id, transaction_id: alert.transaction_id, entity_id: alert.entity_id,
        risk_score: alert.risk_score, risk_label: alert.risk_label,
        status: caseStatus, assignee, action_taken: alert.action_taken,
        feature_vector: alert.feature_vector,
      },
      shap: alert.shap_json ?? null,
      notes,
      exported_at: new Date().toISOString(),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `vaultstream-case-${alert.transaction_id || alert.id}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const submitFeedback = async (label: string) => {
    if (!user || !canTakeAction) return;
    setDisposition(label);
    const token = await getToken(user.role);
    await fetch(apiUrl(`/v1/alerts/${alert.id}/feedback`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ label }),
    });
  };

  const blockEntity = async () => {
    if (!user || !canTakeAction) return;
    setBlocked(true);
    const token = await getToken(user.role);
    await fetch(apiUrl('/v1/watchlist'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ kind: 'entity', value: alert.entity_id, reason: `Blocked from case ${alert.transaction_id || alert.id}` }),
    });
  };

  // The report endpoint is auth-gated, so fetch it with the bearer token and
  // open the returned HTML via a blob URL (a plain new-tab GET can't send auth).
  const openReport = async () => {
    if (!user) return;
    setReportLoading(true);
    try {
      const token = await getToken(user.role);
      const res = await fetch(apiUrl(`/v1/alerts/${alert.id}/report`), { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) {
        const blob = new Blob([await res.text()], { type: 'text/html' });
        window.open(URL.createObjectURL(blob), '_blank');
      } else {
        toast('Could not generate case file (alert may not be persisted).', 'alert');
      }
    } finally {
      setReportLoading(false);
    }
  };

  const tone = toneFor(alert.risk_label);
  const accent = tone === 'alert' ? 'var(--color-alert)' : tone === 'warn' ? 'var(--color-warn)' : 'var(--color-safe)';
  const statusTone: Record<string, string> = { open: 'var(--color-alert)', investigating: 'var(--color-warn)', resolved: 'var(--color-safe)', dismissed: 'var(--color-ink-faint)' };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 22, overflowY: 'auto', flex: 1, paddingRight: 4 }}>
      {/* Score header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <div>
          <div className="eyebrow" style={{ marginBottom: 6 }}>Risk score</div>
          <div className="data" style={{ fontSize: 40, fontWeight: 600, color: accent, lineHeight: 1 }}>
            {(alert.risk_score * 100).toFixed(1)}%
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8 }}>
          <span className={`badge badge-${tone}`} style={{ fontSize: 13, padding: '7px 14px' }}>{alert.risk_label}</span>
          <div style={{ display: 'flex', gap: 6 }}>
            <button onClick={exportCase} title="Export case as JSON" className="btn btn-ghost" style={{ padding: '5px 12px', fontSize: 11 }}>
              ↓ JSON
            </button>
            <button onClick={openReport} disabled={reportLoading} title="Generate printable SAR case file" className="btn btn-ghost" style={{ padding: '5px 12px', fontSize: 11 }}>
              {reportLoading ? '…' : '📄 Case file'}
            </button>
          </div>
        </div>
      </div>

      {/* Case management */}
      <div style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-line)', borderRadius: 16, padding: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <span className="eyebrow">Case</span>
          <span style={{ fontSize: 12, color: 'var(--color-ink-soft)' }}>
            {assignee ? <>assigned · <span className="data">{assignee.split('@')[0]}</span></> : (
              <button onClick={claim} disabled={!canTakeAction} className="btn btn-ghost" style={{ padding: '4px 12px', fontSize: 11 }}>Claim</button>
            )}
          </span>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {STATUSES.map((s) => (
            <button
              key={s}
              onClick={() => changeStatus(s)}
              disabled={!canTakeAction}
              style={{
                padding: '6px 12px', borderRadius: 999, fontSize: 11, fontWeight: 600, textTransform: 'capitalize',
                cursor: canTakeAction ? 'pointer' : 'not-allowed',
                border: `1px solid ${caseStatus === s ? statusTone[s] : 'var(--color-line)'}`,
                background: caseStatus === s ? statusTone[s] : 'var(--color-surface)',
                color: caseStatus === s ? '#fff' : 'var(--color-ink-soft)',
              }}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {/* Analyst disposition — supervised feedback loop + blocklist */}
      {canTakeAction && (
        <div style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-line)', borderRadius: 16, padding: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <span className="eyebrow">Disposition · trains next model</span>
            <button onClick={blockEntity} disabled={blocked} title="Add entity to the blocklist"
              className="btn btn-ghost" style={{ padding: '4px 12px', fontSize: 11, color: blocked ? 'var(--color-safe)' : 'var(--color-alert)' }}>
              {blocked ? '✓ Blocked' : '⛔ Block entity'}
            </button>
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {([['confirmed_fraud', 'Confirmed fraud', 'var(--color-alert)'], ['false_positive', 'False positive', 'var(--color-safe)'], ['unsure', 'Unsure', 'var(--color-ink-faint)']] as [string, string, string][]).map(([val, label, color]) => (
              <button key={val} onClick={() => submitFeedback(val)}
                style={{
                  padding: '6px 12px', borderRadius: 999, fontSize: 11, fontWeight: 600, cursor: 'pointer',
                  border: `1px solid ${disposition === val ? color : 'var(--color-line)'}`,
                  background: disposition === val ? color : 'var(--color-surface)',
                  color: disposition === val ? '#fff' : 'var(--color-ink-soft)',
                }}>
                {label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Metadata */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        {([
          ['Entity', alert.entity_id, true],
          ['Transaction', alert.transaction_id, true],
          ['Action', alert.action_taken ? alert.action_taken.toUpperCase() : 'PENDING', false],
          ['Confidence', '95%', false],
        ] as [string, string, boolean][]).map(([k, v, copyable]) => (
          <div key={k} style={{ background: 'var(--color-surface-2)', borderRadius: 14, padding: '12px 14px', border: '1px solid var(--color-line)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
              <span className="eyebrow" style={{ fontSize: 10 }}>{k}</span>
              {copyable && (
                <button onClick={() => copyText(k.toLowerCase(), v)} title={`Copy ${k.toLowerCase()}`}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontSize: 11, color: copied === k.toLowerCase() ? 'var(--color-safe)' : 'var(--color-ink-faint)' }}>
                  {copied === k.toLowerCase() ? '✓' : '⧉'}
                </button>
              )}
            </div>
            <div className="data" style={{ fontSize: 13, color: 'var(--color-ink)', wordBreak: 'break-all' }}>{v}</div>
          </div>
        ))}
      </div>

      {/* Velocity / risk factors strip */}
      <div>
        <div className="eyebrow" style={{ marginBottom: 10 }}>Risk factors</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {velocity.map((v) => (
            <div key={v.label} style={{ flex: '1 1 80px', background: 'var(--color-surface)', border: '1px solid var(--color-line)', borderRadius: 12, padding: '10px 8px', textAlign: 'center' }}>
              <div className="data" style={{ fontSize: 16, fontWeight: 600 }}>{v.value}</div>
              <div className="eyebrow" style={{ fontSize: 9, marginTop: 4 }}>{v.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Rules triggered (hybrid detection layer) */}
      {alert.rules_triggered && alert.rules_triggered.length > 0 && (
        <div>
          <div className="eyebrow" style={{ marginBottom: 10 }}>Rules triggered</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {alert.rules_triggered.map((r) => (
              <span key={r} className="badge badge-warn" style={{ fontSize: 11, textTransform: 'none', letterSpacing: 0 }}>⚑ {r}</span>
            ))}
          </div>
        </div>
      )}

      {/* Entity relationship graph */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
          <div className="eyebrow">Entity network</div>
          <Link href={`/entity/${encodeURIComponent(alert.entity_id)}`} style={{ fontSize: 11, color: 'var(--color-violet)', textDecoration: 'none', fontWeight: 600 }}>
            View profile →
          </Link>
        </div>
        <EntityGraph entityId={alert.entity_id} deviceShift={features[4] === 1} accent={accent} />
      </div>

      {/* Case timeline */}
      {timeline.length > 0 && (
        <div>
          <div className="eyebrow" style={{ marginBottom: 12 }}>Case timeline</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 0, position: 'relative' }}>
            {timeline.map((e, i) => (
              <div key={i} style={{ display: 'flex', gap: 12, paddingBottom: i === timeline.length - 1 ? 0 : 16, position: 'relative' }}>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0 }}>
                  <span style={{ width: 22, height: 22, borderRadius: 999, background: 'var(--color-surface)', border: `2px solid ${KIND_COLOR[e.kind] || 'var(--color-line-strong)'}`, color: KIND_COLOR[e.kind] || 'var(--color-ink-soft)', display: 'grid', placeItems: 'center', fontSize: 11, zIndex: 1 }}>
                    {KIND_ICON[e.kind] || '•'}
                  </span>
                  {i !== timeline.length - 1 && <span style={{ flex: 1, width: 2, background: 'var(--color-line)', marginTop: 2 }} />}
                </div>
                <div style={{ paddingBottom: 4 }}>
                  <div style={{ fontSize: 13, color: 'var(--color-ink)', textTransform: e.kind === 'feedback' || e.kind === 'action' ? 'capitalize' : 'none' }}>{e.text}</div>
                  <div className="data" style={{ fontSize: 10.5, color: 'var(--color-ink-faint)', marginTop: 2 }}>
                    {e.actor?.split('@')[0]} · {new Date(e.ts).toLocaleString()}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* SHAP waterfall */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
          <div className="eyebrow">Explainability · feature contributions</div>
          {realShap && <span className="badge badge-neutral" style={{ fontSize: 9 }}>TreeSHAP</span>}
        </div>
        <p style={{ fontSize: 12, color: 'var(--color-ink-faint)', marginBottom: 14, lineHeight: 1.5 }}>
          Bars right push toward fraud; bars left suppress risk toward safe.{shapMethod === 'heuristic' ? ' (velocity heuristic)' : ''}
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {shapItems.map((sv) => {
            const pct = (Math.abs(sv.value) / maxMag) * 50;
            const pos = sv.value > 0;
            return (
              <div key={sv.feature}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 5 }}>
                  <span className="data" style={{ color: 'var(--color-ink-soft)' }}>{sv.label}</span>
                  <span className="data" style={{ color: pos ? 'var(--color-alert)' : 'var(--color-safe)', fontWeight: 600 }}>
                    {pos ? '+' : ''}{sv.value.toFixed(3)}
                  </span>
                </div>
                <div style={{ position: 'relative', height: 8, background: 'var(--color-canvas-2)', borderRadius: 999 }}>
                  <div style={{ position: 'absolute', left: '50%', top: -2, bottom: -2, width: 1, background: 'var(--color-line-strong)' }} />
                  <div style={{ position: 'absolute', top: 0, height: '100%', borderRadius: 999, background: pos ? 'var(--color-alert)' : 'var(--color-safe)', width: `${pct}%`, ...(pos ? { left: '50%' } : { right: '50%' }) }} />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Notes */}
      <div>
        <div className="eyebrow" style={{ marginBottom: 10 }}>Investigation notes</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 10 }}>
          {notes.length === 0 && <p style={{ fontSize: 12, color: 'var(--color-ink-faint)' }}>No notes yet.</p>}
          {notes.map((n) => (
            <div key={n.id} style={{ background: 'var(--color-surface)', border: '1px solid var(--color-line)', borderRadius: 12, padding: '10px 12px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span className="data" style={{ fontSize: 11, color: 'var(--color-violet)' }}>{n.author.split('@')[0]}</span>
                <span className="data" style={{ fontSize: 10, color: 'var(--color-ink-faint)' }}>{new Date(n.created_at).toLocaleString()}</span>
              </div>
              <div style={{ fontSize: 13, color: 'var(--color-ink)', lineHeight: 1.4 }}>{n.body}</div>
            </div>
          ))}
        </div>
        {canTakeAction && (
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              value={noteBody}
              onChange={(e) => setNoteBody(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') submitNote(); }}
              placeholder="Add a note…"
              style={{ flex: 1, padding: '10px 12px', borderRadius: 12, border: '1px solid var(--color-line-strong)', background: 'var(--color-surface)', color: 'var(--color-ink)', fontSize: 13, fontFamily: 'var(--font-sans)' }}
            />
            <button onClick={submitNote} className="btn btn-primary" style={{ padding: '10px 16px', fontSize: 12 }}>Add</button>
          </div>
        )}
      </div>

      {/* Actions — viewers may raise (escalate) suspicious/fraud; freeze stays analyst+ */}
      <div style={{ marginTop: 'auto', paddingTop: 8 }}>
        {!isAuthenticated && (
          <Link href="/login" className="btn btn-ghost" style={{ width: '100%', marginBottom: 10 }}>Sign in to take action →</Link>
        )}
        {isAuthenticated && !canTakeAction && !canEscalate && (
          <div style={{ textAlign: 'center', padding: 10, borderRadius: 12, background: 'var(--color-alert-soft)', color: '#b23a54', fontSize: 13, marginBottom: 10 }}>Insufficient permissions</div>
        )}
        {isAuthenticated && !canTakeAction && canEscalate && (
          <div style={{ textAlign: 'center', padding: 9, borderRadius: 12, background: 'var(--color-warn-soft)', color: '#9a6320', fontSize: 12.5, marginBottom: 10 }}>Read-only — you can raise this alert</div>
        )}
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={() => handleAction('freeze')} disabled={loading || !!alert.action_taken || !canTakeAction}
            title={!canTakeAction ? 'Freeze requires analyst access' : undefined} className="btn"
            style={{ flex: 1, background: alert.action_taken === 'freeze' ? 'var(--color-alert)' : 'var(--color-alert-soft)', color: alert.action_taken === 'freeze' ? '#fff' : '#b23a54', border: '1px solid var(--color-alert)' }}>
            {alert.action_taken === 'freeze' ? 'Account frozen' : 'Freeze account'}
          </button>
          <button onClick={() => handleAction('escalate')} disabled={loading || !!alert.action_taken || !canEscalate} className="btn"
            style={{ flex: 1, background: alert.action_taken === 'escalate' ? 'var(--color-warn)' : 'var(--color-warn-soft)', color: alert.action_taken === 'escalate' ? '#fff' : '#9a6320', border: '1px solid var(--color-warn)' }}>
            {alert.action_taken === 'escalate' ? 'Escalated' : 'Raise alert'}
          </button>
        </div>
      </div>
    </div>
  );
}
