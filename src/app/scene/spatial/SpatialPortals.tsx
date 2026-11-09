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

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import type { ThreeEvent } from "@react-three/fiber";
import { Html } from "@react-three/drei";
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
  Raycaster,
  Vector2,
  Vector3,
} from "three";
import SpatialRuntime from "./SpatialRuntime";
import type { SpatialState } from "./SpatialRuntime";
import { destinationFor, type SpatialSceneId } from "./SpatialScenes";
import PortalRegistry, { RING_SCENES, type PortalRecord } from "./PortalRegistry";
import {
  collidingPortalIds,
  duplicatePortalIds,
  overlappingHitIds,
  portalPlacements,
  type PortalPlacement,
} from "./portalField";
import CosmosStore from "../genesis/cosmos/CosmosStore";
import { recordPortalClick, recordPortalPress, traceEnabled } from "./portalTrace";
import {
  ACTIVATION_WINDOW_MS,
  claimPress,
  refusesBusyFlight,
  resolvePress,
  type OwnedPress,
} from "./pressOwnership";

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
  /** Radius of the interactive mouth; derived from neighbour spacing. */
  hitRadius: number;
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
  selected,
  showLabel,
  onPressStart,
  onPressCancel,
  onActivateClick,
  onActivateKeyboard,
}: {
  spec: PortalSpec;
  state: SpatialState;
  position: Vector3;
  selected: boolean;
  showLabel: boolean;
  onPressStart: (spec: PortalSpec, event: ThreeEvent<PointerEvent>) => void;
  onPressCancel: (spec: PortalSpec, event: ThreeEvent<PointerEvent>) => void;
  onActivateClick: (spec: PortalSpec) => void;
  onActivateKeyboard: (spec: PortalSpec) => void;
}) {
  const runtime = SpatialRuntime.getInstance();
  const seam = useRef<Group>(null);
  // Read-only references used by the development click trace only.
  const camera = useThree((three) => three.camera);
  const gl = useThree((three) => three.gl);
  const hovered = state.interaction.hovered === spec.destination;
  const travellingHere = state.destination === spec.destination && Boolean(state.transition);
  const visited = state.current === spec.destination;
  const intensity = selected || hovered || travellingHere ? 1 : visited ? 0.55 : 0.28;
  const busyElsewhere = Boolean(state.transition) && state.destination !== spec.destination;
  const pulse = 1 + Math.sin(state.updatedAt / 320 + spec.radius) * 0.04;

  useFrame((_, delta) => {
    if (!seam.current) return;
    seam.current.rotation.z += delta * (0.25 + intensity * 0.5);
  });

  /*
   * PRESS OWNERSHIP — the field owns the identity; the mouth only reports it.
   *
   * A press belongs to the portal the pointer LANDED ON, for the whole life of
   * that press. The field records it once at pointer-down and resolves that
   * record on the canvas release, so the release completes the interaction the
   * user started even when the rotating field has moved a different mouth under
   * the pointer — and it can never open a neighbour, because the portal is
   * never re-picked at release.
   */
  const activate = (event: ThreeEvent<MouseEvent> | ThreeEvent<PointerEvent>) => {
    event.stopPropagation();
    /*
     * Development trace: record what the REAL handler received in the same
     * frame as the pointer event — the event object's own portal id, every
     * intersection with its distance, the camera pose, the viewport and the
     * projected centre of the object that was hit. Without this, "wrong
     * portal" and "stale coordinates" are indistinguishable.
     */
    if (traceEnabled()) {
      const native = event.nativeEvent as MouseEvent | undefined;
      const rect = gl.domElement.getBoundingClientRect();
      const world = new Vector3();
      event.object.getWorldPosition(world);
      const projected = world.clone().project(camera);
      const round = (value: number, places = 4) => Math.round(value * 10 ** places) / 10 ** places;
      recordPortalClick({
        t: Math.round(performance.now()),
        client: { x: Math.round(native?.clientX ?? -1), y: Math.round(native?.clientY ?? -1) },
        ndc: {
          x: round((((native?.clientX ?? 0) - rect.left) / Math.max(1, rect.width)) * 2 - 1),
          y: round(-(((native?.clientY ?? 0) - rect.top) / Math.max(1, rect.height)) * 2 + 1),
        },
        delivered: {
          portalId: (event.object.userData as { portalId?: string }).portalId ?? null,
          destination: spec.destination,
          object: event.object.name,
        },
        hitDistance: Number.isFinite(event.distance) ? round(event.distance, 3) : null,
        hitPoint: [round(event.point.x, 3), round(event.point.y, 3), round(event.point.z, 3)],
        intersections: event.intersections.slice(0, 8).map((entry) => ({
          name: entry.object.name,
          portalId: (entry.object.userData as { portalId?: string }).portalId ?? null,
          distance: round(entry.distance, 3),
        })),
        camera: {
          position: camera.position.toArray().map((value) => round(value)),
          quaternion: camera.quaternion.toArray().map((value) => round(value)),
          projection: camera.projectionMatrix.elements.map((value) => round(value)),
        },
        viewport: {
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          dpr: window.devicePixelRatio,
        },
        projectedCentre: {
          x: Math.round(rect.left + (projected.x * 0.5 + 0.5) * rect.width),
          y: Math.round(rect.top + (-projected.y * 0.5 + 0.5) * rect.height),
        },
        settle: (window as unknown as { __leluCameraSettle?: unknown }).__leluCameraSettle ?? null,
        scene: state.current,
        transition: state.transition?.kind ?? null,
        travelDestination: state.destination,
      });
    }
    /*
     * The click a release synthesises is the same interaction the press already
     * resolved; the field discards it there. Anything that reaches here without
     * a press (a synthetic click, a keyboard activation through a chip) still
     * travels through the SAME single selection path.
     */
    onActivateClick(spec);
  };

  return (
    <group position={position} name={`spatial-portal-group-${spec.id}`}>
      <group ref={seam} scale={pulse}>
        <mesh
          name={`spatial-portal-${spec.id}`}
          userData={{
            portalId: spec.id,
            destination: spec.destination,
            label: spec.label,
            selected,
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
      {showLabel ? (
        /*
         * The portal's readable identity, in the world next to the thing it
         * names. It is the SAME selection path as the mesh (one handler, one
         * travel call), which is what makes the field keyboard-reachable
         * without a second widget: Tab to a chip, Enter to travel.
         */
        <Html position={[0, spec.radius + 0.3, 0]} center distanceFactor={16} zIndexRange={[6, 0]} style={{ pointerEvents: "none" }}>
          <button
            type="button"
            data-portal-select={spec.id}
            data-portal-select-destination={spec.destination}
            data-portal-selected={selected ? "" : undefined}
            aria-label={`Travel to ${spec.label}`}
            aria-pressed={selected}
            aria-disabled={busyElsewhere || undefined}
            title={`${spec.label} → ${spec.destination} (${spec.id})`}
            onClick={(event) => {
              event.stopPropagation();
              if (busyElsewhere) return;
              onActivateKeyboard(spec);
            }}
            style={{
              pointerEvents: "auto",
              font: "inherit",
              fontSize: 11,
              letterSpacing: "0.06em",
              color: selected ? "#f8fafc" : "rgba(226,232,240,0.86)",
              background: selected ? "rgba(34,211,238,0.22)" : "rgba(8,16,38,0.62)",
              border: `1px solid ${selected ? "rgba(103,232,249,0.85)" : "rgba(148,163,184,0.32)"}`,
              borderRadius: 999,
              padding: "3px 9px",
              whiteSpace: "nowrap",
              cursor: busyElsewhere ? "progress" : "pointer",
              backdropFilter: "blur(8px)",
              WebkitBackdropFilter: "blur(8px)",
              boxShadow: selected ? `0 0 12px ${spec.accent}` : "0 4px 14px rgba(2,6,23,0.45)",
              opacity: busyElsewhere ? 0.5 : 1,
            }}
          >
            ◈ {spec.label}
          </button>
        </Html>
      ) : null}
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
      {/*
       * The interactive region: the whole mouth of the portal, not just the
       * torus seam.
       *
       * The handlers used to sit on the torus alone, whose centre is a HOLE —
       * a measured click at the portal's projected centre raycast straight
       * through it and started nothing, so the field looked interactive and
       * was not. This disc covers the opening (slightly wider than the seam) so
       * pointer, touch and keyboard all reach the same portal from the middle.
       * It paints nothing: opacity 0, no depth write. */}
      <mesh
        name={`spatial-portal-hit-${spec.id}`}
        userData={{ portalId: spec.id, destination: spec.destination, label: spec.label, hitRadius: spec.hitRadius }}
        onPointerDown={(event) => onPressStart(spec, event)}
        onClick={(event) => activate(event)}
        onPointerCancel={(event) => onPressCancel(spec, event)}
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
        {/* Sized by the layout from the distance to its nearest neighbour, so
            two mouths can never cover the same pointer position. */}
        <circleGeometry args={[spec.hitRadius, 32]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} side={DoubleSide} />
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
 * Read-only diagnostics: what the registry says, and what the renderer
 * actually drew for it.
 *
 * Installed on the window exactly like SpatialLayer's probe, so a measurement
 * describes the REAL scene graph (an object with that name, its world
 * position, its projected screen point) rather than the intent of the code
 * that was supposed to draw it. Nothing here mutates the scene.
 */
function PortalFieldProbe({
  placements,
  portals,
  selected,
}: {
  placements: PortalPlacement[];
  portals: Array<{ id: string; destination: SpatialSceneId; position: Vector3 }>;
  selected: string | null;
}) {
  const scene = useThree((state) => state.scene);
  const camera = useThree((state) => state.camera);
  const gl = useThree((state) => state.gl);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const host = window as unknown as {
      __leluPortalField?: () => unknown;
      __leluPortalPick?: (x: number, y: number) => unknown;
    };
    /*
     * What a click at a screen point would actually hit, from the renderer's
     * own raycaster. Read-only: it moves nothing. Without it a measurement can
     * only compare projected arithmetic against itself, which is how the
     * field looked correct while a click through the middle of a portal did
     * nothing at all.
     */
    host.__leluPortalPick = (x: number, y: number) => {
      const rect = gl.domElement.getBoundingClientRect();
      const ndc = new Vector2(
        ((x - rect.left) / Math.max(1, rect.width)) * 2 - 1,
        -((y - rect.top) / Math.max(1, rect.height)) * 2 + 1,
      );
      const raycaster = new Raycaster();
      raycaster.setFromCamera(ndc, camera);
      const hits = raycaster.intersectObjects(scene.children, true);
      const hit = hits.find((entry) => entry.object.name.startsWith("spatial-portal-hit-"));
      if (hit) {
        const userData = hit.object.userData as { portalId?: string; hitRadius?: number };
        const world = new Vector3();
        hit.object.getWorldPosition(world);
        const projected = world.clone().project(camera);
        return {
          portalId: userData.portalId ?? null,
          name: hit.object.name,
          distance: hit.distance,
          hitRadius: userData.hitRadius ?? null,
          /* The aim point: pressing here leaves maximum margin for drift. */
          mouthCentre: {
            x: Math.round(rect.left + (projected.x * 0.5 + 0.5) * rect.width),
            y: Math.round(rect.top + (-projected.y * 0.5 + 0.5) * rect.height),
          },
        };
      }
      return hits.length
        ? { portalId: null, name: hits[0].object.name, distance: hits[0].distance }
        : null;
    };
    /* A stable handle on the canvas that draws this field: the page has more
       than one canvas and a probe must click the right one. */
    gl.domElement.dataset.spatialCanvas = "genesis";
    const round = (value: number) => Math.round(value * 100) / 100;
    host.__leluPortalField = () => {
      const registry = PortalRegistry.getInstance().list();
      const rect = gl.domElement.getBoundingClientRect();
      const reading = placements.map((placement) => {
        const entry = portals.find((portal) => portal.id === placement.id);
        const meshName = `spatial-portal-${placement.id}`;
        const object = scene.getObjectByName(meshName);
        const world = new Vector3();
        if (object) object.getWorldPosition(world);
        else if (entry) world.copy(entry.position);
        const projected = world.clone().project(camera);
        return {
          id: placement.id,
          destination: placement.destination,
          label: placement.label,
          builtin: placement.builtin,
          orbitIndex: placement.orbitIndex,
          meshName,
          hitMeshName: `spatial-portal-hit-${placement.id}`,
          hitRadius: round(placement.hitRadius),
          hitDrawn: Boolean(scene.getObjectByName(`spatial-portal-hit-${placement.id}`)),
          drawn: Boolean(object),
          visible: object ? object.visible : false,
          worldPosition: [round(world.x), round(world.y), round(world.z)],
          screen: {
            x: Math.round(rect.left + (projected.x * 0.5 + 0.5) * rect.width),
            y: Math.round(rect.top + (-projected.y * 0.5 + 0.5) * rect.height),
          },
          onScreen:
            projected.z < 1 && Math.abs(projected.x) <= 1 && Math.abs(projected.y) <= 1,
          selected: selected === placement.id,
        };
      });
      return {
        registryCount: registry.length,
        placedCount: placements.length,
        drawnCount: reading.filter((portal) => portal.drawn).length,
        duplicates: duplicatePortalIds(registry),
        collisions: collidingPortalIds(placements),
        overlappingMouths: overlappingHitIds(placements),
        selected,
        viewport: {
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          left: Math.round(rect.left),
          top: Math.round(rect.top),
        },
        // Which canvas actually draws this field. The page has more than one
        // (!), and a measurement that clicks the wrong one proves nothing.
        canvas: {
          selector: '[data-spatial-canvas="genesis"]',
          id: gl.domElement.id || "",
          className: gl.domElement.className || "",
          width: gl.domElement.width,
          height: gl.domElement.height,
        },
        portals: reading,
      };
    };
    return () => {
      delete host.__leluPortalField;
      delete host.__leluPortalPick;
    };
  }, [placements, portals, selected, camera, scene, gl]);
  return null;
}

/**
 * Camera settlement, measured per rendered frame.
 *
 * A fixed delay is not evidence that the camera stopped: the earlier harness
 * clicked "after 2 seconds" and, on a software compositor, was still mid-flight.
 * This publishes how many consecutive frames the camera's position and rotation
 * have not changed, so a click can require a settled frame instead of assuming
 * one. Development only.
 */
function CameraSettleProbe() {
  const camera = useThree((three) => three.camera);
  const last = useRef({
    frame: 0,
    stableFrames: 0,
    position: new Vector3(),
    quaternion: new Quaternion(),
    ready: false,
  });
  useFrame(() => {
    if (!traceEnabled() || typeof window === "undefined") return;
    const tracking = last.current;
    tracking.frame += 1;
    if (!tracking.ready) {
      tracking.position.copy(camera.position);
      tracking.quaternion.copy(camera.quaternion);
      tracking.ready = true;
    }
    const deltaPosition = camera.position.distanceTo(tracking.position);
    const deltaRotation = tracking.quaternion.angleTo(camera.quaternion);
    tracking.stableFrames = deltaPosition < 1e-4 && deltaRotation < 1e-4 ? tracking.stableFrames + 1 : 0;
    tracking.position.copy(camera.position);
    tracking.quaternion.copy(camera.quaternion);
    const round = (value: number) => Math.round(value * 1e4) / 1e4;
    (window as unknown as { __leluCameraSettle?: unknown }).__leluCameraSettle = {
      frame: tracking.frame,
      stableFrames: tracking.stableFrames,
      deltaPosition: round(deltaPosition),
      deltaRotation: round(deltaRotation),
      position: camera.position.toArray().map(round),
      quaternion: camera.quaternion.toArray().map(round),
    };
  });
  return null;
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

/**
 * Where the ring lives: the plane the SCENE's camera looks through.
 *
 * Two measured failures shaped this. Placed at each destination's own anchor,
 * the portals projected into the same few dozen pixels and a click on one
 * travelled through another. Placed at a fixed world radius, none of them were
 * on screen at all. The ring is therefore framed from the pose the runtime
 * publishes for the scene we are in — its camera position, its target and its
 * field of view — so the field occupies the middle of the wide view, and the
 * geometry changes only when the SCENE changes, never per rendered frame.
 */
const RING_FIT = 0.36;

export default function SpatialPortals() {
  const state = useSpatialState();
  const anchorVersion = useCosmosAnchors();
  const runtime = SpatialRuntime.getInstance();

  // LOD: the portal field belongs to the wide Cosmos view. Once you are
  // inside an environment the portals dim rather than paint under it.
  const wide = state.current === "core" || state.current === "cosmos" || state.current === "portal";
  const records = usePortalRecords();
  // The ring is fitted to the real drawing surface, so the same field is
  // aimable in a phone's portrait viewport and on a wide desktop one.
  const size = useThree((three) => three.size);
  const pose = runtime.poseFor(state.current);
  const basis = useMemo(() => {
    const position = new Vector3(pose.position.x, pose.position.y, pose.position.z);
    const target = new Vector3(pose.target.x, pose.target.y, pose.target.z);
    const distance = position.distanceTo(target);
    const visibleHeight = 2 * distance * Math.tan((pose.fov * Math.PI) / 360);
    const aspect = size.width / Math.max(1, size.height);
    const quaternion = new Quaternion().setFromRotationMatrix(
      new Matrix4().lookAt(position, target, new Vector3(0, 1, 0)),
    );
    // Fit the NARROWER screen axis: a portrait phone has a small visible
    // width, and a ring sized from height alone pushes its outer portals off
    // screen, where they cannot be aimed at at all.
    const visibleWidth = visibleHeight * aspect;
    return {
      centre: target,
      quaternion,
      radius: Math.max(1.2, Math.min(visibleHeight, visibleWidth) * RING_FIT),
    };
  }, [
    size.width,
    size.height,
    state.current,
    pose.position.x,
    pose.position.y,
    pose.position.z,
    pose.target.x,
    pose.target.y,
    pose.target.z,
    pose.fov,
  ]);

  // Placement maths lives in one pure module so the ring, the probe and the
  // tests all agree about where a portal is. Offsets are in the ring's own
  // plane, which the group below lays into the camera's view.
  const placements = useMemo(
    () => portalPlacements(records, { radius: basis.radius }),
    [records, basis.radius],
  );
  const portals = useMemo(
    () =>
      placements.map((placement) => ({
        ...placement,
        position: new Vector3(placement.offset.x, placement.offset.y, placement.offset.z),
      })),
    // `anchorVersion` is not read here: the ring is framed by the camera, not
    // by the Cosmos anchors. It stays in the dependency list so a change in
    // the real galaxy/agent positions still republishes the field's props.
    [placements, anchorVersion],
  );

  const [selected, setSelected] = useState<string | null>(null);
  const gl = useThree((three) => three.gl);
  const camera = useThree((three) => three.camera);

  /*
   * ONE press record for the whole field and ONE selection path.
   *
   * The record is keyed by the portal the pointer landed on, so release
   * completes that portal even when the field has rotated a neighbour under the
   * pointer. It is also what makes "one press, one activation" true: the click
   * the renderer derives from the same press is recognised as the same
   * interaction and discarded instead of travelling on its own.
   */
  const pressRef = useRef<OwnedPress | null>(null);
  const guardRef = useRef({ lastActivationAt: 0, lastResolvedAt: 0 });

  /* The single travel path: mouth, keyboard chip and owned press all come here. */
  const handleActivate = useCallback(
    (
      spec: { id: string; destination: SpatialSceneId },
      source: "press" | "click" | "keyboard",
    ) => {
      const now = performance.now();
      /* A click that follows a resolved press is the same interaction. */
      if (source === "click" && now - guardRef.current.lastResolvedAt < ACTIVATION_WINDOW_MS) return;
      if (source !== "keyboard" && now - guardRef.current.lastActivationAt < ACTIVATION_WINDOW_MS) return;
      guardRef.current.lastActivationAt = now;
      /*
       * One camera, one flight: a press while another destination is in flight
       * is refused by the RUNTIME's own state, read here rather than from a
       * render-time closure that may already be a frame or two old.
       */
      const current = runtime.getState();
      if (refusesBusyFlight(current.transition, current.destination, spec.destination)) return;
      setSelected(spec.id);
      if (traceEnabled()) {
        const host = window as unknown as { __leluSelectCalls?: unknown[] };
        host.__leluSelectCalls = [
          ...(host.__leluSelectCalls ?? []),
          { portalId: spec.id, destination: spec.destination, source, at: Math.round(now) },
        ];
      }
      runtime.travel(spec.destination);
    },
    [runtime],
  );

  const handleActivateClick = useCallback(
    (spec: PortalSpec) => handleActivate(spec, "click"),
    [handleActivate],
  );
  const handleActivateKeyboard = useCallback(
    (spec: PortalSpec) => handleActivate(spec, "keyboard"),
    [handleActivate],
  );

  /* Pointer-down: claim the portal under the pointer. This is the identity. */
  const beginPress = useCallback(
    (spec: PortalSpec, event: ThreeEvent<PointerEvent>) => {
      event.stopPropagation();
      const native = event.nativeEvent;
      const now = performance.now();
      pressRef.current = claimPress(
        { id: spec.id, destination: spec.destination, label: spec.label },
        { pointerId: event.pointerId, x: native.clientX, y: native.clientY },
        now,
      );
      try {
        gl.domElement.setPointerCapture(event.pointerId);
      } catch {
        /* capture is best effort: the canvas still receives the release */
      }
      if (traceEnabled()) {
        const rect = gl.domElement.getBoundingClientRect();
        const world = new Vector3();
        event.object.getWorldPosition(world);
        const projected = world.clone().project(camera);
        const centre = {
          x: Math.round(rect.left + (projected.x * 0.5 + 0.5) * rect.width),
          y: Math.round(rect.top + (-projected.y * 0.5 + 0.5) * rect.height),
        };
        const round = (value: number, places = 3) => Math.round(value * 10 ** places) / 10 ** places;
        const current = runtime.getState();
        recordPortalPress({
          t: Math.round(now),
          phase: "down",
          pointerId: event.pointerId,
          client: { x: Math.round(native.clientX), y: Math.round(native.clientY) },
          portalId: spec.id,
          destination: spec.destination,
          intersections: event.intersections.slice(0, 8).map((entry) => ({
            name: entry.object.name,
            portalId: (entry.object.userData as { portalId?: string }).portalId ?? null,
            distance: round(entry.distance),
          })),
          mouthCentre: centre,
          distanceFromCentre: Math.round(
            Math.hypot(native.clientX - centre.x, native.clientY - centre.y),
          ),
          moved: null,
          outcome: "claimed",
          reason: null,
          scene: current.current,
          transition: current.transition?.kind ?? null,
          travelDestination: current.destination,
        });
      }
    },
    [camera, gl, runtime],
  );

  const cancelPress = useCallback(
    (_spec: PortalSpec, event: ThreeEvent<PointerEvent>) => {
      const owned = pressRef.current;
      if (!owned || owned.pointerId !== event.pointerId) return;
      pressRef.current = null;
      guardRef.current.lastResolvedAt = performance.now();
      if (traceEnabled()) {
        const current = runtime.getState();
        recordPortalPress({
          t: Math.round(performance.now()),
          phase: "cancel",
          pointerId: event.pointerId,
          client: { x: Math.round(event.nativeEvent.clientX), y: Math.round(event.nativeEvent.clientY) },
          portalId: owned.portalId,
          destination: owned.destination,
          intersections: [],
          mouthCentre: null,
          distanceFromCentre: null,
          moved: null,
          outcome: "cleared",
          reason: "pointer-cancel",
          scene: current.current,
          transition: current.transition?.kind ?? null,
          travelDestination: current.destination,
        });
      }
    },
    [runtime],
  );

  /*
   * The release is read from the canvas, not from the mouth: it completes the
   * owned press even when the mouth has rotated away from the pointer, and it
   * travels to the identity claimed at pointer-down.
   */
  useEffect(() => {
    const canvas = gl.domElement;
    const release = (event: PointerEvent) => {
      const owned = pressRef.current;
      if (!owned) return;
      const now = performance.now();
      pressRef.current = null;
      const resolution = resolvePress(
        owned,
        { pointerId: event.pointerId, x: event.clientX, y: event.clientY },
        guardRef.current.lastActivationAt,
        now,
      );
      /* Resolved either way: the click derived from it is the same press. */
      guardRef.current.lastResolvedAt = now;
      if (traceEnabled()) {
        const current = runtime.getState();
        recordPortalPress({
          t: Math.round(now),
          phase: "up",
          pointerId: event.pointerId,
          client: { x: Math.round(event.clientX), y: Math.round(event.clientY) },
          portalId: owned.portalId,
          destination: owned.destination,
          intersections: [],
          mouthCentre: null,
          distanceFromCentre: null,
          moved: Math.round(resolution.moved),
          outcome: resolution.kind === "activate" ? "activated" : "refused",
          reason: resolution.kind === "refuse" ? resolution.reason : null,
          scene: current.current,
          transition: current.transition?.kind ?? null,
          travelDestination: current.destination,
        });
      }
      if (resolution.kind !== "activate") return;
      handleActivate(
        { id: owned.portalId, destination: owned.destination as SpatialSceneId },
        "press",
      );
    };
    const cancel = (event: PointerEvent) => {
      if (pressRef.current?.pointerId !== event.pointerId) return;
      pressRef.current = null;
      guardRef.current.lastResolvedAt = performance.now();
    };
    canvas.addEventListener("pointerup", release);
    canvas.addEventListener("pointercancel", cancel);
    return () => {
      canvas.removeEventListener("pointerup", release);
      canvas.removeEventListener("pointercancel", cancel);
      /* A press cannot outlive the field that owns it. */
      pressRef.current = null;
    };
  }, [gl, handleActivate, runtime]);

  // A portal removed while selected must not leave a ghost selection behind.
  useEffect(() => {
    if (selected && !placements.some((placement) => placement.id === selected)) {
      setSelected(null);
    }
  }, [placements, selected]);

  return (
    <group name="spatial-portals">
      <PortalFieldProbe placements={placements} portals={portals} selected={selected} />
      <CameraSettleProbe />
      <ambientLight intensity={0.06 + state.lighting * 0.1} color="#a5b4fc" />
      <pointLight
        position={[0, 2, 6]}
        color="#67e8f9"
        intensity={0.4 + state.lighting * 0.6 + state.particles * 3}
        distance={26}
      />
      <group name="spatial-portal-ring" position={basis.centre} quaternion={basis.quaternion}>
      {portals.map((portal) => (
        <Portal
          key={portal.id}
          spec={{
            id: portal.id,
            destination: portal.destination,
            label: portal.label,
            accent: portal.accent,
            radius: portal.radius,
            hitRadius: portal.hitRadius,
          }}
          state={state}
          position={portal.position}
          selected={selected === portal.id}
          showLabel={wide}
          onPressStart={beginPress}
          onPressCancel={cancelPress}
          onActivateClick={handleActivateClick}
          onActivateKeyboard={handleActivateKeyboard}
        />
      ))}
      </group>
      <SpatialParticleField state={state} />
      <MorphShell state={state} />
      <group visible={!wide} />
    </group>
  );
}
