import { Suspense, useMemo, useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Text, useTexture, Environment, Sparkles, Outlines } from '@react-three/drei';
import { EffectComposer, Bloom, Vignette } from '@react-three/postprocessing';
import * as THREE from 'three';
import { supportsWebGL, SceneErrorBoundary } from './Scene3D';
import backdropUrl from '../assets/3d/backdrop.jpg';

const GOLD_BRIGHT = '#f3d675';
const GOLD = '#c9a227';
const NEON_RED = '#ff4d4d';

/**
 * Rough device-capability heuristic — real ticket-rush traffic includes a
 * lot of older phones, and a stalled/dropped-frame background is worse than
 * a slightly plainer one. Checked once per mount, not reactively.
 */
function isLowEndDevice(): boolean {
  const cores = navigator.hardwareConcurrency ?? 4;
  const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  return cores <= 4 && isMobile;
}

/** Distant textured plane — drifts slowly on its own so the far layer is never perfectly still. */
function Backdrop() {
  const texture = useTexture(backdropUrl);
  const mesh = useRef<THREE.Mesh>(null);
  useFrame((state) => {
    if (!mesh.current) return;
    mesh.current.position.x = Math.sin(state.clock.elapsedTime * 0.05) * 1.5;
  });
  return (
    <mesh ref={mesh} position={[0, 1, -22]}>
      <planeGeometry args={[52, 29.3]} />
      <meshBasicMaterial map={texture} toneMapped={false} />
    </mesh>
  );
}

/** Wet-street ground — flat cel-shaded base plus a slow breathing glow instead of a static PBR surface. */
function Ground() {
  const material = useRef<THREE.MeshToonMaterial>(null);
  useFrame((state) => {
    if (!material.current) return;
    material.current.emissiveIntensity = 0.08 + Math.sin(state.clock.elapsedTime * 0.6) * 0.05;
  });
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -4, 0]}>
      <planeGeometry args={[80, 80]} />
      <meshToonMaterial ref={material} color="#100b09" emissive={GOLD} emissiveIntensity={0.08} />
    </mesh>
  );
}

interface BuildingSpec {
  x: number;
  height: number;
  depth: number;
  width: number;
  neon: boolean;
  color: string;
  phase: number;
}

/** A cel-shaded skyline that visibly breathes — every tower bobs and every neon stripe flickers on its own phase. */
function Skyline() {
  const buildings = useMemo<BuildingSpec[]>(() => {
    const items: BuildingSpec[] = [];
    const count = 14;
    for (let i = 0; i < count; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      const x = side * (6 + (i / count) * 16 + Math.random() * 2);
      const height = 6 + Math.random() * 10;
      const depth = -6 - Math.random() * 10;
      const width = 1.5 + Math.random() * 1.5;
      items.push({
        x,
        height,
        depth,
        width,
        neon: i % 3 === 0,
        color: i % 2 === 0 ? GOLD : NEON_RED,
        phase: Math.random() * Math.PI * 2,
      });
    }
    return items;
  }, []);

  const groups = useRef<(THREE.Group | null)[]>([]);
  const neonMats = useRef<(THREE.MeshToonMaterial | null)[]>([]);

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    buildings.forEach((b, i) => {
      const group = groups.current[i];
      if (group) {
        group.position.y = b.height / 2 - 4 + Math.sin(t * 0.4 + b.phase) * 0.15;
      }
      const mat = neonMats.current[i];
      if (mat) {
        mat.emissiveIntensity = 1 + Math.sin(t * 1.8 + b.phase) * 0.6;
      }
    });
  });

  return (
    <>
      {buildings.map((b, i) => (
        <group key={i} ref={(el) => (groups.current[i] = el)} position={[b.x, b.height / 2 - 4, b.depth]}>
          <mesh>
            <boxGeometry args={[b.width, b.height, b.width]} />
            <meshToonMaterial color="#161210" />
            <Outlines thickness={0.02} color="#000000" />
          </mesh>
          {b.neon && (
            <mesh position={[0, 0, b.width / 2 + 0.02]}>
              <planeGeometry args={[b.width * 0.15, b.height * 0.6]} />
              <meshToonMaterial
                ref={(el) => (neonMats.current[i] = el)}
                color={b.color}
                emissive={b.color}
                emissiveIntensity={1.5}
                toneMapped={false}
              />
            </mesh>
          )}
        </group>
      ))}
    </>
  );
}

/** Ornate octagonal neon frame with a "TS" monogram — every ring pulses on its own phase, the whole emblem bobs and turns. */
function NeonEmblem() {
  const group = useRef<THREE.Group>(null);
  const textGroup = useRef<THREE.Group>(null);
  const ringMats = useRef<(THREE.MeshToonMaterial | null)[]>([]);

  const ringCount = 8;
  const rings = useMemo(
    () =>
      Array.from({ length: ringCount }, (_, i) => {
        const angle = (i / ringCount) * Math.PI * 2;
        const radius = 3.4;
        return {
          position: [Math.cos(angle) * radius, Math.sin(angle) * radius, 0] as [number, number, number],
          isCorner: i % 2 === 0,
          phase: i * 0.6,
        };
      }),
    [],
  );

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    if (group.current) {
      group.current.rotation.y = Math.sin(t * 0.3) * 0.2;
      group.current.rotation.x = Math.cos(t * 0.25) * 0.06;
      group.current.position.y = Math.sin(t * 0.5) * 0.2;
    }
    if (textGroup.current) {
      textGroup.current.position.z = 0.4 + Math.sin(t * 0.8) * 0.08;
      textGroup.current.rotation.z = Math.sin(t * 0.4) * 0.03;
    }
    rings.forEach((r, i) => {
      const mat = ringMats.current[i];
      if (mat) mat.emissiveIntensity = 1.6 + Math.sin(t * 2 + r.phase) * 0.8;
    });
  });

  return (
    <group ref={group} position={[0, 0, 0]}>
      <mesh>
        <torusGeometry args={[3.4, 0.14, 16, 8]} />
        <meshToonMaterial color={GOLD_BRIGHT} emissive={GOLD_BRIGHT} emissiveIntensity={2.2} toneMapped={false} />
        <Outlines thickness={0.03} color="#000000" />
      </mesh>
      {rings.map((r, i) => (
        <mesh key={i} position={r.position}>
          <torusGeometry args={[0.55, 0.09, 12, 6]} />
          <meshToonMaterial
            ref={(el) => (ringMats.current[i] = el)}
            color={r.isCorner ? NEON_RED : GOLD}
            emissive={r.isCorner ? NEON_RED : GOLD}
            emissiveIntensity={2}
            toneMapped={false}
          />
        </mesh>
      ))}
      <group ref={textGroup} position={[0, 0, 0.4]}>
        <Text fontSize={1.6} anchorX="center" anchorY="middle" letterSpacing={0.05}>
          TS
          <meshToonMaterial color={GOLD_BRIGHT} emissive={GOLD_BRIGHT} emissiveIntensity={2.5} toneMapped={false} />
        </Text>
      </group>
    </group>
  );
}

/** Blends mouse parallax with a gentle autonomous drift, so the camera never sits perfectly still even without input. */
function ParallaxCamera() {
  const { camera } = useThree();
  useFrame((state) => {
    const t = state.clock.elapsedTime;
    const driftX = Math.sin(t * 0.15) * 0.6;
    const driftY = Math.cos(t * 0.12) * 0.3;
    const targetX = state.pointer.x * 1.6 + driftX;
    const targetY = state.pointer.y * 0.9 + 0.5 + driftY;
    camera.position.x += (targetX - camera.position.x) * 0.05;
    camera.position.y += (targetY - camera.position.y) * 0.05;
    camera.lookAt(0, 0, 0);
  });
  return null;
}

function SceneContents({ lowEnd }: { lowEnd: boolean }) {
  return (
    <>
      <color attach="background" args={['#0b0806']} />
      <fog attach="fog" args={['#0b0806', 14, 34]} />
      <ambientLight intensity={0.4} />
      <directionalLight position={[4, 8, 4]} intensity={1.2} color="#fff2d9" />
      <pointLight position={[0, 2, 6]} intensity={3} color={GOLD_BRIGHT} />
      {!lowEnd && <Environment preset="night" environmentIntensity={0.25} />}
      <Suspense fallback={null}>
        <Backdrop />
      </Suspense>
      <Ground />
      <Skyline />
      <NeonEmblem />
      <ParallaxCamera />
      {!lowEnd && (
        <Sparkles count={80} scale={[24, 10, 20]} size={2} speed={0.4} opacity={0.35} color={GOLD_BRIGHT} />
      )}
      <EffectComposer>
        <Bloom
          intensity={lowEnd ? 0.6 : 1}
          luminanceThreshold={0.4}
          luminanceSmoothing={0.6}
          mipmapBlur={!lowEnd}
        />
        <Vignette eskil={false} offset={0.15} darkness={0.9} />
      </EffectComposer>
    </>
  );
}

interface Real3DSceneProps {
  fallback: React.ReactNode;
}

/**
 * A genuine, full-scene 3D environment rendered in a flat, cel-shaded
 * ("animated-film") style rather than photoreal PBR — every object (ground,
 * skyline, sparkles, the neon emblem, even the distant backdrop and camera)
 * has its own continuous motion instead of sitting static, and outlined
 * toon materials give it a hand-drawn look. Falls back to plain 2D content
 * on unsupported devices or render failure, and trims effects on detected
 * low-end mobile hardware so a ticket-rush crowd on old phones doesn't get
 * a stuttering background.
 */
export function Real3DScene({ fallback }: Real3DSceneProps) {
  if (!supportsWebGL()) return <>{fallback}</>;
  const lowEnd = isLowEndDevice();

  return (
    <SceneErrorBoundary fallback={fallback}>
      <Canvas
        camera={{ position: [0, 0.5, 9], fov: 50 }}
        dpr={lowEnd ? 1 : [1, 1.5]}
        gl={{ toneMapping: THREE.ACESFilmicToneMapping }}
      >
        <SceneContents lowEnd={lowEnd} />
      </Canvas>
    </SceneErrorBoundary>
  );
}
