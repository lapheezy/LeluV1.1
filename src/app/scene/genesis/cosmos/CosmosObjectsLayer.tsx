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
 * Mission 17 makes it an environment rather than a display:
 *
 *   - the camera fits the objects, from their real bounding boxes and the
 *     real viewport, through the Cosmos' own navigation (no model, no
 *     second camera system);
 *   - an object can be DRAGGED on a plane facing the camera, tap-selects,
 *     and shift-taps add to the selection;
 *   - the contextual strip works on the selection: nudge, turn, resize,
 *     lock, duplicate, isolate, split a part out, remove, undo;
 *   - motion stops when the page is hidden, so a backgrounded Cosmos is
 *     not paying for animation nobody can see.
 *
 * Nothing is permanently on screen. Deselect and the scene is clean.
 * ==========================================================
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import { Group, MeshStandardMaterial, PerspectiveCamera, Plane, Raycaster, Vector2, Vector3 } from "three";
import CosmosObjectStore from "../../../../core/cosmos/objects/CosmosObjectStore";
import type { CosmosObject, CosmosObjectState } from "../../../../core/cosmos/objects/CosmosObjectTypes";
import { cosmosCameraBus, poseFor, objectBounds, type CameraPose } from "../../../../core/cosmos/objects/CosmosObjectCamera";
import { claimCinematicCamera, releaseCinematicCamera } from "../cameraOwnership";

/** Enough of a draw-call budget per object, and no more. */
const MAX_MESHES_PER_OBJECT = 160;

/* ------------------------------------------------------------------ */
/* drag — one gesture, one undo step                                   */
/* ------------------------------------------------------------------ */

const drag: {
  active: boolean;
  ids: string[];
  plane: Plane;
  last: Vector3;
  pointerId: number;
  moved: boolean;
} = { active: false, ids: [], plane: new Plane(), last: new Vector3(), pointerId: -1, moved: false };

function ndcOf(event: PointerEvent, element: HTMLCanvasElement): Vector2 {
  const rect = element.getBoundingClientRect();
  return new Vector2(((event.clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1, -((event.clientY - rect.top) / Math.max(1, rect.height)) * 2 + 1);
}

/* ------------------------------------------------------------------ */
/* one object                                                          */
/* ------------------------------------------------------------------ */

function ObjectBody({
  object,
  selected,
  onSelect,
  onBeginDrag,
}: {
  object: CosmosObject;
  selected: boolean;
  onSelect: (add: boolean) => void;
  onBeginDrag: (object: CosmosObject) => void;
}) {
  const group = useRef<Group>(null);
  const [hovered, setHovered] = useState(false);
  const objects = useMemo(() => object.scene.objects.slice(0, MAX_MESHES_PER_OBJECT), [object.scene.objects]);
  const bounds = useMemo(() => objectBounds(object), [object]);

  useFrame((_, delta) => {
    const g = group.current;
    if (!g) return;
    // A hidden tab must not animate: nothing is being watched.
    if (typeof document !== "undefined" && document.hidden) return;
    const motion = object.motion;
    if (motion.kind === "still" || motion.paused) return;
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
  });

  return (
    <group
      ref={group}
      renderOrder={900}
      position={object.frame.position}
      rotation={(object.frame.rotation.map((d) => (d * Math.PI) / 180) as [number, number, number])}
      scale={object.frame.scale}
      visible={object.visible}
      onPointerDown={(event) => {
        event.stopPropagation();
        onSelect(event.shiftKey === true);
        if (!object.locked) onBeginDrag(object);
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
            <meshStandardMaterial
              {...common}
              emissive={selected || hovered ? "#b98cff" : undefined}
              emissiveIntensity={selected ? 0.35 : hovered ? 0.18 : 0}
              /*
               * The Cosmos is a crowded backdrop: nebulae, rooms and the core
               * own the space around the origin, and an object parked inside
               * them was stored correctly and drawn where nobody could see
               * it. The objects are what the user is working on, so they are
               * drawn in their own pass over the scene — still lit, still
               * depth-visible among themselves, but never buried by decor.
               */
              depthTest={false}
              depthWrite={false}
            />
          </mesh>
        );
      })}

      {/* Selection outline: the object's own bounding sphere, drawn thin, so a
          selected thing is unmistakable and an unselected one is untouched. */}
      {selected ? (
        <mesh renderOrder={901}>
          <sphereGeometry args={[Math.max(0.02, bounds.radius / Math.max(0.05, object.frame.scale)), 16, 12]} />
          <meshBasicMaterial wireframe transparent opacity={0.16} color="#d8c2ff" depthWrite={false} depthTest={false} />
        </mesh>
      ) : null}

      {selected ? (
        <Html center distanceFactor={12} style={{ pointerEvents: "auto" }}>
          <ObjectControls object={object} />
        </Html>
      ) : null}
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* the contextual strip                                                */
/* ------------------------------------------------------------------ */

function ObjectControls({ object }: { object: CosmosObject }) {
  const store = CosmosObjectStore.getInstance();
  const [partsOpen, setPartsOpen] = useState(false);
  const selected = store.selectionIds();
  const many = selected.length > 1 ? selected.length : 0;
  const b = (label: string, action: () => void, extra?: { title?: string; wide?: boolean }) => (
    <button
      key={label}
      type="button"
      title={extra?.title ?? label}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation();
        action();
      }}
      style={{
        border: "1px solid rgba(185,140,255,0.45)",
        background: "rgba(12,8,24,0.86)",
        color: "#f4f0ff",
        font: "600 10px/1.4 system-ui, sans-serif",
        borderRadius: 999,
        padding: "4px 9px",
        minHeight: 24,
        minWidth: 24,
        whiteSpace: "nowrap",
        cursor: "pointer",
      }}
    >
      {label}
    </button>
  );
  const move = (axis: 0 | 1 | 2, amount: number) => {
    const ids = selected.length ? selected : [object.id];
    store.nudge(ids, [axis === 0 ? amount : 0, axis === 1 ? amount : 0, axis === 2 ? amount : 0]);
  };
  const rotate = () => {
    const ids = selected.length ? selected : [object.id];
    for (const id of ids) {
      const target = store.get(id);
      if (target && !target.locked) store.transform(id, { rotation: [target.frame.rotation[0], target.frame.rotation[1] + 90, target.frame.rotation[2]] });
    }
  };
  const resize = (factor: number) => {
    const ids = selected.length ? selected : [object.id];
    for (const id of ids) {
      const target = store.get(id);
      if (target && !target.locked) store.transform(id, { scale: target.frame.scale * factor });
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, transform: "translateY(-30px)" }}>
      <span
        style={{
          background: "rgba(12,8,24,0.9)",
          border: "1px solid rgba(185,140,255,0.4)",
          borderRadius: 8,
          color: "#f4f0ff",
          font: "600 10.5px/1.5 system-ui, sans-serif",
          padding: "2px 7px",
          maxWidth: 210,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {many ? `${many} selected` : `${object.name} · ${object.partCount} parts`}
        {object.locked ? " · locked" : ""}
      </span>
      <div style={{ display: "flex", gap: 4, flexWrap: "wrap", justifyContent: "center", maxWidth: 236 }}>
        {b("←", () => move(0, -0.25), { title: "Move left along X" })}
        {b("→", () => move(0, 0.25), { title: "Move right along X" })}
        {b("↑", () => move(1, 0.25), { title: "Move up along Y" })}
        {b("↓", () => move(1, -0.25), { title: "Move down along Y" })}
        {b("⤒", () => move(2, 0.25), { title: "Move forward along Z" })}
        {b("⤓", () => move(2, -0.25), { title: "Move back along Z" })}
        {b("⟳", rotate, { title: "Turn 90° about Y" })}
        {b("×2", () => resize(2), { title: "Twice as large" })}
        {b("÷2", () => resize(0.5), { title: "Half the size" })}
        {b(object.locked ? "Unlock" : "Lock", () => store.lock(object.id, !object.locked))}
        {b(object.motion.kind === "still" || object.motion.paused ? "Float" : "Stop", () =>
          object.motion.kind === "still" || object.motion.paused
            ? store.animate(object.id, { kind: "spin", speed: 0.12, paused: false })
            : store.animate(object.id, { paused: true }),
        )}
        {b("Only this", () => store.isolate(object.id))}
        {b("Duplicate", () => store.duplicate(object.id))}
        {b("Take out", () => store.extract(object.id))}
        {object.partCount > 1 ? b("Take a part…", () => setPartsOpen(!partsOpen)) : null}
        {b("Remove", () => store.remove(object.id))}
        {b("Done", () => store.select(null))}
      </div>
      {partsOpen ? (
        <div style={{ display: "flex", gap: 3, flexWrap: "wrap", justifyContent: "center", maxWidth: 236, background: "rgba(12,8,24,0.9)", padding: 4, borderRadius: 8 }}>
          {[...new Set(object.scene.objects.map((p) => p.id))].slice(0, 10).map((partId) =>
            b(partId, () => {
              store.splitPart(object.id, partId);
              setPartsOpen(false);
            }, { title: `Take ${partId} out as its own object` }),
          )}
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* the camera bridge — deterministic poses, flown by the Cosmos camera  */
/* ------------------------------------------------------------------ */

interface CameraStatus {
  mode: string;
  ok: boolean;
  reason?: string;
  pose?: CameraPose;
  at: number;
}

function ObjectCameraBridge() {
  const { camera, size } = useThree();
  // The scene's own default OrbitControls (makeDefault), so a framed pose is
  // the pose the user can then orbit around — not a second camera.
  const controls = useThree((state) => state.controls) as unknown as { target?: Vector3; update?: () => void } | null;
  const previous = useRef<CameraPose | null>(null);

  useEffect(() => {
    const store = CosmosObjectStore.getInstance();
    const unsubscribe = cosmosCameraBus.subscribe((request) => {
      const perspective = camera as PerspectiveCamera;
      const current: CameraPose = (() => {
        const dir = new Vector3();
        camera.getWorldDirection(dir);
        const distance = Math.max(0.5, camera.position.length());
        return {
          position: [camera.position.x, camera.position.y, camera.position.z],
          lookAt: [camera.position.x + dir.x * distance, camera.position.y + dir.y * distance, camera.position.z + dir.z * distance],
          distance,
          fill: 0.5,
        };
      })();
      const result = poseFor(request, store.list(), { fov: perspective.fov ?? 50, aspect: size.width / Math.max(1, size.height) }, previous.current);
      if (!result.ok) {
        (window as unknown as { __cosmosCameraStatus?: CameraStatus }).__cosmosCameraStatus = { mode: request.mode, ok: false, reason: result.reason, at: Date.now() };
        return;
      }
      previous.current = current;
      (window as unknown as { __cosmosCameraStatus?: CameraStatus }).__cosmosCameraStatus = { mode: request.mode, ok: true, pose: result.pose, at: Date.now() };
      // The Cosmos' own navigation: smooth, interruptible, and bounded by the
      // same OrbitControls the user already drags.
      const pose = result.pose;
      // A framed view is a cinematic claim: it has to survive the drift that
      // pulls the controls target back to the origin every frame, and the
      // user takes it back the moment they drag.
      claimCinematicCamera();
      window.dispatchEvent(new CustomEvent("cosmos-navigate", { detail: { pos: { x: pose.position[0], y: pose.position[1], z: pose.position[2] }, lookAt: { x: pose.lookAt[0], y: pose.lookAt[1], z: pose.lookAt[2] } } }));
      /*
       * The Cosmos navigator animates the fly. When something else is holding
       * the camera (a covered scene, a presence recentre, a navigator that has
       * not started yet) the animation never advances and the user is left
       * looking at the home view with the objects off-screen — which is
       * exactly the failure this mission exists to end. So after the fly has
       * had its moment, the bridge checks where the camera actually is and,
       * if it never arrived, puts it there. Same OrbitControls, same target.
       */
      const arrive = () => {
        const aim = new Vector3(pose.lookAt[0], pose.lookAt[1], pose.lookAt[2]);
        const want = new Vector3(pose.position[0], pose.position[1], pose.position[2]);
        if (camera.position.distanceTo(want) < 0.35) return;
        camera.position.copy(want);
        camera.lookAt(aim);
        if (controls?.target) {
          controls.target.copy(aim);
          controls.update?.();
        }
      };
      window.setTimeout(arrive, 900);
    });
    return () => {
      unsubscribe();
      releaseCinematicCamera();
    };
  }, [camera, size.width, size.height]);

  /*
   * A read-only probe, in the same spirit as __leluSpatialProbe: where each
   * object is on SCREEN, in pixels, from the live camera. It exists because
   * "the store has an object" and "the object is on screen" are different
   * claims, and only the second one is what a person sees.
   */
  useEffect(() => {
    const perspective = camera as PerspectiveCamera;
    (window as unknown as { __cosmosObjectsProbe?: () => unknown }).__cosmosObjectsProbe = () => {
      const store = CosmosObjectStore.getInstance();
      const objects = store.list();
      const height = Math.max(1, size.height);
      return objects.map((object) => {
        const point = new Vector3(...object.frame.position).project(camera);
        const distance = camera.position.distanceTo(new Vector3(...object.frame.position));
        const fovRad = ((perspective.fov ?? 50) * Math.PI) / 180;
        return {
          id: object.id,
          name: object.name,
          place: object.place,
          visible: object.visible,
          scale: object.frame.scale,
          meshes: object.scene.objects.length,
          distance: Number(distance.toFixed(2)),
          screen: [Math.round(((point.x + 1) / 2) * size.width), Math.round(((1 - point.y) / 2) * height)],
          inFront: point.z < 1,
          /** how many pixels one world metre covers at that distance */
          pixelsPerMetre: Math.round((height / 2) / Math.tan(fovRad / 2) / Math.max(0.001, distance)),
        };
      });
    };
  }, [camera, size.width, size.height]);

  return null;
}

/* ------------------------------------------------------------------ */
/* the layer                                                           */
/* ------------------------------------------------------------------ */

export default function CosmosObjectsLayer() {
  const store = CosmosObjectStore.getInstance();
  const [state, setState] = useState<CosmosObjectState>(() => store.getState());
  const { camera, gl } = useThree();
  const raycaster = useRef(new Raycaster());

  useEffect(() => store.subscribe(setState), [store]);

  /* A drag holds the plane it started on and moves the selection along it. */
  const beginDrag = (object: CosmosObject) => {
    const element = gl.domElement;
    const door = new Vector3();
    camera.getWorldDirection(door);
    drag.plane.setFromNormalAndCoplanarPoint(door.clone().normalize(), new Vector3(...object.frame.position));
    drag.ids = store.selectionIds().length ? store.selectionIds() : [object.id];
    drag.active = true;
    drag.moved = false;
    drag.last.set(...object.frame.position);
    drag.pointerId = -1;

    const hit = (event: PointerEvent): Vector3 | null => {
      raycaster.current.setFromCamera(ndcOf(event, element), camera);
      const out = new Vector3();
      return raycaster.current.ray.intersectPlane(drag.plane, out) ? out : null;
    };

    const onMove = (event: PointerEvent) => {
      if (!drag.active) return;
      const point = hit(event);
      if (!point) return;
      const delta = point.clone().sub(drag.last);
      if (delta.lengthSq() < 1e-6) return;
      drag.last.copy(point);
      drag.moved = true;
      // Silent while the finger is down: the whole gesture is one undo step.
      store.nudge(drag.ids, [delta.x, delta.y, delta.z], { silent: true });
    };
    const onUp = () => {
      if (!drag.active) return;
      drag.active = false;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      if (drag.moved) store.nudge(drag.ids, [0, 0, 0]);
      drag.ids = [];
      drag.moved = false;
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  };

  const visible = state.objects.filter((object) => object.visible && (object.place === "cosmos" || object.place === "gallery"));

  return (
    <group position={[0, 0, 0]}>
      <ObjectCameraBridge />
      <ambientLight intensity={0.65} color="#e6ddff" />
      <directionalLight position={[6, 10, 8]} intensity={1.25} color="#ffffff" />
      <pointLight position={[-6, -4, 6]} intensity={0.8} color="#b98cff" distance={40} />
      {visible.map((object) => (
        <ObjectBody
          key={object.id}
          object={object}
          selected={state.selection.includes(object.id) || state.selected === object.id}
          onSelect={(add) => store.select(object.id, { add })}
          onBeginDrag={beginDrag}
        />
      ))}
    </group>
  );
}

/** Exported for the panel: when nothing is selected, no controls are drawn. */
export function cosmosObjectMaterial(color: string): MeshStandardMaterial {
  return new MeshStandardMaterial({ color });
}
