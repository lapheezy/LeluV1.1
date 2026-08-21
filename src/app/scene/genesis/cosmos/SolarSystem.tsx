/**
 * ==========================================================
 * LÉLUVERSE — SOLAR SYSTEM
 *
 * Visible solar system in the cosmos with:
 * - Sun (glowing star)
 * - Mercury, Venus, Earth, Mars, Jupiter, Saturn, Uranus, Neptune
 * - Earth has a Moon orbiting it
 * - Orbital paths visible as rings
 * - All standard Three.js materials (no custom shaders)
 * ==========================================================
 */

import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import {
  Group,
  Color,
  AdditiveBlending,
  DoubleSide,
} from "three";

// ── Planet data ──

interface PlanetDef {
  name: string;
  radius: number;
  orbitRadius: number;
  orbitSpeed: number;
  color: number;
  emissive: number;
  hasRing?: boolean;
  hasMoon?: boolean;
  moonColor?: number;
  moonOrbitRadius?: number;
  moonOrbitSpeed?: number;
}

const PLANETS: PlanetDef[] = [
  { name: "Mercury", radius: 0.18, orbitRadius: 5.5, orbitSpeed: 4.15, color: 0x8c7e6d, emissive: 0x1a1510 },
  { name: "Venus", radius: 0.25, orbitRadius: 8, orbitSpeed: 1.62, color: 0xd4a574, emissive: 0x2a1f15 },
  {
    name: "Earth",
    radius: 0.28,
    orbitRadius: 11,
    orbitSpeed: 1.0,
    color: 0x2266aa,
    emissive: 0x0a2244,
    hasMoon: true,
    moonColor: 0x999999,
    moonOrbitRadius: 0.6,
    moonOrbitSpeed: 13.0,
  },
  { name: "Mars", radius: 0.22, orbitRadius: 14, orbitSpeed: 0.53, color: 0xcc4422, emissive: 0x2a0d05 },
  { name: "Jupiter", radius: 0.7, orbitRadius: 20, orbitSpeed: 0.084, color: 0xc8a55a, emissive: 0x1a1508 },
  {
    name: "Saturn",
    radius: 0.55,
    orbitRadius: 27,
    orbitSpeed: 0.034,
    color: 0xdbc48e,
    emissive: 0x1a1808,
    hasRing: true,
  },
  { name: "Uranus", radius: 0.4, orbitRadius: 33, orbitSpeed: 0.012, color: 0x66aacc, emissive: 0x0a1a22 },
  { name: "Neptune", radius: 0.38, orbitRadius: 38, orbitSpeed: 0.006, color: 0x3355aa, emissive: 0x0a0f22 },
];

// ── Single planet mesh ──

function Planet({ def }: { def: PlanetDef }) {
  const groupRef = useRef<Group>(null);
  const moonRef = useRef<Group>(null);
  const angleRef = useRef(Math.random() * Math.PI * 2);

  useFrame((_, delta) => {
    if (!groupRef.current) return;
    angleRef.current += delta * def.orbitSpeed * 0.3;
    const x = Math.cos(angleRef.current) * def.orbitRadius;
    const z = Math.sin(angleRef.current) * def.orbitRadius;
    groupRef.current.position.set(x, 0, z);

    // Moon orbit
    if (moonRef.current && def.hasMoon) {
      const moonAngle = angleRef.current * (def.moonOrbitSpeed ?? 1);
      const mx = Math.cos(moonAngle) * (def.moonOrbitRadius ?? 0.5);
      const mz = Math.sin(moonAngle) * (def.moonOrbitRadius ?? 0.5);
      moonRef.current.position.set(mx, 0, mz);
    }
  });

  return (
    <group>
      {/* Orbit path ring — centered at origin, NOT inside the moving group */}
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <ringGeometry args={[def.orbitRadius - 0.04, def.orbitRadius + 0.04, 128]} />
        <meshBasicMaterial
          color={new Color(0x446688)}
          transparent
          opacity={0.12}
          side={DoubleSide}
          depthWrite={false}
        />
      </mesh>

      {/* Planet body — this group moves */}
      <group ref={groupRef}>
        <mesh>
          <sphereGeometry args={[def.radius, 24, 24]} />
          <meshStandardMaterial
            color={new Color(def.color)}
            emissive={new Color(def.emissive)}
            emissiveIntensity={0.2}
            metalness={0.2}
            roughness={0.7}
          />
        </mesh>

        {/* Saturn ring */}
        {def.hasRing && (
          <mesh rotation={[Math.PI * 0.45, 0, 0]}>
            <ringGeometry args={[def.radius * 1.3, def.radius * 2.2, 48]} />
            <meshStandardMaterial
              color={new Color(0xcca86a)}
              transparent
              opacity={0.55}
              side={DoubleSide}
            />
          </mesh>
        )}

        {/* Earth's Moon */}
        {def.hasMoon && (
          <group ref={moonRef}>
            <mesh>
              <sphereGeometry args={[0.1, 16, 16]} />
              <meshStandardMaterial
                color={new Color(def.moonColor ?? 0x999999)}
                emissive={new Color(0x222222)}
                emissiveIntensity={0.1}
              />
            </mesh>
          </group>
        )}
      </group>
    </group>
  );
}

// ── MAIN SOLAR SYSTEM ──

export default function SolarSystem() {
  const groupRef = useRef<Group>(null);

  // Slow overall rotation
  useFrame((_, delta) => {
    if (groupRef.current) {
      groupRef.current.rotation.y += delta * 0.005;
    }
  });

  return (
    <group ref={groupRef} position={[60, -5, -50]}>
      {/* Sun */}
      <group>
        {/* Sun body */}
        <mesh>
          <sphereGeometry args={[4, 32, 32]} />
          <meshBasicMaterial color={new Color(1.0, 0.95, 0.7)} />
        </mesh>
        {/* Sun corona */}
        <mesh>
          <sphereGeometry args={[6, 32, 32]} />
          <meshBasicMaterial
            color={new Color(1.0, 0.85, 0.3)}
            transparent
            opacity={0.15}
            blending={AdditiveBlending}
            depthWrite={false}
          />
        </mesh>
        {/* Sun glow */}
        <mesh>
          <sphereGeometry args={[8, 24, 24]} />
          <meshBasicMaterial
            color={new Color(1.0, 0.7, 0.2)}
            transparent
            opacity={0.06}
            blending={AdditiveBlending}
            depthWrite={false}
          />
        </mesh>
        {/* Sun light */}
        <pointLight color={new Color(1.0, 0.95, 0.85)} intensity={4} distance={150} decay={0.4} />
      </group>

      {/* Planets */}
      {PLANETS.map((planet) => (
        <Planet key={planet.name} def={planet} />
      ))}
    </group>
  );
}
