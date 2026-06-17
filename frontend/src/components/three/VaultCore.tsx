'use client';
import { Canvas, useFrame } from '@react-three/fiber';
import { Float, OrbitControls, MeshDistortMaterial, Icosahedron, Torus } from '@react-three/drei';
import { useRef, useState, useEffect, Suspense } from 'react';
import * as THREE from 'three';
import { isWebGLAvailable } from '@/lib/webgl';

/**
 * VaultCore — an interactive 3D centerpiece: a softly-distorting "vault core"
 * crystal inside a wireframe shell with an orbiting champagne ring. Auto-rotates,
 * drags to rotate, and gently floats. Pure lights (no external HDR) for fast,
 * offline-safe loading. Loaded client-side only via next/dynamic.
 */

function Core() {
  const inner = useRef<THREE.Mesh>(null);
  const shell = useRef<THREE.Mesh>(null);
  const grp = useRef<THREE.Group>(null);
  const scroll = useRef(0);

  useEffect(() => {
    const onScroll = () => {
      scroll.current = window.scrollY / Math.max(1, window.innerHeight);
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useFrame((_, dt) => {
    if (inner.current) inner.current.rotation.y += dt * 0.15;
    if (shell.current) {
      shell.current.rotation.y -= dt * 0.1;
      shell.current.rotation.x += dt * 0.04;
    }
    // Scroll reactivity: gently tilt + shrink as the hero scrolls away.
    if (grp.current) {
      const s = scroll.current;
      grp.current.rotation.z += ((-s * 0.5) - grp.current.rotation.z) * 0.06;
      const target = Math.max(0.55, 1 - s * 0.35);
      grp.current.scale.x += (target - grp.current.scale.x) * 0.06;
      grp.current.scale.y = grp.current.scale.z = grp.current.scale.x;
    }
  });

  return (
    <group ref={grp}>
      {/* Distorting sage core */}
      <Icosahedron ref={inner} args={[1.15, 6]}>
        <MeshDistortMaterial
          color="#8aa176"
          roughness={0.18}
          metalness={0.35}
          distort={0.32}
          speed={1.6}
          envMapIntensity={0.6}
        />
      </Icosahedron>

      {/* Champagne wireframe shell */}
      <Icosahedron ref={shell} args={[1.55, 1]}>
        <meshStandardMaterial color="#d8be94" wireframe transparent opacity={0.4} />
      </Icosahedron>

      {/* Orbiting ring */}
      <Torus args={[2.1, 0.02, 16, 100]} rotation={[Math.PI / 2.4, 0, 0]}>
        <meshStandardMaterial color="#cf9d7e" metalness={0.6} roughness={0.3} />
      </Torus>
    </group>
  );
}

function Sparkles() {
  const group = useRef<THREE.Group>(null);
  useFrame((_, dt) => {
    if (group.current) group.current.rotation.y += dt * 0.06;
  });
  const pts = Array.from({ length: 14 }, (_, i) => {
    const a = (i / 14) * Math.PI * 2;
    const r = 2.6 + (i % 3) * 0.4;
    return [Math.cos(a) * r, Math.sin(a * 1.7) * 1.2, Math.sin(a) * r] as [number, number, number];
  });
  return (
    <group ref={group}>
      {pts.map((p, i) => (
        <mesh key={i} position={p}>
          <sphereGeometry args={[0.035, 8, 8]} />
          <meshStandardMaterial color={i % 2 ? '#a7c293' : '#d8be94'} emissive="#8aa176" emissiveIntensity={0.3} />
        </mesh>
      ))}
    </group>
  );
}

function OrbFallback() {
  return (
    <div style={{ width: '100%', height: '100%', display: 'grid', placeItems: 'center' }}>
      <div
        className="animate-floaty"
        style={{
          width: 180,
          height: 180,
          borderRadius: '50%',
          background: 'radial-gradient(circle at 35% 30%, #d3ddc6, #8aa176 55%, #cf9d7e 100%)',
          boxShadow: 'var(--shadow-glow)',
        }}
      />
    </div>
  );
}

export default function VaultCore() {
  const [supported, setSupported] = useState<boolean | null>(null);
  // One-time client capability probe.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setSupported(isWebGLAvailable()), []);
  if (supported === null) return null;
  if (!supported) return <OrbFallback />;
  return (
    <Canvas
      camera={{ position: [0, 0, 6], fov: 42 }}
      dpr={[1, 2]}
      gl={{ antialias: true, alpha: true }}
      style={{ width: '100%', height: '100%' }}
    >
      <Suspense fallback={null}>
        <ambientLight intensity={0.7} />
        <directionalLight position={[4, 6, 5]} intensity={1.3} color="#fff6e6" />
        <pointLight position={[-5, -3, 2]} intensity={0.8} color="#a7c293" />
        <pointLight position={[3, -4, -3]} intensity={0.6} color="#cf9d7e" />
        <Float speed={1.4} rotationIntensity={0.5} floatIntensity={0.7}>
          <Core />
        </Float>
        <Sparkles />
        <OrbitControls enableZoom={false} enablePan={false} autoRotate autoRotateSpeed={0.8} />
      </Suspense>
    </Canvas>
  );
}
