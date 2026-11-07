/**
 * ==========================================================
 * LÉLUVERSE — SPATIAL PORTAL FIELD
 *
 * The spatial interfaces themselves, inside the existing Genesis
 * canvas (no second renderer): a ring of dimensional portals,
 * one per navigable environment, each sitting at the world
 * position of the thing it opens.
 *
 *  - the galaxy portal follows the REAL executive-galaxy
 *    position from CosmosStore (same entity CosmosLayer draws),
 *  - the agent portal follows the first real agent universe,
 *  - the rest open the canonical environments (Browser, Studios,
 *    Projects, …) that SpatialExperience then opens as real
 *    panels.
 *
 * Performance: the portal seams and the particle field are one
 * instanced mesh and one point cloud; per-frame work is a material
 * opacity and a rotation, not geometry rebuilds. Portals are
 * distance-culled (LOD) and frustum culling stays on.
 * ==========================================================
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import {
  AdditiveBlending,
  BufferAttribute,
  Color,
  DoubleSide,
  Group,
  InstancedMesh,
  Matrix4,
  Points,
  Quaternion,
  Vector3,
} from "three";
import SpatialRuntime from "./SpatialRuntime";
import type { SpatialState } from "./SpatialRuntime";
import { destinationFor, type SpatialSceneId } from "./SpatialScenes";
import PortalRegistry, { RING_SCENES, isBuiltinPortal, type PortalRecord } from "./PortalRegistry";
import CosmosStore from "../genesis/cosmos/CosmosStore";

/**
 * Destinations drawn as portals in the world (the core and cosmos are the world
 * itself). The list belongs to the registry, so the ring and the seeding can
 * never disagree about what the built-in ring contains.
 */
const PORTAL_SCENES: readonly SpatialSceneId[] = RING_SCENES;

const PARTICLE_COUNT = 420;

interface PortalSpec {
  /** The portal record's id — stable across reloads. */
  id: string;
  /** The environment it opens; every portal points at a real destination. */
  destination: SpatialSceneId;
  label: string;
  accent: string;
  radius: number;
}

/**
 * The ring is built from the registry, not from the static scene graph: the
 * built-in environments are seeded as identities once, and a portal a person
 * or an agent creates appears here as soon as it is registered and disappears
 * when it is removed. No scene rebuild — this is React state over the one
 * canvas.
 */
function usePortalRecords(): PortalRecord[] {
  const [records, setRecords] = useState<PortalRecord[]>(() => {
    const registry = PortalRegistry.getInstance();
    registry.seedRing(PORTAL_SCENES);
    return registry.list();
  });
  useEffect(() => {
    const registry = PortalRegistry.getInstance();
    registry.seedRing(PORTAL_SCENES);
    setRecords(registry.list());
    return registry.subscribe((next) => setRecords(next));
  }, []);
  return records;
}

function useSpatialState(): SpatialState {
  const runtime = SpatialRuntime.getInstance();
  const [state, setState] = useState<SpatialState>(() => runtime.getState());
  useEffect(() => {
    setState(runtime.getState());
    return runtime.subscribe((next) => setState(next));
  }, [runtime]);
  return state;
}

/**
 * Feed the runtime the live Cosmos positions so "galaxy approach" and
 * "agent universes" fly to the galaxy/agent that actually exists, not a
 * hard-coded guess. Same entities CosmosLayer renders.
 */
function useCosmosAnchors(): number {
  const runtime = SpatialRuntime.getInstance();
  // Portal positions are allocated from the anchors, not from every emitted
  // frame: this counter changes only when the real Cosmos anchors do.
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const store = CosmosStore.getInstance();
    const sync = () => {
      const cosmos = store.getState();
      const galaxy = cosmos.executiveGalaxies[0];
      const universe = cosmos.agentUniverses[0];
      const anchors: Partial<Record<SpatialSceneId, { x: number; y: number; z: number }>> = {};
      if (galaxy) {
        anchors.galaxy = {
          x: galaxy.position.x,
          y: galaxy.position.y,
          z: galaxy.position.z - 25,
        };
      }
      if (universe) {
        anchors.agents = {
          x: universe.position.x,
          y: universe.position.y,
          z: universe.position.z - 25,
        };
      }
      runtime.setAnchors(anchors);
      setVersion((value) => value + 1);
    };
    sync();
    return store.subscribe(sync);
  }, [runtime]);
  return version;
}

/** One clickable portal: an instanced seam, a membrane and a light. */
function Portal({
  spec,
  state,
  position,
}: {
  spec: PortalSpec;
  state: SpatialState;
  position: Vector3;
}) {
  const runtime = SpatialRuntime.getInstance();
  const seam = useRef<Group>(null);
  const hovered = state.interaction.hovered === spec.destination;
  const travellingHere = state.destination === spec.destination && Boolean(state.transition);
  const visited = state.current === spec.destination;
  const intensity = hovered || travellingHere ? 1 : visited ? 0.55 : 0.28;
  const pulse = 1 + Math.sin(state.updatedAt / 320 + spec.radius) * 0.04;

  useFrame((_, delta) => {
    if (!seam.current) return;
    seam.current.rotation.z += delta * (0.25 + intensity * 0.5);
  });

  return (
    <group position={position}>
      <group ref={seam} scale={pulse}>
        <mesh
          name={`spatial-portal-${spec.id}`}
          userData={{ portalId: spec.id, destination: spec.destination, label: spec.label }}
          onClick={(event) => {
            event.stopPropagation();
            // Travelling through a portal is the SAME travel the rail uses:
            // one scene, one camera, no second canvas and no context reset.
            runtime.travel(spec.destination);
          }}
          onPointerOver={(event) => {
            event.stopPropagation();
            runtime.hover(spec.destination);
            document.body.style.cursor = "pointer";
          }}
          onPointerOut={() => {
            runtime.hover(null);
            document.body.style.cursor = "default";
          }}
        >
          <torusGeometry args={[spec.radius, 0.045, 10, 72]} />
          <meshBasicMaterial
            color={spec.accent}
            transparent
            opacity={0.35 + intensity * 0.55}
            blending={AdditiveBlending}
            depthWrite={false}
            toneMapped={false}
          />
        </mesh>
        <mesh rotation={[0, 0, Math.PI / 3]}>
          <torusGeometry args={[spec.radius * 0.72, 0.012, 8, 48]} />
          <meshBasicMaterial
            color={spec.accent}
            transparent
            opacity={0.18 + intensity * 0.4}
            blending={AdditiveBlending}
            depthWrite={false}
            toneMapped={false}
          />
        </mesh>
      </group>
      {/* The dimensional surface: what you pass through. */}
      <mesh name={`spatial-portal-surface-${spec.id}`} userData={{ portalId: spec.id }}>
        <circleGeometry args={[spec.radius * 0.86, 48]} />
        <meshBasicMaterial
          color={spec.accent}
          transparent
          opacity={0.05 + state.particles * 0.22 + intensity * 0.04}
          side={DoubleSide}
          blending={AdditiveBlending}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
      <pointLight
        color={spec.accent}
        intensity={0.35 + intensity * 0.9 + state.particles * 2.2}
        distance={7}
        decay={2}
      />
    </group>
  );
}

/**
 * The particle field: one point cloud, instanced geometry, driven by the
 * runtime's burst value. No per-frame allocation.
 */
function SpatialParticleField({ state }: { state: SpatialState }) {
  const points = useRef<Points>(null);
  const geometry = useMemo(() => {
    const positions = new Float32Array(PARTICLE_COUNT * 3);
    const colors = new Float32Array(PARTICLE_COUNT * 3);
    const accents = PORTAL_SCENES.map((id) => new Color(destinationFor(id).accent));
    for (let i = 0; i < PARTICLE_COUNT; i += 1) {
      const angle = (i / PARTICLE_COUNT) * Math.PI * 2 * 7;
      const radius = 3.4 + (i % 23) * 0.42;
      positions[i * 3] = Math.cos(angle) * radius;
      positions[i * 3 + 1] = Math.sin(angle * 0.7) * 2.4;
      positions[i * 3 + 2] = Math.sin(angle) * radius - 4;
      const color = accents[i % accents.length];
      colors[i * 3] = color.r;
      colors[i * 3 + 1] = color.g;
      colors[i * 3 + 2] = color.b;
    }
    return { positions, colors };
  }, []);

  const attribute = useMemo(() => new BufferAttribute(geometry.positions, 3), [geometry]);
  const colorAttribute = useMemo(() => {
    const attribute = new BufferAttribute(geometry.colors, 3);
    return attribute;
  }, [geometry]);

  useFrame((_, delta) => {
    if (!points.current) return;
    points.current.rotation.y += delta * 0.03;
  });

  return (
    <points ref={points} frustumCulled>
      <bufferGeometry>
        <primitive attach="attributes-position" object={attribute} />
        <primitive attach="attributes-color" object={colorAttribute} />
      </bufferGeometry>
      <pointsMaterial
        size={0.055 + state.particles * 0.12}
        vertexColors
        transparent
        opacity={0.25 + state.particles * 0.6}
        sizeAttenuation
        blending={AdditiveBlending}
        depthWrite={false}
        toneMapped={false}
      />
    </points>
  );
}

/**
 * Geometry morphing: the Core-facing shell that responds to a transition
 * by expanding and unwinding. It sits around the existing Core, it does
 * not replace it.
 */
function MorphShell({ state }: { state: SpatialState }) {
  const mesh = useRef<InstancedMesh>(null);
  const count = 12;
  const matrices = useMemo(() => {
    const matrix = new Matrix4();
    const quaternion = new Quaternion();
    const scale = new Vector3(1, 1, 1);
    const list: Matrix4[] = [];
    for (let i = 0; i < count; i += 1) {
      const angle = (i / count) * Math.PI * 2;
      list.push(
        matrix.clone().compose(
          new Vector3(Math.cos(angle) * 1.01, Math.sin(angle) * 1.01, Math.sin(angle * 2) * 0.2),
          quaternion.clone(),
          scale.clone(),
        ),
      );
    }
    return list;
  }, []);

  useEffect(() => {
    if (!mesh.current) return;
    matrices.forEach((matrix, index) => mesh.current?.setMatrixAt(index, matrix));
    mesh.current.instanceMatrix.needsUpdate = true;
  }, [matrices]);

  const morph = state.geometryMorph;
  return (
    <instancedMesh
      ref={mesh}
      args={[undefined, undefined, count]}
      scale={[1 + morph * 0.55, 1 + morph * 0.55, 1 + morph * 0.55]}
      frustumCulled
    >
      <octahedronGeometry args={[0.055, 0]} />
      <meshBasicMaterial
        color="#a5f3fc"
        transparent
        opacity={0.15 + morph * 0.55}
        blending={AdditiveBlending}
        depthWrite={false}
        toneMapped={false}
      />
    </instancedMesh>
  );
}

export default function SpatialPortals() {
  const state = useSpatialState();
  const anchorVersion = useCosmosAnchors();
  const runtime = SpatialRuntime.getInstance();

  // LOD: the portal field belongs to the wide Cosmos view. Once you are
  // inside an environment the portals dim rather than paint under it.
  const wide = state.current === "core" || state.current === "cosmos" || state.current === "portal";
  const records = usePortalRecords();
  const positions = useMemo(() => {
    // A second portal to the same environment orbits beside the first rather
    // than stacking on it: the golden angle keeps them apart deterministically.
    const orbits = new Map<SpatialSceneId, number>();
    return records
      .filter((record) => {
        const kind = destinationFor(record.destination).kind;
        return kind !== "core" && kind !== "cosmos";
      })
      .map((record) => {
        const destination = destinationFor(record.destination);
        const anchor = runtime.poseFor(record.destination).target;
        const builtin = isBuiltinPortal(record);
        const orbitIndex = builtin ? 0 : orbits.get(record.destination) ?? 0;
        if (!builtin) orbits.set(record.destination, orbitIndex + 1);
        const angle = orbitIndex * 2.399963 + record.destination.length;
        const orbit = builtin ? 0 : 1.7 + (orbitIndex % 3) * 0.55;
        const radius = builtin
          ? destination.kind === "portal"
            ? 1.5
            : destination.kind === "galaxy"
              ? 1.25
              : 0.95
          : 0.72;
        return {
          id: record.id,
          destination: record.destination,
          label: record.label,
          accent: destination.accent,
          radius,
          position: new Vector3(
            anchor.x + Math.cos(angle) * orbit,
            anchor.y + Math.sin(angle) * orbit * 0.62,
            anchor.z + orbit * 0.45,
          ),
        };
      });
  }, [records, runtime, anchorVersion]);

  return (
    <group name="spatial-portals">
      <ambientLight intensity={0.06 + state.lighting * 0.1} color="#a5b4fc" />
      <pointLight
        position={[0, 2, 6]}
        color="#67e8f9"
        intensity={0.4 + state.lighting * 0.6 + state.particles * 3}
        distance={26}
      />
      {positions.map((portal) => (
        <Portal
          key={portal.id}
          spec={{
            id: portal.id,
            destination: portal.destination,
            label: portal.label,
            accent: portal.accent,
            radius: portal.radius,
          }}
          state={state}
          position={portal.position}
        />
      ))}
      <SpatialParticleField state={state} />
      <MorphShell state={state} />
      <group visible={!wide} />
    </group>
  );
}
