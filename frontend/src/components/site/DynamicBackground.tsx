'use client';
import dynamic from 'next/dynamic';

const AmbientField = dynamic(() => import('@/components/three/AmbientField'), {
  ssr: false,
  loading: () => null,
});

/**
 * DynamicBackground — a fixed, behind-everything living backdrop: slowly
 * drifting aurora blobs (CSS) layered under a cursor-reactive 3D particle
 * field. pointer-events:none so it never intercepts clicks. Additive — does
 * not modify any existing section or component.
 */
export default function DynamicBackground() {
  return (
    <div
      aria-hidden
      style={{ position: 'fixed', inset: 0, zIndex: -1, overflow: 'hidden', pointerEvents: 'none' }}
    >
      <div className="dyn-blob dyn-1" />
      <div className="dyn-blob dyn-2" />
      <div className="dyn-blob dyn-3" />
      <div style={{ position: 'absolute', inset: 0, opacity: 0.9 }}>
        <AmbientField />
      </div>

      <style jsx>{`
        .dyn-blob {
          position: absolute;
          border-radius: 50%;
          filter: blur(90px);
          opacity: 0.5;
          will-change: transform;
        }
        .dyn-1 {
          width: 46vw; height: 46vw;
          background: var(--color-violet-soft);
          top: -10vw; left: -8vw;
          animation: drift1 26s ease-in-out infinite;
        }
        .dyn-2 {
          width: 40vw; height: 40vw;
          background: var(--color-rose-soft);
          top: 30vh; right: -10vw;
          animation: drift2 32s ease-in-out infinite;
        }
        .dyn-3 {
          width: 38vw; height: 38vw;
          background: var(--color-mint-soft);
          bottom: -12vw; left: 35vw;
          animation: drift3 30s ease-in-out infinite;
        }
        @keyframes drift1 {
          0%, 100% { transform: translate(0, 0) scale(1); }
          50% { transform: translate(8vw, 6vh) scale(1.12); }
        }
        @keyframes drift2 {
          0%, 100% { transform: translate(0, 0) scale(1.05); }
          50% { transform: translate(-7vw, 8vh) scale(0.92); }
        }
        @keyframes drift3 {
          0%, 100% { transform: translate(0, 0) scale(1); }
          50% { transform: translate(-6vw, -7vh) scale(1.15); }
        }
        @media (prefers-reduced-motion: reduce) {
          .dyn-blob { animation: none; }
        }
      `}</style>
    </div>
  );
}
