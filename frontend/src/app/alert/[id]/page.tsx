'use client';
import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import PageShell, { PageHeading } from '@/components/site/PageShell';
import DeepDivePanel from '@/components/DeepDivePanel';
import { Skeleton } from '@/components/ui';
import { AlertType } from '@/components/ThreatTicker';
import { apiFetch } from '@/lib/api';

export default function AlertDeepLinkPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;
  const [alert, setAlert] = useState<AlertType | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const res = await apiFetch(`/v1/alerts/${id}`, { role: 'viewer' });
      if (res.ok) setAlert(await res.json());
      else setNotFound(true);
    } catch { setNotFound(true); }
    setLoading(false);
  }, [id]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  const onActionSuccess = (alertId: string, action: 'freeze' | 'escalate') =>
    setAlert((prev) => (prev && prev.id === alertId ? { ...prev, action_taken: action } : prev));

  return (
    <PageShell maxWidth={620}>
      <PageHeading
        eyebrow="Shared alert"
        title="Alert deep-dive"
        action={<Link href="/workspace" className="btn btn-ghost" style={{ fontSize: 13 }}>← Back to workspace</Link>}
      />
      <div className="lux-card" style={{ padding: 24, minHeight: 400, display: 'flex', flexDirection: 'column' }}>
        {loading ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <Skeleton height={56} radius={14} />
            <Skeleton height={80} radius={16} />
            <Skeleton height={120} radius={16} />
            <Skeleton height={160} radius={16} />
          </div>
        ) : notFound || !alert ? (
          <div style={{ flex: 1, display: 'grid', placeItems: 'center', textAlign: 'center', color: 'var(--color-ink-soft)' }}>
            <div>
              <div style={{ fontSize: 32, marginBottom: 8 }}>🔍</div>
              <p>No alert found with id <span className="data">{id}</span>.</p>
              <p style={{ fontSize: 13, marginTop: 6 }}>It may not be persisted, or the database is in mock mode.</p>
            </div>
          </div>
        ) : (
          <DeepDivePanel alert={alert} onActionSuccess={onActionSuccess} />
        )}
      </div>
    </PageShell>
  );
}
