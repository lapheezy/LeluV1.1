/**
 * ==========================================================
 * LÉLUVERSE — COSMOS ROOMS (3D)
 *
 * Draws the navigable map INSIDE the existing cosmos scene:
 * galaxies are rings, planets (agents, projects, SHAMAN) are
 * rings of their own steel, and rooms are small mint markers.
 * Records placed in the current room appear as coloured
 * prisms you can tap to inspect.
 *
 * It is added to the existing CosmosLayer rather than
 * replacing it — every entity, galaxy, pathway and visual
 * effect the scene already had is untouched. Positions come
 * from the same CosmosStore coordinates the scene already
 * uses, so a galaxy's ring sits around the galaxy itself.
 *
 * Tapping anything is a real navigation (WorkspaceAPI, actor
 * "user"), never a local highlight that the map would then
 * disagree with.
 * ==========================================================
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import { AdditiveBlending, Color, type Group } from "three";
import CosmosNavigation, { type NavNode, type NavigationState } from "../../../../core/cosmos/CosmosNavigation";
import SpatialObjects, { type SpatialObject } from "../../../../core/cosmos/SpatialObjects";
import CosmosFocus, { type FocusTarget } from "../../../../core/cosmos/CosmosFocus";
import WorkspaceAPI from "../../../../core/workspace/WorkspaceAPI";
import { syncCosmosMap } from "../../../../core/cosmos/CosmosLiveMap";
import { cameraFlightActive } from "../cameraFlight";
import { cameraOwner } from "../cameraOwnership";

/** The scene draws its entities at this depth. */
const Z_OFFSET = -25;
const MAX_NODES = 70;

const LEVEL_COLOR: Record<string, string> = {
  galaxy: "#fbbf24",
  planet: "#67e8f9",
  room: "#34d399",
  core: "#a5f3fc",
};

const KIND_COLOR: Record<string, string> = {
  message: "#93c5fd",
  document: "#fcd34d",
  image: "#f9a8d4",
  video: "#fca5a5",
  research: "#a78bfa",
  project: "#34d399",
  task: "#fbbf24",
  file: "#cbd5e1",
  conversation: "#7dd3fc",
  note: "#e9d5ff",
};

/** Fly the existing camera to a point, the same way the minimap does. */
function flyTo(x: number, y: number, z: number): void {
  const camera = (window as unknown as { __cosmosCamera?: { navigateTo?: (pos: { x: number; y: number; z: number }, lookAt: { x: number; y: number; z: number }) => void } }).__cosmosCamera;
  if (camera?.navigateTo) {
    camera.navigateTo({ x, y, z: z + 10 }, { x, y, z });
    return;
  }
  window.dispatchEvent(new CustomEvent("cosmos-navigate", { detail: { pos: { x, y, z: z + 10 }, lookAt: { x, y, z } } }));
}

/** Fly the existing camera to a destination ring (where the ring is drawn). */
function flyToNode(node: NavNode): void {
  flyTo(node.position[0], node.position[1], node.position[2] + Z_OFFSET);
}

function DestinationRing({ node, current, focused }: { node: NavNode; current: boolean; focused: boolean }) {
  const group = useRef<Group>(null);
  const color = useMemo(() => new Color(LEVEL_COLOR[node.level] ?? "#94a3b8"), [node.level]);
  const [hovered, setHovered] = useState(false);
  const radius = node.level === "galaxy" ? 1.2 : node.level === "planet" ? 0.7 : 0.4;

  useFrame(({ clock }) => {
    if (!group.current) return;
    const t = clock.elapsedTime;
    group.current.rotation.z = t * (current ? 0.35 : 0.12);
    const pulse = focused ? 1 + Math.sin(t * 3) * 0.08 : 1;
    group.current.scale.setScalar(pulse);
  });

  const goTo = () => {
    WorkspaceAPI.getInstance().execute({ action: "navigate", actor: "user", roomId: node.id });
    CosmosFocus.getInstance().set({ kind: "node", id: node.id });
    // Arriving somewhere new flies the camera from CosmosRooms3D's
    // navigation subscription (the same path the panel and LÉLU use).
    // Tapping the place you are already in only re-centres on it.
    if (current) flyToNode(node);
  };

  return (
    <group ref={group} position={[node.position[0], node.position[1], node.position[2] + Z_OFFSET]}>
      <mesh
        rotation={[Math.PI / 2, 0, 0]}
        onClick={(event) => {
          event.stopPropagation();
          goTo();
        }}
        onPointerOver={(event) => {
          event.stopPropagation();
          setHovered(true);
          document.body.style.cursor = "pointer";
        }}
        onPointerOut={() => {
          setHovered(false);
          document.body.style.cursor = "auto";
        }}
      >
        <torusGeometry args={[radius, focused ? 0.05 : 0.022, 8, 48]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={focused ? 1.1 : hovered ? 0.8 : current ? 0.6 : 0.3}
          transparent
          opacity={focused ? 0.95 : current ? 0.7 : 0.4}
          blending={AdditiveBlending}
          depthWrite={false}
        />
      </mesh>

      {/* A dot at the centre keeps a room's position readable when its
          label is hidden by distance. */}
      <mesh>
        <sphereGeometry args={[0.06, 8, 8]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.9} transparent opacity={0.9} />
      </mesh>

      <Html position={[0, radius + 0.28, 0]} center distanceFactor={26} style={{ pointerEvents: "none" }}>
        <div
          style={{
            color: focused ? "#f0f9ff" : current ? "#e0f2fe" : "rgba(203, 213, 225, 0.72)",
            fontSize: node.level === "galaxy" ? "9px" : "7px",
            fontWeight: current || focused ? 700 : 500,
            letterSpacing: "0.06em",
            textShadow: `0 0 8px ${LEVEL_COLOR[node.level] ?? "#94a3b8"}`,
            whiteSpace: "nowrap",
            fontFamily: "system-ui, sans-serif",
            opacity: focused || current || hovered ? 1 : 0.6,
          }}
        >
          {node.level === "room" ? "⬡ " : ""}
          {node.label}
        </div>
      </Html>
    </group>
  );
}

function PlacedRecord({ object, room }: { object: SpatialObject; room: NavNode | null }) {
  const group = useRef<Group>(null);
  const color = useMemo(() => new Color(KIND_COLOR[object.kind] ?? "#94a3b8"), [object.kind]);
  const [hovered, setHovered] = useState(false);
  const base = room ? room.position : [0, 0, 0];

  useFrame(({ clock }) => {
    if (!group.current) return;
    group.current.rotation.y = clock.elapsedTime * 0.5;
    group.current.position.y =
      base[1] + Z_OFFSET + object.position[1] + Math.sin(clock.elapsedTime * 1.1 + object.position[0]) * 0.08;
  });

  return (
    <group
      ref={group}
      position={[
        base[0] + object.position[0] * 0.7,
        base[1] + Z_OFFSET + object.position[1],
        base[2] + Z_OFFSET + object.position[2] * 0.7 + 0.4,
      ]}
    >
      <mesh
        onClick={(event) => {
          event.stopPropagation();
          CosmosFocus.getInstance().set({ kind: "object", id: object.id });
        }}
        onPointerOver={(event) => {
          event.stopPropagation();
          setHovered(true);
          document.body.style.cursor = "pointer";
        }}
        onPointerOut={() => {
          setHovered(false);
          document.body.style.cursor = "auto";
        }}
      >
        <octahedronGeometry args={[object.pinned ? 0.17 : 0.13, 0]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={hovered ? 1.2 : 0.6}
          transparent
          opacity={0.92}
          roughness={0.3}
          metalness={0.4}
        />
      </mesh>
      <Html position={[0, 0.26, 0]} center distanceFactor={30} style={{ pointerEvents: "none" }}>
        <div
          style={{
            color: `#${color.getHexString()}`,
            fontSize: "6px",
            letterSpacing: "0.04em",
            textShadow: "0 0 6px rgba(0,0,0,0.9)",
            whiteSpace: "nowrap",
            fontFamily: "system-ui, sans-serif",
            opacity: hovered ? 1 : 0.7,
          }}
        >
          {object.title.length > 26 ? `${object.title.slice(0, 24)}…` : object.title}
        </div>
      </Html>
    </group>
  );
}

/**
 * Select a destination restored from storage, as arriving there would
 * have. Never replaces a selection made in this session.
 */
function reselectRestored(id: string): boolean {
  if (CosmosNavigation.getInstance().restoredArrival() !== id) return false;
  const focus = CosmosFocus.getInstance();
  if (!focus.get()) focus.set({ kind: "node", id });
  return true;
}

/**
 * Fly to a restored destination as soon as the camera controller takes the
 * flight. During start-up the camera API or OrbitControls may not be up
 * yet, and the controller ignores a navigation it cannot perform; the
 * flight starts synchronously when it is accepted (cameraFlightActive), so
 * this simply asks again on the next frame until it is (for up to a minute). A newer
 * navigation, or the user taking the camera, ends the attempt.
 */
function frameWhenReady(node: NavNode): () => void {
  let cancelled = false;
  // A time bound, not a frame count: animation frames run far faster than a
  // slow device mounts the scene, so a frame budget expired before the camera
  // API existed.
  const deadline = Date.now() + 60_000;
  const tick = () => {
    if (cancelled) return;
    if (CosmosNavigation.getInstance().getState().currentId !== node.id) return;
    if (cameraOwner() === "user") return;
    if ((window as unknown as { __cosmosCamera?: unknown }).__cosmosCamera) {
      flyToNode(node);
      if (cameraFlightActive()) {
        CosmosNavigation.getInstance().restoredArrivalFramed(node.id);
        return;
      }
    }
    if (Date.now() < deadline) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  return () => {
    cancelled = true;
  };
}

export default function CosmosRooms3D() {
  const [state, setState] = useState<NavigationState>(() => CosmosNavigation.getInstance().getState());
  const [objects, setObjects] = useState<SpatialObject[]>(() => SpatialObjects.getInstance().list());
  const [focus, setFocus] = useState<FocusTarget | null>(() => CosmosFocus.getInstance().get());

  useEffect(() => {
    const nav = CosmosNavigation.getInstance();
    const objectStore = SpatialObjects.getInstance();
    const focusStore = CosmosFocus.getInstance();
    const unsubNav = nav.subscribe(setState);
    const unsubObjects = objectStore.subscribe(setObjects);
    const unsubFocus = focusStore.subscribe(setFocus);
    return () => {
      unsubNav();
      unsubObjects();
      unsubFocus();
    };
  }, []);

  /*
   * Arrival moves the camera. CosmosNavigation is the one record of where
   * you are, and it changes from three places: a ring tapped here, a row
   * in the Cosmos workspace panel, and LÉLU's cosmos.workspace "navigate".
   * Only the ring tap used to fly the camera, so the other two moved the
   * highlight and left the view where it was. Following currentId here
   * covers all three. The first value is where you already were (restored
   * from storage), not an arrival, so it does not fly on load. The core
   * is drawn by the scene itself, at the origin.
   */
  const lastCurrent = useRef(state.currentId);
  // The pending restore framing, if any (cancelled by a newer arrival or unmount).
  const framing = useRef<(() => void) | null>(null);
  const frame = (node: NavNode) => {
    framing.current?.();
    framing.current = frameWhenReady(node);
  };
  useEffect(() => () => framing.current?.(), []);
  useEffect(() => {
    if (state.currentId === lastCurrent.current) return;
    lastCurrent.current = state.currentId;
    const node = state.nodes.find((n) => n.id === state.currentId);
    if (!node) return;
    // A live-map destination that a reload was waiting for has just been
    // registered: it is the place you were, so it is selected again too,
    // and framed once the camera can take it (the scene may still be starting).
    if (reselectRestored(node.id) && node.level !== "core") {
      frame(node);
      return;
    }
    framing.current?.();
    framing.current = null;
    if (node.level === "core") {
      // Back to the core is back to the Genesis view CosmosLayer defines.
      const camera = (window as unknown as { __cosmosCamera?: { resetToGenesis?: () => void } }).__cosmosCamera;
      camera?.resetToGenesis?.();
      return;
    }
    flyToNode(node);
  }, [state.currentId, state.nodes]);

  /*
   * After a reload. The camera pose is deliberately not persisted
   * (cameraPoseMemory), so a destination restored from storage would be
   * the current place while the view sat at the opening composition.
   * Frame it once, through the same flight every arrival uses. Only a
   * restored destination is framed: a remount in the same session (back
   * from chat) keeps its remembered pose.
   *
   * A live-map destination (an agent's planet, a project) is only known
   * after the live map syncs, and on most Homes nothing else asks for a
   * sync. So while a restore is pending the scene asks once, through the
   * same syncCosmosMap the workspace panel and the terminal use; the
   * currentId change that follows flies the camera like any arrival.
   */
  useEffect(() => {
    const nav = CosmosNavigation.getInstance();
    if (nav.pendingRestore()) void syncCosmosMap();
    const restored = nav.restoredArrival();
    if (!restored) return;
    const node = nav.get(restored);
    if (!node || node.level === "core") return;
    reselectRestored(node.id);
    frame(node);
  }, []);

  const nodes = useMemo(
    () => state.nodes.filter((node) => node.level !== "core").slice(0, MAX_NODES),
    [state.nodes],
  );

  const room = useMemo(
    () => state.nodes.find((node) => node.id === state.currentId) ?? null,
    [state.nodes, state.currentId],
  );

  // Only the room you are standing in shows its records: the scene stays
  // readable, and "in this room" means the same thing here as in the panel.
  const placed = useMemo(
    () => objects.filter((object) => object.roomId === state.currentId),
    [objects, state.currentId],
  );

  return (
    <group>
      {nodes.map((node) => (
        <DestinationRing
          key={node.id}
          node={node}
          current={node.id === state.currentId}
          focused={focus?.kind === "node" && focus.id === node.id}
        />
      ))}
      {placed.map((object) => (
        <PlacedRecord key={object.id} object={object} room={room} />
      ))}
    </group>
  );
}
