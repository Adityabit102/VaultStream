'use client';
import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import dynamic from 'next/dynamic';
import Logo from './Logo';
import ArcText from '@/components/fx/ArcText';

const LoaderOrb = dynamic(() => import('@/components/three/LoaderOrb'), { ssr: false, loading: () => null });

const EASE = [0.83, 0, 0.17, 1] as const;

const BOOT_STEPS = [
  { at: 0, label: 'Initializing feature store' },
  { at: 28, label: 'Loading XGBoost model' },
  { at: 52, label: 'Connecting to live stream' },
  { at: 78, label: 'Securing analyst session' },
  { at: 100, label: 'Ready' },
];
const stepFor = (pct: number) => [...BOOT_STEPS].reverse().find((s) => pct >= s.at)?.label ?? BOOT_STEPS[0].label;

/**
 * Preloader — the landing intro. A 3D particle orb forms while a counter runs
 * to 100, then two sage panels split apart to reveal the page. Shown once per
 * session; subsequent navigations use the route transition instead.
 */
export default function Preloader() {
  const [phase, setPhase] = useState<'loading' | 'reveal' | 'done'>('loading');
  const [pct, setPct] = useState(0);

  useEffect(() => {
    if (typeof window !== 'undefined' && sessionStorage.getItem('vs_intro_seen')) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPhase('done');
      return;
    }
    sessionStorage.setItem('vs_intro_seen', '1');
    document.body.style.overflow = 'hidden';

    let raf = 0;
    const start = performance.now();
    const DURATION = 2000;
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / DURATION);
      const eased = 1 - Math.pow(1 - p, 2);
      setPct(Math.round(eased * 100));
      if (p < 1) raf = requestAnimationFrame(tick);
      else setTimeout(() => setPhase('reveal'), 280);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      document.body.style.overflow = '';
    };
  }, []);

  useEffect(() => {
    if (phase === 'reveal') {
      document.body.style.overflow = '';
      const t = setTimeout(() => setPhase('done'), 950);
      return () => clearTimeout(t);
    }
  }, [phase]);

  const panel = (origin: 'top' | 'bottom', delay: number) => (
    <motion.div
      initial={{ y: 0 }}
      animate={phase === 'reveal' ? { y: origin === 'top' ? '-100%' : '100%' } : { y: 0 }}
      transition={{ duration: 0.85, ease: EASE, delay }}
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        height: '50%',
        [origin]: 0,
        background: 'var(--grad-mist)',
      }}
    />
  );

  return (
    <AnimatePresence>
      {phase !== 'done' && (
        <motion.div
          key="preloader"
          exit={{ opacity: 0 }}
          style={{ position: 'fixed', inset: 0, zIndex: 200, overflow: 'hidden', pointerEvents: phase === 'reveal' ? 'none' : 'auto' }}
        >
          {panel('top', 0)}
          {panel('bottom', 0.04)}

          {/* Center content fades out before the split */}
          <motion.div
            animate={{ opacity: phase === 'reveal' ? 0 : 1, scale: phase === 'reveal' ? 0.92 : 1 }}
            transition={{ duration: 0.4, ease: 'easeOut' }}
            style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10 }}
          >
            {/* Orb + rotating arc seal + logo */}
            <div style={{ width: 320, height: 320, position: 'relative', display: 'grid', placeItems: 'center' }}>
              <div style={{ position: 'absolute', inset: 0 }}>
                <LoaderOrb />
              </div>
              <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', pointerEvents: 'none', opacity: 0.6 }}>
                <ArcText size={300} text="VAULTSTREAM · REAL-TIME FRAUD INTELLIGENCE · " spin={22} fontSize={11} />
              </div>
              <div style={{ position: 'relative', zIndex: 1, pointerEvents: 'none' }}>
                <Logo size={46} />
              </div>
            </div>

            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
              style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 30, letterSpacing: '-0.02em', marginTop: 4 }}
            >
              VaultStream
            </motion.div>
            <div className="eyebrow" style={{ fontSize: 11 }}>Real-time fraud intelligence</div>

            {/* Progress + cycling boot status */}
            <div style={{ marginTop: 20, width: 240, display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 11 }}>
                <AnimatePresence mode="wait">
                  <motion.span
                    key={stepFor(pct)}
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    transition={{ duration: 0.25 }}
                    className="data"
                    style={{ color: 'var(--color-ink-soft)', letterSpacing: '0.04em' }}
                  >
                    {stepFor(pct)}
                  </motion.span>
                </AnimatePresence>
                <span className="data" style={{ color: 'var(--color-ink-faint)' }}>{pct}%</span>
              </div>
              <div style={{ width: '100%', height: 3, borderRadius: 999, background: 'var(--color-line)', overflow: 'hidden' }}>
                <div style={{ width: `${pct}%`, height: '100%', background: 'var(--grad-violet-rose)', borderRadius: 999, transition: 'width 0.1s linear' }} />
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
