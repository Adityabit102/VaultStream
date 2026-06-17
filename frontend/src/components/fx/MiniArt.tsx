'use client';
import { motion } from 'framer-motion';

/**
 * MiniArt — minimalist, fraud-relevant SVG line art used in place of flat
 * color blocks across cards and the pipeline. Each piece is themed via two
 * colors and carries a small live accent (a moving dot / pulse) so the cards
 * feel alive without heavy assets.
 */

export type ArtKind =
  | 'ingest' | 'stream' | 'features' | 'score' | 'decide'
  | 'velocity' | 'device' | 'amount' | 'case' | 'threshold';

const dash = { strokeDasharray: '3 4' };

export default function MiniArt({
  kind,
  color = 'var(--color-violet)',
  accent = 'var(--color-rose)',
  className = '',
}: {
  kind: ArtKind;
  color?: string;
  accent?: string;
  className?: string;
}) {
  const common = {
    className,
    viewBox: '0 0 120 70',
    width: '100%',
    height: '100%',
    fill: 'none',
    preserveAspectRatio: 'xMidYMid meet',
    style: { display: 'block' as const },
  };
  const sw = 2;

  switch (kind) {
    case 'ingest':
      return (
        <svg {...common}>
          {[20, 35, 50].map((y, i) => (
            <line key={i} x1="8" y1={y} x2="84" y2={y} stroke={color} strokeWidth={sw} strokeLinecap="round" opacity={0.35} style={dash} />
          ))}
          <circle cx="100" cy="35" r="12" stroke={color} strokeWidth={sw} />
          {[20, 35, 50].map((y, i) => (
            <motion.circle key={i} cx="8" cy={y} r="3" fill={accent}
              animate={{ cx: [8, 88], opacity: [0, 1, 0] }}
              transition={{ duration: 2.2, repeat: Infinity, delay: i * 0.5, ease: 'easeInOut' }} />
          ))}
        </svg>
      );
    case 'stream':
      return (
        <svg {...common}>
          <circle cx="16" cy="35" r="6" fill={color} />
          {[14, 35, 56].map((y, i) => (
            <path key={i} d={`M22 35 C 50 35, 60 ${y}, 92 ${y}`} stroke={color} strokeWidth={sw} opacity={0.5} />
          ))}
          {[14, 35, 56].map((y, i) => (
            <circle key={i} cx="98" cy={y} r="5" stroke={accent} strokeWidth={sw} fill="var(--color-surface)" />
          ))}
        </svg>
      );
    case 'features':
      return (
        <svg {...common}>
          <rect x="10" y="14" width="64" height="42" rx="6" stroke={color} strokeWidth={sw} opacity={0.3} style={dash} />
          {[24, 40, 56, 72].map((x, i) => (
            <motion.rect key={i} x={x} width="8" rx="2" fill={i === 1 ? accent : color}
              animate={{ height: [10, 28, 16, 10], y: [50, 32, 44, 50] }}
              transition={{ duration: 2.4, repeat: Infinity, delay: i * 0.3, ease: 'easeInOut' }} />
          ))}
          <line x1="90" y1="14" x2="90" y2="56" stroke={color} strokeWidth={sw} opacity={0.25} />
          <text x="98" y="39" fontSize="9" fill={color} opacity={0.6} fontFamily="var(--font-mono)">z</text>
        </svg>
      );
    case 'score':
      return (
        <svg {...common}>
          <path d="M14 54 A 46 46 0 0 1 106 54" stroke={color} strokeWidth={sw} opacity={0.3} />
          <path d="M14 54 A 46 46 0 0 1 60 12" stroke={accent} strokeWidth={3} strokeLinecap="round" />
          <motion.line x1="60" y1="54" x2="60" y2="22" stroke={color} strokeWidth={sw} strokeLinecap="round"
            style={{ originX: '60px', originY: '54px' }}
            animate={{ rotate: [-46, 32, -10, -46] }}
            transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }} />
          <circle cx="60" cy="54" r="4" fill={color} />
        </svg>
      );
    case 'decide':
      return (
        <svg {...common}>
          <circle cx="30" cy="35" r="7" fill={color} />
          {[1, 2, 3].map((r) => (
            <motion.circle key={r} cx="30" cy="35" r={7} stroke={accent} strokeWidth={sw} fill="none"
              animate={{ r: [7, 7 + r * 9], opacity: [0.7, 0] }}
              transition={{ duration: 2.1, repeat: Infinity, delay: r * 0.4, ease: 'easeOut' }} />
          ))}
          <path d="M64 35 H 104 M 96 28 L 104 35 L 96 42" stroke={color} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case 'velocity':
      return (
        <svg {...common}>
          {[16, 34, 52, 70, 88].map((x, i) => {
            const h = [14, 24, 18, 34, 44][i];
            return <rect key={i} x={x} y={58 - h} width="12" height={h} rx="3" fill={i === 4 ? accent : color} opacity={i === 4 ? 1 : 0.55} />;
          })}
          <path d="M16 50 L 40 40 L 58 46 L 76 28 L 100 16" stroke={color} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case 'device':
      return (
        <svg {...common}>
          {[8, 14, 20, 26].map((r, i) => (
            <path key={i} d={`M${60 - r} 35 A ${r} ${r} 0 0 1 ${60 + r} 35`} stroke={color} strokeWidth={sw} opacity={0.6 - i * 0.1} />
          ))}
          <circle cx="60" cy="35" r="3" fill={color} />
          <motion.circle cx="60" cy="35" r="30" stroke={accent} strokeWidth={sw} strokeDasharray="4 6"
            animate={{ rotate: 360 }} transition={{ duration: 14, repeat: Infinity, ease: 'linear' }}
            style={{ originX: '60px', originY: '35px' }} />
        </svg>
      );
    case 'amount':
      return (
        <svg {...common}>
          <line x1="10" y1="58" x2="110" y2="58" stroke={color} strokeWidth={sw} opacity={0.25} />
          <line x1="12" y1="10" x2="12" y2="58" stroke={color} strokeWidth={sw} opacity={0.25} />
          {[[26, 48], [38, 40], [50, 44], [62, 30], [74, 36], [98, 16]].map(([x, y], i) => (
            <circle key={i} cx={x} cy={y} r={i === 5 ? 5 : 3.2} fill={i === 5 ? accent : color} opacity={i === 5 ? 1 : 0.6} />
          ))}
          <circle cx="98" cy="16" r="10" stroke={accent} strokeWidth={sw} opacity={0.5} />
        </svg>
      );
    case 'case':
      return (
        <svg {...common}>
          <path d="M60 10 L 86 20 V 38 C 86 52 74 60 60 64 C 46 60 34 52 34 38 V 20 Z" stroke={color} strokeWidth={sw} fill="none" />
          <motion.path d="M50 36 L 57 44 L 72 28" stroke={accent} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round"
            initial={{ pathLength: 0 }} animate={{ pathLength: [0, 1, 1, 0] }} transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }} />
        </svg>
      );
    case 'threshold':
      return (
        <svg {...common}>
          <line x1="12" y1="35" x2="108" y2="35" stroke={color} strokeWidth={sw} opacity={0.3} />
          <rect x="12" y="33" width="50" height="4" rx="2" fill={color} />
          <rect x="62" y="33" width="46" height="4" rx="2" fill={accent} opacity={0.5} />
          <motion.circle cy="35" r="8" fill="var(--color-surface)" stroke={color} strokeWidth={3}
            animate={{ cx: [40, 84, 40] }} transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }} />
        </svg>
      );
  }
}
