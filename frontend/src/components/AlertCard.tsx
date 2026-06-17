'use client';
import { AlertType } from './ThreatTicker';
import { motion } from 'framer-motion';

const toneFor = (label: string) =>
  label === 'FRAUD' ? 'alert' : label === 'SUSPICIOUS' ? 'warn' : 'safe';

function timeAgo(alert: AlertType): string {
  const ms = alert.timestamp ?? (alert.created_at ? Date.parse(alert.created_at) : NaN);
  if (!ms || isNaN(ms)) return '';
  const s = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export default function AlertCard({
  alert,
  onClick,
  isActive,
}: {
  alert: AlertType;
  onClick: () => void;
  isActive?: boolean;
}) {
  const tone = toneFor(alert.risk_label);
  const accent =
    tone === 'alert' ? 'var(--color-alert)' : tone === 'warn' ? 'var(--color-warn)' : 'var(--color-safe)';

  return (
    <motion.button
      layout
      initial={{ opacity: 0, y: -10, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
      onClick={onClick}
      className={alert.risk_label === 'FRAUD' ? 'flash-alert' : ''}
      style={{
        textAlign: 'left',
        width: '100%',
        cursor: 'pointer',
        background: 'var(--color-surface)',
        border: `1px solid ${isActive ? accent : 'var(--color-line)'}`,
        borderRadius: 16,
        padding: '13px 15px 13px 18px',
        // left accent rendered via inset shadow to avoid border shorthand/longhand conflicts
        boxShadow: `inset 3px 0 0 ${accent}, ${isActive ? 'var(--shadow-md)' : 'var(--shadow-sm)'}`,
        transition: 'border-color 0.2s, box-shadow 0.2s',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <span className={`badge badge-${tone}`}>{alert.risk_label}</span>
        <span className="data" style={{ fontSize: 14, fontWeight: 600, color: accent }}>
          {(alert.risk_score * 100).toFixed(1)}%
        </span>
      </div>
      <div className="data" style={{ fontSize: 12, color: 'var(--color-ink-soft)', lineHeight: 1.5 }}>
        <div>tx · {alert.transaction_id.slice(0, 14)}</div>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
          <span>entity · {alert.entity_id}</span>
          <span style={{ color: 'var(--color-ink-faint)' }}>{timeAgo(alert)}</span>
        </div>
      </div>
      {alert.action_taken && (
        <div style={{ marginTop: 8, display: 'flex', justifyContent: 'flex-end' }}>
          <span className="badge badge-neutral" style={{ fontSize: 10 }}>
            {alert.action_taken.toUpperCase()}
          </span>
        </div>
      )}
    </motion.button>
  );
}
