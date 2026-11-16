/**
 * ==========================================================
 * LÉLU — COSMOS OBJECTS LAYER
 *
 * The objects the user built, drawn inside the existing Cosmos scene —
 * not a second canvas, not a preview. Each one is a group with its own
 * position, rotation and scale from CosmosObjectStore, and its geometry
 * is the construction's own objects, so what floats here is the thing
 * that was built.
 *
 * Selection is by touch: tapping an object selects it, and a small
 * contextual strip appears with the operations that make sense on that
 * one object (spin/stop, isolate, take it out, remove). Nothing is
 * permanent on screen; deselect and the scene is clean again.
 * ==========================================================
 */

import { NeuralView } from "../neural/neuralView";
import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import { Group, MeshStandardMaterial } from "three";
import CosmosObjectStore from "../../../../core/cosmos/objects/CosmosObjectStore";
import type { CosmosObject, CosmosObjectState } from "../../../../core/cosmos/objects/CosmosObjectTypes";

/** Enough of a draw-call budget per object, and no more. */
const MAX_MESHES_PER_OBJECT = 160;

function ObjectBody({ object, selected, onSelect }: { object: CosmosObject; selected: boolean; onSelect: () => void }) {
  const group = useRef<Group>(null);
  const [hovered, setHovered] = useState(false);
  const objects = useMemo(() => object.scene.objects.slice(0, MAX_MESHES_PER_OBJECT), [object.scene.objects]);

  useFrame((_, delta) => {
    const g = group.current;
    if (!g) return;
    const motion = object.motion;
    if (motion.kind !== "still" && !motion.paused) {
      const step = Math.min(delta, 0.1) * motion.speed * Math.PI * 2;
      if (motion.kind === "spin") {
        if (motion.axis === "x") g.rotation.x += step;
        else if (motion.axis === "z") g.rotation.z += step;
        else g.rotation.y += step;
      } else if (motion.kind === "bob") {
        g.position.y = object.frame.position[1] + Math.sin(performance.now() / 1000 * motion.speed * 2) * 0.25;
      } else if (motion.kind === "orbit") {
        g.rotation.y += step * 0.4;
        g.position.x = object.frame.position[0] + Math.cos(performance.now() / 1000 * motion.speed) * 1.2;
        g.position.z = object.frame.position[2] + Math.sin(performance.now() / 1000 * motion.speed) * 1.2;
      } else if (motion.kind === "drift") {
        g.position.x += step * 0.4;
        if (g.position.x > object.frame.position[0] + 6) g.position.x = object.frame.position[0] - 6;
      }
    }
  });

  return (
    <group
      ref={group}
      position={object.frame.position}
      rotation={(object.frame.rotation.map((d) => (d * Math.PI) / 180) as [number, number, number])}
      scale={object.frame.scale}
      visible={object.visible}
      onClick={(event) => {
        event.stopPropagation();
        onSelect();
      }}
      onPointerOver={() => setHovered(true)}
      onPointerOut={() => setHovered(false)}
    >
      {objects.map((part) => {
        const size = part.size as Record<string, number>;
        const common = { color: part.color, metalness: part.metalness, roughness: part.roughness, transparent: (part.opacity ?? 1) < 1, opacity: part.opacity ?? 1 };
        return (
          <mesh
            key={part.id}
            position={part.position as [number, number, number]}
            rotation={((part.rotation ?? [0, 0, 0]).map((d) => (d * Math.PI) / 180) as [number, number, number])}
            castShadow={false}
            receiveShadow={false}
          >
            {part.shape === "box" ? (
              <boxGeometry args={[size.width ?? 0.1, size.height ?? 0.1, size.depth ?? 0.1]} />
            ) : part.shape === "cylinder" ? (
              <cylinderGeometry args={[size.radius ?? size.radiusTop ?? 0.05, size.radius ?? size.radiusBottom ?? 0.05, size.height ?? 0.1, 20]} />
            ) : part.shape === "cone" ? (
              <coneGeometry args={[size.radius ?? 0.05, size.height ?? 0.1, 18]} />
            ) : part.shape === "torus" ? (
              <torusGeometry args={[size.radius ?? 0.1, size.tube ?? 0.02, 12, 24]} />
            ) : (
              <sphereGeometry args={[size.radius ?? 0.05, 20, 14]} />
            )}
            <meshStandardMaterial {...common} emissive={selected || hovered ? "#b98cff" : undefined} emissiveIntensity={selected ? 0.35 : hovered ? 0.18 : 0} />
          </mesh>
        );
      })}

      {selected ? (
        <Html center distanceFactor={12} style={{ pointerEvents: "auto" }}>
          <ObjectControls object={object} />
        </Html>
      ) : null}
    </group>
  );
}

/** The strip that appears when an object is selected — nothing is always on screen. */
function ObjectControls({ object }: { object: CosmosObject }) {
  const store = CosmosObjectStore.getInstance();
  const button = (label: string, action: () => void, active = false) => (
    <button
      key={label}
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        action();
      }}
      style={{
        border: "1px solid rgba(185,140,255,0.45)",
        background: active ? "rgba(185,140,255,0.4)" : "rgba(12,8,24,0.86)",
        color: "#f4f0ff",
        font: "600 10px/1.4 system-ui, sans-serif",
        borderRadius: 999,
        padding: "3px 8px",
        whiteSpace: "nowrap",
        cursor: "pointer",
      }}
    >
      {label}
    </button>
  );
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, transform: "translateY(-26px)" }}>
      <span
        style={{
          background: "rgba(12,8,24,0.9)",
          border: "1px solid rgba(185,140,255,0.4)",
          borderRadius: 8,
          color: "#f4f0ff",
          font: "600 10.5px/1.5 system-ui, sans-serif",
          padding: "2px 7px",
          maxWidth: 190,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {object.name} · {object.partCount} parts
      </span>
      <div style={{ display: "flex", gap: 4, flexWrap: "wrap", justifyContent: "center", maxWidth: 220 }}>
        {button(object.motion.kind === "still" || object.motion.paused ? "Float" : "Stop", () =>
          object.motion.kind === "still" || object.motion.paused
            ? store.animate(object.id, { kind: "spin", speed: 0.12, paused: false })
            : store.animate(object.id, { paused: true }),
        )}
        {button("Only this", () => store.isolate(object.id))}
        {button("Take out", () => store.extract(object.id))}
        {button("Duplicate", () => store.duplicate(object.id))}
        {button("Remove", () => store.remove(object.id))}
        {button("Neural", () => NeuralView.inspect(`cosmos.object:${object.id}`))}
        {button("Done", () => store.select(null))}
      </div>
    </div>
  );
}

export default function CosmosObjectsLayer() {
  const store = CosmosObjectStore.getInstance();
  const [state, setState] = useState<CosmosObjectState>(() => store.getState());

  useEffect(() => store.subscribe(setState), [store]);

  // The layer is inside the Cosmos scene, in front of the deep background so
  // the objects are what you see, and near enough to touch.
  return (
    <group position={[0, 0, 0]}>
      <ambientLight intensity={0.55} color="#e6ddff" />
      <directionalLight position={[6, 10, 8]} intensity={1.1} color="#ffffff" />
      <pointLight position={[-6, -4, 6]} intensity={0.7} color="#b98cff" distance={40} />
      {state.objects
        .filter((object) => object.place === "cosmos" || object.place === "gallery")
        .map((object) => (
          <ObjectBody key={object.id} object={object} selected={state.selected === object.id} onSelect={() => store.select(object.id)} />
        ))}
    </group>
  );
}

/** Exported for the panel: when nothing is selected, no controls are drawn. */
export function cosmosObjectMaterial(color: string): MeshStandardMaterial {
  return new MeshStandardMaterial({ color });
}
