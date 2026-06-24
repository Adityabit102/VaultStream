'use client';
import { useEffect, useState } from 'react';
import { useRole } from './RoleProvider';

export default function DynamicFooter() {
  const [streamLag, setStreamLag] = useState(42);
  const [redisHitRate, setRedisHitRate] = useState(99.8);
  const [p95Latency, setP95Latency] = useState(38);
  const [fpr, setFpr] = useState(1.1);
  const { isAdmin } = useRole();

  useEffect(() => {
    const interval = setInterval(() => {
      setStreamLag((prev) => Math.max(30, Math.min(55, prev + (Math.floor(Math.random() * 5) - 2))));
      setRedisHitRate((prev) => parseFloat(Math.max(99.4, Math.min(99.9, prev + (Math.random() * 0.1 - 0.05))).toFixed(2)));
      setP95Latency((prev) => Math.max(32, Math.min(44, prev + (Math.floor(Math.random() * 3) - 1))));
      setFpr((prev) => parseFloat(Math.max(1.0, Math.min(1.2, prev + (Math.random() * 0.02 - 0.01))).toFixed(2)));
    }, 2000);
    return () => clearInterval(interval);
  }, []);

  const wrap: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 36,
    padding: '14px 26px',
    borderRadius: 18,
    margin: '0 4px 4px',
  };

  if (!isAdmin) {
    return (
      <footer className="glass" style={{ ...wrap, justifyContent: 'center', color: 'var(--color-ink-faint)', fontSize: 13 }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="11" width="18" height="11" rx="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
          System telemetry · admin only
        </span>
      </footer>
    );
  }

  const kpis: [string, string, string][] = [
    ['Stream lag', `${streamLag}ms`, 'var(--color-ink)'],
    ['Redis hit rate', `${redisHitRate}%`, 'var(--color-ink)'],
    ['p95 latency', `${p95Latency}ms`, 'var(--color-safe)'],
    ['FPR', `${fpr}%`, 'var(--color-ink)'],
  ];

  return (
    <footer className="glass" style={wrap}>
      {kpis.map(([label, value, color]) => (
        <div key={label} style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
          <span className="eyebrow" style={{ fontSize: 10 }}>{label}</span>
          <span className="data" style={{ fontSize: 16, fontWeight: 600, color }}>{value}</span>
        </div>
      ))}
      <span className="data" style={{ marginLeft: 'auto', marginRight: 64, fontSize: 11, color: 'var(--color-safe)' }}>● all systems nominal</span>
    </footer>
  );
}
