/**
 * ==========================================================
 * LÉLUVERSE
 * GENESIS V2 — WORLD SCENE
 *
 * The environment LÉLU is in, rendered inside the same Gen V2
 * canvas as her presence (no second viewer):
 *
 *   - the environment itself: her circular room by default —
 *     floor, inlaid accent ring, pillars with an open front,
 *     rim and lights — from the persisted settings
 *   - every object in it: built-in shapes and Forge models
 *   - real rigid-body physics for objects that have it
 *     (src/core/world/Physics.ts); when everything comes to
 *     rest the resting positions are saved
 *   - wearables attached to LÉLU (they travel with her)
 *   - tap/click an object to select it: rotate, resize, drop,
 *     push or remove it (the same API LÉLU's tools use)
 *
 * State comes from /api/forge/world and reloads on the
 * FORGE_CHANGED_EVENT that every mutation fires.
 * ==========================================================
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import * as THREE from "three";
import ForgeClient, { FORGE_CHANGED_EVENT, type CosmosPlacement, type WorldState } from "../../../core/forge/ForgeClient";
import { PhysicsWorld, type Body } from "../../../core/world/Physics";
import { PlacedModel } from "./PlacedModel";

/* ------------------------------- the room ------------------------------- */

function Room({ state }: { state: WorldState }) {
  const s = state.environment.settings;
  const [cx, cz] = state.origin.centre;
  const floorY = state.origin.floorY;
  const pillars = useMemo(() => {
    if (s.wallHeight <= 0) return [];
    const count = Math.max(10, Math.round(s.radius * 2.6));
    const list: Array<[number, number]> = [];
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2;
      // Leave the front (toward the viewer, +z) open so the room never blocks the view.
      if (Math.abs(Math.atan2(Math.sin(a), Math.cos(a))) < 0.62) continue;
      list.push([cx + Math.sin(a) * s.radius, cz + Math.cos(a) * s.radius]);
    }
    return list;
  }, [s.radius, s.wallHeight, cx, cz]);

  return (
    <group name={`Environment:${state.environment.id}`}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[cx, floorY - 0.01, cz]} receiveShadow>
        <circleGeometry args={[s.radius, 64]} />
        <meshStandardMaterial color={s.floorColor} roughness={0.75} metalness={0.15} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[cx, floorY, cz]}>
        <ringGeometry args={[s.radius * 0.42, s.radius * 0.44, 96]} />
        <meshBasicMaterial color={s.accent} transparent opacity={0.55} toneMapped={false} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[cx, floorY, cz]}>
        <ringGeometry args={[s.radius - 0.08, s.radius, 128]} />
        <meshBasicMaterial color={s.accent} transparent opacity={0.35} toneMapped={false} />
      </mesh>
      {pillars.map(([x, z], i) => (
        <group key={i} position={[x, floorY, z]}>
          <mesh position={[0, s.wallHeight / 2, 0]} castShadow>
            <cylinderGeometry args={[0.09, 0.12, s.wallHeight, 12]} />
            <meshStandardMaterial color={s.wallColor} roughness={0.5} metalness={0.4} />
          </mesh>
          <mesh position={[0, s.wallHeight + 0.04, 0]}>
            <sphereGeometry args={[0.06, 12, 12]} />
            <meshBasicMaterial color={s.accent} toneMapped={false} />
          </mesh>
        </group>
      ))}
      {/* Lights scoped to the room (distance-limited) so the rest of Gen V2 keeps its look. */}
      <pointLight position={[cx, floorY + 4.5, cz]} intensity={s.ambient * 6} distance={s.radius * 2.4} color={s.keyColor} />
      <pointLight position={[cx + s.radius * 0.5, floorY + 2.5, cz + s.radius * 0.6]} intensity={s.keyLight * 3} distance={s.radius * 2} color={s.keyColor} />
      <pointLight position={[cx, floorY + 0.4, cz]} intensity={1.2} distance={s.radius * 1.2} color={s.accent} />
    </group>
  );
}

/* ------------------------------ built-in shapes ------------------------------ */

function shapeGeometry(shape: NonNullable<CosmosPlacement["primitive"]>["shape"]) {
  switch (shape) {
    case "sphere":
      return <sphereGeometry args={[0.5, 32, 24]} />;
    case "cylinder":
      return <cylinderGeometry args={[0.5, 0.5, 1, 32]} />;
    case "cone":
      return <coneGeometry args={[0.5, 1, 32]} />;
    case "torus":
      return <torusGeometry args={[0.35, 0.15, 16, 48]} />;
    case "plane":
      return <boxGeometry args={[1, 0.04, 1]} />;
    default:
      return <boxGeometry args={[1, 1, 1]} />;
  }
}

/* ---------------------------------- objects ---------------------------------- */

const STEP_ANGLE = Math.PI / 12;

function WorldObject({
  object,
  selected,
  onSelect,
  register,
}: {
  object: CosmosPlacement;
  selected: boolean;
  onSelect: (id: string | null) => void;
  register: (id: string, group: THREE.Group | null) => void;
}) {
  const p = object.primitive!;
  const busy = useRef(false);
  const act = (fn: () => Promise<unknown>) => (e: { stopPropagation: () => void }) => {
    e.stopPropagation();
    if (busy.current) return;
    busy.current = true;
    void fn().finally(() => (busy.current = false));
  };
  const h = object.height;
  // Generated furniture parts carry proportions so a desk top can be flat; older objects are cubic.
  const [px, py, pz] = p.proportions ?? [1, 1, 1];
  return (
    <group
      ref={(g) => register(object.id, g)}
      name={`WorldObject:${object.id}`}
      position={object.position}
      rotation={[0, object.rotationY, 0]}
      onClick={(e) => {
        e.stopPropagation();
        onSelect(selected ? null : object.id);
      }}
    >
      <mesh position={[0, p.shape === "plane" ? 0.02 * h * py : (h * py) / 2, 0]} scale={[h * px, h * py, h * pz]} castShadow receiveShadow>
        {shapeGeometry(p.shape)}
        <meshStandardMaterial
          color={p.color}
          metalness={p.metalness}
          roughness={p.roughness}
          emissive={p.emissive ?? "#000000"}
          emissiveIntensity={p.emissive ? 0.8 : 0}
          transparent={p.opacity < 1}
          opacity={p.opacity}
        />
      </mesh>
      {selected ? (
        <>
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]}>
            <ringGeometry args={[h * 0.62, h * 0.7, 48]} />
            <meshBasicMaterial color="#ffffff" transparent opacity={0.8} toneMapped={false} />
          </mesh>
          <Html center position={[0, h * py + 0.45, 0]} zIndexRange={[40, 0]}>
            <div className="lelu-world-toolbar" style={TOOLBAR}>
              <span style={{ padding: "0 6px", opacity: 0.85 }}>{object.label}</span>
              <button style={BTN} title="Rotate left" onClick={act(() => ForgeClient.updatePlacement(object.id, { rotationY: object.rotationY + STEP_ANGLE }))}>⟲</button>
              <button style={BTN} title="Rotate right" onClick={act(() => ForgeClient.updatePlacement(object.id, { rotationY: object.rotationY - STEP_ANGLE }))}>⟳</button>
              <button style={BTN} title="Smaller" onClick={act(() => ForgeClient.updatePlacement(object.id, { height: Math.max(0.05, h / 1.25) }))}>−</button>
              <button style={BTN} title="Larger" onClick={act(() => ForgeClient.updatePlacement(object.id, { height: h * 1.25 }))}>+</button>
              <button
                style={BTN}
                title={object.physics?.dynamic ? "Push" : "Drop with physics"}
                onClick={act(async () => {
                  if (!object.physics?.dynamic) await ForgeClient.updatePlacement(object.id, { position: [object.position[0], object.position[1] + 2, object.position[2]] });
                  const a = Math.random() * Math.PI * 2;
                  await ForgeClient.modifyObject(object.id, { physics: { dynamic: true, velocity: object.physics?.dynamic ? [Math.cos(a) * 3, 3, Math.sin(a) * 3] : [0, 0, 0] } });
                })}
              >
                {object.physics?.dynamic ? "↗" : "⤓"}
              </button>
              <button
                style={BTN}
                title={object.group ? `Remove the whole ${object.group}` : "Remove"}
                onClick={act(async () => (onSelect(null), object.group ? ForgeClient.removeGroup(object.group, object.environmentId) : ForgeClient.unplace(object.id)))}
              >
                ✕
              </button>
            </div>
          </Html>
        </>
      ) : null}
    </group>
  );
}

const TOOLBAR: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 4,
  padding: 4,
  borderRadius: 999,
  background: "rgba(16,12,24,0.82)",
  border: "1px solid rgba(240,171,252,0.35)",
  color: "#f5e9ff",
  font: "12px system-ui, sans-serif",
  whiteSpace: "nowrap",
  backdropFilter: "blur(6px)",
};

const BTN: React.CSSProperties = {
  minWidth: 34,
  height: 34,
  borderRadius: 999,
  border: "none",
  background: "rgba(255,255,255,0.08)",
  color: "inherit",
  fontSize: 15,
  cursor: "pointer",
  touchAction: "manipulation",
};

/* ---------------------------------- scene ---------------------------------- */

export default function WorldScene() {
  const [state, setState] = useState<WorldState | null>(null);
  const [wearables, setWearables] = useState<CosmosPlacement[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const groups = useRef(new Map<string, THREE.Group>());
  const sim = useRef<{ world: PhysicsWorld; bodies: Map<string, Body>; awake: boolean } | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () =>
      Promise.all([ForgeClient.world(), ForgeClient.placements()])
        .then(([world, { placements }]) => {
          if (!alive) return;
          setState(world);
          setWearables(placements.filter((p) => p.attach));
        })
        .catch((error) => console.info("[World] unavailable", error instanceof Error ? error.message : error));
    void load();
    window.addEventListener(FORGE_CHANGED_EVENT, load);
    return () => {
      alive = false;
      window.removeEventListener(FORGE_CHANGED_EVENT, load);
    };
  }, []);

  // (Re)build the simulation whenever the environment's objects change.
  useEffect(() => {
    if (!state) return;
    const withPhysics = state.objects.filter((o) => o.physics);
    if (!withPhysics.length) {
      sim.current = null;
      return;
    }
    const bodies = new Map<string, Body>();
    for (const o of withPhysics) {
      const r = o.height / 2;
      bodies.set(o.id, {
        id: o.id,
        position: [o.position[0], o.position[1] + r, o.position[2]],
        velocity: [...(o.physics!.velocity ?? [0, 0, 0])],
        radius: r,
        mass: o.physics!.mass,
        restitution: o.physics!.restitution,
        friction: o.physics!.friction,
        dynamic: o.physics!.dynamic,
      });
    }
    const s = state.environment.settings;
    sim.current = {
      world: new PhysicsWorld([...bodies.values()], { floorY: state.origin.floorY, centre: state.origin.centre, radius: s.wallHeight > 0 ? s.radius : 1e6, gravity: s.gravity }),
      bodies,
      awake: true,
    };
  }, [state]);

  useFrame((_, delta) => {
    const run = sim.current;
    if (!run || !run.awake) return;
    const awake = run.world.step(delta);
    for (const [id, body] of run.bodies) {
      const g = groups.current.get(id);
      if (g && body.dynamic) g.position.set(body.position[0], body.position[1] - body.radius, body.position[2]);
    }
    if (!awake) {
      // Everything is at rest: remember where it all ended up.
      run.awake = false;
      const positions: Record<string, [number, number, number]> = {};
      for (const [id, body] of run.bodies) {
        if (body.dynamic) positions[id] = [body.position[0], body.position[1] - body.radius, body.position[2]];
      }
      void ForgeClient.settled(positions).catch(() => {});
    }
  });

  if (!state) return null;
  return (
    <group name="LeluverseWorld" onPointerMissed={() => setSelected(null)}>
      <Room state={state} />
      {state.objects.map((o) =>
        o.primitive ? (
          <WorldObject
            key={o.id}
            object={o}
            selected={selected === o.id}
            onSelect={setSelected}
            register={(id, g) => (g ? groups.current.set(id, g) : groups.current.delete(id))}
          />
        ) : (
          <PlacedModel key={o.id} placement={o} />
        ),
      )}
      {wearables.map((w) => (
        <PlacedModel key={w.id} placement={w} />
      ))}
    </group>
  );
}
