/**
 * ==========================================================
 * LÉLUVERSE — COSMOS VISUAL COMPONENTS
 *
 * All Three.js visual layers rendered inside the infinite cosmos:
 *   1. Aurora Waves — misty fluorescent gas clouds flowing through space (BEHIND core)
 *   2. Space Waves — periodic energy ripples
 *   3. Flying Cars — visible vehicles with glow
 *   4. Zodiac Observatory — 12 signs, Earth, Moon, eclipses
 *   5. Weather Storms / Tornadoes
 *   6. Floating Cities
 * ==========================================================
 */

import { useRef, useState, useMemo } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import {
  Group,
  Vector3,
  Color,
  AdditiveBlending,
} from "three";
import FloatingCityEngine from "../engines/FloatingCityEngine";
import { ZODIAC_SIGNS } from "../engines/ZodiacObservatory";
import { sampleCosmosAtmosphere } from "./CosmosAtmosphere";

/* ==================================================================
 * 1. AURORA — Fluorescent Living Light Ribbons
 *
 * Vibrant, luminous flowing auroras that move through space.
 * Each aurora is a chain of soft translucent spheres creating
 * a flowing ribbon effect with iridescent color transitions.
 * ================================================================== */

const AURORA_COUNT = 12;
const RIBBON_SEGMENTS = 20;

const AURORA_PALETTE = [
  { h: 170, s: 1.0, l: 0.65 }, // vibrant cyan
  { h: 200, s: 0.95, l: 0.6 }, // electric blue
  { h: 280, s: 1.0, l: 0.6 },  // neon purple
  { h: 320, s: 0.9, l: 0.65 }, // fluorescent magenta
  { h: 140, s: 1.0, l: 0.55 }, // luminous green
  { h: 180, s: 0.9, l: 0.6 },  // turquoise
  { h: 340, s: 0.85, l: 0.6 }, // hot pink
  { h: 240, s: 0.95, l: 0.55 }, // deep blue
  { h: 160, s: 1.0, l: 0.5 },  // emerald
  { h: 300, s: 0.9, l: 0.6 },  // violet
  { h: 190, s: 0.85, l: 0.65 }, // sky blue
  { h: 260, s: 0.9, l: 0.55 }, // royal purple
];

function AuroraRibbon({ index }: { index: number }) {
  const groupRef = useRef<Group>(null);
  const { camera } = useThree();
  const seed = index * 2.3 + 0.7;
  const palette = AURORA_PALETTE[index % AURORA_PALETTE.length];
  const ribbonColor = useMemo(() => new Color().setHSL(palette.h / 360, palette.s, palette.l), [palette]);
  const ribbonColor2 = useMemo(() => new Color().setHSL((palette.h + 30) / 360, palette.s * 0.9, palette.l + 0.05), [palette]);

  const segments = useMemo(() => {
    return Array.from({ length: RIBBON_SEGMENTS }, (_, i) => ({
      offset: (i / RIBBON_SEGMENTS) * Math.PI * 2,
      size: 1.5 + Math.sin(i * 0.8 + seed) * 0.8,
      yWobble: Math.sin(i * 1.2 + seed) * 8,
      zWobble: Math.cos(i * 0.9 + seed) * 5,
    }));
  }, [seed]);

  useFrame(({ clock }) => {
    if (!groupRef.current) return;
    const t = clock.elapsedTime;

    // Aurora flows through space behind the core
    const angleOffset = (index / AURORA_COUNT) * Math.PI * 2;
    const flowAngle = t * 0.03 + angleOffset;
    const flowRadius = 30 + index * 8;

    // Position aurora in a ring behind the core
    const cx = camera.position.x + Math.sin(flowAngle) * flowRadius;
    const cy = camera.position.y + Math.sin(t * 0.02 + index) * 12;
    const cz = camera.position.z + 25 + Math.cos(flowAngle) * flowRadius * 0.5;

    groupRef.current.position.set(cx, cy, cz);
    groupRef.current.rotation.y = t * 0.02 + index * 0.5;

    // Each segment flows along the ribbon
    groupRef.current.children.forEach((child, si) => {
      if (si >= segments.length) return;
      const segData = segments[si];
      const waveT = t * 0.4 + segData.offset;
      const x = Math.sin(waveT) * 15;
      const y = segData.yWobble + Math.sin(waveT * 1.3) * 3;
      const z = segData.zWobble + Math.cos(waveT * 0.7) * 2;
      child.position.set(x, y, z);

      // Breathing scale
      const breathe = 1 + Math.sin(t * 0.5 + segData.offset) * 0.3;
      child.scale.setScalar(segData.size * breathe);

      // Shifting color — iridescent
      const hueShift = Math.sin(t * 0.2 + segData.offset) * 0.05;
      const mat = (child as any).material;
      if (mat?.color) {
        const baseH = (palette.h / 360 + hueShift + 1) % 1;
        mat.color.setHSL(baseH, palette.s, palette.l);
      }
    });
  });

  return (
    <group ref={groupRef}>
      {segments.map((_seg, i) => {
        const useColor = i % 2 === 0 ? ribbonColor : ribbonColor2;
        return (
          <mesh key={i}>
            <sphereGeometry args={[1, 16, 16]} />
            <meshBasicMaterial
              color={useColor}
              transparent
              opacity={0.08}
              blending={AdditiveBlending}
              depthWrite={false}
            />
          </mesh>
        );
      })}
    </group>
  );
}

function AuroraWaves() {
  return (
    <group>
      {Array.from({ length: AURORA_COUNT }, (_, i) => (
        <AuroraRibbon key={`aurora-${i}`} index={i} />
      ))}
    </group>
  );
}

/* ==================================================================
 * 2. SPACE WAVE — periodic energy waves flowing through cosmos
 * ================================================================== */

function SpaceWave({ index }: { index: number }) {
  const meshRef = useRef<any>(null);
  const { camera } = useThree();
  const speed = 0.6 + index * 0.12;
  const startPhase = index * (Math.PI * 2) / 5;

  useFrame(({ clock }) => {
    if (!meshRef.current) return;
    const t = clock.elapsedTime;
    const cycle = (t * speed + startPhase) % (Math.PI * 2);
    const progress = cycle / (Math.PI * 2);

    const scale = 0.5 + progress * 100;
    meshRef.current.scale.setScalar(scale);

    // Position BEHIND core
    meshRef.current.position.set(
      camera.position.x,
      camera.position.y,
      camera.position.z + 25,
    );

    const alpha = progress < 0.1 ? progress / 0.1 : progress > 0.7 ? (1 - progress) / 0.3 : 1;
    meshRef.current.material.opacity = 0.02 * Math.max(0, alpha);

    meshRef.current.rotation.z = t * 0.03 + index;
    meshRef.current.rotation.x = Math.sin(t * 0.02 + index) * 0.3;
  });

  const hue = (index * 72 + 180) % 360;
  const color = useMemo(() => new Color().setHSL(hue / 360, 0.7, 0.65), [hue]);

  return (
    <mesh ref={meshRef}>
      <torusGeometry args={[1, 0.12, 8, 64]} />
      <meshBasicMaterial
        color={color}
        transparent
        opacity={0.02}
        blending={AdditiveBlending}
        depthWrite={false}
      />
    </mesh>
  );
}

function SpaceWaves() {
  return (
    <group>
      {Array.from({ length: 6 }, (_, i) => (
        <SpaceWave key={`wave-${i}`} index={i} />
      ))}
    </group>
  );
}

/* ==================================================================
 * COSMIC WANDERING — portals, black holes, and transit behavior
 *
 * Entities (cars, people, cartoon cats/stars) cruise through the
 * galaxy, get pulled toward a portal or black hole, are absorbed,
 * then re-emerge at a random new location.
 * ================================================================== */

const PORTAL_POSITIONS: [number, number, number][] = [
  [-80, 20, -60],
  [90, -15, -100],
  [0, 40, -150],
  [-120, -30, -80],
  [60, 35, -120],
];

const BLACKHOLE_POSITIONS: [number, number, number][] = [
  [-50, -20, -90],
  [110, 10, -130],
  [-30, 30, -160],
];

const WANDER_DESTINATIONS: Vector3[] = [
  ...PORTAL_POSITIONS.map((p) => new Vector3(...p)),
  ...BLACKHOLE_POSITIONS.map((p) => new Vector3(...p)),
];

const GALAXY_BOUNDS = { x: 300, y: 140, zMin: -180, zMax: -6 };

function galaxyWrap(pos: Vector3) {
  if (pos.x > GALAXY_BOUNDS.x) pos.x = -GALAXY_BOUNDS.x;
  if (pos.x < -GALAXY_BOUNDS.x) pos.x = GALAXY_BOUNDS.x;
  if (pos.y > GALAXY_BOUNDS.y) pos.y = -GALAXY_BOUNDS.y;
  if (pos.y < -GALAXY_BOUNDS.y) pos.y = GALAXY_BOUNDS.y;
  if (pos.z < GALAXY_BOUNDS.zMin) pos.z = GALAXY_BOUNDS.zMax;
  if (pos.z > GALAXY_BOUNDS.zMax) pos.z = GALAXY_BOUNDS.zMin;
}

type WanderPhase = "cruise" | "approach" | "absorb" | "emerge";

const _FORWARD = new Vector3(1, 0, 0);

/**
 * Shared movement engine: cruise → approach a portal/black hole →
 * get absorbed → teleport to a random far location → emerge.
 * Returns a ref to attach to the entity's outer group.
 */
function usePortalWander(seed: number, speed: number, rotateToVelocity = false) {
  const ref = useRef<Group>(null);
  const state = useRef({
    pos: new Vector3(
      (Math.sin(seed * 3.1) * 0.5 + 0.5) * 2 * GALAXY_BOUNDS.x - GALAXY_BOUNDS.x,
      (Math.cos(seed * 2.7) * 0.5 + 0.5) * 2 * GALAXY_BOUNDS.y - GALAXY_BOUNDS.y,
      GALAXY_BOUNDS.zMin + Math.abs(Math.sin(seed * 1.9)) * (GALAXY_BOUNDS.zMax - GALAXY_BOUNDS.zMin),
    ),
    vel: new Vector3(
      (Math.sin(seed * 5.3) - 0.5) * speed,
      (Math.cos(seed * 4.1) - 0.5) * speed * 0.5,
      (Math.sin(seed * 2.2) - 0.5) * speed * 0.4,
    ),
    phase: "cruise" as WanderPhase,
    target: 0,
    timer: 0,
    cruiseLeft: 3 + ((seed * 13.7) % 5),
    scale: 1,
  });

  useFrame((_, dt) => {
    const s = state.current;
    s.timer += dt;

    if (s.phase === "cruise") {
      s.pos.addScaledVector(s.vel, dt);
      // gentle cosmic curvature while cruising
      s.pos.x += Math.sin(s.pos.z * 0.01 + seed) * dt * 2;
      s.pos.y += Math.cos(s.pos.x * 0.008 + seed) * dt * 1.5;
      galaxyWrap(s.pos);
      s.cruiseLeft -= dt;
      if (s.cruiseLeft <= 0) {
        s.phase = "approach";
        s.target = Math.floor(Math.random() * WANDER_DESTINATIONS.length);
      }
    } else if (s.phase === "approach") {
      const dest = WANDER_DESTINATIONS[s.target];
      const toDest = dest.clone().sub(s.pos).normalize().multiplyScalar(speed * 2.8);
      s.vel.lerp(toDest, 0.045);
      s.pos.addScaledVector(s.vel, dt);
      if (s.pos.distanceTo(dest) < 1.6) {
        s.phase = "absorb";
        s.timer = 0;
      }
    } else if (s.phase === "absorb") {
      s.scale = Math.max(0, 1 - s.timer / 0.4);
      s.pos.lerp(WANDER_DESTINATIONS[s.target], 0.14);
      if (s.timer >= 0.4) {
        s.pos.set(
          (Math.random() - 0.5) * 2 * GALAXY_BOUNDS.x,
          (Math.random() - 0.5) * 2 * GALAXY_BOUNDS.y,
          GALAXY_BOUNDS.zMin + Math.random() * (GALAXY_BOUNDS.zMax - GALAXY_BOUNDS.zMin),
        );
        s.vel.set(
          (Math.random() - 0.5) * speed,
          (Math.random() - 0.5) * speed * 0.5,
          (Math.random() - 0.5) * speed * 0.4,
        );
        s.phase = "emerge";
        s.timer = 0;
      }
    } else if (s.phase === "emerge") {
      s.scale = Math.min(1, s.timer / 0.4);
      if (s.timer >= 0.4) {
        s.phase = "cruise";
        s.cruiseLeft = 4 + Math.random() * 7;
        s.timer = 0;
      }
    }

    if (ref.current) {
      ref.current.position.copy(s.pos);
      ref.current.scale.setScalar(s.scale);
      if (rotateToVelocity && s.vel.lengthSq() > 0.0001 && s.phase !== "absorb") {
        ref.current.quaternion.setFromUnitVectors(_FORWARD, s.vel.clone().normalize());
      }
    }
  });

  return ref;
}

/* ==================================================================
 * 3. FLYING CARS — futuristic vehicles moving through the cosmos
 * ================================================================== */

function FlyingCar({ seed, hue, carType }: { seed: number; hue: number; carType: number }) {
  const meshRef = usePortalWander(seed, 14, true);

  const carColor = useMemo(() => new Color().setHSL(hue / 360, 0.85, 0.7), [hue]);
  const trailColor = useMemo(() => new Color().setHSL(hue / 360, 0.9, 0.55), [hue]);
  const bodyColor = useMemo(() => new Color().setHSL(hue / 360, 0.3, 0.35), [hue]);

  const isFlyingCar = carType % 3 === 0;
  const isSpacecraft = carType % 3 === 1;
  const isHoverCar = carType % 3 === 2;

  return (
    <group ref={meshRef}>
      {/* Main body */}
      {isFlyingCar && (
        <mesh scale={[0.45, 0.08, 0.15]}>
          <boxGeometry args={[1, 1, 1]} />
          <meshStandardMaterial color={bodyColor} emissive={carColor} emissiveIntensity={0.6} metalness={0.8} roughness={0.2} />
        </mesh>
      )}
      {isSpacecraft && (
        <mesh scale={[0.5, 0.1, 0.12]}>
          <coneGeometry args={[1, 2, 6]} />
          <meshStandardMaterial color={bodyColor} emissive={carColor} emissiveIntensity={0.5} metalness={0.9} roughness={0.15} />
        </mesh>
      )}
      {isHoverCar && (
        <mesh scale={[0.4, 0.06, 0.18]}>
          <octahedronGeometry args={[1, 1]} />
          <meshStandardMaterial color={bodyColor} emissive={carColor} emissiveIntensity={0.7} metalness={0.7} roughness={0.25} />
        </mesh>
      )}
      {/* Windshield glow */}
      <mesh position={[0.12, 0.04, 0]} scale={[0.12, 0.05, 0.1]}>
        <sphereGeometry args={[1, 6, 6]} />
        <meshBasicMaterial color={carColor} transparent opacity={0.3} blending={AdditiveBlending} depthWrite={false} />
      </mesh>
      {/* Headlight */}
      <mesh position={[0.5, 0, 0]} scale={[0.08, 0.06, 0.06]}>
        <sphereGeometry args={[1, 8, 8]} />
        <meshBasicMaterial color="#ffffff" transparent opacity={0.95} blending={AdditiveBlending} />
      </mesh>
      {/* Taillight */}
      <mesh position={[-0.45, 0, 0]} scale={[0.04, 0.04, 0.04]}>
        <sphereGeometry args={[1, 6, 6]} />
        <meshBasicMaterial color="#ff3333" transparent opacity={0.8} blending={AdditiveBlending} />
      </mesh>
      {/* Under-body glow */}
      <mesh position={[0, -0.06, 0]} scale={[0.35, 0.08, 0.12]}>
        <sphereGeometry args={[1, 8, 8]} />
        <meshBasicMaterial color={carColor} transparent opacity={0.15} blending={AdditiveBlending} depthWrite={false} />
      </mesh>
      {/* Trail particles */}
      <mesh position={[-0.55, 0, 0]} scale={[0.2, 0.04, 0.04]}>
        <sphereGeometry args={[1, 6, 6]} />
        <meshBasicMaterial color={trailColor} transparent opacity={0.5} blending={AdditiveBlending} depthWrite={false} />
      </mesh>
      <mesh position={[-0.9, 0, 0]} scale={[0.15, 0.03, 0.03]}>
        <sphereGeometry args={[1, 6, 6]} />
        <meshBasicMaterial color={trailColor} transparent opacity={0.3} blending={AdditiveBlending} depthWrite={false} />
      </mesh>
      <mesh position={[-1.2, 0, 0]} scale={[0.1, 0.02, 0.02]}>
        <sphereGeometry args={[1, 6, 6]} />
        <meshBasicMaterial color={trailColor} transparent opacity={0.15} blending={AdditiveBlending} depthWrite={false} />
      </mesh>
    </group>
  );
}

function FlyingCars() {
  const [cars] = useState(() =>
    Array.from({ length: 25 }, (_, i) => ({
      id: `car-${i}`,
      seed: i * 11.7 + 1.3,
      hue: Math.random() * 360,
      type: i,
    }))
  );
  return (
    <group>
      {cars.map((car) => (
        <FlyingCar key={car.id} seed={car.seed} hue={car.hue} carType={car.type} />
      ))}
    </group>
  );
}

/* ==================================================================
 * 4. COSMIC ENTITIES — people, cartoon cats, stars floating through cosmos
 *
 * Visible entities that drift, travel through portals, appear randomly.
 * ================================================================== */

/* --- Floating Person (capsule body + head) --- */
function FloatingPerson({ seed, idx }: { seed: number; idx: number }) {
  const ref = usePortalWander(seed, 9, false);
  const tumbleRef = useRef<Group>(null);

  const bodyColor = useMemo(() => {
    const hues = [0, 20, 200, 340, 160, 280, 45];
    return new Color().setHSL(hues[idx % hues.length] / 360, 0.7, 0.6);
  }, [idx]);

  useFrame(({ clock }) => {
    if (!tumbleRef.current) return;
    const t = clock.elapsedTime;
    tumbleRef.current.rotation.x = Math.sin(t * 0.7 + seed) * 0.5;
    tumbleRef.current.rotation.z = Math.cos(t * 0.5 + seed) * 0.4;
  });

  return (
    <group ref={ref}>
      <group ref={tumbleRef}>
        {/* Head */}
        <mesh position={[0, 0.28, 0]}>
          <sphereGeometry args={[0.12, 8, 8]} />
          <meshStandardMaterial color={bodyColor} emissive={bodyColor} emissiveIntensity={0.4} />
        </mesh>
        {/* Body (capsule) */}
        <mesh position={[0, 0.05, 0]} scale={[0.08, 0.18, 0.08]}>
          <sphereGeometry args={[1, 6, 8]} />
          <meshStandardMaterial color={bodyColor} emissive={bodyColor} emissiveIntensity={0.3} />
        </mesh>
        {/* Glow */}
        <mesh>
          <sphereGeometry args={[0.5, 6, 6]} />
          <meshBasicMaterial color={bodyColor} transparent opacity={0.08} blending={AdditiveBlending} depthWrite={false} />
        </mesh>
      </group>
    </group>
  );
}

/* --- Cartoon Cat (round body + ears + tail) --- */
function CartoonCat({ seed, idx }: { seed: number; idx: number }) {
  const ref = usePortalWander(seed, 8, false);
  const tumbleRef = useRef<Group>(null);

  const catColor = useMemo(() => {
    const hues = [30, 340, 50, 180, 260, 10];
    return new Color().setHSL(hues[idx % hues.length] / 360, 0.8, 0.55);
  }, [idx]);

  useFrame(({ clock }) => {
    if (!tumbleRef.current) return;
    const t = clock.elapsedTime;
    tumbleRef.current.rotation.y = Math.sin(t * 0.5 + seed) * 0.6;
    tumbleRef.current.rotation.x = Math.cos(t * 0.4 + seed) * 0.3;
  });

  return (
    <group ref={ref}>
      <group ref={tumbleRef}>
      {/* Body */}
      <mesh>
        <sphereGeometry args={[0.18, 8, 8]} />
        <meshStandardMaterial color={catColor} emissive={catColor} emissiveIntensity={0.5} />
      </mesh>
      {/* Head */}
      <mesh position={[0.15, 0.1, 0]}>
        <sphereGeometry args={[0.1, 8, 8]} />
        <meshStandardMaterial color={catColor} emissive={catColor} emissiveIntensity={0.5} />
      </mesh>
      {/* Left ear */}
      <mesh position={[0.2, 0.2, -0.05]} scale={[0.03, 0.06, 0.02]}>
        <coneGeometry args={[1, 2, 4]} />
        <meshStandardMaterial color={catColor} emissive={catColor} emissiveIntensity={0.6} />
      </mesh>
      {/* Right ear */}
      <mesh position={[0.2, 0.2, 0.05]} scale={[0.03, 0.06, 0.02]}>
        <coneGeometry args={[1, 2, 4]} />
        <meshStandardMaterial color={catColor} emissive={catColor} emissiveIntensity={0.6} />
      </mesh>
      {/* Eyes */}
      <mesh position={[0.22, 0.12, -0.04]}>
        <sphereGeometry args={[0.02, 4, 4]} />
        <meshBasicMaterial color="#ffffff" />
      </mesh>
      <mesh position={[0.22, 0.12, 0.04]}>
        <sphereGeometry args={[0.02, 4, 4]} />
        <meshBasicMaterial color="#ffffff" />
      </mesh>
      {/* Tail */}
      <mesh position={[-0.2, 0.05, 0]} rotation={[0, 0, 0.5]} scale={[0.03, 0.12, 0.03]}>
        <cylinderGeometry args={[0.5, 1, 1, 6]} />
        <meshStandardMaterial color={catColor} emissive={catColor} emissiveIntensity={0.4} />
      </mesh>
      {/* Glow */}
        <mesh>
          <sphereGeometry args={[0.5, 6, 6]} />
          <meshBasicMaterial color={catColor} transparent opacity={0.07} blending={AdditiveBlending} depthWrite={false} />
        </mesh>
      </group>
    </group>
  );
}

/* --- Cartoon Star (star-shaped with face) --- */
function CartoonStar({ seed, idx }: { seed: number; idx: number }) {
  const ref = usePortalWander(seed, 10, false);
  const tumbleRef = useRef<Group>(null);

  const starColor = useMemo(() => {
    const hues = [45, 60, 30, 50, 15];
    return new Color().setHSL(hues[idx % hues.length] / 360, 1.0, 0.65);
  }, [idx]);

  useFrame((_, dt) => {
    if (!tumbleRef.current) return;
    tumbleRef.current.rotation.z += dt * 2;
  });

  return (
    <group ref={ref}>
      <group ref={tumbleRef}>
      <mesh>
        <octahedronGeometry args={[0.15, 0]} />
        <meshStandardMaterial color={starColor} emissive={starColor} emissiveIntensity={0.8} />
      </mesh>
      {/* Eyes */}
      <mesh position={[0.04, 0.03, 0.12]}>
        <sphereGeometry args={[0.02, 4, 4]} />
        <meshBasicMaterial color="#000000" />
      </mesh>
      <mesh position={[-0.04, 0.03, 0.12]}>
        <sphereGeometry args={[0.02, 4, 4]} />
        <meshBasicMaterial color="#000000" />
      </mesh>
      {/* Glow trail */}
        <mesh>
          <sphereGeometry args={[0.6, 6, 6]} />
          <meshBasicMaterial color={starColor} transparent opacity={0.06} blending={AdditiveBlending} depthWrite={false} />
        </mesh>
      </group>
    </group>
  );
}

/* --- Portal visual (rotating ring) --- */
function CosmicPortal({ position }: { position: [number, number, number] }) {
  const ref = useRef<Group>(null);
  useFrame(({ clock }) => {
    if (!ref.current) return;
    ref.current.rotation.y = clock.elapsedTime * 0.8;
    ref.current.rotation.x = Math.sin(clock.elapsedTime * 0.3) * 0.2;
  });

  return (
    <group ref={ref} position={position}>
      <mesh>
        <torusGeometry args={[2.5, 0.15, 8, 32]} />
        <meshBasicMaterial color="#8855ff" transparent opacity={0.6} blending={AdditiveBlending} />
      </mesh>
      <mesh>
        <torusGeometry args={[2.2, 0.08, 8, 32]} />
        <meshBasicMaterial color="#cc88ff" transparent opacity={0.3} blending={AdditiveBlending} />
      </mesh>
      <mesh>
        <sphereGeometry args={[1.5, 12, 12]} />
        <meshBasicMaterial color="#6633cc" transparent opacity={0.15} blending={AdditiveBlending} depthWrite={false} />
      </mesh>
      <pointLight color="#9966ff" intensity={4} distance={20} decay={2} />
    </group>
  );
}

/* --- Black Hole (dark core + accretion ring) --- */
function CosmicBlackHole({ position }: { position: [number, number, number] }) {
  const ref = useRef<Group>(null);
  useFrame(({ clock }) => {
    if (!ref.current) return;
    ref.current.rotation.y = clock.elapsedTime * 0.3;
  });

  return (
    <group ref={ref} position={position}>
      <mesh>
        <sphereGeometry args={[1.5, 16, 16]} />
        <meshBasicMaterial color="#000000" />
      </mesh>
      <mesh>
        <torusGeometry args={[3, 0.2, 8, 32]} />
        <meshBasicMaterial color="#ff6633" transparent opacity={0.4} blending={AdditiveBlending} />
      </mesh>
      <mesh>
        <torusGeometry args={[2.5, 0.1, 8, 32]} />
        <meshBasicMaterial color="#ffaa44" transparent opacity={0.25} blending={AdditiveBlending} />
      </mesh>
      <mesh>
        <sphereGeometry args={[4, 8, 8]} />
        <meshBasicMaterial color="#221100" transparent opacity={0.08} blending={AdditiveBlending} depthWrite={false} />
      </mesh>
      <pointLight color="#ff8844" intensity={3} distance={25} decay={2} />
    </group>
  );
}

/* --- Combined cosmic entities layer --- */
function CosmicEntities() {
  return (
    <group>
      {/* Portals */}
      {PORTAL_POSITIONS.map((pos, i) => (
        <CosmicPortal key={`portal-${i}`} position={pos} />
      ))}
      {/* Black holes */}
      {BLACKHOLE_POSITIONS.map((pos, i) => (
        <CosmicBlackHole key={`bh-${i}`} position={pos} />
      ))}
      {/* People */}
      {Array.from({ length: 15 }, (_, i) => (
        <FloatingPerson key={`person-${i}`} seed={i * 7.3 + 1.1} idx={i} />
      ))}
      {/* Cartoon cats */}
      {Array.from({ length: 8 }, (_, i) => (
        <CartoonCat key={`cat-${i}`} seed={i * 5.7 + 2.3} idx={i} />
      ))}
      {/* Cartoon stars */}
      {Array.from({ length: 10 }, (_, i) => (
        <CartoonStar key={`star-${i}`} seed={i * 4.1 + 3.7} idx={i} />
      ))}
    </group>
  );
}

/* ==================================================================
 * 4b. ZODIAC OBSERVATORY — real astronomical visualization
 * ================================================================== */

const ZODIAC_POS = { x: 100, y: 10, z: -90 };

// ── EARTH ──

function Earth() {
  const groupRef = useRef<Group>(null);
  const moonRef = useRef<Group>(null);
  const [eclipse, setEclipse] = useState(false);

  useFrame(({ clock }) => {
    if (!groupRef.current || !moonRef.current) return;
    const t = clock.elapsedTime;
    groupRef.current.rotation.y = t * 0.1;
    const moonAngle = t * 0.5;
    const moonR = 3;
    moonRef.current.position.set(
      Math.cos(moonAngle) * moonR,
      Math.sin(moonAngle * 0.1) * 0.5,
      Math.sin(moonAngle) * moonR,
    );
    const sunDir = new Vector3(1, 0.3, 0).normalize();
    const moonDir = moonRef.current.position.clone().normalize();
    const dot = sunDir.dot(moonDir);
    setEclipse(dot > 0.95);
  });

  return (
    <group position={[ZODIAC_POS.x, ZODIAC_POS.y, ZODIAC_POS.z]}>
      <group ref={groupRef}>
        <mesh>
          <sphereGeometry args={[1.2, 24, 24]} />
          <meshStandardMaterial
            color="#2266aa"
            emissive="#1144aa"
            emissiveIntensity={0.2}
            roughness={0.7}
          />
        </mesh>
        <mesh>
          <sphereGeometry args={[1.35, 16, 16]} />
          <meshBasicMaterial
            color="#66bbff"
            transparent
            opacity={0.1}
            blending={AdditiveBlending}
            depthWrite={false}
          />
        </mesh>
        <Html position={[0, 2, 0]} center distanceFactor={30} style={{ pointerEvents: "none" }}>
          <div style={{
            color: "rgba(100, 200, 255, 0.9)",
            fontSize: "9px",
            fontWeight: 600,
            letterSpacing: "0.15em",
            textShadow: "0 0 8px rgba(100, 200, 255, 0.6)",
            whiteSpace: "nowrap" as const,
            fontFamily: "system-ui, sans-serif",
          }}>
            EARTH
          </div>
        </Html>
      </group>
      <group ref={moonRef}>
        <mesh>
          <sphereGeometry args={[0.35, 12, 12]} />
          <meshStandardMaterial
            color="#cccccc"
            emissive="#999999"
            emissiveIntensity={0.15}
            roughness={0.9}
          />
        </mesh>
        {eclipse && (
          <mesh>
            <sphereGeometry args={[0.8, 8, 8]} />
            <meshBasicMaterial
              color="#000000"
              transparent
              opacity={0.4}
              blending={AdditiveBlending}
              depthWrite={false}
            />
          </mesh>
        )}
        <Html position={[0, 0.8, 0]} center distanceFactor={30} style={{ pointerEvents: "none" }}>
          <div style={{
            color: "rgba(200, 200, 200, 0.8)",
            fontSize: "7px",
            fontWeight: 500,
            letterSpacing: "0.1em",
            whiteSpace: "nowrap" as const,
            fontFamily: "system-ui, sans-serif",
          }}>
            {eclipse ? "🌑 ECLIPSE" : "MOON"}
          </div>
        </Html>
      </group>
    </group>
  );
}

// ── ZODIAC RING ──

function ZodiacSignNode({ sign, index }: { sign: typeof ZODIAC_SIGNS[0]; index: number }) {
  const meshRef = useRef<Group>(null);
  const angle = ((sign.startDegree + 15) * Math.PI) / 180;

  useFrame(({ clock }) => {
    if (!meshRef.current) return;
    const t = clock.elapsedTime;
    meshRef.current.position.y = ZODIAC_POS.y + Math.sin(t * 0.3 + index) * 0.5 + Math.sin(angle) * ZODIAC_RING_R * 0.3;
  });

  const pos = useMemo(() => ({
    x: ZODIAC_POS.x + Math.cos(angle) * ZODIAC_RING_R,
    y: ZODIAC_POS.y + Math.sin(angle) * ZODIAC_RING_R * 0.3,
    z: ZODIAC_POS.z + Math.sin(angle) * ZODIAC_RING_R,
  }), [angle]);

  const elementColors: Record<string, number> = {
    fire: 0, earth: 90, air: 200, water: 240,
  };
  const hue = elementColors[sign.element] ?? 180;
  const color = useMemo(() => new Color().setHSL(hue / 360, 0.7, 0.6), [hue]);

  return (
    <group ref={meshRef} position={[pos.x, pos.y, pos.z]}>
      <mesh>
        <octahedronGeometry args={[1.2, 0]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={0.5}
          transparent
          opacity={0.9}
        />
      </mesh>
      <mesh>
        <sphereGeometry args={[2.0, 10, 10]} />
        <meshBasicMaterial
          color={color}
          transparent
          opacity={0.1}
          blending={AdditiveBlending}
          depthWrite={false}
        />
      </mesh>
      <Html position={[0, 2.5, 0]} center distanceFactor={50} style={{ pointerEvents: "none" }}>
        <div style={{
          color: `hsl(${hue}, 70%, 75%)`,
          fontSize: "11px",
          fontWeight: 700,
          letterSpacing: "0.15em",
          textShadow: `0 0 10px hsl(${hue}, 80%, 50%)`,
          whiteSpace: "nowrap" as const,
          fontFamily: "system-ui, sans-serif",
          textAlign: "center" as const,
        }}>
          <div style={{ fontSize: "20px" }}>{sign.symbol}</div>
          <div>{sign.name}</div>
        </div>
      </Html>
    </group>
  );
}

const ZODIAC_RING_R = 65;

function ZodiacRing() {
  return (
    <group>
      <mesh position={[ZODIAC_POS.x, ZODIAC_POS.y, ZODIAC_POS.z]} rotation={[Math.PI / 2.2, 0, 0]}>
        <torusGeometry args={[ZODIAC_RING_R, 0.15, 8, 96]} />
        <meshBasicMaterial
          color="#4488cc"
          transparent
          opacity={0.2}
          blending={AdditiveBlending}
        />
      </mesh>
      <mesh position={[ZODIAC_POS.x, ZODIAC_POS.y, ZODIAC_POS.z]} rotation={[Math.PI / 2.2, 0, 0]}>
        <torusGeometry args={[ZODIAC_RING_R * 0.65, 0.08, 8, 64]} />
        <meshBasicMaterial
          color="#336699"
          transparent
          opacity={0.12}
          blending={AdditiveBlending}
        />
      </mesh>
      <mesh position={[ZODIAC_POS.x, ZODIAC_POS.y, ZODIAC_POS.z]} rotation={[Math.PI / 2.2, 0, 0]}>
        <torusGeometry args={[ZODIAC_RING_R * 1.15, 0.06, 8, 64]} />
        <meshBasicMaterial
          color="#225588"
          transparent
          opacity={0.08}
          blending={AdditiveBlending}
        />
      </mesh>
      {ZODIAC_SIGNS.map((sign, i) => (
        <ZodiacSignNode key={sign.name} sign={sign} index={i} />
      ))}
    </group>
  );
}

// ── PLANETARY BODIES IN ZODIAC ──

function ZodiacPlanet({ name, symbol, orbitRadius, speed, hue }: {
  name: string; symbol: string; orbitRadius: number; speed: number; hue: number;
}) {
  const meshRef = useRef<Group>(null);
  const color = useMemo(() => new Color().setHSL(hue / 360, 0.7, 0.6), [hue]);

  useFrame(({ clock }) => {
    if (!meshRef.current) return;
    const t = clock.elapsedTime;
    const angle = t * speed;
    meshRef.current.position.set(
      ZODIAC_POS.x + Math.cos(angle) * orbitRadius,
      ZODIAC_POS.y + Math.sin(angle * 0.3) * 2,
      ZODIAC_POS.z + Math.sin(angle) * orbitRadius,
    );
  });

  return (
    <group ref={meshRef}>
      <mesh>
        <sphereGeometry args={[0.6, 14, 14]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.6} />
      </mesh>
      <mesh>
        <sphereGeometry args={[1.2, 10, 10]} />
        <meshBasicMaterial color={color} transparent opacity={0.12} blending={AdditiveBlending} depthWrite={false} />
      </mesh>
      <Html position={[0, 1.5, 0]} center distanceFactor={50} style={{ pointerEvents: "none" }}>
        <div style={{
          color: `hsl(${hue}, 60%, 70%)`,
          fontSize: "10px",
          fontWeight: 600,
          whiteSpace: "nowrap" as const,
          fontFamily: "system-ui, sans-serif",
          textShadow: `0 0 8px hsl(${hue}, 70%, 40%)`,
          letterSpacing: "0.1em",
        }}>
          {symbol} {name}
        </div>
      </Html>
    </group>
  );
}

function ZodiacPlanets() {
  const bodies = [
    { id: "sun", name: "Sun", symbol: "☉", orbitRadius: 8, speed: 0.1, hue: 45 },
    { id: "moon", name: "Moon", symbol: "☽", orbitRadius: 11, speed: 0.3, hue: 220 },
    { id: "mercury", name: "Mercury", symbol: "☿", orbitRadius: 16, speed: 0.5, hue: 30 },
    { id: "venus", name: "Venus", symbol: "♀", orbitRadius: 22, speed: 0.35, hue: 340 },
    { id: "mars", name: "Mars", symbol: "♂", orbitRadius: 30, speed: 0.25, hue: 10 },
    { id: "jupiter", name: "Jupiter", symbol: "♃", orbitRadius: 42, speed: 0.12, hue: 35 },
    { id: "saturn", name: "Saturn", symbol: "♄", orbitRadius: 55, speed: 0.08, hue: 50 },
    { id: "uranus", name: "Uranus", symbol: "⛢", orbitRadius: 70, speed: 0.05, hue: 190 },
    { id: "neptune", name: "Neptune", symbol: "♆", orbitRadius: 85, speed: 0.03, hue: 230 },
    { id: "pluto", name: "Pluto", symbol: "♇", orbitRadius: 95, speed: 0.02, hue: 280 },
  ];

  return (
    <group>
      {bodies.map((b) => (
        <ZodiacPlanet key={b.id} {...b} />
      ))}
    </group>
  );
}

function ZodiacObservatoryVisual() {
  return (
    <group>
      <Earth />
      <ZodiacRing />
      <ZodiacPlanets />
      <Html position={[ZODIAC_POS.x, ZODIAC_POS.y + 50, ZODIAC_POS.z]} center distanceFactor={40} style={{ pointerEvents: "none" }}>
        <div style={{
          color: "rgba(100, 200, 255, 0.7)",
          fontSize: "11px",
          fontWeight: 700,
          letterSpacing: "0.3em",
          textTransform: "uppercase" as const,
          textShadow: "0 0 15px rgba(100, 200, 255, 0.5)",
          whiteSpace: "nowrap" as const,
          fontFamily: "system-ui, sans-serif",
        }}>
          ✦ ZODIAC OBSERVATORY ✦
        </div>
      </Html>
    </group>
  );
}

/* ==================================================================
 * 5. WEATHER STORMS / TORNADOES
 * ================================================================== */

function CosmicStorm({ position, intensity, radius }: { position: { x: number; y: number; z: number }; intensity: number; radius: number }) {
  const groupRef = useRef<Group>(null);
  const baseOpacity = useRef(new Map<string, number>());

  useFrame(({ clock }) => {
    if (!groupRef.current) return;
    const t = clock.elapsedTime;
    const atmosphere = sampleCosmosAtmosphere(t);
    const stormEnergy = Math.min(1, atmosphere.storm * (0.72 + atmosphere.hurricane * 0.5));
    groupRef.current.rotation.y = t * intensity * (1.2 + stormEnergy * 2.2);
    groupRef.current.rotation.x = Math.sin(t * (0.35 + atmosphere.hurricane * 0.45)) * (0.16 + atmosphere.hurricane * 0.3);
    groupRef.current.scale.setScalar(0.82 + stormEnergy * 0.38);

    groupRef.current.traverse((object) => {
      const material = (object as { material?: { uuid?: string; opacity?: number; transparent?: boolean } }).material;
      if (!material || material.opacity === undefined) return;
      const id = material.uuid ?? `${object.uuid}-material`;
      const original = baseOpacity.current.get(id) ?? material.opacity;
      baseOpacity.current.set(id, original);
      material.opacity = original * (0.04 + stormEnergy * 0.96);
      material.transparent = true;
    });
  });

  const particleCount = Math.floor(40 * intensity);
  const positions = useMemo(() => {
    const arr = new Float32Array(particleCount * 3);
    for (let i = 0; i < particleCount; i++) {
      const angle = (i / particleCount) * Math.PI * 2;
      const r = radius * (0.3 + Math.random() * 0.7);
      const h = (Math.random() - 0.5) * radius * 0.5;
      arr[i * 3] = Math.cos(angle) * r;
      arr[i * 3 + 1] = h;
      arr[i * 3 + 2] = Math.sin(angle) * r;
    }
    return arr;
  }, [particleCount, radius]);

  return (
    <group ref={groupRef} position={[position.x, position.y, position.z - 25]}>
      <mesh>
        <sphereGeometry args={[radius * 0.2, 8, 8]} />
        <meshBasicMaterial
          color="#ff6633"
          transparent
          opacity={0.18 * intensity}
          blending={AdditiveBlending}
          depthWrite={false}
        />
      </mesh>
      <points>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[positions, 3]} />
        </bufferGeometry>
        <pointsMaterial
          size={0.18}
          color="#ff8844"
          transparent
          opacity={0.45 * intensity}
          blending={AdditiveBlending}
          depthWrite={false}
        />
      </points>
      <mesh>
        <cylinderGeometry args={[radius * 0.05, radius * 0.15, radius * 2, 8, 8, true]} />
        <meshBasicMaterial
          color="#cc5522"
          transparent
          opacity={0.1 * intensity}
          blending={AdditiveBlending}
          depthWrite={false}
        />
      </mesh>
      <pointLight
        position={[0, radius * 0.5, 0]}
        color="#ffaa44"
        intensity={intensity * 0.5}
        distance={radius * 3}
        decay={2}
      />
    </group>
  );
}

function CosmicStorms() {
  const root = useRef<Group>(null);
  const [storms] = useState(() =>
    Array.from({ length: 10 }, (_, i) => ({
      id: `storm-${i}`,
      pos: {
        x: (Math.random() - 0.5) * 200,
        y: (Math.random() - 0.5) * 100,
        z: -10 - Math.random() * 80,
      },
      intensity: 0.3 + Math.random() * 0.7,
      radius: 2 + Math.random() * 6,
    }))
  );

  useFrame(({ clock }, delta) => {
    if (!root.current) return;
    const atmosphere = sampleCosmosAtmosphere(clock.elapsedTime);
    root.current.visible = atmosphere.storm > 0.025;
    root.current.rotation.y += delta * (0.006 + atmosphere.hurricane * 0.08);
    root.current.rotation.z = Math.sin(clock.elapsedTime * 0.025) * atmosphere.hurricane * 0.06;
    root.current.scale.setScalar(1 + atmosphere.hurricane * 0.12);
  });

  return (
    <group ref={root}>
      {storms.map((s) => (
        <CosmicStorm key={s.id} position={s.pos} intensity={s.intensity} radius={s.radius} />
      ))}
    </group>
  );
}

/* ==================================================================
 * 6. FLOATING CITIES
 * ================================================================== */

function FloatingCityMesh({ city }: { city: { x: number; y: number; z: number; name: string; population: number; hue: number; scale: number } }) {
  const groupRef = useRef<Group>(null);

  useFrame(({ clock }) => {
    if (!groupRef.current) return;
    const t = clock.elapsedTime;
    groupRef.current.position.y = city.y + Math.sin(t * 0.2 + city.x) * 1;
    groupRef.current.rotation.y = t * 0.05;
  });

  const color = useMemo(() => new Color().setHSL(city.hue / 360, 0.6, 0.5), [city.hue]);

  return (
    <group ref={groupRef} position={[city.x, city.y, city.z - 25]}>
      <mesh scale={[city.scale * 2, city.scale * 0.3, city.scale * 2]}>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.3} transparent opacity={0.7} />
      </mesh>
      <mesh position={[0, city.scale * 1.5, 0]} scale={[city.scale * 0.2, city.scale * 3, city.scale * 0.2]}>
        <cylinderGeometry args={[0.5, 1, 1, 6]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.5} transparent opacity={0.8} />
      </mesh>
      <mesh>
        <sphereGeometry args={[city.scale * 3, 8, 8]} />
        <meshBasicMaterial color={color} transparent opacity={0.04} blending={AdditiveBlending} depthWrite={false} />
      </mesh>
      <Html position={[0, city.scale * 4, 0]} center distanceFactor={30} style={{ pointerEvents: "none" }}>
        <div style={{
          color: `hsl(${city.hue}, 50%, 75%)`,
          fontSize: "7px",
          fontWeight: 500,
          whiteSpace: "nowrap" as const,
          fontFamily: "system-ui, sans-serif",
          textShadow: `0 0 4px hsl(${city.hue}, 60%, 40%)`,
        }}>
          🏙 {city.name}
        </div>
      </Html>
    </group>
  );
}

function FloatingCitiesVisual() {
  const cities = useMemo(() => {
    const engine = FloatingCityEngine.getInstance();
    const existing = engine.getCities();
    if (existing.length > 0) {
      return existing.map((c) => ({
        x: c.x, y: c.y, z: c.z, name: c.name,
        population: c.population, hue: c.hue, scale: c.scale,
      }));
    }
    return Array.from({ length: 5 }, (_, i) => ({
      x: (Math.random() - 0.5) * 100,
      y: 15 + Math.random() * 30,
      z: -20 - Math.random() * 50,
      name: ["Nova Haven", "Skyreach", "Cloudspire", "Aetheria", "Lumina"][i],
      population: 10000 + Math.floor(Math.random() * 90000),
      hue: 180 + i * 30,
      scale: 0.5 + Math.random(),
    }));
  }, []);

  return (
    <group>
      {cities.map((c, i) => (
        <FloatingCityMesh key={`city-${i}`} city={c} />
      ))}
    </group>
  );
}

/* ==================================================================
 * 7. COTTON-CANDY COSMIC CLOUDS — REAL CLOUD FORMATIONS
 *
 * THREE distinct cloud types:
 *   CUMULUS — tall puffy towers (stacked rounded billows)
 *   STRATUS — wide flat layers (flattened discs)
 *   CIRRUS — thin wispy streaks (elongated shards)
 *
 * Hot pinks, magentas, maroons, fluorescent roses.
 * Each cloud DRIFTS through space with visible momentum.
 * ================================================================== */

const CANDY_PALETTE = [
  { r: 1.0, g: 0.05, b: 0.35 },   // hot magenta-pink
  { r: 0.9, g: 0.0,  b: 0.25 },   // deep maroon-rose
  { r: 1.0, g: 0.2,  b: 0.6 },    // fluorescent pink
  { r: 0.7, g: 0.0,  b: 0.35 },   // dark magenta
  { r: 1.0, g: 0.35, b: 0.55 },   // bright rose
  { r: 0.85,g: 0.05, b: 0.45 },   // burgundy-magenta
  { r: 0.6, g: 0.0,  b: 0.5 },    // deep violet-maroon
  { r: 1.0, g: 0.15, b: 0.45 },   // neon fuchsia
  { r: 0.95,g: 0.0,  b: 0.2 },    // crimson pink
  { r: 0.5, g: 0.0,  b: 0.6 },    // royal purple
  { r: 1.0, g: 0.5,  b: 0.7 },    // warm cotton-candy pink
  { r: 0.8, g: 0.0,  b: 0.3 },    // dark fuchsia
];

function candyColor(idx: number) {
  const c = CANDY_PALETTE[idx % CANDY_PALETTE.length];
  return new Color(c.r, c.g, c.b);
}

/* --- CUMULUS: tall billowy towers with rounded tops --- */
function CumulusCloud({ center, scale, ci }: {
  center: [number, number, number]; scale: number; ci: number;
}) {
  const ref = useRef<Group>(null);
  const pos = useRef(new Vector3(center[0], center[1], center[2]));
  const vel = useMemo(() => new Vector3(
    Math.sin(ci * 12.9898) * 6,
    Math.cos(ci * 78.233) * 3,
    Math.sin(ci * 37.719) * 2,
  ), [ci]);
  const c1 = candyColor(ci);
  const c2 = candyColor(ci + 2);

  // Build a cumulus from stacked deformed spheres (billows)
  const billows = useMemo(() => {
    const b: { x: number; y: number; z: number; sx: number; sy: number; sz: number; c: Color }[] = [];
    // Base layer — wide
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const r = scale * 0.6 + Math.sin(i * 2.1) * scale * 0.15;
      b.push({
        x: Math.cos(a) * r * 0.5,
        y: -scale * 0.1,
        z: Math.sin(a) * r * 0.5,
        sx: scale * (0.4 + Math.sin(i * 1.3) * 0.1),
        sy: scale * 0.18,
        sz: scale * (0.35 + Math.cos(i * 1.7) * 0.1),
        c: i % 2 === 0 ? c1 : c2,
      });
    }
    // Middle layer — fewer, taller
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + 0.5;
      b.push({
        x: Math.cos(a) * scale * 0.2,
        y: scale * 0.15,
        z: Math.sin(a) * scale * 0.2,
        sx: scale * 0.3,
        sy: scale * 0.25,
        sz: scale * 0.28,
        c: i % 2 === 0 ? c2 : c1,
      });
    }
    // Top — big puffy cap
    b.push({
      x: 0, y: scale * 0.45, z: 0,
      sx: scale * 0.35, sy: scale * 0.3, sz: scale * 0.32,
      c: c1,
    });
    return b;
  }, [scale, c1, c2]);

  useFrame(({ clock }, dt) => {
    if (!ref.current) return;
    const t = clock.elapsedTime;
    pos.current.addScaledVector(vel, dt);
    galaxyWrap(pos.current);
    ref.current.position.copy(pos.current);
    ref.current.rotation.y = t * 0.01 + ci;
  });

  return (
    <group ref={ref} position={center}>
      {billows.map((b, i) => (
        <group key={i}>
          <mesh position={[b.x, b.y, b.z]} scale={[b.sx, b.sy, b.sz]}>
            <sphereGeometry args={[1, 12, 10]} />
            <meshBasicMaterial color={b.c} transparent opacity={0.2} blending={AdditiveBlending} depthWrite={false} />
          </mesh>
          <mesh position={[b.x, b.y, b.z]} scale={[b.sx * 2, b.sy * 1.8, b.sz * 2]}>
            <sphereGeometry args={[1, 8, 6]} />
            <meshBasicMaterial color={b.c} transparent opacity={0.06} blending={AdditiveBlending} depthWrite={false} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

/* --- STRATUS: wide flat layers stretching horizontally --- */
function StratusCloud({ center, scale, ci }: {
  center: [number, number, number]; scale: number; ci: number;
}) {
  const ref = useRef<Group>(null);
  const pos = useRef(new Vector3(center[0], center[1], center[2]));
  const vel = useMemo(() => new Vector3(
    Math.sin(ci * 91.471) * 5,
    Math.cos(ci * 31.379) * 2.5,
    Math.sin(ci * 57.113) * 2,
  ), [ci]);
  const c1 = candyColor(ci + 4);

  const layers = useMemo(() =>
    Array.from({ length: 8 }, () => ({
      x: (Math.random() - 0.5) * scale * 1.2,
      y: (Math.random() - 0.5) * scale * 0.05,
      z: (Math.random() - 0.5) * scale * 0.4,
      sx: scale * (0.3 + Math.random() * 0.4),
      sy: scale * 0.04,
      sz: scale * (0.15 + Math.random() * 0.2),
    })),
  [scale]);

  useFrame(({ clock }, dt) => {
    if (!ref.current) return;
    const t = clock.elapsedTime;
    pos.current.addScaledVector(vel, dt);
    galaxyWrap(pos.current);
    ref.current.position.copy(pos.current);
    ref.current.rotation.y = t * 0.005 + ci * 0.5;
  });

  return (
    <group ref={ref} position={center}>
      {layers.map((l, i) => (
        <group key={i}>
          <mesh position={[l.x, l.y, l.z]} scale={[l.sx, l.sy, l.sz]}>
            <boxGeometry args={[1, 1, 1, 1, 1, 1]} />
            <meshBasicMaterial color={c1} transparent opacity={0.16} blending={AdditiveBlending} depthWrite={false} />
          </mesh>
          <mesh position={[l.x, l.y, l.z]} scale={[l.sx * 1.6, l.sy * 3, l.sz * 1.6]}>
            <boxGeometry args={[1, 1, 1]} />
            <meshBasicMaterial color={c1} transparent opacity={0.05} blending={AdditiveBlending} depthWrite={false} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

/* --- CIRRUS: thin wispy streaks stretched diagonally --- */
function CirrusCloud({ center, scale, ci }: {
  center: [number, number, number]; scale: number; ci: number;
}) {
  const ref = useRef<Group>(null);
  const pos = useRef(new Vector3(center[0], center[1], center[2]));
  const vel = useMemo(() => new Vector3(
    Math.sin(ci * 67.819) * 7,
    Math.cos(ci * 43.297) * 3,
    Math.sin(ci * 19.713) * 2.5,
  ), [ci]);
  const c1 = candyColor(ci + 6);

  const streaks = useMemo(() =>
    Array.from({ length: 10 }, (_, i) => ({
      x: (i / 10 - 0.5) * scale * 2.5 + (Math.random() - 0.5) * scale * 0.3,
      y: Math.sin(i * 0.7) * scale * 0.15,
      z: (Math.random() - 0.5) * scale * 0.3,
      sx: scale * (0.4 + Math.random() * 0.5),
      sy: scale * 0.015,
      sz: scale * 0.025,
      rotZ: (Math.random() - 0.5) * 0.3,
    })),
  [scale]);

  useFrame(({ clock }, dt) => {
    if (!ref.current) return;
    const t = clock.elapsedTime;
    pos.current.addScaledVector(vel, dt);
    galaxyWrap(pos.current);
    ref.current.position.copy(pos.current);
    ref.current.rotation.y = t * 0.008 + ci;
  });

  return (
    <group ref={ref} position={center}>
      {streaks.map((s, i) => (
        <group key={i}>
          <mesh position={[s.x, s.y, s.z]} scale={[s.sx, s.sy, s.sz]} rotation={[0, 0, s.rotZ]}>
            <boxGeometry args={[1, 1, 1]} />
            <meshBasicMaterial color={c1} transparent opacity={0.14} blending={AdditiveBlending} depthWrite={false} />
          </mesh>
          <mesh position={[s.x, s.y, s.z]} scale={[s.sx * 1.3, s.sy * 5, s.sz * 4]} rotation={[0, 0, s.rotZ]}>
            <boxGeometry args={[1, 1, 1]} />
            <meshBasicMaterial color={c1} transparent opacity={0.04} blending={AdditiveBlending} depthWrite={false} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

function CottonCandyClouds() {
  const root = useRef<Group>(null);
  const clouds = useMemo(() => {
    const arr: { id: string; type: 'cumulus' | 'stratus' | 'cirrus'; center: [number, number, number]; scale: number; ci: number }[] = [];
    const types: ('cumulus' | 'stratus' | 'cirrus')[] = ['cumulus', 'stratus', 'cirrus'];
    for (let i = 0; i < 21; i++) {
      arr.push({
        id: `cloud-${i}`,
        type: types[i % 3],
        center: [
          (Math.random() - 0.5) * 500,
          (Math.random() - 0.5) * 200,
          -10 - Math.random() * 140,
        ],
        scale: 10 + Math.random() * 22,
        ci: i,
      });
    }
    return arr;
  }, []);

  useFrame(({ clock }, delta) => {
    if (!root.current) return;
    const atmosphere = sampleCosmosAtmosphere(clock.elapsedTime);
    const cloudPresence = Math.max(
      0,
      atmosphere.storm * 0.62 + atmosphere.hurricane * 0.48 - atmosphere.static * 0.08,
    );
    root.current.visible = cloudPresence > 0.015;
    root.current.rotation.y += delta * (0.002 + atmosphere.hurricane * 0.035);
    root.current.rotation.z = Math.sin(clock.elapsedTime * 0.018) * atmosphere.hurricane * 0.08;
    root.current.scale.setScalar(1 + atmosphere.hurricane * 0.08);
  });

  return (
    <group ref={root}>
      {clouds.map((c) => {
        if (c.type === 'cumulus') return <CumulusCloud key={c.id} center={c.center} scale={c.scale} ci={c.ci} />;
        if (c.type === 'stratus') return <StratusCloud key={c.id} center={c.center} scale={c.scale} ci={c.ci} />;
        return <CirrusCloud key={c.id} center={c.center} scale={c.scale} ci={c.ci} />;
      })}
    </group>
  );
}

/* ==================================================================
 * 8. COSMIC LIGHTNING — GALAXY-SPANNING PERSISTENT ARCS
 *
 * Massive streaks that stretch 150–350 units through the cosmos.
 * Always visible — cycle between ON states with brief resets.
 * Branching forks at the endpoints. Purple-white core glow.
 * ================================================================== */

function LightningSegment({ from, to, width, color, glowColor, glowRadius }: {
  from: [number, number, number]; to: [number, number, number];
  width: number; color: string; glowColor: string; glowRadius: number;
}) {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const dz = to[2] - from[2];
  const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
  const mx = (from[0] + to[0]) / 2;
  const my = (from[1] + to[1]) / 2;
  const mz = (from[2] + to[2]) / 2;

  return (
    <group position={[mx, my, mz]}>
      {/* Bright core */}
      <mesh>
        <boxGeometry args={[width, width, len]} />
        <meshBasicMaterial color={color} transparent opacity={0.95} />
      </mesh>
      {/* Inner glow */}
      <mesh>
        <boxGeometry args={[width * 4, width * 4, len * 1.02]} />
        <meshBasicMaterial
          color={glowColor}
          transparent
          opacity={0.35}
          blending={AdditiveBlending}
          depthWrite={false}
        />
      </mesh>
      {/* Outer halo */}
      <mesh>
        <boxGeometry args={[width * 10, width * 10, len * 1.05]} />
        <meshBasicMaterial
          color={glowColor}
          transparent
          opacity={0.08}
          blending={AdditiveBlending}
          depthWrite={false}
        />
      </mesh>
      {/* Vertex glow sphere at midpoint */}
      <mesh>
        <sphereGeometry args={[glowRadius, 6, 6]} />
        <meshBasicMaterial
          color={glowColor}
          transparent
          opacity={0.3}
          blending={AdditiveBlending}
          depthWrite={false}
        />
      </mesh>
    </group>
  );
}

function CosmicLightningBolt({ seed, span }: { seed: number; span: number }) {
  const groupRef = useRef<Group>(null);
  const [phase, setPhase] = useState(0); // 0=off, 1=on, 2=fading
  const timerRef = useRef(Math.random() * 2);
  const cycleRef = useRef(0);
  const branchesRef = useRef(0);

  // Pre-generate bolt geometry (changes only on flash)
  const [segments, setSegments] = useState<[number, number, number][]>([]);
  const [branchSegs, setBranchSegs] = useState<[number, number, number][][]>([]);

  const generateBolt = useMemo(() => () => {
    // Main bolt: 10-18 segments spanning `span` units
    const count = 10 + Math.floor(Math.random() * 8);
    const pts: [number, number, number][] = [];
    const startY = (Math.random() - 0.5) * span * 0.3;
    for (let i = 0; i <= count; i++) {
      const t = i / count;
      pts.push([
        t * span + (Math.random() - 0.5) * span * 0.06,
        startY + t * ((Math.random() - 0.5) * span * 0.15) + (Math.random() - 0.5) * 8,
        -20 - Math.random() * 80 + (Math.random() - 0.5) * 20,
      ]);
    }
    setSegments(pts);

    // 2-4 branches forking off random midpoints
    const numBranches = 2 + Math.floor(Math.random() * 3);
    const branches: [number, number, number][][] = [];
    for (let b = 0; b < numBranches; b++) {
      const forkIdx = 2 + Math.floor(Math.random() * (count - 3));
      const forkPt = pts[forkIdx];
      const bLen = 3 + Math.floor(Math.random() * 5);
      const branch: [number, number, number][] = [forkPt];
      const dir = Math.random() > 0.5 ? 1 : -1;
      for (let j = 1; j <= bLen; j++) {
        const bt = j / bLen;
        branch.push([
          forkPt[0] + bt * span * 0.08 * dir + (Math.random() - 0.5) * 6,
          forkPt[1] + bt * (Math.random() - 0.5) * span * 0.06,
          forkPt[2] + (Math.random() - 0.5) * 8,
        ]);
      }
      branches.push(branch);
    }
    setBranchSegs(branches);
  }, [span]);

  useFrame((_, delta) => {
    timerRef.current += delta;
    cycleRef.current += delta;

    const cycleTime = 2 + (Math.sin(seed * 7.3) * 0.5 + 0.5) * 4; // 2-6s cycle

    if (phase === 0 && cycleRef.current > cycleTime) {
      // Flash on
      setPhase(1);
      cycleRef.current = 0;
      generateBolt();
      branchesRef.current = Math.random() * 2;
    } else if (phase === 1 && timerRef.current > 0.06 + Math.random() * 0.1) {
      // Brief flicker off
      setPhase(0);
      timerRef.current = 0;
    } else if (phase === 1 && branchesRef.current > 0) {
      branchesRef.current -= delta;
      // Rapid re-generate for flicker effect
      if (Math.random() > 0.5) generateBolt();
    }
  });

  if (phase === 0 || segments.length < 2) return null;

  const boltColor = "#e8e0ff"; // bright purple-white core
  const glowColor = "#aa66ff"; // vivid purple glow

  return (
    <group ref={groupRef}>
      {/* Main bolt */}
      {segments.slice(0, -1).map((pt, i) => {
        const next = segments[i + 1];
        return (
          <LightningSegment
            key={`m-${i}`}
            from={pt}
            to={next}
            width={0.15 - i * 0.005}
            color={boltColor}
            glowColor={glowColor}
            glowRadius={1.5}
          />
        );
      })}
      {/* Branches */}
      {branchSegs.map((branch, bi) =>
        branch.slice(0, -1).map((pt, i) => {
          const next = branch[i + 1];
          return (
            <LightningSegment
              key={`b-${bi}-${i}`}
              from={pt}
              to={next}
              width={0.08}
              color="#ccbbff"
              glowColor="#8855dd"
              glowRadius={0.8}
            />
          );
        })
      )}
      {/* Illumination point lights along the bolt */}
      <pointLight
        position={segments[Math.floor(segments.length / 2)]}
        color="#aa66ff"
        intensity={15}
        distance={120}
        decay={1.5}
      />
      <pointLight
        position={segments[segments.length - 1]}
        color="#9955ee"
        intensity={8}
        distance={80}
        decay={2}
      />
    </group>
  );
}

function CosmicLightning() {
  const bolts = useMemo(() =>
    Array.from({ length: 12 }, (_, i) => ({
      id: `arc-${i}`,
      seed: i * 3.7 + 1.2,
      span: 150 + Math.random() * 200, // 150-350 unit streaks
    })),
  []);

  return (
    <group>
      {bolts.map((b) => (
        <CosmicLightningBolt key={b.id} seed={b.seed} span={b.span} />
      ))}
    </group>
  );
}

/* ==================================================================
 * EXPORTS
 * ================================================================== */

export {
  AuroraWaves,
  SpaceWaves,
  FlyingCars,
  ZodiacObservatoryVisual,
  CosmicStorms,
  FloatingCitiesVisual,
  CottonCandyClouds,
  CosmicLightning,
  CosmicEntities,
};
