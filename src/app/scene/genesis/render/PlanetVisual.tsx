/**
 * ==========================================================
 * LÉLUVERSE — PLANET VISUAL (GUARANTEED RENDER)
 *
 * Uses ONLY standard Three.js materials (MeshStandardMaterial,
 * MeshBasicMaterial). Zero custom shaders. Zero risk of silent
 * WebGL compilation failure. If this doesn't render, Three.js
 * itself is broken.
 *
 * Renders as CHILDREN of the Core group — never a separate object.
 * The Core IS the planet. Layers add on top.
 * ==========================================================
 */

import { useRef, useMemo, useEffect, useState } from "react";
import { useFrame } from "@react-three/fiber";
import {
  Group,
  MeshStandardMaterial,
  MeshBasicMaterial,
  Mesh,
  Color,
  AdditiveBlending,
  DoubleSide,
} from "three";
import WorldLifecycle from "../engines/WorldLifecycle";
import { WorldPhase } from "../engines/EngineDomains";

// ── Seeded RNG ──

function mulberry32(a: number) {
  return () => {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── OCEAN LAYER ──
// A simple blue sphere slightly larger than the core.

function OceanLayer({ visible, opacity }: { visible: boolean; opacity: number }) {
  const meshRef = useRef<Mesh>(null);

  useFrame(() => {
    if (!meshRef.current) return;
    const mat = meshRef.current.material as MeshStandardMaterial;
    mat.opacity = opacity;
  });

  return (
    <mesh ref={meshRef} renderOrder={100} visible={visible}>
      <sphereGeometry args={[1.01, 48, 48]} />
      <meshStandardMaterial
        color={new Color(0x0a3d6b)}
        emissive={new Color(0x051a33)}
        emissiveIntensity={0.15}
        metalness={0.3}
        roughness={0.6}
        transparent
        opacity={opacity}
      />
    </mesh>
  );
}

// ── CONTINENT LAYER ──
// Green patches scattered on the surface.

function ContinentLayer({ visible, opacity }: { visible: boolean; opacity: number }) {
  const meshRef = useRef<Mesh>(null);

  useFrame(() => {
    if (!meshRef.current) return;
    const mat = meshRef.current.material as MeshStandardMaterial;
    mat.opacity = opacity;
  });

  return (
    <mesh ref={meshRef} renderOrder={101} visible={visible}>
      <sphereGeometry args={[1.015, 48, 48]} />
      <meshStandardMaterial
        color={new Color(0x1a7a35)}
        emissive={new Color(0x0a3518)}
        emissiveIntensity={0.08}
        metalness={0.1}
        roughness={0.8}
        transparent
        opacity={opacity}
      />
    </mesh>
  );
}

// ── ATMOSPHERE LAYER ──
// Rim-lit translucent blue sphere.

function AtmosphereLayer({ visible, opacity }: { visible: boolean; opacity: number }) {
  const meshRef = useRef<Mesh>(null);

  useFrame(() => {
    if (!meshRef.current) return;
    const mat = meshRef.current.material as MeshBasicMaterial;
    mat.opacity = opacity;
  });

  return (
    <mesh ref={meshRef} renderOrder={110} visible={visible}>
      <sphereGeometry args={[1.2, 32, 32]} />
      <meshBasicMaterial
        color={new Color(0x4488ff)}
        transparent
        opacity={opacity}
        side={DoubleSide}
        depthWrite={false}
        blending={AdditiveBlending}
      />
    </mesh>
  );
}

// ── CLOUD LAYER ──
// Slightly larger white translucent sphere.

function CloudLayer({ visible, opacity }: { visible: boolean; opacity: number }) {
  const meshRef = useRef<Mesh>(null);

  useFrame((_, delta) => {
    if (!meshRef.current) return;
    const mat = meshRef.current.material as MeshBasicMaterial;
    mat.opacity = opacity;
    // Slow rotation for drifting clouds
    meshRef.current.rotation.y += delta * 0.01;
  });

  return (
    <mesh ref={meshRef} renderOrder={105} visible={visible}>
      <sphereGeometry args={[1.06, 32, 32]} />
      <meshBasicMaterial
        color={new Color(0xffffff)}
        transparent
        opacity={opacity}
        depthWrite={false}
      />
    </mesh>
  );
}

// ── CITY LIGHTS LAYER ──
// Scattered bright dots on the surface.

function CityLightsLayer({ visible }: { visible: boolean }) {
  const groupRef = useRef<Group>(null);

  const positions = useMemo(() => {
    const rng = mulberry32(99);
    const pts: [number, number, number][] = [];
    for (let i = 0; i < 30; i++) {
      const theta = rng() * Math.PI * 2;
      const phi = Math.acos(2 * rng() - 1);
      const r = 1.02;
      pts.push([
        r * Math.sin(phi) * Math.cos(theta),
        r * Math.sin(phi) * Math.sin(theta),
        r * Math.cos(phi),
      ]);
    }
    return pts;
  }, []);

  useFrame((_, delta) => {
    if (!groupRef.current) return;
    groupRef.current.rotation.y += delta * 0.02;
  });

  return (
    <group ref={groupRef} visible={visible}>
      {positions.map((pos, i) => (
        <mesh key={i} position={pos}>
          <sphereGeometry args={[0.012, 4, 4]} />
          <meshBasicMaterial color={new Color(1.0, 0.95, 0.6)} />
        </mesh>
      ))}
    </group>
  );
}

// ── SUN (distant star) ──

function SunObject({ visible }: { visible: boolean }) {
  return (
    <group position={[60, 30, 50]} visible={visible}>
      {/* Sun body */}
      <mesh>
        <sphereGeometry args={[2.5, 24, 24]} />
        <meshBasicMaterial color={new Color(1.0, 0.95, 0.7)} />
      </mesh>
      {/* Sun glow */}
      <mesh>
        <sphereGeometry args={[4.5, 24, 24]} />
        <meshBasicMaterial
          color={new Color(1.0, 0.85, 0.3)}
          transparent
          opacity={0.12}
          blending={AdditiveBlending}
          depthWrite={false}
        />
      </mesh>
      {/* Sun point light */}
      <pointLight
        color={new Color(1.0, 0.95, 0.85)}
        intensity={3}
        distance={200}
        decay={0.5}
      />
    </group>
  );
}

// ── MAIN: PLANET LAYERS ──
// These are rendered as CHILDREN of the Core group.
// The Core never disappears. Layers add on top.

export default function PlanetVisualLayers() {
  const [lifecycleState, setLifecycleState] = useState(() =>
    WorldLifecycle.getInstance().getState()
  );

  useEffect(() => {
    return WorldLifecycle.getInstance().subscribe(setLifecycleState);
  }, []);

  const { phase, phaseProgress } = lifecycleState;

  // What layers to show per phase
  const showOcean = phase !== WorldPhase.CORE_SEED && phase !== WorldPhase.REBIRTH;
  const showContinents =
    phase === WorldPhase.LIFE ||
    phase === WorldPhase.MIND ||
    phase === WorldPhase.FULL_WORLD ||
    phase === WorldPhase.SUNSET;
  const showAtmosphere =
    phase === WorldPhase.EXPANSION ||
    phase === WorldPhase.PLANET ||
    phase === WorldPhase.LIFE ||
    phase === WorldPhase.MIND ||
    phase === WorldPhase.FULL_WORLD ||
    phase === WorldPhase.SUNSET ||
    phase === WorldPhase.COLLAPSE;
  const showClouds =
    phase === WorldPhase.LIFE ||
    phase === WorldPhase.MIND ||
    phase === WorldPhase.FULL_WORLD ||
    phase === WorldPhase.SUNSET;
  const showCityLights =
    phase === WorldPhase.FULL_WORLD || phase === WorldPhase.SUNSET;
  const showSun = phase !== WorldPhase.CORE_SEED;

  // Opacity values
  const oceanOpacity = showOcean
    ? phase === WorldPhase.FORMATION
      ? 0.3 + phaseProgress * 0.6
      : phase === WorldPhase.COLLAPSE
        ? 0.8 * (1 - phaseProgress)
        : 0.85
    : 0;

  const continentOpacity = showContinents ? 0.75 : 0;
  const atmosphereOpacity = showAtmosphere
    ? phase === WorldPhase.COLLAPSE
      ? 0.3 * (1 - phaseProgress)
      : 0.2
    : 0;
  const cloudOpacity = showClouds ? 0.15 : 0;

  return (
    <>
      <OceanLayer visible={showOcean} opacity={oceanOpacity} />
      <ContinentLayer visible={showContinents} opacity={continentOpacity} />
      <CloudLayer visible={showClouds} opacity={cloudOpacity} />
      <CityLightsLayer visible={showCityLights} />
      <AtmosphereLayer visible={showAtmosphere} opacity={atmosphereOpacity} />
      <SunObject visible={showSun} />
    </>
  );
}

// Re-export React for the useState/useEffect calls above
