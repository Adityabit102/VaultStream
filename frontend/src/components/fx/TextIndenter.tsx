'use client';
import { ReactNode } from 'react';
import { motion } from 'framer-motion';

/**
 * Text Indenter — staggered line/word reveal that "indents" each line up
 * into place as it enters the viewport. Native re-creation of the Framer
 * "TextIndenter" component.
 */
export default function TextIndenter({
  lines,
  as: Tag = 'h1',
  className = '',
  style,
  delay = 0,
  stagger = 0.12,
  immediate = false,
}: {
  lines: ReactNode[];
  as?: 'h1' | 'h2' | 'h3' | 'p';
  className?: string;
  style?: React.CSSProperties;
  delay?: number;
  stagger?: number;
  /** Animate on mount instead of on scroll-into-view (for above-the-fold text). */
  immediate?: boolean;
}) {
  const reveal = { y: '0%', opacity: 1 };
  const trigger = immediate
    ? { animate: reveal }
    : { whileInView: reveal, viewport: { once: true, margin: '-60px' } };

  return (
    <Tag className={className} style={{ ...style }}>
      {lines.map((line, i) => (
        <span
          key={i}
          // Extra padding + compensating negative margin gives italic/serif glyphs
          // room so the reveal clip never crops descenders or right-leaning letters.
          style={{
            display: 'block',
            overflow: 'hidden',
            padding: '0.08em 0.3em 0.22em',
            margin: '-0.08em -0.3em -0.22em',
          }}
        >
          <motion.span
            style={{ display: 'block' }}
            initial={{ y: '110%', opacity: 0 }}
            {...trigger}
            transition={{
              duration: 0.8,
              ease: [0.16, 1, 0.3, 1],
              delay: delay + i * stagger,
            }}
          >
            {line}
          </motion.span>
        </span>
      ))}
    </Tag>
  );
}
