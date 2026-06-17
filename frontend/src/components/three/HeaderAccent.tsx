'use client';
import { Canvas, useFrame } from '@react-three/fiber';
import { Float, OrbitControls } from '@react-three/drei';
import { useRef, useState, useEffect, Suspense } from 'react';
import * as THREE from 'three';
import { isWebGLAvailable } from '@/lib/webgl';

/**
 * HeaderAccent — a small interactive 3D mark for data-page headers (Lab,
 * Analytics, Admin). Low-poly, drag-to-spin, palette-matched. Additive focal
 * point; WebGL-guarded with a soft CSS-orb fallback.
 */
const SHAPES = {
  crystal: () => <icosahedronGeometry args={[1.15, 0]} />,
  prism: () => <octahedronGeometry args={[1.2, 0]} />,
  shield: () => <dodecahedronGeometry args={[1.05, 0]} />,
} as const;

function Mark({ variant, color }: { variant: keyof typeof SHAPES; color: string }) {
  const mesh = useRef<THREE.Mesh>(null);
  const ring = useRef<THREE.Mesh>(null);
  useFrame((_, dt) => {
    if (mesh.current) { mesh.current.rotation.y += dt * 0.5; mesh.current.rotation.x += dt * 0.2; }
    if (ring.current) { ring.current.rotation.x += dt * 0.35; ring.current.rotation.z -= dt * 0.25; }
  });
  return (
    <group>
      <mesh ref={mesh}>
        {SHAPES[variant]()}
        <meshStandardMaterial color={color} metalness={0.5} roughness={0.2} flatShading emissive={color} emissiveIntensity={0.15} />
      </mesh>
      <mesh ref={ring}>
        <torusGeometry args={[1.7, 0.018, 12, 80]} />
        <meshStandardMaterial color="#d8be94" metalness={0.6} roughness={0.3} transparent opacity={0.8} />
      </mesh>
    </group>
  );
}

export default function HeaderAccent({
  variant = 'crystal',
  color = '#8aa176',
  size = 104,
}: {
  variant?: keyof typeof SHAPES;
  color?: string;
  size?: number;
}) {
  const [ok, setOk] = useState<boolean | null>(null);
  // One-time client capability probe.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setOk(isWebGLAvailable()), []);
  if (ok === false) {
    return <div style={{ width: size, height: size, borderRadius: '50%', background: `radial-gradient(circle at 38% 32%, #d3ddc6, ${color})` }} className="animate-floaty" />;
  }
  if (ok === null) return <div style={{ width: size, height: size }} />;
  return (
    <div style={{ width: size, height: size }}>
      <Canvas camera={{ position: [0, 0, 5], fov: 42 }} dpr={[1, 1.5]} gl={{ antialias: true, alpha: true }}>
        <Suspense fallback={null}>
          <ambientLight intensity={0.8} />
          <directionalLight position={[3, 4, 5]} intensity={1.3} color="#fff6e6" />
          <pointLight position={[-4, -2, 2]} intensity={0.7} color="#a7c293" />
          <Float speed={1.6} rotationIntensity={0.6} floatIntensity={0.9}>
            <Mark variant={variant} color={color} />
          </Float>
          <OrbitControls enableZoom={false} enablePan={false} autoRotate autoRotateSpeed={0.7} />
        </Suspense>
      </Canvas>
    </div>
  );
}
