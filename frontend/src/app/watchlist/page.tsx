'use client';
import { useEffect, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import PageShell, { PageHeading } from '@/components/site/PageShell';
import { Skeleton } from '@/components/ui';
import { useRole } from '@/components/RoleProvider';
import { apiFetch } from '@/lib/api';

interface WatchItem { id: string; kind: string; value: string; reason?: string | null; added_by?: string | null; created_at?: string }

const KINDS = ['entity', 'device', 'merchant'];
const KIND_LABEL: Record<string, string> = { entity: 'Entity / account', device: 'Device fingerprint', merchant: 'Merchant' };

export default function WatchlistPage() {
  const { isAnalyst, isAdmin } = useRole();
  const canEdit = isAnalyst || isAdmin;
  const [items, setItems] = useState<WatchItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [kind, setKind] = useState('entity');
  const [value, setValue] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await apiFetch('/v1/watchlist', { role: 'viewer' });
      if (res.ok) setItems((await res.json()).items || []);
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  const submit = async () => {
    setError(null);
    if (!value.trim()) { setError('Enter a value to block.'); return; }
    setSaving(true);
    try {
      const res = await apiFetch('/v1/watchlist', {
        role: 'analyst', method: 'POST',
        body: JSON.stringify({ kind, value: value.trim(), reason: reason.trim() || null }),
      });
      if (!res.ok) { setError((await res.json()).detail || 'Failed to add.'); setSaving(false); return; }
      setValue(''); setReason(''); setCreating(false);
      await load();
    } catch { setError('Network error.'); }
    setSaving(false);
  };

  const remove = async (w: WatchItem) => {
    setItems((prev) => prev.filter((x) => x.id !== w.id));
    await apiFetch(`/v1/watchlist/${w.id}`, { role: 'analyst', method: 'DELETE' });
  };

  return (
    <PageShell maxWidth={920}>
      <PageHeading
        eyebrow="Hard blocks"
        title="Watchlist"
        subtitle="Entities, devices and merchants on this list are denied at scoring time — an instant FRAUD verdict that bypasses the model. Use it for confirmed-bad actors and known compromised devices."
        action={canEdit && !creating && (
          <button className="btn btn-primary" onClick={() => setCreating(true)} style={{ fontSize: 13 }}>+ Add block</button>
        )}
      />

      {canEdit && (
        <AnimatePresence>
          {creating && (
            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
              className="lux-card" style={{ padding: 24, marginBottom: 24, overflow: 'hidden' }}>
              <h3 style={{ fontSize: 18, marginBottom: 18 }}>Block an actor</h3>
              <div className="watch-form-grid" style={{ display: 'grid', gridTemplateColumns: '180px 1fr', gap: 14, marginBottom: 14 }}>
                <label>
                  <span className="eyebrow" style={{ display: 'block', marginBottom: 6, fontSize: 10 }}>Kind</span>
                  <select value={kind} onChange={(e) => setKind(e.target.value)} style={inputStyle}>
                    {KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
                  </select>
                </label>
                <label>
                  <span className="eyebrow" style={{ display: 'block', marginBottom: 6, fontSize: 10 }}>Value</span>
                  <input value={value} onChange={(e) => setValue(e.target.value)} placeholder="acct_ivy_204 / device-hash / merch_crypto_exch" style={{ ...inputStyle, fontFamily: 'var(--font-mono)' }} />
                </label>
              </div>
              <label>
                <span className="eyebrow" style={{ display: 'block', marginBottom: 6, fontSize: 10 }}>Reason (optional)</span>
                <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Confirmed account-takeover ring" style={inputStyle} />
              </label>
              {error && <div style={{ color: 'var(--color-alert)', fontSize: 13, marginTop: 14 }}>{error}</div>}
              <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
                <button className="btn btn-primary" onClick={submit} disabled={saving} style={{ fontSize: 13 }}>{saving ? 'Saving…' : 'Add block'}</button>
                <button className="btn btn-ghost" onClick={() => { setCreating(false); setError(null); }} style={{ fontSize: 13 }}>Cancel</button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      )}

      {loading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} height={72} radius={20} />)}
        </div>
      ) : items.length === 0 ? (
        <div className="lux-card" style={{ padding: 40, textAlign: 'center', color: 'var(--color-ink-soft)' }}>
          Nothing blocked yet.{canEdit ? ' Add an entity, device or merchant to deny it instantly.' : ''}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {items.map((w) => (
            <div key={w.id} className="lux-card" style={{ padding: '16px 22px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                  <span className="badge badge-alert" style={{ fontSize: 9 }}>{w.kind}</span>
                  <span className="data" style={{ fontSize: 14, color: 'var(--color-ink)', wordBreak: 'break-all' }}>{w.value}</span>
                </div>
                <div style={{ fontSize: 12, color: 'var(--color-ink-faint)' }}>
                  {w.reason || 'No reason given'}{w.added_by ? ` · ${w.added_by.split('@')[0]}` : ''}
                </div>
              </div>
              {canEdit && (
                <button onClick={() => remove(w)} style={iconBtn} title="Remove block">🗑</button>
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
  color: 'var(--color-ink-soft)', cursor: 'pointer', fontSize: 15, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
};
