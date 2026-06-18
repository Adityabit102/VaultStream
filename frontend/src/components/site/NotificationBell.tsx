'use client';
import { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';
import { useNotifications } from '@/components/NotificationProvider';

function timeAgo(ts: number) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export default function NotificationBell() {
  const { items, unread, markAllRead, clear } = useNotifications();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const toggle = () => {
    setOpen((o) => {
      if (!o && unread) markAllRead();
      return !o;
    });
  };

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={toggle}
        title="Recent fraud alerts"
        aria-label="Notifications"
        style={{
          width: 36, height: 36, borderRadius: 999,
          border: '1px solid var(--color-line-strong)',
          background: 'var(--color-surface)', color: 'var(--color-ink)',
          cursor: 'pointer', fontSize: 16, position: 'relative',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: 'var(--shadow-sm)',
        }}
      >
        🔔
        {unread > 0 && (
          <span style={{
            position: 'absolute', top: -3, right: -3, minWidth: 17, height: 17, padding: '0 4px',
            borderRadius: 999, background: 'var(--color-alert)', color: '#fff',
            fontSize: 10, fontWeight: 700, display: 'grid', placeItems: 'center',
            fontFamily: 'var(--font-mono)', border: '2px solid var(--color-surface)',
          }}>
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -8, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.97 }}
            transition={{ duration: 0.18 }}
            className="lux-card"
            style={{
              position: 'absolute', top: 46, right: 0, width: 340, maxHeight: 440,
              padding: 0, overflow: 'hidden', zIndex: 80, display: 'flex', flexDirection: 'column',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px', borderBottom: '1px solid var(--color-line)' }}>
              <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 15 }}>Fraud alerts</span>
              {items.length > 0 && (
                <button onClick={clear} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, color: 'var(--color-ink-faint)', fontWeight: 600 }}>
                  Clear
                </button>
              )}
            </div>
            <div style={{ overflowY: 'auto' }}>
              {items.length === 0 ? (
                <div style={{ padding: '32px 16px', textAlign: 'center', color: 'var(--color-ink-faint)', fontSize: 13 }}>
                  No fraud alerts yet.
                </div>
              ) : (
                items.map((n) => (
                  <Link
                    key={n.id}
                    href={`/alert/${n.id}`}
                    onClick={() => setOpen(false)}
                    style={{ display: 'block', padding: '12px 16px', borderBottom: '1px solid var(--color-line)', textDecoration: 'none', color: 'var(--color-ink)' }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                      <span className={`badge badge-${n.risk_label === 'FRAUD' ? 'alert' : 'warn'}`} style={{ fontSize: 9 }}>{n.risk_label}</span>
                      <span className="data" style={{ fontSize: 10, color: 'var(--color-ink-faint)' }}>{timeAgo(n.ts)}</span>
                    </div>
                    <div className="data" style={{ fontSize: 12 }}>{n.entity_id}</div>
                    <div style={{ fontSize: 11, color: 'var(--color-ink-soft)', marginTop: 2 }}>
                      risk {(n.risk_score * 100).toFixed(1)}%
                    </div>
                  </Link>
                ))
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
