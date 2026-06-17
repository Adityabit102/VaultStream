'use client';
import { useEffect, useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import PageShell, { PageHeading } from '@/components/site/PageShell';
import { Skeleton } from '@/components/ui';
import { apiFetch } from '@/lib/api';

interface Component { name: string; ok: boolean; detail: string }
interface Status { healthy: boolean; env: string; components: Component[] }

export default function StatusPage() {
  const [status, setStatus] = useState<Status | null>(null);
  const [loading, setLoading] = useState(true);
  const [updated, setUpdated] = useState<Date | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await apiFetch('/v1/status', { role: 'viewer' });
      if (res.ok) {
        setStatus(await res.json());
        setUpdated(new Date());
      }
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
  }, [load]);

  return (
    <PageShell maxWidth={900}>
      <PageHeading
        eyebrow="Operations"
        title="System status"
        subtitle="Live health of the services powering VaultStream. Auto-refreshes every 10 seconds."
        action={
          status && (
            <div className={`badge badge-${status.healthy ? 'safe' : 'alert'}`} style={{ fontSize: 12, padding: '8px 16px' }}>
              <span style={{ width: 8, height: 8, borderRadius: 999, background: status.healthy ? 'var(--color-safe)' : 'var(--color-alert)', animation: 'pulseSoft 2s infinite' }} />
              {status.healthy ? 'All systems operational' : 'Degraded service'}
            </div>
          )
        }
      />

      {loading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} height={76} radius={20} />)}
        </div>
      ) : !status ? (
        <div className="lux-card" style={{ padding: 32, textAlign: 'center', color: 'var(--color-ink-soft)' }}>
          Unable to reach the status endpoint.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {status.components.map((c, i) => (
            <motion.div
              key={c.name}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.06 }}
              className="lux-card"
              style={{ padding: '18px 22px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <span style={{
                  width: 12, height: 12, borderRadius: 999, flexShrink: 0,
                  background: c.ok ? 'var(--color-safe)' : 'var(--color-alert)',
                  boxShadow: `0 0 0 4px ${c.ok ? 'var(--color-safe-soft)' : 'var(--color-alert-soft)'}`,
                }} />
                <div>
                  <div style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 16 }}>{c.name}</div>
                  <div className="data" style={{ fontSize: 12, color: 'var(--color-ink-soft)', marginTop: 2 }}>{c.detail}</div>
                </div>
              </div>
              <span className={`badge badge-${c.ok ? 'safe' : 'alert'}`}>{c.ok ? 'Operational' : 'Down'}</span>
            </motion.div>
          ))}
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--color-ink-faint)', marginTop: 8, padding: '0 4px' }}>
            <span>Environment: <span className="data">{status.env}</span></span>
            {updated && <span>Updated {updated.toLocaleTimeString()}</span>}
          </div>
        </div>
      )}
    </PageShell>
  );
}
