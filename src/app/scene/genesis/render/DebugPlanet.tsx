/**
 * ==========================================================
 * LÉLUVERSE — HIGH-QUALITY EARTH PLANET
 *
 * Uses procedural Canvas2D textures for:
 * - Earth surface (oceans + continents + terrain + ice caps)
 * - Cloud layers
 * - City lights (night side)
 * - Atmospheric scattering (rim glow)
 * - Sunset/warm glow during SUNSET phase
 * - Explosion particles during REBIRTH phase
 *
 * All lifecycle-connected. Each phase adds/removes visual layers.
 * ==========================================================
 */

import { useRef, useState, useEffect, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import {
  Group,
  Mesh,
  Color,
  CanvasTexture,
  AdditiveBlending,
  DoubleSide,
} from "three";
import WorldLifecycle from "../engines/WorldLifecycle";
import { WorldPhase, type WorldPhaseType } from "../engines/EngineDomains";
import {
  generateEarthSurface,
  generateCloudTexture,
  generateCityLightsTexture,
} from "./PlanetTextures";
import {
  PlanetCities,
  PlanetPopulation,
  PlanetVehicles,
  PlanetWeather,
  PlanetFloatingCities,
} from "./PlanetCivilization";

// ── Explosion particles ──

interface EjectedParticle {
  pos: [number, number, number];
  vel: [number, number, number];
  size: number;
  type: "energy" | "city" | "person" | "vehicle" | "element" | "memory";
  color: Color;
}

function ExplosionParticles({ active, progress }: { active: boolean; progress: number }) {
  const groupRef = useRef<Group>(null);

  const particles = useMemo(() => {
    const pts: EjectedParticle[] = [];

    // Energy particles (60)
    for (let i = 0; i < 60; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const speed = 2 + Math.random() * 8;
      pts.push({
        pos: [Math.sin(phi) * Math.cos(theta) * 0.5, Math.sin(phi) * Math.sin(theta) * 0.5, Math.cos(phi) * 0.5],
        vel: [Math.sin(phi) * Math.cos(theta) * speed, Math.sin(phi) * Math.sin(theta) * speed, Math.cos(phi) * speed],
        size: 0.02 + Math.random() * 0.04,
        type: "energy",
        color: new Color(1.0, 0.6 + Math.random() * 0.4, 0.2),
      });
    }

    // City fragments (20) — larger, rectangular
    for (let i = 0; i < 20; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const speed = 1.5 + Math.random() * 5;
      pts.push({
        pos: [Math.sin(phi) * Math.cos(theta) * 0.8, Math.sin(phi) * Math.sin(theta) * 0.8, Math.cos(phi) * 0.8],
        vel: [Math.sin(phi) * Math.cos(theta) * speed, Math.sin(phi) * Math.sin(theta) * speed, Math.cos(phi) * speed],
        size: 0.04 + Math.random() * 0.08,
        type: "city",
        color: new Color(0.5, 0.6, 0.8),
      });
    }

    // People silhouettes (15) — small capsules
    for (let i = 0; i < 15; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const speed = 2 + Math.random() * 6;
      pts.push({
        pos: [Math.sin(phi) * Math.cos(theta) * 0.6, Math.sin(phi) * Math.sin(theta) * 0.6, Math.cos(phi) * 0.6],
        vel: [Math.sin(phi) * Math.cos(theta) * speed, Math.sin(phi) * Math.sin(theta) * speed, Math.cos(phi) * speed],
        size: 0.015,
        type: "person",
        color: new Color(0.9, 0.85, 0.8),
      });
    }

    // Vehicles (10)
    for (let i = 0; i < 10; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const speed = 3 + Math.random() * 7;
      pts.push({
        pos: [Math.sin(phi) * Math.cos(theta) * 0.7, Math.sin(phi) * Math.sin(theta) * 0.7, Math.cos(phi) * 0.7],
        vel: [Math.sin(phi) * Math.cos(theta) * speed, Math.sin(phi) * Math.sin(theta) * speed, Math.cos(phi) * speed],
        size: 0.025,
        type: "vehicle",
        color: new Color(1.0, 0.9, 0.6),
      });
    }

    // Element streams (30) — water, minerals, atmosphere
    for (let i = 0; i < 30; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const speed = 4 + Math.random() * 10;
      pts.push({
        pos: [Math.sin(phi) * Math.cos(theta) * 0.4, Math.sin(phi) * Math.sin(theta) * 0.4, Math.cos(phi) * 0.4],
        vel: [Math.sin(phi) * Math.cos(theta) * speed, Math.sin(phi) * Math.sin(theta) * speed, Math.cos(phi) * speed],
        size: 0.01 + Math.random() * 0.03,
        type: "element",
        color: new Color(0.3 + Math.random() * 0.5, 0.5 + Math.random() * 0.5, 0.8 + Math.random() * 0.2),
      });
    }

    // Memory/knowledge (15) — glowing data streams
    for (let i = 0; i < 15; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const speed = 1 + Math.random() * 4;
      pts.push({
        pos: [Math.sin(phi) * Math.cos(theta) * 0.3, Math.sin(phi) * Math.sin(theta) * 0.3, Math.cos(phi) * 0.3],
        vel: [Math.sin(phi) * Math.cos(theta) * speed, Math.sin(phi) * Math.sin(theta) * speed, Math.cos(phi) * speed],
        size: 0.015,
        type: "memory",
        color: new Color(0.6, 0.8, 1.0),
      });
    }

    return pts;
  }, []);

  useFrame(() => {
    if (!groupRef.current || !active) return;
    const t = progress;
    groupRef.current.children.forEach((child, i) => {
      if (i >= particles.length) return;
      const p = particles[i];
      const mesh = child as Mesh;
      mesh.position.set(
        p.pos[0] + p.vel[0] * t,
        p.pos[1] + p.vel[1] * t,
        p.pos[2] + p.vel[2] * t,
      );
      const fade = Math.max(0, 1 - t * 1.5);
      const scale = fade * p.size * 10;
      mesh.scale.setScalar(scale);
      (mesh.material as any).opacity = fade * 0.8;
    });
  });

  if (!active) return null;

  return (
    <group ref={groupRef}>
      {particles.map((p, i) => (
        <mesh key={i} position={p.pos}>
          {p.type === "city" ? (
            <boxGeometry args={[p.size, p.size * 1.5, p.size]} />
          ) : p.type === "person" ? (
            <sphereGeometry args={[p.size, 4, 4]} />
          ) : p.type === "vehicle" ? (
            <boxGeometry args={[p.size * 2, p.size * 0.5, p.size]} />
          ) : (
            <sphereGeometry args={[p.size, 4, 4]} />
          )}
          <meshBasicMaterial
            color={p.color}
            transparent
            opacity={0.8}
            blending={p.type === "memory" ? AdditiveBlending : undefined}
            depthWrite={false}
          />
        </mesh>
      ))}
    </group>
  );
}

// ── Shockwave ring ──

function ShockwaveRing({ active, progress }: { active: boolean; progress: number }) {
  const ref = useRef<Mesh>(null);

  useFrame(() => {
    if (!ref.current || !active) return;
    const scale = progress * 15;
    ref.current.scale.setScalar(scale);
    (ref.current.material as any).opacity = Math.max(0, 0.6 - progress * 0.8);
  });

  if (!active) return null;

  return (
    <mesh ref={ref} renderOrder={200}>
      <ringGeometry args={[0.9, 1.0, 64]} />
      <meshBasicMaterial
        color={new Color(1.0, 0.8, 0.4)}
        transparent
        opacity={0.6}
        side={DoubleSide}
        depthWrite={false}
        blending={AdditiveBlending}
      />
    </mesh>
  );
}

// ── HIGH-QUALITY EARTH PLANET ──

export function TestPlanet() {
  const groupRef = useRef<Group>(null);
  const surfaceRef = useRef<Mesh>(null);
  const cloudsRef = useRef<Mesh>(null);
  const atmosphereRef = useRef<Mesh>(null);
  const cityLightsRef = useRef<Mesh>(null);
  const nightGlowRef = useRef<Mesh>(null);

  const [phase, setPhase] = useState<WorldPhaseType>(() =>
    WorldLifecycle.getInstance().getState().phase
  );
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    return WorldLifecycle.getInstance().subscribe((state) => {
      setPhase(state.phase);
      setProgress(state.phaseProgress);
    });
  }, []);

  // Generate procedural textures (once)
  const surfaceTexture = useMemo(() => {
    const canvas = generateEarthSurface(1024);
    return new CanvasTexture(canvas);
  }, []);

  const cloudTexture = useMemo(() => {
    const canvas = generateCloudTexture(1024);
    return new CanvasTexture(canvas);
  }, []);

  const cityLightsTexture = useMemo(() => {
    const canvas = generateCityLightsTexture(1024);
    return new CanvasTexture(canvas);
  }, []);

  // Phase-driven values
  const isRebirth = phase === WorldPhase.REBIRTH;
  const isCollapse = phase === WorldPhase.COLLAPSE;
  const isSunset = phase === WorldPhase.SUNSET;
  const isExplosion = phase === WorldPhase.REBIRTH && progress > 0.3 && progress < 0.8;

  // Planet scale (grows during formation, shrinks during collapse)
  const planetScale = useMemo(() => {
    switch (phase) {
      case WorldPhase.CORE_SEED: return 0.6;
      case WorldPhase.FORMATION: return 0.6 + progress * 0.4;
      case WorldPhase.EXPANSION: return 0.9 + progress * 0.15;
      case WorldPhase.PLANET:
      case WorldPhase.LIFE:
      case WorldPhase.MIND:
      case WorldPhase.FULL_WORLD:
      case WorldPhase.SUNSET:
        return 1.05;
      case WorldPhase.COLLAPSE:
        return 1.05 * (1 - progress * 0.5);
      case WorldPhase.REBIRTH:
        return 0.5 + Math.sin(progress * Math.PI * 3) * 0.3;
      default: return 0.6;
    }
  }, [phase, progress]);

  // Surface visibility
  const surfaceOpacity = phase === WorldPhase.REBIRTH ? 0.3 : 1.0;

  // Atmosphere
  const atmosphereOpacity = (() => {
    if (phase === WorldPhase.CORE_SEED) return 0.02;
    if (phase === WorldPhase.FORMATION) return 0.02 + progress * 0.08;
    if (isCollapse) return 0.15 * (1 - progress);
    if (isSunset) return 0.15 + progress * 0.08;
    if (isRebirth) return 0.05;
    return 0.12;
  })();

  // Sunset warm color
  const atmosphereColor = isSunset
    ? new Color(1.0, 0.5 + progress * 0.3, 0.2 + progress * 0.1)
    : isRebirth
      ? new Color(0.8, 0.9, 1.0)
      : new Color(0.3, 0.6, 1.0);

  // Clouds
  const showClouds = phase !== WorldPhase.CORE_SEED && phase !== WorldPhase.REBIRTH;
  const cloudOpacity = isCollapse ? 0.3 * (1 - progress) : 0.35;

  // City lights
  const showCityLights = phase === WorldPhase.FULL_WORLD || phase === WorldPhase.SUNSET ||
    (phase === WorldPhase.MIND && progress > 0.5);

  // Night glow
  const showNightGlow = showCityLights;

  // Civilization visibility
  const showCivilization = phase === WorldPhase.FULL_WORLD || phase === WorldPhase.SUNSET;
  const showPopulation = phase === WorldPhase.LIFE || phase === WorldPhase.MIND || showCivilization;
  const showVehicles = showCivilization;
  const showWeather = phase === WorldPhase.LIFE || phase === WorldPhase.MIND || showCivilization;
  const showFloatingCities = showCivilization;
  const civilizationOpacity = isCollapse ? (1 - progress) : 1.0;

  // Rotation
  useFrame((_, delta) => {
    if (!groupRef.current) return;
    groupRef.current.rotation.y += delta * 0.06;
    if (cloudsRef.current) cloudsRef.current.rotation.y += delta * 0.012;
  });

  return (
    <group position={[0, 1.15, 0]}>
      {/* Main planet group (scales with lifecycle) */}
      <group ref={groupRef} scale={[planetScale, planetScale, planetScale]}>
        {/* Surface sphere with procedural Earth texture */}
        <mesh ref={surfaceRef} renderOrder={150}>
          <sphereGeometry args={[2.0, 128, 128]} />
          <meshStandardMaterial
            map={surfaceTexture}
            emissive={isSunset ? new Color(0.4, 0.15, 0.05) : new Color(0x050a15)}
            emissiveIntensity={isSunset ? 0.15 + progress * 0.1 : 0.05}
            metalness={0.1}
            roughness={0.7}
            transparent
            opacity={surfaceOpacity}
          />
        </mesh>

        {/* Cloud sphere */}
        {showClouds && (
          <mesh ref={cloudsRef} renderOrder={152}>
            <sphereGeometry args={[2.03, 96, 96]} />
            <meshStandardMaterial
              map={cloudTexture}
              transparent
              opacity={cloudOpacity}
              depthWrite={false}
              side={DoubleSide}
            />
          </mesh>
        )}

        {/* City lights (visible on dark side) */}
        {showCityLights && (
          <mesh ref={cityLightsRef} renderOrder={153}>
            <sphereGeometry args={[2.01, 96, 96]} />
            <meshBasicMaterial
              map={cityLightsTexture}
              transparent
              opacity={0.8}
              depthWrite={false}
              blending={AdditiveBlending}
            />
          </mesh>
        )}

        {/* Night-side warm glow */}
        {showNightGlow && (
          <mesh ref={nightGlowRef} renderOrder={154}>
            <sphereGeometry args={[2.06, 48, 48]} />
            <meshBasicMaterial
              color={new Color(0.8, 0.5, 0.2)}
              transparent
              opacity={0.04}
              depthWrite={false}
              blending={AdditiveBlending}
            />
          </mesh>
        )}

        {/* Atmosphere (rim glow) */}
        <mesh ref={atmosphereRef} renderOrder={160}>
          <sphereGeometry args={[2.2, 64, 64]} />
          <meshBasicMaterial
            color={atmosphereColor}
            transparent
            opacity={atmosphereOpacity}
            side={DoubleSide}
            depthWrite={false}
            blending={AdditiveBlending}
          />
        </mesh>

        {/* Rebirth flash */}
        {isRebirth && (
          <mesh renderOrder={170}>
            <sphereGeometry args={[3.0, 32, 32]} />
            <meshBasicMaterial
              color={new Color(1.0, 0.9, 0.7)}
              transparent
              opacity={0.4 + Math.sin(progress * Math.PI * 8) * 0.3}
              depthWrite={false}
              blending={AdditiveBlending}
            />
          </mesh>
        )}

        {/* ── CIVILIZATION LAYERS ── */}

        {/* 3D Cities (buildings on surface) */}
        <PlanetCities
          visible={showCivilization}
          planetRadius={2.0}
          opacity={civilizationOpacity}
        />

        {/* Population (people dots) */}
        <PlanetPopulation
          visible={showPopulation}
          planetRadius={2.0}
          opacity={isCollapse ? 0.4 : 0.7}
        />

        {/* Vehicles (moving dots) */}
        <PlanetVehicles
          visible={showVehicles}
          planetRadius={2.0}
          opacity={civilizationOpacity * 0.8}
        />

        {/* Weather systems */}
        <PlanetWeather
          visible={showWeather}
          planetRadius={2.0}
          opacity={civilizationOpacity * 0.6}
        />

        {/* Floating cities above planet */}
        <PlanetFloatingCities
          visible={showFloatingCities}
          planetRadius={2.0}
          opacity={civilizationOpacity * 0.9}
        />
      </group>

      {/* Explosion effects (outside planet group, don't scale with it) */}
      <ExplosionParticles active={isExplosion} progress={(progress - 0.3) / 0.5} />
      <ShockwaveRing active={isExplosion} progress={(progress - 0.3) / 0.5} />

      {/* Directional sunlight */}
      <directionalLight
        position={[8, 4, 6]}
        intensity={isSunset ? 1.5 : 2.5}
        color={isSunset ? new Color(1.0, 0.7, 0.4) : new Color(1.0, 0.98, 0.92)}
      />
      <ambientLight intensity={isSunset ? 0.15 : 0.12} color={new Color(0.2, 0.25, 0.4)} />
    </group>
  );
}

// ── Phase Test Buttons (collapsible) ──

const PHASE_BUTTONS: { label: string; phase: WorldPhaseType }[] = [
  { label: "◉ CORE", phase: WorldPhase.CORE_SEED },
  { label: "✦ FORM", phase: WorldPhase.FORMATION },
  { label: "✧ EXPAND", phase: WorldPhase.EXPANSION },
  { label: "🌍 PLANET", phase: WorldPhase.PLANET },
  { label: "🌿 LIFE", phase: WorldPhase.LIFE },
  { label: "🧠 MIND", phase: WorldPhase.MIND },
  { label: "🌐 WORLD", phase: WorldPhase.FULL_WORLD },
  { label: "🌅 SUNSET", phase: WorldPhase.SUNSET },
  { label: "⊗ COLLAPSE", phase: WorldPhase.COLLAPSE },
  { label: "💥 REBIRTH", phase: WorldPhase.REBIRTH },
];

export function PhaseTestButtons() {
  const lifecycle = WorldLifecycle.getInstance();
  const [phase, setPhase] = useState<WorldPhaseType>(() => lifecycle.getState().phase);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    return lifecycle.subscribe((s) => setPhase(s.phase));
  }, []);

  const forcePhase = (p: WorldPhaseType) => {
    try {
      lifecycle.pause();
      lifecycle.advanceToPhase(p);
    } catch (err) {
      console.error("[PhaseTest] Failed:", err);
    }
  };

  return (
    <div
      style={{
        position: "fixed",
        top: 8,
        left: 8,
        zIndex: 9999,
        fontFamily: "system-ui, sans-serif",
        fontSize: 11,
        pointerEvents: "auto",
      }}
    >
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        style={{
          background: "rgba(8,16,32,0.85)",
          color: "#7dd3fc",
          border: "1px solid rgba(125,211,252,0.3)",
          borderRadius: 6,
          padding: "5px 10px",
          cursor: "pointer",
          fontSize: 11,
          fontFamily: "inherit",
          backdropFilter: "blur(8px)",
        }}
      >
        {expanded ? "▾ PHASE" : "▸ " + phase.replace("_", " ").toUpperCase()}
      </button>

      {expanded && (
        <div
          style={{
            marginTop: 4,
            background: "rgba(8,16,32,0.92)",
            border: "1px solid rgba(125,211,252,0.2)",
            borderRadius: 6,
            padding: 6,
            display: "flex",
            flexDirection: "column",
            gap: 3,
            backdropFilter: "blur(12px)",
          }}
        >
          {PHASE_BUTTONS.map((btn) => (
            <button
              key={btn.phase}
              type="button"
              onClick={() => forcePhase(btn.phase)}
              style={{
                background: phase === btn.phase ? "rgba(125,211,252,0.15)" : "transparent",
                color: phase === btn.phase ? "#7dd3fc" : "rgba(200,220,240,0.6)",
                border: `1px solid ${phase === btn.phase ? "rgba(125,211,252,0.4)" : "transparent"}`,
                borderRadius: 4,
                padding: "4px 8px",
                cursor: "pointer",
                fontSize: 10,
                fontFamily: "inherit",
                textAlign: "left",
              }}
            >
              {btn.label}
            </button>
          ))}
          <div style={{ color: "rgba(148,163,184,0.5)", fontSize: 9, marginTop: 2 }}>
            Lifecycle paused. Click a phase.
          </div>
        </div>
      )}
    </div>
  );
}
