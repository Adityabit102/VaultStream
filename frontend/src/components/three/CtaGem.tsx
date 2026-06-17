'use client';
import { Canvas, useFrame } from '@react-three/fiber';
import { Float, OrbitControls } from '@react-three/drei';
import { useRef, useState, useEffect, Suspense } from 'react';
import * as THREE from 'three';
import { isWebGLAvailable } from '@/lib/webgl';

/**
 * CtaGem — a faceted "vault gem" that turns inside the call-to-action band.
 * Drag to spin; auto-rotates and floats. Glassy champagne facets over the
 * aurora panel. Lightweight (low-poly), WebGL-guarded.
 */
function Gem() {
  const mesh = useRef<THREE.Mesh>(null);
  const ring = useRef<THREE.Mesh>(null);
  useFrame((_, dt) => {
    if (mesh.current) mesh.current.rotation.y += dt * 0.4;
    if (ring.current) {
      ring.current.rotation.x += dt * 0.25;
      ring.current.rotation.z -= dt * 0.18;
    }
  });
  return (
    <group>
      <mesh ref={mesh}>
        <octahedronGeometry args={[1.5, 0]} />
        <meshStandardMaterial color="#f3e8d2" metalness={0.55} roughness={0.18} flatShading emissive="#d8be94" emissiveIntensity={0.18} />
      </mesh>
      <mesh ref={ring}>
        <torusGeometry args={[2.1, 0.018, 12, 80]} />
        <meshStandardMaterial color="#ffffff" metalness={0.4} roughness={0.4} transparent opacity={0.6} />
      </mesh>
    </group>
  );
}

export default function CtaGem() {
  const [ok, setOk] = useState<boolean | null>(null);
  // One-time client capability probe.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setOk(isWebGLAvailable()), []);
  if (!ok) return null;
  return (
    <Canvas camera={{ position: [0, 0, 6], fov: 42 }} dpr={[1, 1.5]} gl={{ antialias: true, alpha: true }} style={{ width: '100%', height: '100%' }}>
      <Suspense fallback={null}>
        <ambientLight intensity={0.8} />
        <directionalLight position={[3, 4, 5]} intensity={1.4} color="#fff" />
        <pointLight position={[-4, -2, 2]} intensity={0.8} color="#fbeede" />
        <Float speed={1.6} rotationIntensity={0.6} floatIntensity={0.9}>
          <Gem />
        </Float>
        <OrbitControls enableZoom={false} enablePan={false} autoRotate autoRotateSpeed={0.6} />
      </Suspense>
    </Canvas>
  );
}
