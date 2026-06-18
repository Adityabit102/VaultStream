'use client';
import { ReactNode, CSSProperties } from 'react';
import { motion } from 'framer-motion';

export { Button, ButtonLink } from './Button';
export { Skeleton, SkeletonRows } from './Skeleton';

/* ---------------- Card ---------------- */
export function Card({
  children,
  className = '',
  hover = true,
  style,
}: {
  children: ReactNode;
  className?: string;
  hover?: boolean;
  style?: CSSProperties;
}) {
  return (
    <div
      className={`lux-card ${className}`}
      style={{ padding: 28, ...(hover ? {} : { transition: 'none' }), ...style }}
    >
      {children}
    </div>
  );
}

/* ---------------- GlassPanel ---------------- */
export function GlassPanel({
  children,
  className = '',
  style,
}: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <div className={`glass ${className}`} style={{ borderRadius: 28, ...style }}>
      {children}
    </div>
  );
}

/* ---------------- Badge ---------------- */
type Tone = 'safe' | 'warn' | 'alert' | 'neutral';
export function Badge({
  children,
  tone = 'neutral',
  className = '',
}: {
  children: ReactNode;
  tone?: Tone;
  className?: string;
}) {
  return <span className={`badge badge-${tone} ${className}`}>{children}</span>;
}

/* ---------------- SectionHeading ---------------- */
export function SectionHeading({
  eyebrow,
  title,
  subtitle,
  align = 'center',
}: {
  eyebrow?: string;
  title: ReactNode;
  subtitle?: ReactNode;
  align?: 'center' | 'left';
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-80px' }}
      transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
      style={{
        textAlign: align,
        maxWidth: align === 'center' ? 720 : undefined,
        margin: align === 'center' ? '0 auto' : undefined,
      }}
    >
      {eyebrow && (
        <div className="eyebrow" style={{ marginBottom: 16 }}>
          {eyebrow}
        </div>
      )}
      <h2 style={{ fontSize: 'clamp(30px, 4vw, 52px)', marginBottom: subtitle ? 18 : 0 }}>
        {title}
      </h2>
      {subtitle && (
        <p
          style={{
            fontSize: 18,
            lineHeight: 1.6,
            color: 'var(--color-ink-soft)',
            margin: align === 'center' ? '0 auto' : 0,
            maxWidth: 620,
          }}
        >
          {subtitle}
        </p>
      )}
    </motion.div>
  );
}

/* ---------------- StatTile ---------------- */
export function StatTile({
  value,
  label,
  accent = 'var(--color-violet)',
  sub,
}: {
  value: ReactNode;
  label: string;
  accent?: string;
  sub?: ReactNode;
}) {
  return (
    <div style={{ textAlign: 'left' }}>
      <div
        className="data"
        style={{
          fontSize: 'clamp(34px, 4vw, 48px)',
          fontWeight: 600,
          lineHeight: 1,
          color: accent,
        }}
      >
        {value}
      </div>
      <div
        className="eyebrow"
        style={{ marginTop: 12, letterSpacing: '0.14em', fontSize: 11 }}
      >
        {label}
      </div>
      {sub && (
        <div style={{ marginTop: 6, fontSize: 13, color: 'var(--color-ink-soft)' }}>
          {sub}
        </div>
      )}
    </div>
  );
}

/* ---------------- Marquee ---------------- */
export function Marquee({
  items,
  speed = 30,
}: {
  items: ReactNode[];
  speed?: number;
}) {
  const loop = [...items, ...items];
  return (
    <div style={{ overflow: 'hidden', width: '100%', maskImage: 'linear-gradient(90deg, transparent, #000 8%, #000 92%, transparent)' }}>
      <motion.div
        style={{ display: 'flex', gap: 56, width: 'max-content' }}
        animate={{ x: ['0%', '-50%'] }}
        transition={{ duration: speed, ease: 'linear', repeat: Infinity }}
      >
        {loop.map((item, i) => (
          <div
            key={i}
            style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--color-ink-faint)', fontWeight: 600, whiteSpace: 'nowrap' }}
          >
            {item}
          </div>
        ))}
      </motion.div>
    </div>
  );
}
