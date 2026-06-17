'use client';
import { motion } from 'framer-motion';

/**
 * Arc Text — lays text along a circular SVG path and slowly rotates the ring.
 * Native re-creation of the Framer "ArcText" component. Great as a rotating
 * seal/badge behind a hero focal point.
 */
export default function ArcText({
  text = 'VAULTSTREAM · REAL-TIME FRAUD INTELLIGENCE · ',
  size = 240,
  fontSize = 13,
  color = 'var(--color-ink-soft)',
  spin = 28,
  className = '',
}: {
  text?: string;
  size?: number;
  fontSize?: number;
  color?: string;
  spin?: number;
  className?: string;
}) {
  const r = size / 2 - fontSize;
  const cx = size / 2;
  const cy = size / 2;
  const pathId = `arc-${Math.round(r)}-${text.length}`;

  return (
    <motion.div
      className={className}
      animate={{ rotate: 360 }}
      transition={{ duration: spin, ease: 'linear', repeat: Infinity }}
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <defs>
          <path
            id={pathId}
            d={`M ${cx},${cy} m -${r},0 a ${r},${r} 0 1,1 ${r * 2},0 a ${r},${r} 0 1,1 -${r * 2},0`}
          />
        </defs>
        <text
          fill={color}
          fontSize={fontSize}
          fontWeight={600}
          letterSpacing="2"
          style={{ fontFamily: 'var(--font-sans)', textTransform: 'uppercase' }}
        >
          <textPath href={`#${pathId}`} startOffset="0">
            {text.repeat(2)}
          </textPath>
        </text>
      </svg>
    </motion.div>
  );
}
