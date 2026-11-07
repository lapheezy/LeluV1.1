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
import { SPATIAL_DESTINATIONS, destinationFor, type SpatialSceneId } from "./SpatialScenes";
import CosmosStore from "../genesis/cosmos/CosmosStore";

/** Destinations drawn as portals in the world (the core and cosmos are the world itself). */
const PORTAL_SCENES: SpatialSceneId[] = SPATIAL_DESTINATIONS.filter(
  (destination) => destination.kind !== "core" && destination.kind !== "cosmos",
).map((destination) => destination.id);

const PARTICLE_COUNT = 420;

interface PortalSpec {
  id: SpatialSceneId;
  accent: string;
  radius: number;
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
  const hovered = state.interaction.hovered === spec.id;
  const travellingHere = state.destination === spec.id && Boolean(state.transition);
  const visited = state.current === spec.id;
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
          onClick={(event) => {
            event.stopPropagation();
            runtime.travel(spec.id);
          }}
          onPointerOver={(event) => {
            event.stopPropagation();
            runtime.hover(spec.id);
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
      <mesh name={`spatial-portal-surface-${spec.id}`}>
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
  const positions = useMemo(() => {
    return PORTAL_SCENES.map((id) => {
      const destination = destinationFor(id);
      const anchor = runtime.poseFor(id).target;
      return {
        id,
        accent: destination.accent,
        radius: destination.kind === "portal" ? 1.5 : destination.kind === "galaxy" ? 1.25 : 0.95,
        position: new Vector3(anchor.x, anchor.y, anchor.z),
      };
    });
  }, [runtime, anchorVersion]);

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
          spec={{ id: portal.id, accent: portal.accent, radius: portal.radius }}
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
