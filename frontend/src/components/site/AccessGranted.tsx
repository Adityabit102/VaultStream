'use client';
import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';

/**
 * AccessGranted — the post-login transition. A scanning ring sweeps, a lock
 * releases into a checkmark, and "ACCESS GRANTED" resolves before routing into
 * the workspace. Deliberately distinct from the landing preloader: a deep
 * forest "secure" veil rather than a light split — same palette, different mood.
 */
export default function AccessGranted({
  role = 'analyst',
  onDone,
}: {
  role?: string;
  onDone: () => void;
}) {
  const [granted, setGranted] = useState(false);

  useEffect(() => {
    // Lock page scroll so the centered overlay isn't offset by a scrollbar gutter.
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const t1 = setTimeout(() => setGranted(true), 900);
    const t2 = setTimeout(onDone, 2000);
    return () => {
      document.body.style.overflow = prev;
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [onDone]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100vw',
        height: '100vh',
        zIndex: 200,
        display: 'grid',
        placeItems: 'center',
        background: 'radial-gradient(circle at 50% 50%, #3a4433, #2f372a 70%)',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 22 }}>
        <svg width="132" height="132" viewBox="0 0 132 132" fill="none">
          {/* base ring */}
          <circle cx="66" cy="66" r="54" stroke="rgba(255,255,255,0.12)" strokeWidth="2" />
          {/* sweeping scan arc */}
          {!granted && (
            <motion.circle
              cx="66" cy="66" r="54"
              stroke="#a7c293" strokeWidth="3" strokeLinecap="round"
              strokeDasharray="60 280"
              animate={{ rotate: 360 }}
              transition={{ duration: 0.9, ease: 'linear', repeat: Infinity }}
              style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
            />
          )}
          {/* completed ring */}
          {granted && (
            <motion.circle
              cx="66" cy="66" r="54" stroke="#a7c293" strokeWidth="3" strokeLinecap="round"
              initial={{ pathLength: 0, rotate: -90 }} animate={{ pathLength: 1 }}
              transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
              style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
            />
          )}
          {/* lock -> check */}
          {!granted ? (
            <g stroke="#e9ede2" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" fill="none">
              <rect x="52" y="62" width="28" height="22" rx="4" />
              <path d="M57 62 V55 a9 9 0 0 1 18 0 v7" />
            </g>
          ) : (
            <motion.path
              d="M50 67 L61 78 L83 54"
              stroke="#d8be94" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" fill="none"
              initial={{ pathLength: 0 }} animate={{ pathLength: 1 }}
              transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1], delay: 0.1 }}
            />
          )}
        </svg>

        <div style={{ textAlign: 'center' }}>
          <motion.div
            key={granted ? 'g' : 'v'}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            style={{ fontFamily: 'var(--font-display)', fontSize: 26, fontWeight: 600, color: '#fbf8f2', letterSpacing: '-0.01em' }}
          >
            {granted ? 'Access granted' : 'Verifying credentials'}
          </motion.div>
          <div className="data" style={{ marginTop: 8, fontSize: 12, letterSpacing: '0.2em', textTransform: 'uppercase', color: granted ? '#a7c293' : 'rgba(233,237,226,0.5)' }}>
            {granted ? `Role · ${role}` : 'Secure session'}
          </div>
        </div>
      </div>
    </motion.div>
  );
}
