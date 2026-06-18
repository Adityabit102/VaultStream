'use client';
import { useState, ReactNode } from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';

/**
 * Circle-Expand Button — a pill CTA whose accent fill expands from the
 * cursor-side on hover, with an arrow that slides through. Native re-creation
 * of the Framer "Circle-Expand-Button-Animation" component.
 */
export default function CircleExpandButton({
  children,
  href,
  onClick,
  tone = 'violet',
  className = '',
}: {
  children: ReactNode;
  href?: string;
  onClick?: () => void;
  tone?: 'violet' | 'ink' | 'gold';
  className?: string;
}) {
  const [hovered, setHovered] = useState(false);

  const fills: Record<string, string> = {
    violet: 'var(--grad-violet-rose)',
    ink: '#241a33',
    gold: 'var(--grad-gold)',
  };
  // Base text follows the theme so it stays legible on --color-surface in both
  // light and dark; hover text is chosen to read against the expanding fill.
  const baseText = 'var(--color-ink)';
  const hoverText = tone === 'gold' ? '#5a3d22' : '#ffffff';

  const inner = (
    <span
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={onClick}
      className={className}
      style={{
        position: 'relative',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 12,
        padding: '15px 30px',
        borderRadius: 999,
        border: '1px solid var(--color-line-strong)',
        background: 'var(--color-surface)',
        color: hovered ? hoverText : baseText,
        fontWeight: 600,
        fontSize: 15,
        cursor: 'pointer',
        overflow: 'hidden',
        transition: 'color 0.35s ease',
        boxShadow: 'var(--shadow-sm)',
        userSelect: 'none',
      }}
    >
      <motion.span
        aria-hidden
        initial={false}
        animate={{ scale: hovered ? 1 : 0 }}
        transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
        style={{
          position: 'absolute',
          left: -40,
          top: '50%',
          width: 360,
          height: 360,
          marginTop: -180,
          borderRadius: '50%',
          background: fills[tone],
          transformOrigin: 'left center',
          zIndex: 0,
        }}
      />
      <span style={{ position: 'relative', zIndex: 1, display: 'inline-flex', alignItems: 'center', gap: 12 }}>
        {children}
        <motion.svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          animate={{ x: hovered ? 4 : 0 }}
          transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
          style={{ position: 'relative', zIndex: 1 }}
        >
          <path
            d="M5 12h14M13 6l6 6-6 6"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </motion.svg>
      </span>
    </span>
  );

  if (href) {
    return (
      <Link href={href} style={{ textDecoration: 'none' }}>
        {inner}
      </Link>
    );
  }
  return inner;
}
