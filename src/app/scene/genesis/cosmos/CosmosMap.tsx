/**
 * ==========================================================
 * LÉLUVERSE COSMOS MAP
 *
 * The master 3D visualization of the LÉLU cognitive hierarchy.
 * Connected to existing runtime via CosmosStore.
 *
 * React Three Fiber scene containing:
 *   - LÉLU Core (central intelligence)
 *   - SHAMAN (governing intelligence beneath LÉLU)
 *   - Executive Galaxies (Governor, Caretaker, Engineer, Warden, Sage)
 *   - Agent Universes (inside their Executive Galaxy)
 *   - Aurora communication pathways
 *   - Memory Garden
 *   - Deep-space backdrop
 *
 * ALL entities map to real runtime entities.
 * NO duplicate state. NO fake agents.
 * ==========================================================
 */

import { useRef, useMemo, useEffect, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Html, Stars } from "@react-three/drei";
import { Group, Vector3, Color, AdditiveBlending } from "three";
import CosmosStore from "./CosmosStore";
import type {
  CosmosState,
  CosmosEntity,
  ExecutiveGalaxy,
  AuroraPathway,
} from "./CosmosTypes";

/* ------------------------------------------------------------------
 * CAMERA CONTROLLER — smooth orbit + zoom + navigation
 * ------------------------------------------------------------------ */

function CosmosCamera() {
  const { camera } = useThree();
  const state = CosmosStore.getInstance().getState();
  const targetPos = useRef(new Vector3(
    state.camera.position.x,
    state.camera.position.y,
    state.camera.position.z,
  ));
  const currentPos = useRef(new Vector3(
    state.camera.position.x,
    state.camera.position.y,
    state.camera.position.z,
  ));

  useFrame((_, delta) => {
    const cosmos = CosmosStore.getInstance().getState();
    const cam = cosmos.camera;

    targetPos.current.set(cam.position.x, cam.position.y, cam.position.z);
    currentPos.current.lerp(targetPos.current, Math.min(1, delta * 2));

    camera.position.copy(currentPos.current);
    camera.lookAt(cam.target.x, cam.target.y, cam.target.z);
  });

  return null;
}

/* ------------------------------------------------------------------
 * LÉLU CORE — the central gravitational intelligence
 * ------------------------------------------------------------------ */

function LeluCore({ entity }: { entity: CosmosEntity }) {
  const meshRef = useRef<Group>(null);

  useFrame(({ clock }) => {
    if (!meshRef.current) return;
    const t = clock.elapsedTime;
    // Central gravitational breathing
    const breath = 1 + Math.sin(t * 0.4) * 0.06 + entity.activity.energy * 0.08;
    meshRef.current.scale.setScalar(entity.scale * breath);
    meshRef.current.rotation.y = t * 0.05;
    meshRef.current.rotation.x = Math.sin(t * 0.03) * 0.1;
  });

  const dna = entity.visualDNA;
  const baseColor = new Color().setHSL(dna.hue / 360, dna.saturation, dna.brightness);
  const glowColor = new Color().setHSL(dna.hue / 360, 0.9, 0.7);

  return (
    <group ref={meshRef} position={[entity.position.x, entity.position.y, entity.position.z]}>
      {/* Core sphere */}
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

      {/* Inner glow */}
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

      {/* Orbital rings */}
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

      {/* Label */}
      <Html position={[0, 1.8, 0]} center distanceFactor={15} style={{ pointerEvents: "none" }}>
        <div style={{
          color: "rgba(220, 240, 255, 0.95)",
          fontSize: "11px",
          fontWeight: 700,
          letterSpacing: "0.2em",
          textTransform: "uppercase",
          textShadow: "0 0 12px rgba(103, 232, 249, 0.8)",
          whiteSpace: "nowrap",
          fontFamily: "system-ui, sans-serif",
        }}>
          LÉLU
        </div>
      </Html>
    </group>
  );
}

/* ------------------------------------------------------------------
 * SHAMAN — governing intelligence beneath LÉLU
 * ------------------------------------------------------------------ */

function ShamanCore({ entity }: { entity: CosmosEntity }) {
  const meshRef = useRef<Group>(null);

  useFrame(({ clock }) => {
    if (!meshRef.current) return;
    const t = clock.elapsedTime;
    // SHAMAN orbits slowly around LÉLU
    const angle = t * entity.orbit.speed + entity.orbit.phase;
    const r = entity.orbit.radius;
    const ecc = entity.orbit.eccentricity;
    meshRef.current.position.x = entity.position.x + Math.cos(angle) * r * (1 - ecc);
    meshRef.current.position.y = entity.position.y + Math.sin(angle) * r * Math.sin(entity.orbit.inclination);
    meshRef.current.position.z = entity.position.z + Math.sin(angle * 0.5) * r * ecc * 0.3;

    const breath = 1 + Math.sin(t * 0.5) * 0.05 + entity.activity.energy * 0.1;
    meshRef.current.scale.setScalar(entity.scale * breath);
    meshRef.current.rotation.y = t * 0.08;
  });

  const dna = entity.visualDNA;
  const baseColor = new Color().setHSL(dna.hue / 360, dna.saturation, dna.brightness);
  const glowColor = new Color().setHSL(dna.hue / 360, 0.9, 0.65);

  return (
    <group ref={meshRef}>
      {/* SHAMAN core */}
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

      {/* Glow shell */}
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

      {/* Label */}
      <Html position={[0, 1.3, 0]} center distanceFactor={15} style={{ pointerEvents: "none" }}>
        <div style={{
          color: "rgba(200, 220, 255, 0.9)",
          fontSize: "10px",
          fontWeight: 600,
          letterSpacing: "0.18em",
          textTransform: "uppercase",
          textShadow: "0 0 10px rgba(147, 197, 253, 0.7)",
          whiteSpace: "nowrap",
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

function ExecutiveGalaxyNode({ galaxy, isSelected }: { galaxy: ExecutiveGalaxy; isSelected: boolean }) {
  const meshRef = useRef<Group>(null);
  const store = CosmosStore.getInstance();

  useFrame(({ clock }) => {
    if (!meshRef.current) return;
    const t = clock.elapsedTime;
    // Organic orbital motion — different plane, speed, eccentricity per galaxy
    const angle = t * galaxy.orbit.speed + galaxy.orbit.phase;
    const r = galaxy.orbit.radius;
    const ecc = galaxy.orbit.eccentricity;
    const inc = galaxy.orbit.inclination;

    meshRef.current.position.x =
      galaxy.position.x + Math.cos(angle) * r * (1 - ecc) + galaxy.orbit.driftX * t * 0.1;
    meshRef.current.position.y =
      galaxy.position.y + Math.sin(angle) * r * Math.sin(inc) + galaxy.orbit.driftY * t * 0.1;
    meshRef.current.position.z =
      galaxy.position.z + Math.sin(angle * 0.7) * r * ecc * 0.4 + galaxy.orbit.driftZ * t * 0.1;

    // Morphology-driven rotation
    const rotSpeed = 0.03 + galaxy.morphology.mutationProgress * 0.05;
    meshRef.current.rotation.y = t * rotSpeed;

    // Activity-driven breathing
    const breath = 1 + Math.sin(t * 0.3) * 0.04 + galaxy.activity.energy * 0.12;
    meshRef.current.scale.setScalar(galaxy.scale * breath);
  });

  const dna = galaxy.visualDNA;
  const baseColor = new Color().setHSL(dna.hue / 360, dna.saturation, dna.brightness);
  const glowColor = new Color().setHSL(dna.hue / 360, 0.85, 0.6);

  // Morphology-driven geometry
  const geometryComponent = useMemo(() => {
    switch (galaxy.morphology.type) {
      case "ordered":
        return <octahedronGeometry args={[0.6, 1]} />;
      case "protective":
        return <dodecahedronGeometry args={[0.6, 0]} />;
      case "constructive":
        return <boxGeometry args={[0.9, 0.9, 0.9]} />;
      case "vigilant":
        return <tetrahedronGeometry args={[0.7, 0]} />;
      case "knowledge":
        return <icosahedronGeometry args={[0.6, 1]} />;
      default:
        return <sphereGeometry args={[0.6, 16, 16]} />;
    }
  }, [galaxy.morphology.type]);

  return (
    <group
      ref={meshRef}
      onClick={(e) => {
        e.stopPropagation();
        store.selectEntity(galaxy.id);
        store.navigateToEntity(galaxy.id);
      }}
    >
      {/* Galaxy core — unique morphology */}
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

      {/* Glow field */}
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

      {/* Morphology rings — unique per executive type */}
      {Array.from({ length: galaxy.morphology.rings }).map((_, i) => (
        <mesh
          key={`ring-${i}`}
          rotation={[Math.PI / 2 + i * (Math.PI / galaxy.morphology.rings), i * 0.3, 0]}
        >
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

      {/* Shield structures for Warden */}
      {galaxy.morphology.shields > 0 && Array.from({ length: galaxy.morphology.shields }).map((_, i) => {
        const angle = (i / galaxy.morphology.shields) * Math.PI * 2;
        return (
          <mesh
            key={`shield-${i}`}
            position={[Math.cos(angle) * 1.1, Math.sin(angle) * 1.1, 0]}
          >
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

      {/* Branching knowledge structures for Sage */}
      {galaxy.morphology.branches > 0 && Array.from({ length: Math.min(galaxy.morphology.branches, 8) }).map((_, i) => {
        const angle = (i / galaxy.morphology.branches) * Math.PI * 2;
        const len = 0.5 + (i % 3) * 0.3;
        return (
          <mesh
            key={`branch-${i}`}
            position={[Math.cos(angle) * len, Math.sin(angle) * len, 0]}
            rotation={[0, 0, angle]}
          >
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

      {/* Galaxy label */}
      <Html position={[0, 1.2, 0]} center distanceFactor={15} style={{ pointerEvents: "none" }}>
        <div style={{
          color: `hsl(${dna.hue}, 70%, 85%)`,
          fontSize: "9px",
          fontWeight: 600,
          letterSpacing: "0.15em",
          textTransform: "uppercase",
          textShadow: `0 0 8px hsl(${dna.hue}, 80%, 60%)`,
          whiteSpace: "nowrap",
          fontFamily: "system-ui, sans-serif",
          opacity: isSelected ? 1 : 0.75,
        }}>
          {galaxy.name}
        </div>
      </Html>

      {/* Children — agent universes rendered as orbiting dots */}
      {galaxy.childrenIds.map((childId) => (
        <AgentUniverseNode key={childId} parentId={galaxy.id} />
      ))}
    </group>
  );
}

/* ------------------------------------------------------------------
 * AGENT UNIVERSE — miniature cosmos inside executive galaxy
 * ------------------------------------------------------------------ */

function AgentUniverseNode({ parentId }: { parentId: string }) {
  const store = CosmosStore.getInstance();
  const universe = store.getState().agentUniverses.find((u) => u.parentId === parentId);
  const meshRef = useRef<Group>(null);

  useFrame(({ clock }) => {
    if (!meshRef.current || !universe) return;
    const t = clock.elapsedTime;
    // Orbit within the parent galaxy
    const angle = t * universe.orbit.speed + universe.orbit.phase;
    const r = universe.orbit.radius;

    meshRef.current.position.x = Math.cos(angle) * r * (1 - universe.orbit.eccentricity);
    meshRef.current.position.y = Math.sin(angle) * r * Math.sin(universe.orbit.inclination);
    meshRef.current.position.z = Math.sin(angle * 0.5) * r * universe.orbit.eccentricity * 0.3;

    const breath = 1 + Math.sin(t * 0.6 + universe.orbit.phase) * 0.06;
    meshRef.current.scale.setScalar(universe.scale * breath);
    meshRef.current.rotation.y = t * 0.12;
  });

  if (!universe) return null;

  const dna = universe.visualDNA;
  const color = new Color().setHSL(dna.hue / 360, dna.saturation, dna.brightness);
  const glow = new Color().setHSL(dna.hue / 360, 0.8, 0.55);

  // Growth stage determines visual complexity
  const growthScale = universe.growthStage === "seed" ? 0.3 :
                      universe.growthStage === "nebula" ? 0.4 :
                      universe.growthStage === "star" ? 0.5 :
                      universe.growthStage === "system" ? 0.6 : 0.7;

  return (
    <group
      ref={meshRef}
      onClick={(e) => {
        e.stopPropagation();
        store.selectEntity(universe.id);
        store.navigateToEntity(universe.id);
      }}
    >
      {/* Universe core */}
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

      {/* Activity glow */}
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

      {/* Growth-stage moons/planets */}
      {universe.growthStage !== "seed" && (
        <>
          <mesh position={[0.3 * growthScale, 0, 0]}>
            <sphereGeometry args={[0.05, 6, 6]} />
            <meshStandardMaterial color={color} emissive={glow} emissiveIntensity={0.2} transparent opacity={0.6} />
          </mesh>
          {universe.growthStage === "system" || universe.growthStage === "constellation" ? (
            <mesh position={[-0.25 * growthScale, 0.15, 0]}>
              <sphereGeometry args={[0.04, 6, 6]} />
              <meshStandardMaterial color={color} emissive={glow} emissiveIntensity={0.2} transparent opacity={0.5} />
            </mesh>
          ) : null}
        </>
      )}

      {/* Constellation pathways for advanced growth */}
      {universe.growthStage === "constellation" && universe.systems.length > 2 && (
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.35, 0.003, 4, 24]} />
          <meshStandardMaterial
            color={glow}
            emissive={glow}
            emissiveIntensity={0.3}
            transparent
            opacity={0.2}
            blending={AdditiveBlending}
          />
        </mesh>
      )}

      {/* Label */}
      <Html position={[0, 0.35 * growthScale, 0]} center distanceFactor={20} style={{ pointerEvents: "none" }}>
        <div style={{
          color: `hsl(${dna.hue}, 60%, 80%)`,
          fontSize: "7px",
          fontWeight: 500,
          letterSpacing: "0.1em",
          textShadow: `0 0 6px hsl(${dna.hue}, 70%, 50%)`,
          whiteSpace: "nowrap",
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
 * AURORA PATHWAYS — visual connections between communicating entities
 * ------------------------------------------------------------------ */

function AuroraPathwayMesh({ pathway, entities }: { pathway: AuroraPathway; entities: CosmosEntity[] }) {
  const lineRef = useRef<Group>(null);
  const particleRef = useRef<Group>(null);

  const fromEntity = entities.find((e) => e.id === pathway.fromId);
  const toEntity = entities.find((e) => e.id === pathway.toId);

  useFrame(({ clock }) => {
    if (!particleRef.current || !fromEntity || !toEntity) return;
    const t = clock.elapsedTime;

    // Animate a particle along the path
    const progress = (t * 0.1 + pathway.energy) % 1;
    particleRef.current.position.x = fromEntity.position.x + (toEntity.position.x - fromEntity.position.x) * progress;
    particleRef.current.position.y = fromEntity.position.y + (toEntity.position.y - fromEntity.position.y) * progress;
    particleRef.current.position.z = fromEntity.position.z + (toEntity.position.z - fromEntity.position.z) * progress;

    // Pulse visibility based on pathway energy
    particleRef.current.visible = pathway.energy > 0.08;
  });

  if (!fromEntity || !toEntity) return null;

  const pathColor = pathway.type === "hierarchy" ? "#7dd3fc" :
                    pathway.type === "communication" ? "#c084fc" :
                    pathway.type === "delegation" ? "#34d399" :
                    pathway.type === "memory" ? "#fbbf24" : "#94a3b8";

  return (
    <group>
      {/* Path line */}
      <group ref={lineRef}>
        <line>
          <bufferGeometry>
            <bufferAttribute
              attach="attributes-position"
              args={[new Float32Array([
                fromEntity.position.x, fromEntity.position.y, fromEntity.position.z,
                toEntity.position.x, toEntity.position.y, toEntity.position.z,
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
      </group>

      {/* Traveling particle */}
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
 * MEMORY GARDEN — organic visual structures for actual memory
 * ------------------------------------------------------------------ */

function MemoryGarden(_props: { state: CosmosState }) {
  const groupRef = useRef<Group>(null);
  const [memoryCount, setMemoryCount] = useState(0);

  // Poll memory count
  useEffect(() => {
    let cancelled = false;
    const interval = window.setInterval(async () => {
      try {
        const { default: AIService } = await import("../../../../core/AIService");
        const memories = await AIService.getInstance().getMemories(500);
        if (!cancelled) setMemoryCount(memories.length);
      } catch { /* memory may be empty */ }
    }, 10000);
    return () => { cancelled = true; window.clearInterval(interval); };
  }, []);

  useFrame(({ clock }) => {
    if (!groupRef.current) return;
    const t = clock.elapsedTime;
    // Gentle sway
    groupRef.current.rotation.y = Math.sin(t * 0.05) * 0.02;
    groupRef.current.position.x = -6;
    groupRef.current.position.y = -8;
    groupRef.current.position.z = 2;
  });

  // Organic garden structures — seeds, plants, trees, groves
  const structures = useMemo(() => {
    const items: Array<{ pos: [number, number, number]; scale: number; type: "seed" | "plant" | "tree" | "grove"; hue: number }> = [];
    const count = Math.min(memoryCount, 30);
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2;
      const r = 0.5 + (i % 5) * 0.6;
      items.push({
        pos: [Math.cos(angle) * r, Math.sin(i * 0.7) * 0.3, Math.sin(angle) * r],
        scale: 0.08 + (i % 3) * 0.04,
        type: i % 5 === 0 ? "grove" : i % 3 === 0 ? "tree" : i % 2 === 0 ? "plant" : "seed",
        hue: 120 + (i * 17) % 60, // Green-gold spectrum
      });
    }
    return items;
  }, [memoryCount]);

  return (
    <group ref={groupRef}>
      {/* Ground */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.15, 0]}>
        <circleGeometry args={[2, 24]} />
        <meshStandardMaterial
          color="#0a2a1a"
          emissive="#1a4a2a"
          emissiveIntensity={0.1}
          transparent
          opacity={0.4}
        />
      </mesh>

      {/* Garden structures */}
      {structures.map((s, i) => (
        <group key={i} position={s.pos}>
          {s.type === "seed" && (
            <mesh>
              <sphereGeometry args={[s.scale, 6, 6]} />
              <meshStandardMaterial
                color={new Color().setHSL(s.hue / 360, 0.5, 0.5)}
                emissive={new Color().setHSL(s.hue / 360, 0.6, 0.3)}
                emissiveIntensity={0.3}
                transparent
                opacity={0.6}
              />
            </mesh>
          )}
          {s.type === "plant" && (
            <>
              <mesh position={[0, s.scale * 2, 0]}>
                <cylinderGeometry args={[0.005, 0.008, s.scale * 4, 4]} />
                <meshStandardMaterial color="#2a6a3a" emissive="#2a6a3a" emissiveIntensity={0.2} transparent opacity={0.5} />
              </mesh>
              <mesh position={[0, s.scale * 4, 0]}>
                <sphereGeometry args={[s.scale * 0.8, 8, 8]} />
                <meshStandardMaterial
                  color={new Color().setHSL(s.hue / 360, 0.6, 0.4)}
                  emissive={new Color().setHSL(s.hue / 360, 0.7, 0.3)}
                  emissiveIntensity={0.25}
                  transparent
                  opacity={0.5}
                />
              </mesh>
            </>
          )}
          {s.type === "tree" && (
            <>
              <mesh position={[0, s.scale * 3, 0]}>
                <cylinderGeometry args={[0.008, 0.012, s.scale * 6, 4]} />
                <meshStandardMaterial color="#3a5a2a" emissive="#2a4a1a" emissiveIntensity={0.15} transparent opacity={0.5} />
              </mesh>
              <mesh position={[0, s.scale * 6, 0]}>
                <coneGeometry args={[s.scale * 1.5, s.scale * 3, 6]} />
                <meshStandardMaterial
                  color={new Color().setHSL(s.hue / 360, 0.5, 0.35)}
                  emissive={new Color().setHSL(s.hue / 360, 0.6, 0.25)}
                  emissiveIntensity={0.2}
                  transparent
                  opacity={0.5}
                />
              </mesh>
            </>
          )}
          {s.type === "grove" && (
            <>
              {Array.from({ length: 4 }).map((_, j) => {
                const ga = (j / 4) * Math.PI * 2;
                return (
                  <mesh key={j} position={[Math.cos(ga) * s.scale, s.scale * 2, Math.sin(ga) * s.scale]}>
                    <sphereGeometry args={[s.scale * 0.6, 6, 6]} />
                    <meshStandardMaterial
                      color={new Color().setHSL(s.hue / 360, 0.55, 0.35)}
                      emissive={new Color().setHSL(s.hue / 360, 0.65, 0.25)}
                      emissiveIntensity={0.2}
                      transparent
                      opacity={0.4}
                    />
                  </mesh>
                );
              })}
            </>
          )}
        </group>
      ))}

      {/* Label */}
      <Html position={[0, 1.2, 0]} center distanceFactor={15} style={{ pointerEvents: "none" }}>
        <div style={{
          color: "rgba(134, 239, 172, 0.8)",
          fontSize: "8px",
          fontWeight: 500,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          textShadow: "0 0 8px rgba(34, 197, 94, 0.5)",
          whiteSpace: "nowrap",
          fontFamily: "system-ui, sans-serif",
        }}>
          Memory Garden · {memoryCount} memories
        </div>
      </Html>
    </group>
  );
}

/* ------------------------------------------------------------------
 * COSMOS MAP ROOT — the scene graph
 * ------------------------------------------------------------------ */

function CosmosScene() {
  const groupRef = useRef<Group>(null);
  const [state, setState] = useState<CosmosState>(() => CosmosStore.getInstance().getState());

  // Subscribe to cosmos state updates
  useEffect(() => {
    return CosmosStore.getInstance().subscribe((next) => {
      setState(next);
    });
  }, []);

  return (
    <>
      <CosmosCamera />

      {/* Ambient + directional light */}
      <ambientLight intensity={0.15} />
      <directionalLight position={[10, 10, 5]} intensity={0.3} color="#e0e7ff" />
      <pointLight position={[0, 0, 0]} intensity={0.8} color="#67e8f9" distance={30} />

      {/* Deep-space stars */}
      <Stars radius={100} depth={80} count={3000} factor={3} saturation={0.5} fade speed={0.3} />

      <group ref={groupRef}>
        {/* LÉLU Core */}
        {state.entities.filter((e) => e.level === "lelu-core").map((entity) => (
          <LeluCore key={entity.id} entity={entity} />
        ))}

        {/* SHAMAN */}
        {state.entities.filter((e) => e.level === "shaman").map((entity) => (
          <ShamanCore key={entity.id} entity={entity} />
        ))}

        {/* Executive Galaxies */}
        {state.executiveGalaxies.map((galaxy) => (
          <ExecutiveGalaxyNode
            key={galaxy.id}
            galaxy={galaxy}
            isSelected={state.selectedEntityId === galaxy.id}
          />
        ))}

        {/* Aurora Pathways */}
        {state.auroraPathways.map((pathway) => (
          <AuroraPathwayMesh
            key={pathway.id}
            pathway={pathway}
            entities={state.entities}
          />
        ))}

        {/* Memory Garden */}
        <MemoryGarden state={state} />
      </group>
    </>
  );
}

/* ------------------------------------------------------------------
 * COSMOS MAP — exported wrapper with Canvas
 * ------------------------------------------------------------------ */

export default function CosmosMap() {
  return (
    <div style={{
      position: "fixed",
      inset: 0,
      zIndex: 0,
      background: "#020617",
    }}>
      <Canvas
        camera={{ position: [0, 0, 18], fov: 55, near: 0.1, far: 200 }}
        gl={{ antialias: true, alpha: false }}
        style={{ width: "100%", height: "100%" }}
      >
        <color attach="background" args={["#020617"]} />
        <CosmosScene />
      </Canvas>
    </div>
  );
}
