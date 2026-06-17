'use client';
import { Canvas, useFrame } from '@react-three/fiber';
import { useRef, useState, useEffect, Suspense } from 'react';
import * as THREE from 'three';
import { isWebGLAvailable } from '@/lib/webgl';

/**
 * ScannerOrb — a small idle 3D "scanner" for the deep-dive empty state: a
 * wireframe sphere with two scanning rings and a pulsing core, suggesting the
 * system watching for the next alert. WebGL-guarded with a CSS fallback.
 */
function Scene() {
  const wire = useRef<THREE.Mesh>(null);
  const r1 = useRef<THREE.Mesh>(null);
  const r2 = useRef<THREE.Mesh>(null);
  const core = useRef<THREE.Mesh>(null);
  useFrame((s, dt) => {
    if (wire.current) wire.current.rotation.y += dt * 0.25;
    if (r1.current) r1.current.rotation.x += dt * 0.9;
    if (r2.current) r2.current.rotation.z -= dt * 0.7;
    if (core.current) {
      const k = 1 + Math.sin(s.clock.elapsedTime * 2) * 0.12;
      core.current.scale.setScalar(k);
    }
  });
  return (
    <group>
      <mesh ref={wire}><icosahedronGeometry args={[1.5, 1]} /><meshBasicMaterial color="#8aa176" wireframe transparent opacity={0.3} /></mesh>
      <mesh ref={r1}><torusGeometry args={[1.7, 0.012, 10, 80]} /><meshBasicMaterial color="#cf9d7e" transparent opacity={0.7} /></mesh>
      <mesh ref={r2} rotation={[Math.PI / 2.5, 0, 0]}><torusGeometry args={[1.9, 0.01, 10, 80]} /><meshBasicMaterial color="#a7c293" transparent opacity={0.6} /></mesh>
      <mesh ref={core}><sphereGeometry args={[0.5, 24, 24]} /><meshStandardMaterial color="#8aa176" emissive="#a7c293" emissiveIntensity={0.4} roughness={0.3} /></mesh>
    </group>
  );
}

export default function ScannerOrb() {
  const [ok, setOk] = useState<boolean | null>(null);
  // One-time client capability probe.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setOk(isWebGLAvailable()), []);
  if (ok === false) {
    return (
      <div style={{ width: 96, height: 96, borderRadius: '50%', margin: '0 auto', background: 'radial-gradient(circle at 38% 32%, #d3ddc6, #8aa176)' }} className="animate-floaty" />
    );
  }
  if (ok === null) return null;
  return (
    <Canvas camera={{ position: [0, 0, 5], fov: 45 }} dpr={[1, 1.5]} gl={{ antialias: true, alpha: true }} style={{ width: 150, height: 150 }}>
      <Suspense fallback={null}>
        <ambientLight intensity={0.8} />
        <pointLight position={[3, 3, 4]} intensity={0.7} color="#fff6e6" />
        <Scene />
      </Suspense>
    </Canvas>
  );
}
