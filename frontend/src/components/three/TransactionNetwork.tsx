'use client';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useMemo, useRef, useState, useEffect, Suspense } from 'react';
import * as THREE from 'three';
import { isWebGLAvailable } from '@/lib/webgl';

/**
 * TransactionNetwork — an immersive 3D "surveillance" view of a live payment
 * network. Nodes sit on a sphere; most glow sage (safe), a few pulse terracotta
 * (fraud). Energy pulses travel the edges and the whole graph rotates toward the
 * cursor — an Orwell-style watching-eye over the transaction graph, themed to
 * fraud detection. Pure lights, no external assets.
 */

const N = 64;
const SAGE = new THREE.Color('#8aa176');
const FERN = new THREE.Color('#a7c293');
const CLAY = new THREE.Color('#c0714f');
const GOLD = new THREE.Color('#d8be94');

// Seeded, deterministic PRNG (pure) — stable graph, no render-impurity.
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function fibonacciSphere(n: number, radius: number) {
  const pts: THREE.Vector3[] = [];
  const phi = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y = 1 - (i / (n - 1)) * 2;
    const r = Math.sqrt(1 - y * y);
    const theta = phi * i;
    pts.push(new THREE.Vector3(Math.cos(theta) * r, y, Math.sin(theta) * r).multiplyScalar(radius));
  }
  return pts;
}

function Graph() {
  const group = useRef<THREE.Group>(null);
  const inst = useRef<THREE.InstancedMesh>(null);
  const { pointer } = useThree();

  const { nodes, fraudIdx, edges, pulses } = useMemo(() => {
    const rng = mulberry32(20260617);
    const nodes = fibonacciSphere(N, 2.4);
    const fraudIdx = new Set<number>();
    while (fraudIdx.size < 8) fraudIdx.add(Math.floor(rng() * N));

    // edges: connect each node to its 2 nearest neighbours
    const edgePairs: [number, number][] = [];
    for (let i = 0; i < N; i++) {
      const d = nodes.map((p, j) => ({ j, dist: p.distanceTo(nodes[i]) })).filter((o) => o.j !== i).sort((a, b) => a.dist - b.dist);
      for (let k = 0; k < 2; k++) {
        const j = d[k].j;
        if (!edgePairs.some(([a, b]) => (a === i && b === j) || (a === j && b === i))) edgePairs.push([i, j]);
      }
    }
    const positions = new Float32Array(edgePairs.length * 6);
    edgePairs.forEach(([a, b], i) => {
      positions.set([nodes[a].x, nodes[a].y, nodes[a].z, nodes[b].x, nodes[b].y, nodes[b].z], i * 6);
    });

    // pulses travel along a subset of edges
    const pulses = Array.from({ length: 7 }, () => ({
      edge: edgePairs[Math.floor(rng() * edgePairs.length)],
      t: rng(),
      speed: 0.25 + rng() * 0.4,
      fraud: rng() < 0.3,
    }));

    return { nodes, fraudIdx, edges: positions, pulses };
  }, []);

  const dummy = useMemo(() => new THREE.Object3D(), []);
  const pulseRefs = useRef<THREE.Mesh[]>([]);

  useFrame((state, dt) => {
    if (group.current) {
      group.current.rotation.y += dt * 0.06;
      // ease toward cursor
      group.current.rotation.x += (pointer.y * 0.4 - group.current.rotation.x) * 0.04;
      group.current.rotation.z += (-pointer.x * 0.2 - group.current.rotation.z) * 0.04;
    }
    // node scale pulse for fraud
    if (inst.current) {
      const time = state.clock.elapsedTime;
      nodes.forEach((p, i) => {
        const isFraud = fraudIdx.has(i);
        const s = isFraud ? 0.07 + Math.sin(time * 3 + i) * 0.03 : 0.045;
        dummy.position.copy(p);
        dummy.scale.setScalar(s);
        dummy.updateMatrix();
        inst.current!.setMatrixAt(i, dummy.matrix);
        inst.current!.setColorAt(i, isFraud ? CLAY : i % 3 === 0 ? FERN : SAGE);
      });
      inst.current.instanceMatrix.needsUpdate = true;
      if (inst.current.instanceColor) inst.current.instanceColor.needsUpdate = true;
    }
    // move pulses along edges
    pulses.forEach((pulse, i) => {
      pulse.t += dt * pulse.speed;
      if (pulse.t > 1) pulse.t = 0;
      const [a, b] = pulse.edge;
      const m = pulseRefs.current[i];
      if (m) m.position.lerpVectors(nodes[a], nodes[b], pulse.t);
    });
  });

  return (
    <group ref={group}>
      {/* edges */}
      <lineSegments>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[edges, 3]} />
        </bufferGeometry>
        <lineBasicMaterial color="#8aa176" transparent opacity={0.32} />
      </lineSegments>

      {/* nodes */}
      <instancedMesh ref={inst} args={[undefined, undefined, N]}>
        <sphereGeometry args={[1, 12, 12]} />
        <meshStandardMaterial roughness={0.4} metalness={0.2} emissive="#5f6657" emissiveIntensity={0.15} />
      </instancedMesh>

      {/* traveling pulses */}
      {pulses.map((p, i) => (
        <mesh key={i} ref={(el) => { if (el) pulseRefs.current[i] = el; }}>
          <sphereGeometry args={[p.fraud ? 0.06 : 0.045, 10, 10]} />
          <meshStandardMaterial color={p.fraud ? '#c0714f' : '#d8be94'} emissive={p.fraud ? '#c0714f' : '#8aa176'} emissiveIntensity={0.8} />
        </mesh>
      ))}

      {/* faint core glow */}
      <mesh>
        <sphereGeometry args={[1.2, 24, 24]} />
        <meshBasicMaterial color={GOLD} transparent opacity={0.04} />
      </mesh>
    </group>
  );
}

export default function TransactionNetwork() {
  const [supported, setSupported] = useState<boolean | null>(null);
  // One-time client capability probe.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setSupported(isWebGLAvailable()), []);
  if (supported === null) return null;
  if (!supported) {
    return (
      <div style={{ width: '100%', height: '100%', background: 'radial-gradient(circle at 50% 45%, rgba(138,161,118,0.18), transparent 60%)' }} />
    );
  }
  return (
    <Canvas camera={{ position: [0, 0, 7], fov: 45 }} dpr={[1, 2]} gl={{ antialias: true, alpha: true }} style={{ width: '100%', height: '100%' }}>
      <Suspense fallback={null}>
        <ambientLight intensity={0.6} />
        <directionalLight position={[5, 5, 5]} intensity={1.1} color="#fff6e6" />
        <pointLight position={[-5, -2, 3]} intensity={0.7} color="#a7c293" />
        <Graph />
      </Suspense>
    </Canvas>
  );
}
