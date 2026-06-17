'use client';
import { motion } from 'framer-motion';

/**
 * Global route transition. template.tsx re-mounts on every navigation, so each
 * screen reveals behind a sage panel carrying a CSS-3D orbiting "vault core"
 * (renders instantly — a WebGL canvas can't spin up in the brief window), which
 * wipes upward while the new content rises into place. Enter-only (App Router).
 */
const EASE = [0.83, 0, 0.17, 1] as const;

export default function Template({ children }: { children: React.ReactNode }) {
  return (
    <>
      <motion.div
        initial={{ scaleY: 1 }}
        animate={{ scaleY: 0 }}
        transition={{ duration: 1.0, ease: EASE, delay: 0.55 }}
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 90,
          transformOrigin: 'top',
          background: 'var(--grad-mist)',
          pointerEvents: 'none',
          display: 'grid',
          placeItems: 'center',
        }}
      >
        <motion.div
          initial={{ opacity: 1, scale: 1 }}
          animate={{ opacity: 0, scale: 0.86 }}
          transition={{ duration: 0.55, ease: 'easeOut', delay: 0.75 }}
          style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 18 }}
        >
          <div className="t3d">
            <div className="t3d-inner">
              <span className="t3d-ring r1" />
              <span className="t3d-ring r2" />
              <span className="t3d-ring r3" />
              <span className="t3d-core" />
            </div>
          </div>
          <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 18, letterSpacing: '-0.02em', color: 'var(--color-ink)' }}>
            VaultStream
          </span>
        </motion.div>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1], delay: 1.05 }}
      >
        {children}
      </motion.div>

      <style jsx>{`
        .t3d {
          width: 110px;
          height: 110px;
          perspective: 600px;
        }
        .t3d-inner {
          position: relative;
          width: 100%;
          height: 100%;
          transform-style: preserve-3d;
          animation: t3dspin 3.2s linear infinite;
        }
        .t3d-ring {
          position: absolute;
          inset: 8px;
          border-radius: 50%;
          border: 2px solid transparent;
        }
        .r1 { border-top-color: var(--color-violet); border-bottom-color: var(--color-violet); }
        .r2 { border-left-color: var(--color-gold); border-right-color: var(--color-gold); transform: rotateX(64deg); }
        .r3 { border-top-color: var(--color-rose); border-bottom-color: var(--color-rose); transform: rotateY(64deg); }
        .t3d-core {
          position: absolute;
          inset: 38px;
          border-radius: 50%;
          background: radial-gradient(circle at 36% 32%, #d3ddc6, #8aa176 60%, #cf9d7e 100%);
          box-shadow: 0 0 24px rgba(138, 161, 118, 0.5);
          animation: t3dpulse 1.6s ease-in-out infinite;
        }
        @keyframes t3dspin {
          from { transform: rotateY(0deg) rotateX(8deg); }
          to { transform: rotateY(360deg) rotateX(8deg); }
        }
        @keyframes t3dpulse {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.16); }
        }
        @media (prefers-reduced-motion: reduce) {
          .t3d-inner, .t3d-core { animation: none; }
        }
      `}</style>
    </>
  );
}
