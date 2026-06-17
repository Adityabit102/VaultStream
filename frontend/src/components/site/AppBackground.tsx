'use client';
import dynamic from 'next/dynamic';

const AmbientField = dynamic(() => import('@/components/three/AmbientField'), { ssr: false, loading: () => null });

/**
 * AppBackground — a very subtle fixed 3D particle field behind the dense app
 * screens (workspace, lab, admin) so every page carries living 3D without
 * distracting from the data. pointer-events:none, low opacity, additive.
 */
export default function AppBackground() {
  return (
    <div aria-hidden style={{ position: 'fixed', inset: 0, zIndex: -1, pointerEvents: 'none', overflow: 'hidden' }}>
      <div style={{ position: 'absolute', inset: 0, opacity: 0.5 }}>
        <AmbientField />
      </div>
    </div>
  );
}
