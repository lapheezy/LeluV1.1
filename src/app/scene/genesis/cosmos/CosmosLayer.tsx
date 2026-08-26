/**
 * ==========================================================
 * LÉLUVERSE COSMOS LAYER
 *
 * 3D entities rendered INSIDE the existing Genesis Canvas.
 * Positioned at deep z-values (z=-20 to z=-60) so they
 * appear as the cosmic background behind the Genesis core.
 *
 * This is NOT a separate Canvas. It lives inside the
 * existing R3F scene alongside GenesisController.
 * ==========================================================
 */

import { useRef, useEffect, useState, useMemo } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import { Group, Color, AdditiveBlending, BufferAttribute } from "three";
import CosmosStore from "./CosmosStore";
import type {
  CosmosState,
  CosmosEntity,
  ExecutiveGalaxy,
  AuroraPathway,
} from "./CosmosTypes";
import InfiniteCosmos from "../engines/InfiniteCosmos";
import type { GalaxyData, NebulaData, BlackHoleData } from "../engines/InfiniteCosmos";
import {
  AuroraWaves,
  SpaceWaves,
  FlyingCars,
  ZodiacObservatoryVisual,
  CosmicStorms,
  FloatingCitiesVisual,
  CottonCandyClouds,
  CosmicEntities,
} from "./CosmosVisuals";
import SolarSystem from "./SolarSystem";

/* ------------------------------------------------------------------
 * CAMERA BLEND — smoothly transitions between Genesis view and Cosmos view
 * ------------------------------------------------------------------ */

function CosmosCameraBlend() {
  // Expose navigation API — navigateTo positions the camera smoothly
  // via GenesisCosmosPanel tap. Does NOT fight OrbitControls.
  useEffect(() => {
    (window as any).__cosmosCamera = {
      navigateTo: (pos: { x: number; y: number; z: number }, lookAt: { x: number; y: number; z: number }) => {
        // Dispatch a custom event that the camera controller can listen to
        window.dispatchEvent(new CustomEvent("cosmos-navigate", { detail: { pos, lookAt } }));
      },
      resetToGenesis: () => {
        window.dispatchEvent(new CustomEvent("cosmos-navigate", { detail: { pos: { x: 0, y: 0, z: 6.8 }, lookAt: { x: 0, y: 0, z: 0 } } }));
      },
    };
    return () => { delete (window as any).__cosmosCamera; };
  }, []);

  return null;
}

/* ------------------------------------------------------------------
 * LÉLU CORE — central gravitational intelligence
 * ------------------------------------------------------------------ */

function LeluCore({ entity }: { entity: CosmosEntity }) {
  const meshRef = useRef<Group>(null);

  useFrame(({ clock }) => {
    if (!meshRef.current) return;
    const t = clock.elapsedTime;
    const breath = 1 + Math.sin(t * 0.4) * 0.06 + entity.activity.energy * 0.08;
    meshRef.current.scale.setScalar(entity.scale * breath);
    meshRef.current.rotation.y = t * 0.05;
    meshRef.current.rotation.x = Math.sin(t * 0.03) * 0.1;
  });

  const dna = entity.visualDNA;
  const baseColor = new Color().setHSL(dna.hue / 360, dna.saturation, dna.brightness);
  const glowColor = new Color().setHSL(dna.hue / 360, 0.9, 0.7);

  return (
    <group ref={meshRef} position={[entity.position.x, entity.position.y, entity.position.z - 25]}>
      <mesh>
        <sphereGeometry args={[1, 32, 32]} />
        <meshStandardMaterial
          color={baseColor}
          emissive={glowColor}
          emissiveIntensity={0.4 + entity.activity.energy * 0.6}
          transparent
          opacity={0.85}
          roughness={0.2}
          metalness={0.6}
        />
      </mesh>
      <mesh>
        <sphereGeometry args={[1.15, 16, 16]} />
        <meshStandardMaterial
          color={glowColor}
          emissive={glowColor}
          emissiveIntensity={0.3}
          transparent
          opacity={0.15 + entity.activity.energy * 0.15}
          blending={AdditiveBlending}
          depthWrite={false}
        />
      </mesh>
      {[0, 1, 2].map((i) => (
        <mesh key={i} rotation={[Math.PI / 2 + i * 0.4, i * 0.3, 0]}>
          <torusGeometry args={[1.4 + i * 0.5, 0.015, 8, 64]} />
          <meshStandardMaterial
            color={new Color().setHSL((dna.hue + i * 30) / 360, 0.8, 0.7)}
            emissive={new Color().setHSL((dna.hue + i * 30) / 360, 0.9, 0.5)}
            emissiveIntensity={0.5}
            transparent
            opacity={0.4}
            blending={AdditiveBlending}
          />
        </mesh>
      ))}
      <Html position={[0, 1.8, 0]} center distanceFactor={20} style={{ pointerEvents: "none" }}>
        <div style={{
          color: "rgba(220, 240, 255, 0.95)",
          fontSize: "11px",
          fontWeight: 700,
          letterSpacing: "0.2em",
          textTransform: "uppercase" as const,
          textShadow: "0 0 12px rgba(103, 232, 249, 0.8)",
          whiteSpace: "nowrap" as const,
          fontFamily: "system-ui, sans-serif",
        }}>
          LÉLU
        </div>
      </Html>
    </group>
  );
}

/* ------------------------------------------------------------------
 * SHAMAN — governing intelligence
 * ------------------------------------------------------------------ */

function ShamanCore({ entity }: { entity: CosmosEntity }) {
  const meshRef = useRef<Group>(null);

  useFrame(({ clock }) => {
    if (!meshRef.current) return;
    const t = clock.elapsedTime;
    const angle = t * entity.orbit.speed + entity.orbit.phase;
    const r = entity.orbit.radius;
    const ecc = entity.orbit.eccentricity;
    meshRef.current.position.x = entity.position.x + Math.cos(angle) * r * (1 - ecc);
    meshRef.current.position.y = entity.position.y + Math.sin(angle) * r * Math.sin(entity.orbit.inclination);
    meshRef.current.position.z = entity.position.z - 25 + Math.sin(angle * 0.5) * r * ecc * 0.3;
    const breath = 1 + Math.sin(t * 0.5) * 0.05 + entity.activity.energy * 0.1;
    meshRef.current.scale.setScalar(entity.scale * breath);
    meshRef.current.rotation.y = t * 0.08;
  });

  const dna = entity.visualDNA;
  const baseColor = new Color().setHSL(dna.hue / 360, dna.saturation, dna.brightness);
  const glowColor = new Color().setHSL(dna.hue / 360, 0.9, 0.65);

  return (
    <group ref={meshRef} position={[entity.position.x, entity.position.y, entity.position.z - 25]}>
      <mesh>
        <icosahedronGeometry args={[0.8, 2]} />
        <meshStandardMaterial
          color={baseColor}
          emissive={glowColor}
          emissiveIntensity={0.3 + entity.activity.energy * 0.7}
          transparent
          opacity={0.8}
          roughness={0.3}
          metalness={0.5}
        />
      </mesh>
      <mesh>
        <sphereGeometry args={[1.0, 16, 16]} />
        <meshStandardMaterial
          color={glowColor}
          emissive={glowColor}
          emissiveIntensity={0.2}
          transparent
          opacity={0.1 + entity.activity.energy * 0.1}
          blending={AdditiveBlending}
          depthWrite={false}
        />
      </mesh>
      <Html position={[0, 1.3, 0]} center distanceFactor={20} style={{ pointerEvents: "none" }}>
        <div style={{
          color: "rgba(200, 220, 255, 0.9)",
          fontSize: "10px",
          fontWeight: 600,
          letterSpacing: "0.18em",
          textTransform: "uppercase" as const,
          textShadow: "0 0 10px rgba(147, 197, 253, 0.7)",
          whiteSpace: "nowrap" as const,
          fontFamily: "system-ui, sans-serif",
        }}>
          SHAMAN
        </div>
      </Html>
    </group>
  );
}

/* ------------------------------------------------------------------
 * EXECUTIVE GALAXY — each executive has a unique morphological core
 * ------------------------------------------------------------------ */

function ExecutiveGalaxyNode({ galaxy }: { galaxy: ExecutiveGalaxy }) {
  const meshRef = useRef<Group>(null);

  useFrame(({ clock }) => {
    if (!meshRef.current) return;
    const t = clock.elapsedTime;
    const angle = t * galaxy.orbit.speed + galaxy.orbit.phase;
    const r = galaxy.orbit.radius;
    const ecc = galaxy.orbit.eccentricity;
    const inc = galaxy.orbit.inclination;
    meshRef.current.position.x = galaxy.position.x + Math.cos(angle) * r * (1 - ecc);
    meshRef.current.position.y = galaxy.position.y + Math.sin(angle) * r * Math.sin(inc);
    meshRef.current.position.z = galaxy.position.z - 25 + Math.sin(angle * 0.7) * r * ecc * 0.4;
    const rotSpeed = 0.03 + galaxy.morphology.mutationProgress * 0.05;
    meshRef.current.rotation.y = t * rotSpeed;
    const breath = 1 + Math.sin(t * 0.3) * 0.04 + galaxy.activity.energy * 0.12;
    meshRef.current.scale.setScalar(galaxy.scale * breath);
  });

  const dna = galaxy.visualDNA;
  const baseColor = new Color().setHSL(dna.hue / 360, dna.saturation, dna.brightness);
  const glowColor = new Color().setHSL(dna.hue / 360, 0.85, 0.6);

  const geometryComponent = useMemo(() => {
    switch (galaxy.morphology.type) {
      case "ordered": return <octahedronGeometry args={[0.6, 1]} />;
      case "protective": return <dodecahedronGeometry args={[0.6, 0]} />;
      case "constructive": return <boxGeometry args={[0.9, 0.9, 0.9]} />;
      case "vigilant": return <tetrahedronGeometry args={[0.7, 0]} />;
      case "knowledge": return <icosahedronGeometry args={[0.6, 1]} />;
      default: return <sphereGeometry args={[0.6, 16, 16]} />;
    }
  }, [galaxy.morphology.type]);

  return (
    <group ref={meshRef} position={[galaxy.position.x, galaxy.position.y, galaxy.position.z - 25]}>
      <mesh>
        {geometryComponent}
        <meshStandardMaterial
          color={baseColor}
          emissive={glowColor}
          emissiveIntensity={0.25 + galaxy.activity.energy * 0.75}
          transparent
          opacity={0.82}
          roughness={0.25}
          metalness={0.55}
        />
      </mesh>
      <mesh>
        <sphereGeometry args={[0.9, 12, 12]} />
        <meshStandardMaterial
          color={glowColor}
          emissive={glowColor}
          emissiveIntensity={0.15}
          transparent
          opacity={0.08 + galaxy.activity.energy * 0.12}
          blending={AdditiveBlending}
          depthWrite={false}
        />
      </mesh>
      {Array.from({ length: galaxy.morphology.rings }).map((_, i) => (
        <mesh key={`ring-${i}`} rotation={[Math.PI / 2 + i * (Math.PI / galaxy.morphology.rings), i * 0.3, 0]}>
          <torusGeometry args={[0.8 + i * 0.2, 0.008, 6, 48]} />
          <meshStandardMaterial
            color={new Color().setHSL((dna.hue + i * 20) / 360, 0.7, 0.6)}
            emissive={new Color().setHSL((dna.hue + i * 20) / 360, 0.8, 0.4)}
            emissiveIntensity={0.4}
            transparent
            opacity={0.35}
            blending={AdditiveBlending}
          />
        </mesh>
      ))}
      {galaxy.morphology.shields > 0 && Array.from({ length: galaxy.morphology.shields }).map((_, i) => {
        const angle = (i / galaxy.morphology.shields) * Math.PI * 2;
        return (
          <mesh key={`shield-${i}`} position={[Math.cos(angle) * 1.1, Math.sin(angle) * 1.1, 0]}>
            <planeGeometry args={[0.25, 0.25]} />
            <meshStandardMaterial
              color={new Color().setHSL(30 / 360, 0.7, 0.6)}
              emissive={new Color().setHSL(30 / 360, 0.8, 0.4)}
              emissiveIntensity={0.3}
              transparent
              opacity={0.3}
              side={2}
              blending={AdditiveBlending}
            />
          </mesh>
        );
      })}
      {galaxy.morphology.branches > 0 && Array.from({ length: Math.min(galaxy.morphology.branches, 8) }).map((_, i) => {
        const angle = (i / galaxy.morphology.branches) * Math.PI * 2;
        const len = 0.5 + (i % 3) * 0.3;
        return (
          <mesh key={`branch-${i}`} position={[Math.cos(angle) * len, Math.sin(angle) * len, 0]} rotation={[0, 0, angle]}>
            <cylinderGeometry args={[0.005, 0.015, len * 1.5, 4]} />
            <meshStandardMaterial
              color={new Color().setHSL(280 / 360, 0.5, 0.6)}
              emissive={new Color().setHSL(280 / 360, 0.6, 0.4)}
              emissiveIntensity={0.3}
              transparent
              opacity={0.25}
            />
          </mesh>
        );
      })}
      <Html position={[0, 1.2, 0]} center distanceFactor={20} style={{ pointerEvents: "none" }}>
        <div style={{
          color: `hsl(${dna.hue}, 70%, 85%)`,
          fontSize: "9px",
          fontWeight: 600,
          letterSpacing: "0.15em",
          textTransform: "uppercase" as const,
          textShadow: `0 0 8px hsl(${dna.hue}, 80%, 60%)`,
          whiteSpace: "nowrap" as const,
          fontFamily: "system-ui, sans-serif",
          opacity: 0.75,
        }}>
          {galaxy.name}
        </div>
      </Html>
    </group>
  );
}

/* ------------------------------------------------------------------
 * AGENT UNIVERSE — miniature cosmos inside executive galaxy
 * ------------------------------------------------------------------ */

function AgentUniverseNode({ universe }: { universe: import("./CosmosTypes").AgentUniverse }) {
  const meshRef = useRef<Group>(null);

  useFrame(({ clock }) => {
    if (!meshRef.current) return;
    const t = clock.elapsedTime;
    const angle = t * universe.orbit.speed + universe.orbit.phase;
    const r = universe.orbit.radius;
    meshRef.current.position.x = universe.position.x + Math.cos(angle) * r * (1 - universe.orbit.eccentricity);
    meshRef.current.position.y = universe.position.y + Math.sin(angle) * r * Math.sin(universe.orbit.inclination);
    meshRef.current.position.z = universe.position.z - 25 + Math.sin(angle * 0.5) * r * universe.orbit.eccentricity * 0.3;
    const breath = 1 + Math.sin(t * 0.6 + universe.orbit.phase) * 0.06;
    meshRef.current.scale.setScalar(universe.scale * breath);
    meshRef.current.rotation.y = t * 0.12;
  });

  const dna = universe.visualDNA;
  const color = new Color().setHSL(dna.hue / 360, dna.saturation, dna.brightness);
  const glow = new Color().setHSL(dna.hue / 360, 0.8, 0.55);
  const growthScale = universe.growthStage === "seed" ? 0.3 :
                      universe.growthStage === "nebula" ? 0.4 :
                      universe.growthStage === "star" ? 0.5 :
                      universe.growthStage === "system" ? 0.6 : 0.7;

  return (
    <group ref={meshRef}>
      <mesh>
        <sphereGeometry args={[0.2 * growthScale, 12, 12]} />
        <meshStandardMaterial
          color={color}
          emissive={glow}
          emissiveIntensity={0.3 + universe.activity.energy * 0.7}
          transparent
          opacity={0.8}
          roughness={0.3}
        />
      </mesh>
      <mesh>
        <sphereGeometry args={[0.3 * growthScale, 8, 8]} />
        <meshStandardMaterial
          color={glow}
          emissive={glow}
          emissiveIntensity={0.15}
          transparent
          opacity={universe.activity.energy * 0.2}
          blending={AdditiveBlending}
          depthWrite={false}
        />
      </mesh>
      {universe.growthStage !== "seed" && (
        <mesh position={[0.3 * growthScale, 0, 0]}>
          <sphereGeometry args={[0.05, 6, 6]} />
          <meshStandardMaterial color={color} emissive={glow} emissiveIntensity={0.2} transparent opacity={0.6} />
        </mesh>
      )}
      <Html position={[0, 0.35 * growthScale, 0]} center distanceFactor={25} style={{ pointerEvents: "none" }}>
        <div style={{
          color: `hsl(${dna.hue}, 60%, 80%)`,
          fontSize: "7px",
          fontWeight: 500,
          letterSpacing: "0.1em",
          textShadow: `0 0 6px hsl(${dna.hue}, 70%, 50%)`,
          whiteSpace: "nowrap" as const,
          fontFamily: "system-ui, sans-serif",
          opacity: universe.activity.energy > 0.3 ? 0.9 : 0.5,
        }}>
          {universe.name}
        </div>
      </Html>
    </group>
  );
}

/* ------------------------------------------------------------------
 * AURORA PATHWAYS — visual connections
 * ------------------------------------------------------------------ */

function AuroraPathwayMesh({ pathway, entities }: { pathway: AuroraPathway; entities: CosmosEntity[] }) {
  const particleRef = useRef<Group>(null);
  const fromEntity = entities.find((e) => e.id === pathway.fromId);
  const toEntity = entities.find((e) => e.id === pathway.toId);

  useFrame(({ clock }) => {
    if (!particleRef.current || !fromEntity || !toEntity) return;
    const t = clock.elapsedTime;
    const progress = (t * 0.1 + pathway.energy) % 1;
    const zOffset = -25;
    particleRef.current.position.x = fromEntity.position.x + (toEntity.position.x - fromEntity.position.x) * progress;
    particleRef.current.position.y = fromEntity.position.y + (toEntity.position.y - fromEntity.position.y) * progress;
    particleRef.current.position.z = fromEntity.position.z + zOffset + ((toEntity.position.z + zOffset) - (fromEntity.position.z + zOffset)) * progress;
    particleRef.current.visible = pathway.energy > 0.08;
  });

  if (!fromEntity || !toEntity) return null;

  const zOffset = -25;
  const pathColor = pathway.type === "hierarchy" ? "#7dd3fc" :
                    pathway.type === "communication" ? "#c084fc" :
                    pathway.type === "delegation" ? "#34d399" :
                    pathway.type === "memory" ? "#fbbf24" : "#94a3b8";

  return (
    <group>
      <line>
        <bufferGeometry>
          <bufferAttribute
            attach="attributes-position"
            args={[new Float32Array([
              fromEntity.position.x, fromEntity.position.y, fromEntity.position.z + zOffset,
              toEntity.position.x, toEntity.position.y, toEntity.position.z + zOffset,
            ]), 3]}
          />
        </bufferGeometry>
        <lineBasicMaterial
          color={pathColor}
          transparent
          opacity={0.08 + pathway.energy * 0.15}
          blending={AdditiveBlending}
        />
      </line>
      <group ref={particleRef}>
        <mesh>
          <sphereGeometry args={[0.03, 6, 6]} />
          <meshStandardMaterial
            color={pathColor}
            emissive={pathColor}
            emissiveIntensity={0.8}
            transparent
            opacity={0.7}
            blending={AdditiveBlending}
          />
        </mesh>
      </group>
    </group>
  );
}

/* ------------------------------------------------------------------
 * INFINITE COSMOS — Camera Tracker
 * ------------------------------------------------------------------ */

function InfiniteCosmosTracker() {
  const { camera } = useThree();
  useFrame(() => {
    InfiniteCosmos.getInstance().updateCameraPosition(
      camera.position.x,
      camera.position.y,
      camera.position.z,
    );
  });
  return null;
}

/* ------------------------------------------------------------------
 * INFINITE COSMOS — Star Field (instanced points)
 * ------------------------------------------------------------------ */

function InfiniteStarField() {
  const meshRef = useRef<any>(null);
  const [data, setData] = useState(() => InfiniteCosmos.getInstance().getRenderableData());

  useEffect(() => {
    return InfiniteCosmos.getInstance().subscribe(() => {
      setData(InfiniteCosmos.getInstance().getRenderableData());
    });
  }, []);

  useFrame(({ clock }) => {
    if (!meshRef.current) return;
    const t = clock.elapsedTime;
    const count = data.stars.length;
    if (count === 0) return;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);

    for (let i = 0; i < count; i++) {
      const star = data.stars[i];
      positions[i * 3] = star.x;
      positions[i * 3 + 1] = star.y;
      positions[i * 3 + 2] = star.z - 25;

      const c = new Color().setHSL(star.hue / 360, 0.6, star.brightness * (0.7 + 0.3 * Math.sin(t * star.twinkleSpeed + star.twinklePhase)));
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }

    meshRef.current.geometry.setAttribute("position", new BufferAttribute(positions, 3));
    meshRef.current.geometry.setAttribute("color", new BufferAttribute(colors, 3));
  });

  return (
    <points ref={meshRef}>
      <bufferGeometry />
      <pointsMaterial size={0.08} vertexColors transparent opacity={0.8} sizeAttenuation blending={AdditiveBlending} depthWrite={false} />
    </points>
  );
}

/* ------------------------------------------------------------------
 * INFINITE COSMOS — Galaxy Renderer
 * ------------------------------------------------------------------ */

function InfiniteGalaxyMesh({ galaxy }: { galaxy: GalaxyData }) {
  const groupRef = useRef<Group>(null);
  useFrame(({ clock }) => {
    if (!groupRef.current) return;
    groupRef.current.rotation.z = galaxy.rotation + clock.elapsedTime * 0.02;
  });

  const color = useMemo(() => new Color().setHSL(galaxy.hue / 360, 0.7, 0.6), [galaxy.hue]);
  const glowColor = useMemo(() => new Color().setHSL(galaxy.hue / 360, 0.9, 0.5), [galaxy.hue]);

  return (
    <group ref={groupRef} position={[galaxy.x, galaxy.y, galaxy.z - 25]}>
      <mesh>
        <sphereGeometry args={[galaxy.size * 0.2, 16, 16]} />
        <meshStandardMaterial color={color} emissive={glowColor} emissiveIntensity={0.5} transparent opacity={0.7} />
      </mesh>
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[galaxy.size * 0.6, galaxy.size * 0.15, 8, 32]} />
        <meshStandardMaterial color={glowColor} emissive={glowColor} emissiveIntensity={0.3} transparent opacity={0.15} blending={AdditiveBlending} depthWrite={false} />
      </mesh>
      {galaxy.spiralArms > 0 && Array.from({ length: galaxy.spiralArms }, (_, i) => (
        <mesh key={i} rotation={[Math.PI / 2 + i * (Math.PI * 2 / galaxy.spiralArms), 0, 0]}>
          <torusGeometry args={[galaxy.size * (0.4 + i * 0.15), 0.02, 6, 24]} />
          <meshStandardMaterial color={new Color().setHSL((galaxy.hue + i * 20) / 360, 0.8, 0.6)} emissive={new Color().setHSL((galaxy.hue + i * 20) / 360, 0.9, 0.4)} emissiveIntensity={0.4} transparent opacity={0.3} blending={AdditiveBlending} />
        </mesh>
      ))}
    </group>
  );
}

function InfiniteGalaxies() {
  const [galaxies, setGalaxies] = useState(() => InfiniteCosmos.getInstance().getRenderableData().galaxies);
  useEffect(() => {
    return InfiniteCosmos.getInstance().subscribe(() => {
      setGalaxies(InfiniteCosmos.getInstance().getRenderableData().galaxies);
    });
  }, []);
  const visible = useMemo(() => galaxies.slice(0, 30), [galaxies]);
  return (
    <group>
      {visible.map((g) => <InfiniteGalaxyMesh key={g.id} galaxy={g} />)}
    </group>
  );
}

/* ------------------------------------------------------------------
 * INFINITE COSMOS — Nebula Renderer
 * ------------------------------------------------------------------ */

function InfiniteNebulaMesh({ nebula }: { nebula: NebulaData }) {
  const color = useMemo(() => new Color().setHSL(nebula.hue / 360, 0.6, 0.4), [nebula.hue]);
  return (
    <mesh position={[nebula.x, nebula.y, nebula.z - 25]}>
      <sphereGeometry args={[nebula.size, 12, 12]} />
      <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.1} transparent opacity={nebula.opacity} blending={AdditiveBlending} depthWrite={false} />
    </mesh>
  );
}

function InfiniteNebulae() {
  const [nebulae, setNebulae] = useState(() => InfiniteCosmos.getInstance().getRenderableData().nebulae);
  useEffect(() => {
    return InfiniteCosmos.getInstance().subscribe(() => {
      setNebulae(InfiniteCosmos.getInstance().getRenderableData().nebulae);
    });
  }, []);
  const visible = useMemo(() => nebulae.slice(0, 15), [nebulae]);
  return (
    <group>
      {visible.map((n) => <InfiniteNebulaMesh key={n.id} nebula={n} />)}
    </group>
  );
}

/* ------------------------------------------------------------------
 * INFINITE COSMOS — Black Hole Renderer
 * ------------------------------------------------------------------ */

function InfiniteBlackHoleMesh({ bh }: { bh: BlackHoleData }) {
  const groupRef = useRef<Group>(null);
  useFrame(({ clock }) => {
    if (!groupRef.current) return;
    groupRef.current.rotation.z = clock.elapsedTime * 0.3;
  });
  const accretionColor = useMemo(() => new Color().setHSL(bh.accretionHue / 360, 0.9, 0.5), [bh.accretionHue]);
  return (
    <group ref={groupRef} position={[bh.x, bh.y, bh.z - 25]}>
      <mesh>
        <sphereGeometry args={[bh.size * 0.3, 16, 16]} />
        <meshStandardMaterial color="#000000" emissive="#000000" emissiveIntensity={0} />
      </mesh>
      <mesh rotation={[Math.PI / 2.2, 0, 0]}>
        <torusGeometry args={[bh.size, bh.size * 0.08, 8, 32]} />
        <meshStandardMaterial color={accretionColor} emissive={accretionColor} emissiveIntensity={0.8} transparent opacity={0.6} blending={AdditiveBlending} />
      </mesh>
      <mesh>
        <sphereGeometry args={[bh.size * 1.5, 8, 8]} />
        <meshStandardMaterial color={accretionColor} emissive={accretionColor} emissiveIntensity={0.1} transparent opacity={0.05} blending={AdditiveBlending} depthWrite={false} />
      </mesh>
    </group>
  );
}

function InfiniteBlackHoles() {
  const [holes, setHoles] = useState(() => InfiniteCosmos.getInstance().getRenderableData().blackHoles);
  useEffect(() => {
    return InfiniteCosmos.getInstance().subscribe(() => {
      setHoles(InfiniteCosmos.getInstance().getRenderableData().blackHoles);
    });
  }, []);
  const visible = useMemo(() => holes.slice(0, 5), [holes]);
  return (
    <group>
      {visible.map((bh) => <InfiniteBlackHoleMesh key={bh.id} bh={bh} />)}
    </group>
  );
}

/* ------------------------------------------------------------------
 * COSMOS LAYER — exported for GenesisController
 * ------------------------------------------------------------------ */

export default function CosmosLayer() {
  const [state, setState] = useState<CosmosState>(() => CosmosStore.getInstance().getState());

  useEffect(() => {
    return CosmosStore.getInstance().subscribe(setState);
  }, []);

  useEffect(() => {
    InfiniteCosmos.getInstance().preloadAround(0, 0, 0);
  }, []);

  return (
    <group position={[0, 0, 0]}>
      <CosmosCameraBlend />
      <InfiniteCosmosTracker />

      <ambientLight intensity={0.08} color="#a5b4fc" />
      <pointLight position={[0, 0, -25]} intensity={0.6} color="#67e8f9" distance={40} />

      {/* ─── INFINITE COSMOS LAYER ─── */}
      <InfiniteStarField />
      <InfiniteGalaxies />
      <InfiniteNebulae />
      <InfiniteBlackHoles />

      {/* ─── COSMIC VISUAL EFFECTS ─── */}
      <AuroraWaves />
      <SpaceWaves />
      <FlyingCars />
      <CosmicStorms />
      <CottonCandyClouds />
      <CosmicEntities />
      <FloatingCitiesVisual />

      {/* ─── ZODIAC OBSERVATORY ─── */}
      <ZodiacObservatoryVisual />

      {/* ─── SOLAR SYSTEM ─── */}
      <SolarSystem />

      {/* ─── EXISTING ENTITY LAYER ─── */}
      {state.entities.filter((e) => e.level === "lelu-core").map((entity) => (
        <LeluCore key={entity.id} entity={entity} />
      ))}
      {state.entities.filter((e) => e.level === "shaman").map((entity) => (
        <ShamanCore key={entity.id} entity={entity} />
      ))}
      {state.executiveGalaxies.map((galaxy) => (
        <ExecutiveGalaxyNode key={galaxy.id} galaxy={galaxy} />
      ))}
      {state.agentUniverses.map((universe) => (
        <AgentUniverseNode key={universe.id} universe={universe} />
      ))}
      {state.auroraPathways.map((pathway) => (
        <AuroraPathwayMesh key={pathway.id} pathway={pathway} entities={state.entities} />
      ))}
    </group>
  );
}
