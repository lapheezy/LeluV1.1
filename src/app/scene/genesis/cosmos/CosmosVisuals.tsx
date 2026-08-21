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
 * 3. FLYING CARS — futuristic vehicles moving through the cosmos
 * ================================================================== */

function FlyingCar({ position, velocity, hue, carType }: { position: Vector3; velocity: Vector3; hue: number; carType: number }) {
  const meshRef = useRef<Group>(null);
  const pos = useRef(position.clone());
  const vel = useRef(velocity.clone());

  const carColor = useMemo(() => new Color().setHSL(hue / 360, 0.85, 0.7), [hue]);
  const trailColor = useMemo(() => new Color().setHSL(hue / 360, 0.9, 0.55), [hue]);
  const bodyColor = useMemo(() => new Color().setHSL(hue / 360, 0.3, 0.35), [hue]);

  useFrame((_, delta) => {
    if (!meshRef.current) return;
    pos.current.addScaledVector(vel.current, delta);
    if (pos.current.length() > 120) {
      pos.current.multiplyScalar(-0.05);
    }
    meshRef.current.position.copy(pos.current);
    if (vel.current.length() > 0.01) {
      meshRef.current.lookAt(pos.current.clone().add(vel.current));
    }
  });

  const isFlyingCar = carType % 3 === 0;
  const isSpacecraft = carType % 3 === 1;
  const isHoverCar = carType % 3 === 2;

  return (
    <group ref={meshRef} position={position}>
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
      pos: new Vector3((Math.random() - 0.5) * 160, (Math.random() - 0.5) * 80, -20 - Math.random() * 60),
      vel: new Vector3((Math.random() - 0.5) * 12, (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 4),
      hue: Math.random() * 360,
      type: i,
    }))
  );
  return (
    <group>
      {cars.map((car) => (
        <FlyingCar key={car.id} position={car.pos} velocity={car.vel} hue={car.hue} carType={car.type} />
      ))}
    </group>
  );
}

/* ==================================================================
 * 4. ZODIAC OBSERVATORY — real astronomical visualization
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

  useFrame(({ clock }) => {
    if (!groupRef.current) return;
    const t = clock.elapsedTime;
    groupRef.current.rotation.y = t * intensity * 2;
    groupRef.current.rotation.x = Math.sin(t * 0.5) * 0.3;
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

  return (
    <group>
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
 * 7. COTTON-CANDY COSMIC CLOUDS — VIVID FLUORESCENT NEBULAE
 *
 * Massive, layered, high-saturation cloud formations.
 * Hot pinks, magentas, maroons, electric roses.
 * Each cloud is 20+ overlapping spheres with additive + basic blend.
 * ================================================================== */

/** Fluorescent palette — HIGH SATURATION, not pastel */
const CANDY_PALETTE = [
  new Color(1.0, 0.05, 0.35),   // hot magenta-pink
  new Color(0.9, 0.0, 0.25),    // deep maroon-rose
  new Color(1.0, 0.2, 0.6),     // fluorescent pink
  new Color(0.7, 0.0, 0.35),    // dark magenta
  new Color(1.0, 0.35, 0.55),   // bright rose
  new Color(0.85, 0.05, 0.45),  // burgundy-magenta
  new Color(0.6, 0.0, 0.5),     // deep violet-maroon
  new Color(1.0, 0.15, 0.45),   // neon fuchsia
  new Color(0.95, 0.0, 0.2),    // crimson pink
  new Color(0.5, 0.0, 0.6),     // royal purple
  new Color(1.0, 0.5, 0.7),     // warm cotton-candy pink
  new Color(0.8, 0.0, 0.3),     // dark fuchsia
];

function CottonCandyCloud({ center, cloudScale, paletteIdx }: {
  center: [number, number, number]; cloudScale: number; paletteIdx: number;
}) {
  const groupRef = useRef<Group>(null);
  const c1 = CANDY_PALETTE[paletteIdx % CANDY_PALETTE.length];
  const c2 = CANDY_PALETTE[(paletteIdx + 3) % CANDY_PALETTE.length];

  /** 24 overlapping spheres per cloud for real volume */
  const layers = useMemo(() =>
    Array.from({ length: 24 }, (_, i) => {
      const a = (i / 24) * Math.PI * 2;
      const r = (0.3 + Math.sin(i * 1.7 + paletteIdx) * 0.25) * cloudScale;
      const h = Math.cos(i * 2.1 + paletteIdx * 0.7) * cloudScale * 0.35;
      const s = cloudScale * (0.35 + Math.sin(i * 0.9 + paletteIdx) * 0.25);
      return { x: Math.cos(a) * r, y: h, z: Math.sin(a) * r, s };
    }),
  [cloudScale, paletteIdx]);

  useFrame(({ clock }) => {
    if (!groupRef.current) return;
    const t = clock.elapsedTime;
    groupRef.current.rotation.y = t * 0.015 + paletteIdx;
    groupRef.current.rotation.x = Math.sin(t * 0.008 + paletteIdx) * 0.1;
    // slow drift
    groupRef.current.position.x = center[0] + Math.sin(t * 0.004 + paletteIdx * 2) * 3;
    groupRef.current.position.y = center[1] + Math.cos(t * 0.003 + paletteIdx) * 2;
    groupRef.current.position.z = center[2] + Math.sin(t * 0.002 + paletteIdx * 3) * 1.5;
  });

  return (
    <group ref={groupRef} position={center}>
      {layers.map((l, i) => {
        const useC = i % 3 === 0 ? c2 : c1;
        const blend = i / 24;
        // Inner core — brighter, more opaque
        const isInner = blend < 0.4;
        return (
          <group key={i}>
            {/* Main cloud sphere */}
            <mesh position={[l.x, l.y, l.z]} scale={l.s}>
              <sphereGeometry args={[1, 14, 14]} />
              <meshBasicMaterial
                color={useC}
                transparent
                opacity={isInner ? 0.18 : 0.09}
                blending={AdditiveBlending}
                depthWrite={false}
              />
            </mesh>
            {/* Glow halo — double the size, fainter */}
            <mesh position={[l.x, l.y, l.z]} scale={l.s * 2.5}>
              <sphereGeometry args={[1, 8, 8]} />
              <meshBasicMaterial
                color={useC}
                transparent
                opacity={isInner ? 0.06 : 0.03}
                blending={AdditiveBlending}
                depthWrite={false}
              />
            </mesh>
          </group>
        );
      })}
      {/* Central luminous core */}
      <mesh scale={cloudScale * 1.2}>
        <sphereGeometry args={[1, 10, 10]} />
        <meshBasicMaterial
          color={c1}
          transparent
          opacity={0.12}
          blending={AdditiveBlending}
          depthWrite={false}
        />
      </mesh>
    </group>
  );
}

function CottonCandyClouds() {
  const clouds = useMemo(() =>
    Array.from({ length: 14 }, (_, i) => ({
      id: `nebula-${i}`,
      center: [
        (Math.random() - 0.5) * 400,
        (Math.random() - 0.5) * 160,
        -20 - Math.random() * 120,
      ] as [number, number, number],
      scale: 8 + Math.random() * 18,
      pi: i,
    })),
  []);

  return (
    <group>
      {clouds.map((c) => (
        <CottonCandyCloud key={c.id} center={c.center} cloudScale={c.scale} paletteIdx={c.pi} />
      ))}
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
};
