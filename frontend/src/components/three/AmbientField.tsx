'use client';
import { Canvas, useFrame } from '@react-three/fiber';
import { useMemo, useRef, useState, useEffect, Suspense } from 'react';
import * as THREE from 'three';
import { isWebGLAvailable } from '@/lib/webgl';

/**
 * AmbientField — a full-viewport, cursor-reactive 3D particle field used as a
 * living background. Lightweight Points cloud (one draw call) that drifts and
 * parallaxes toward the pointer. Read via a window listener so it stays
 * interactive even though the layer is pointer-events:none. Palette-matched.
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

function Field() {
  const group = useRef<THREE.Group>(null);
  const mouse = useRef({ x: 0, y: 0 });
  const points = useRef<THREE.Points>(null);
  const launch = useRef(0); // 0→1 spread progress

  const { positions, start, target, colors, count } = useMemo(() => {
    const rng = mulberry32(424242);
    const count = 260;
    const start = new Float32Array(count * 3);
    const target = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const c = new THREE.Color();
    for (let i = 0; i < count; i++) {
      // launch from a tight cluster at centre (the rotating globe)…
      start[i * 3] = (rng() - 0.5) * 1.4;
      start[i * 3 + 1] = (rng() - 0.5) * 1.4;
      start[i * 3 + 2] = (rng() - 0.5) * 1.4 - 2;
      // …then spread across the whole background
      target[i * 3] = (rng() - 0.5) * 18;
      target[i * 3 + 1] = (rng() - 0.5) * 12;
      target[i * 3 + 2] = (rng() - 0.5) * 8 - 2;
      c.set(PALETTE[Math.floor(rng() * PALETTE.length)]);
      colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
    }
    return { positions: Float32Array.from(start), start, target, colors, count };
  }, []);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      mouse.current.x = (e.clientX / window.innerWidth) * 2 - 1;
      mouse.current.y = -((e.clientY / window.innerHeight) * 2 - 1);
    };
    window.addEventListener('mousemove', onMove);
    return () => window.removeEventListener('mousemove', onMove);
  }, []);

  useFrame((state, dt) => {
    if (!group.current) return;
    // Spread-from-globe launch (≈2s, ease-out), then settle.
    if (launch.current < 1 && points.current) {
      launch.current = Math.min(1, launch.current + dt / 2.0);
      const e = 1 - Math.pow(1 - launch.current, 3);
      const arr = points.current.geometry.attributes.position.array as Float32Array;
      for (let i = 0; i < arr.length; i++) arr[i] = start[i] + (target[i] - start[i]) * e;
      points.current.geometry.attributes.position.needsUpdate = true;
    }
    group.current.rotation.y += dt * 0.02;
    // parallax toward cursor
    group.current.rotation.x += (mouse.current.y * 0.18 - group.current.rotation.x) * 0.03;
    group.current.position.x += (mouse.current.x * 0.6 - group.current.position.x) * 0.03;
    const t = state.clock.elapsedTime;
    group.current.position.y = Math.sin(t * 0.2) * 0.3;
  });

  return (
    <group ref={group}>
      <points ref={points}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[positions, 3]} count={count} />
          <bufferAttribute attach="attributes-color" args={[colors, 3]} count={count} />
        </bufferGeometry>
        <pointsMaterial size={0.14} sizeAttenuation vertexColors transparent opacity={0.9} depthWrite={false} />
      </points>
    </group>
  );
}

export default function AmbientField() {
  const [ok, setOk] = useState<boolean | null>(null);
  // One-time client capability probe.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setOk(isWebGLAvailable()), []);
  if (!ok) return null; // graceful: CSS aurora still shows behind
  return (
    <Canvas camera={{ position: [0, 0, 9], fov: 50 }} dpr={[1, 1.5]} gl={{ antialias: true, alpha: true }} style={{ width: '100%', height: '100%' }}>
      <Suspense fallback={null}>
        <Field />
      </Suspense>
    </Canvas>
  );
}
