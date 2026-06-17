'use client';
import { Canvas, useFrame } from '@react-three/fiber';
import { Float, OrbitControls } from '@react-three/drei';
import { useRef, useMemo, useState, useEffect, Suspense } from 'react';
import * as THREE from 'three';
import { isWebGLAvailable } from '@/lib/webgl';

/**
 * AuthScene — the 3D centerpiece behind the auth aside: a faceted "vault key"
 * dodecahedron orbited by a halo of credential particles and twin rings.
 * Cream/champagne materials read well over the aurora gradient. Drag to spin.
 */
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function Halo() {
  const ref = useRef<THREE.Points>(null);
  const count = 160;
  const positions = useMemo(() => {
    const rng = mulberry32(13);
    const arr = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const y = 1 - (i / (count - 1)) * 2;
      const r = Math.sqrt(1 - y * y);
      const theta = Math.PI * (3 - Math.sqrt(5)) * i;
      const rad = 2.6 + rng() * 0.5;
      arr[i * 3] = Math.cos(theta) * r * rad;
      arr[i * 3 + 1] = y * rad;
      arr[i * 3 + 2] = Math.sin(theta) * r * rad;
    }
    return arr;
  }, []);
  useFrame((_, dt) => { if (ref.current) ref.current.rotation.y += dt * 0.1; });
  return (
    <points ref={ref}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} count={count} />
      </bufferGeometry>
      <pointsMaterial size={0.05} sizeAttenuation color="#fbf3e4" transparent opacity={0.8} depthWrite={false} />
    </points>
  );
}

function Key() {
  const core = useRef<THREE.Mesh>(null);
  const r1 = useRef<THREE.Mesh>(null);
  const r2 = useRef<THREE.Mesh>(null);
  useFrame((_, dt) => {
    if (core.current) core.current.rotation.y += dt * 0.3;
    if (r1.current) { r1.current.rotation.x += dt * 0.4; r1.current.rotation.z += dt * 0.15; }
    if (r2.current) { r2.current.rotation.y -= dt * 0.35; }
  });
  return (
    <group>
      <mesh ref={core}>
        <dodecahedronGeometry args={[1.25, 0]} />
        <meshStandardMaterial color="#f6ecd8" metalness={0.5} roughness={0.22} flatShading emissive="#e9d8b6" emissiveIntensity={0.15} />
      </mesh>
      <mesh ref={r1}><torusGeometry args={[1.9, 0.02, 12, 90]} /><meshStandardMaterial color="#ffffff" metalness={0.4} roughness={0.4} transparent opacity={0.7} /></mesh>
      <mesh ref={r2} rotation={[Math.PI / 3, 0, 0]}><torusGeometry args={[2.2, 0.015, 12, 90]} /><meshStandardMaterial color="#fbeede" metalness={0.4} roughness={0.4} transparent opacity={0.5} /></mesh>
    </group>
  );
}

export default function AuthScene() {
  const [ok, setOk] = useState<boolean | null>(null);
  // One-time client capability probe.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setOk(isWebGLAvailable()), []);
  if (!ok) return null;
  return (
    <Canvas camera={{ position: [0, 0, 6.5], fov: 45 }} dpr={[1, 1.5]} gl={{ antialias: true, alpha: true }} style={{ width: '100%', height: '100%' }}>
      <Suspense fallback={null}>
        <ambientLight intensity={0.9} />
        <directionalLight position={[4, 5, 5]} intensity={1.4} color="#ffffff" />
        <pointLight position={[-4, -3, 2]} intensity={0.7} color="#fff0d8" />
        <Float speed={1.5} rotationIntensity={0.5} floatIntensity={0.8}>
          <Key />
        </Float>
        <Halo />
        <OrbitControls enableZoom={false} enablePan={false} autoRotate autoRotateSpeed={0.5} />
      </Suspense>
    </Canvas>
  );
}
