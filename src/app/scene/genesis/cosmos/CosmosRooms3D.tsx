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

import { useEffect, useMemo, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import { AdditiveBlending, Color, type Group } from "three";
import { useRef } from "react";
import CosmosNavigation, { type NavNode, type NavigationState } from "../../../../core/cosmos/CosmosNavigation";
import SpatialObjects, { type SpatialObject } from "../../../../core/cosmos/SpatialObjects";
import CosmosFocus, { type FocusTarget } from "../../../../core/cosmos/CosmosFocus";
import WorkspaceAPI from "../../../../core/workspace/WorkspaceAPI";

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
    flyTo(node.position[0], node.position[1], node.position[2] + Z_OFFSET);
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
