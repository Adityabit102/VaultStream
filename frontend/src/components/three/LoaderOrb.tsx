'use client';
import { Canvas, useFrame } from '@react-three/fiber';
import { Float } from '@react-three/drei';
import { useMemo, useRef, useState, useEffect, Suspense } from 'react';
import * as THREE from 'three';
import { isWebGLAvailable } from '@/lib/webgl';

/**
 * LoaderOrb — the preloader centerpiece. ~1600 particles converge from a
 * scattered cloud into a luminous sphere, wrapped by two counter-rotating
 * champagne rings and a soft glow. Palette-matched, WebGL-guarded.
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

const PALETTE = ['#8aa176', '#a7c293', '#d8be94', '#cf9d7e', '#b3c4a8'];

function Particles() {
  const ref = useRef<THREE.Points>(null);
  const count = 1600;

  const { scattered, target, colors } = useMemo(() => {
    const rng = mulberry32(7);
    const scattered = new Float32Array(count * 3);
    const target = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const c = new THREE.Color();
    for (let i = 0; i < count; i++) {
      scattered[i * 3] = (rng() - 0.5) * 18;
      scattered[i * 3 + 1] = (rng() - 0.5) * 18;
      scattered[i * 3 + 2] = (rng() - 0.5) * 18;
      const y = 1 - (i / (count - 1)) * 2;
      const r = Math.sqrt(1 - y * y);
      const theta = Math.PI * (3 - Math.sqrt(5)) * i;
      const rad = 2.25 + rng() * 0.15;
      target[i * 3] = Math.cos(theta) * r * rad;
      target[i * 3 + 1] = y * rad;
      target[i * 3 + 2] = Math.sin(theta) * r * rad;
      c.set(PALETTE[Math.floor(rng() * PALETTE.length)]);
      colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
    }
    return { scattered, target, colors };
  }, []);

  const positions = useMemo(() => Float32Array.from(scattered), [scattered]);
  const t = useRef(0);

  useFrame((state, dt) => {
    if (!ref.current) return;
    t.current = Math.min(1, t.current + dt * 0.45);
    const ease = 1 - Math.pow(1 - t.current, 3);
    const arr = ref.current.geometry.attributes.position.array as Float32Array;
    for (let i = 0; i < arr.length; i++) arr[i] = scattered[i] + (target[i] - scattered[i]) * ease;
    ref.current.geometry.attributes.position.needsUpdate = true;
    ref.current.rotation.y += dt * 0.35;
    ref.current.rotation.x = Math.sin(state.clock.elapsedTime * 0.3) * 0.18;
  });

  return (
    <points ref={ref}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} count={count} />
        <bufferAttribute attach="attributes-color" args={[colors, 3]} count={count} />
      </bufferGeometry>
      <pointsMaterial size={0.055} sizeAttenuation vertexColors transparent opacity={0.95} depthWrite={false} />
    </points>
  );
}

function Rings() {
  const a = useRef<THREE.Mesh>(null);
  const b = useRef<THREE.Mesh>(null);
  useFrame((_, dt) => {
    if (a.current) { a.current.rotation.x += dt * 0.5; a.current.rotation.y += dt * 0.2; }
    if (b.current) { b.current.rotation.y -= dt * 0.4; b.current.rotation.z += dt * 0.25; }
  });
  return (
    <group>
      <mesh ref={a}><torusGeometry args={[3, 0.012, 12, 90]} /><meshBasicMaterial color="#d8be94" transparent opacity={0.7} /></mesh>
      <mesh ref={b} rotation={[Math.PI / 3, 0, 0]}><torusGeometry args={[3.4, 0.01, 12, 90]} /><meshBasicMaterial color="#cf9d7e" transparent opacity={0.5} /></mesh>
    </group>
  );
}

export default function LoaderOrb() {
  const [ok, setOk] = useState<boolean | null>(null);
  // One-time client capability probe.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setOk(isWebGLAvailable()), []);
  if (!ok) return null;
  return (
    <Canvas camera={{ position: [0, 0, 7.5], fov: 45 }} dpr={[1, 1.5]} gl={{ antialias: true, alpha: true }} style={{ width: '100%', height: '100%' }}>
      <Suspense fallback={null}>
        <ambientLight intensity={0.8} />
        <pointLight position={[4, 4, 4]} intensity={0.6} color="#fff6e6" />
        <Float speed={1.2} rotationIntensity={0.3} floatIntensity={0.5}>
          <Particles />
          <Rings />
          <mesh><sphereGeometry args={[1.6, 24, 24]} /><meshBasicMaterial color="#a7c293" transparent opacity={0.06} /></mesh>
        </Float>
      </Suspense>
    </Canvas>
  );
}
