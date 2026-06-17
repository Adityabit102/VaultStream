'use client';
import { useEffect, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import PageShell, { PageHeading } from '@/components/site/PageShell';
import { Skeleton } from '@/components/ui';
import { useRole } from '@/components/RoleProvider';
import { useTheme } from '@/components/ThemeProvider';
import { apiFetch } from '@/lib/api';

interface ApiKey { id: string; name: string; prefix: string; created_at: string; last_used_at?: string | null }

function Section({ title, desc, children }: { title: string; desc?: string; children: React.ReactNode }) {
  return (
    <div className="lux-card" style={{ padding: 26, marginBottom: 18 }}>
      <h3 style={{ fontSize: 18, marginBottom: desc ? 6 : 16 }}>{title}</h3>
      {desc && <p style={{ fontSize: 13, color: 'var(--color-ink-soft)', marginBottom: 18, lineHeight: 1.6, maxWidth: 560 }}>{desc}</p>}
      {children}
    </div>
  );
}

export default function SettingsPage() {
  const { isAdmin } = useRole();
  const { theme, setTheme } = useTheme();

  // Notification prefs (local)
  const [prefs, setPrefs] = useState({ soundFraud: false, notifyFraud: true, notifySuspicious: false });
  const [prefsLoaded, setPrefsLoaded] = useState(false);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    try {
      const p = JSON.parse(localStorage.getItem('vs_notif_prefs') || '{}');
      setPrefs((cur) => ({ ...cur, ...p }));
    } catch { /* ignore */ }
    setPrefsLoaded(true);
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!prefsLoaded) return;
    localStorage.setItem('vs_notif_prefs', JSON.stringify(prefs));
  }, [prefs, prefsLoaded]);

  // Threshold (admin)
  const [threshold, setThreshold] = useState(0.5);
  const [thLoaded, setThLoaded] = useState(false);
  const [savingTh, setSavingTh] = useState(false);
  const [thSaved, setThSaved] = useState(false);

  // API keys (admin)
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [keysLoading, setKeysLoading] = useState(true);
  const [newName, setNewName] = useState('');
  const [created, setCreated] = useState<{ name: string; key: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const loadKeys = useCallback(async () => {
    try {
      const res = await apiFetch('/v1/keys', { role: 'admin' });
      if (res.ok) setKeys((await res.json()).keys || []);
    } catch { /* ignore */ }
    setKeysLoading(false);
  }, []);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!isAdmin) return;
    (async () => {
      try {
        const res = await apiFetch('/v1/model/health', { role: 'admin' });
        if (res.ok) { const d = await res.json(); setThreshold(d.threshold ?? 0.5); }
      } catch { /* ignore */ }
      setThLoaded(true);
    })();
    loadKeys();
  }, [isAdmin, loadKeys]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const saveThreshold = async () => {
    setSavingTh(true); setThSaved(false);
    try {
      const res = await apiFetch('/v1/model/threshold', { role: 'admin', method: 'PATCH', body: JSON.stringify({ threshold }) });
      if (res.ok) { setThSaved(true); setTimeout(() => setThSaved(false), 2000); }
    } catch { /* ignore */ }
    setSavingTh(false);
  };

  const createKey = async () => {
    const res = await apiFetch('/v1/keys', { role: 'admin', method: 'POST', body: JSON.stringify({ name: newName.trim() || 'API key' }) });
    if (res.ok) {
      const d = await res.json();
      setCreated({ name: d.name, key: d.key });
      setNewName('');
      loadKeys();
    }
  };

  const revokeKey = async (k: ApiKey) => {
    setKeys((prev) => prev.filter((x) => x.id !== k.id));
    await apiFetch(`/v1/keys/${k.id}`, { role: 'admin', method: 'DELETE' });
  };

  return (
    <PageShell maxWidth={760}>
      <PageHeading eyebrow="Preferences" title="Settings" subtitle="Personalize your workspace and, with admin access, tune the model and manage API credentials." />

      <Section title="Appearance" desc="Switch between the light 'Sage & Champagne' theme and its dusk variant. Your choice is remembered on this device.">
        <div style={{ display: 'flex', gap: 12 }}>
          {(['light', 'dark'] as const).map((t) => (
            <button key={t} onClick={() => setTheme(t)} style={{
              flex: 1, padding: '16px', borderRadius: 16, cursor: 'pointer', textAlign: 'left',
              border: `2px solid ${theme === t ? 'var(--color-violet)' : 'var(--color-line)'}`,
              background: theme === t ? 'var(--color-violet-soft)' : 'var(--color-surface)',
            }}>
              <div style={{ fontSize: 22, marginBottom: 6 }}>{t === 'light' ? '☀' : '☾'}</div>
              <div style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 15, textTransform: 'capitalize' }}>{t} mode</div>
            </button>
          ))}
        </div>
      </Section>

      <Section title="Notifications" desc="Control alerts in the workspace. The notification bell always collects fraud verdicts; these control sound and which verdicts surface.">
        <Toggle label="Play a sound on new fraud" hint="Audible chime when a FRAUD verdict streams in" on={prefs.soundFraud} onChange={(v) => setPrefs((p) => ({ ...p, soundFraud: v }))} />
        <Toggle label="Notify on fraud" hint="Collect FRAUD verdicts in the bell" on={prefs.notifyFraud} onChange={(v) => setPrefs((p) => ({ ...p, notifyFraud: v }))} />
        <Toggle label="Notify on suspicious" hint="Also collect SUSPICIOUS verdicts" on={prefs.notifySuspicious} onChange={(v) => setPrefs((p) => ({ ...p, notifySuspicious: v }))} />
      </Section>

      {isAdmin && (
        <Section title="Decision threshold" desc="The probability above which a transaction is labelled FRAUD. Lower it to catch more fraud at the cost of more false positives; raise it to reduce alert volume. This mirrors how banks tune alert load.">
          {!thLoaded ? <Skeleton height={48} /> : (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 14 }}>
                <input type="range" min={0.05} max={0.95} step={0.01} value={threshold} onChange={(e) => setThreshold(parseFloat(e.target.value))}
                  style={{ flex: 1, accentColor: 'var(--color-violet)' }} />
                <span className="data" style={{ fontSize: 22, fontWeight: 600, color: 'var(--color-violet)', minWidth: 64, textAlign: 'right' }}>{threshold.toFixed(2)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--color-ink-faint)', marginBottom: 18 }}>
                <span>← more sensitive (catches more)</span>
                <span style={{ marginLeft: 'auto' }}>fewer false positives →</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <button className="btn btn-primary" onClick={saveThreshold} disabled={savingTh} style={{ fontSize: 13 }}>{savingTh ? 'Saving…' : 'Save threshold'}</button>
                <AnimatePresence>{thSaved && <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="badge badge-safe">Saved</motion.span>}</AnimatePresence>
              </div>
            </>
          )}
        </Section>
      )}

      {isAdmin && (
        <Section title="API keys" desc="Generate keys to authenticate the /v1/ingest endpoint with an X-API-Key header. The full key is shown only once at creation.">
          <div style={{ display: 'flex', gap: 10, marginBottom: 18 }}>
            <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Key name (e.g. ingest-prod)"
              style={{ flex: 1, padding: '10px 14px', borderRadius: 12, border: '1px solid var(--color-line-strong)', background: 'var(--color-surface)', color: 'var(--color-ink)', fontSize: 13, outline: 'none' }} />
            <button className="btn btn-primary" onClick={createKey} style={{ fontSize: 13 }}>Generate key</button>
          </div>

          <AnimatePresence>
            {created && (
              <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
                style={{ overflow: 'hidden', marginBottom: 18 }}>
                <div style={{ padding: 16, borderRadius: 14, background: 'var(--color-gold-soft)', border: '1px solid var(--color-gold)' }}>
                  <div className="eyebrow" style={{ fontSize: 10, marginBottom: 8 }}>New key “{created.name}” — copy it now, it won&apos;t be shown again</div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <code className="data" style={{ flex: 1, padding: '10px 12px', borderRadius: 10, background: 'var(--color-surface)', border: '1px solid var(--color-line)', fontSize: 12, wordBreak: 'break-all' }}>{created.key}</code>
                    <button className="btn btn-ghost" style={{ fontSize: 12, padding: '8px 14px' }}
                      onClick={() => { navigator.clipboard?.writeText(created.key); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>
                      {copied ? '✓ Copied' : 'Copy'}
                    </button>
                    <button className="btn btn-ghost" style={{ fontSize: 12, padding: '8px 12px' }} onClick={() => setCreated(null)}>Done</button>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {keysLoading ? <Skeleton height={56} /> : keys.length === 0 ? (
            <p style={{ fontSize: 13, color: 'var(--color-ink-faint)' }}>No API keys yet.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {keys.map((k) => (
                <div key={k.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderRadius: 12, background: 'var(--color-surface-2)', border: '1px solid var(--color-line)' }}>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>{k.name}</div>
                    <div className="data" style={{ fontSize: 11, color: 'var(--color-ink-soft)', marginTop: 2 }}>
                      {k.prefix}••• · {k.last_used_at ? `last used ${new Date(k.last_used_at).toLocaleDateString()}` : 'never used'}
                    </div>
                  </div>
                  <button onClick={() => revokeKey(k)} className="btn btn-ghost" style={{ fontSize: 12, padding: '7px 14px', color: 'var(--color-alert)' }}>Revoke</button>
                </div>
              ))}
            </div>
          )}
        </Section>
      )}
    </PageShell>
  );
}

function Toggle({ label, hint, on, onChange }: { label: string; hint?: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 0', borderBottom: '1px solid var(--color-line)' }}>
      <div>
        <div style={{ fontSize: 14, fontWeight: 500 }}>{label}</div>
        {hint && <div style={{ fontSize: 12, color: 'var(--color-ink-faint)', marginTop: 2 }}>{hint}</div>}
      </div>
      <button onClick={() => onChange(!on)} aria-label={label} style={{ width: 42, height: 24, borderRadius: 999, border: 'none', cursor: 'pointer', padding: 3, background: on ? 'var(--color-violet)' : 'var(--color-line-strong)', transition: 'background 0.2s', flexShrink: 0 }}>
        <motion.span animate={{ x: on ? 18 : 0 }} transition={{ type: 'spring', stiffness: 500, damping: 30 }} style={{ display: 'block', width: 18, height: 18, borderRadius: 999, background: '#fff' }} />
      </button>
    </div>
  );
}
