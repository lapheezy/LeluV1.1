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
import type { Object3D as ThreeObject } from "three";
import { Frustum, Group, Matrix4, MeshStandardMaterial, PerspectiveCamera, Plane, Raycaster, Vector2, Vector3 } from "three";
import CosmosObjectStore from "../../../../core/cosmos/objects/CosmosObjectStore";
import type { CosmosObject, CosmosObjectState } from "../../../../core/cosmos/objects/CosmosObjectTypes";
import { cosmosCameraBus, poseFor, objectBounds, type CameraPose } from "../../../../core/cosmos/objects/CosmosObjectCamera";
import { claimCinematicCamera, releaseCinematicCamera } from "../cameraOwnership";
import SpatialRuntime from "../../spatial/SpatialRuntime";

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
  register,
}: {
  object: CosmosObject;
  selected: boolean;
  /** The layer keeps the group so it can raycast its own objects directly. */
  register: (group: Group | null) => void;
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
      ref={(node) => {
        group.current = node;
        register(node);
      }}
      renderOrder={900}
      userData={{ cosmosObjectId: object.id }}
      position={object.frame.position}
      rotation={(object.frame.rotation.map((d) => (d * Math.PI) / 180) as [number, number, number])}
      scale={object.frame.scale}
      visible={object.visible}
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
        {b("Bring out", () => store.relocate(object.id), { title: "Move it to a clear spot in front of the core" })}
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
  const { camera, size, scene, gl } = useThree();
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
      /*
       * A reveal supersedes an older flight. If the Cosmos is still travelling
       * (an entry transition, say), it keeps its transition for `resume()` but
       * stops posing the camera — otherwise its next frame, or its arrival,
       * overwrites the pose that was just requested and the objects leave the
       * frame. Newest request wins; the interrupted one is still resumable.
       */
      const spatial = SpatialRuntime.getInstance();
      if (spatial.getState().transition) spatial.interrupt();
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
  /*
   * The camera's own aspect, kept in step with the canvas. A remount after
   * chat owned the phone screen left the projection matrix from the previous
   * size, so taps landed ~57 px from the pixels the user was pointing at and
   * an object could be drawn in one place and picked in another.
   */
  useEffect(() => {
    const perspective = camera as PerspectiveCamera;
    if (!perspective.isPerspectiveCamera) return;
    const aspect = size.width / Math.max(1, size.height);
    if (Math.abs(perspective.aspect - aspect) > 1e-4) {
      perspective.aspect = aspect;
      perspective.updateProjectionMatrix();
    }
  }, [camera, size.width, size.height]);

  useEffect(() => {
    const perspective = camera as PerspectiveCamera;
    (window as unknown as { __cosmosObjectsProbe?: () => unknown }).__cosmosObjectsProbe = () => {
      const store = CosmosObjectStore.getInstance();
      const height = Math.max(1, size.height);
      const frustum = new Frustum().setFromProjectionMatrix(new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));

      /* 1. what the store has */
      const fromStore = store.list().map((object) => {
        const point = new Vector3(...object.frame.position).project(camera);
        const distance = camera.position.distanceTo(new Vector3(...object.frame.position));
        const fovRad = ((perspective.fov ?? 50) * Math.PI) / 180;
        return {
          id: object.id,
          name: object.name,
          place: object.place,
          visible: object.visible,
          scale: object.frame.scale,
          sceneParts: object.scene.objects.length,
          distance: Number(distance.toFixed(2)),
          screen: [Math.round(((point.x + 1) / 2) * size.width), Math.round(((1 - point.y) / 2) * height)],
          inFront: point.z < 1,
          pixelsPerMetre: Math.round((height / 2) / Math.tan(fovRad / 2) / Math.max(0.001, distance)),
          inFrustum: frustum.containsPoint(new Vector3(...object.frame.position)),
        };
      });

      /* 2. what the RENDER SCENE actually holds, found by traversing it */
      const groups: Array<Record<string, unknown>> = [];
      let sceneMeshes = 0;
      scene.traverse((node: import("three").Object3D) => {
        const any = node as unknown as { isMesh?: boolean; userData?: Record<string, unknown> };
        if (any.isMesh) sceneMeshes += 1;
        if (!any.userData || typeof any.userData.cosmosObjectId !== "string") return;
        const group = node as unknown as Group;
        let meshes = 0;
        let materials: Array<Record<string, unknown>> = [];
        group.traverse((child) => {
          const mesh = child as unknown as { isMesh?: boolean; material?: unknown };
          if (!mesh.isMesh) return;
          meshes += 1;
          const material = mesh.material as { type?: string; color?: { getHexString?: () => string }; transparent?: boolean; opacity?: number; depthTest?: boolean; visible?: boolean; wireframe?: boolean } | undefined;
          if (materials.length < 2 && material) {
            materials.push({
              type: material.type,
              color: material.color?.getHexString?.(),
              transparent: material.transparent,
              opacity: material.opacity,
              depthTest: material.depthTest,
              wireframe: material.wireframe,
            });
          }
        });
        const world = new Vector3();
        group.getWorldPosition(world);
        // Visibility is inherited: a visible group under a hidden parent is not drawn.
        let chainVisible = true;
        let cursor: Group | null = group;
        while (cursor) {
          if (cursor.visible === false) chainVisible = false;
          cursor = cursor.parent as Group | null;
        }
        groups.push({
          id: any.userData.cosmosObjectId,
          meshes,
          worldPosition: [Number(world.x.toFixed(2)), Number(world.y.toFixed(2)), Number(world.z.toFixed(2))],
          worldScale: [group.scale.x, group.scale.y, group.scale.z],
          renderOrder: group.renderOrder,
          layers: group.layers.mask,
          groupVisible: group.visible,
          chainVisible,
          parentType: group.parent?.type,
          inFrustum: frustum.containsPoint(world),
          materials,
        });
      });

      const storeIds = fromStore.map((o) => o.id);
      const sceneIds = groups.map((g) => g.id);
      const parentScene = camera.parent as unknown as { type?: string; children?: unknown[] } | null;
      const canvases = Array.from(document.querySelectorAll("canvas")).map((canvas, index) => ({
        index,
        connected: canvas.isConnected,
        size: [canvas.clientWidth, canvas.clientHeight],
        isOurs: canvas === gl.domElement,
        hasContext: Boolean(canvas.getContext("webgl2") || canvas.getContext("webgl")),
      }));
      return {
        wiring: {
          ourCanvas: { connected: gl.domElement.isConnected, size: [gl.domElement.clientWidth, gl.domElement.clientHeight], style: gl.domElement.style.cssText.slice(0, 120) },
          cameraParentType: parentScene?.type ?? null,
          cameraParentChildren: parentScene?.children?.length ?? null,
          storeSceneChildren: scene.children.length,
          sameScene: (parentScene as unknown) === (scene as unknown),
          canvases,
        },
        camera: {
          aspect: Number((perspective.aspect ?? 0).toFixed(3)),
          viewport: [size.width, size.height],
          position: [Number(camera.position.x.toFixed(2)), Number(camera.position.y.toFixed(2)), Number(camera.position.z.toFixed(2))],
          layersMask: camera.layers.mask,
          near: perspective.near,
          far: perspective.far,
          fov: perspective.fov,
        },
        selection: store.selectionIds(),
        /* What a click at (x, y) actually hits, in order — the same walk the
           pointer handler does. */
        hit: (x: number, y: number) => {
          const ray = new Raycaster();
          ray.setFromCamera(new Vector2((x / Math.max(1, size.width)) * 2 - 1, -(y / Math.max(1, height)) * 2 + 1), camera);
          return ray.intersectObjects(scene.children, true).slice(0, 4).map((h) => {
            let owner: string | null = null;
            let cursor: ThreeObject | null = h.object;
            while (cursor && !owner) {
              if (cursor.userData?.cosmosObjectId) owner = cursor.userData.cosmosObjectId as string;
              cursor = cursor.parent;
            }
            const geometry = (h.object as unknown as { geometry?: { type?: string; parameters?: Record<string, unknown> } }).geometry;
            return {
              dist: Number(h.distance.toFixed(2)),
              owner,
              geometry: geometry?.type ?? null,
              params: geometry?.parameters ? Object.entries(geometry.parameters).map(([k, v]) => `${k}=${v}`).slice(0, 4).join(" ") : null,
              point: [Number(h.point.x.toFixed(1)), Number(h.point.y.toFixed(1)), Number(h.point.z.toFixed(1))],
            };
          });
        },
        scene: { meshes: sceneMeshes, children: scene.children.length, groups },
        store: fromStore,
        mounted: storeIds.filter((id) => sceneIds.includes(id)),
        missing: storeIds.filter((id) => !sceneIds.includes(id)),
      };
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
  const { camera, gl, invalidate } = useThree();
  const raycaster = useRef(new Raycaster());
  /** object id → its group in this scene, for the layer's own hit test. */
  const registry = useRef(new Map<string, Group>());

  /*
   * The world canvas runs on demand. A store change re-rendered React but
   * never asked for a frame, so a move/rotate/resize was applied to the
   * objects' transforms and the screen kept showing the previous picture
   * until something else happened to invalidate it.
   */
  useEffect(() => store.subscribe(() => {
    setState(store.getState());
    invalidate();
  }), [store, invalidate]);

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

  /*
   * Taps belong to the objects. R3F's own event walk raycasts the whole
   * scene, so a decoration standing in front of a chair (<2 m from the
   * camera) took the pointerdown and the chair was never selectable —
   * the objects rendered, and could not be touched. This hit test looks
   * at the objects only: nothing else in the Cosmos can eat their taps.
   */
  const beginDragRef = useRef(beginDrag);
  beginDragRef.current = beginDrag;
  useEffect(() => {
    const element = gl.domElement;
    const onDown = (event: PointerEvent) => {
      const targets = [...registry.current.values()].filter((group) => group.visible);
      if (!targets.length) return;
      raycaster.current.setFromCamera(ndcOf(event, element), camera);
      const hit = raycaster.current.intersectObjects(targets, true)[0];
      if (!hit) return;
      let owner: ThreeObject | null = hit.object;
      let id: string | null = null;
      while (owner && !id) {
        if (typeof owner.userData?.cosmosObjectId === "string") id = owner.userData.cosmosObjectId as string;
        owner = owner.parent;
      }
      if (!id) return;
      const object = store.get(id);
      if (!object || !object.visible) return;
      store.select(id, { add: event.shiftKey === true });
      if (!object.locked) beginDragRef.current(object);
    };
    element.addEventListener("pointerdown", onDown);
    return () => element.removeEventListener("pointerdown", onDown);
  }, [camera, gl, store]);

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
          register={(node) => {
            if (node) registry.current.set(object.id, node);
            else registry.current.delete(object.id);
          }}
        />
      ))}
    </group>
  );
}

/** Exported for the panel: when nothing is selected, no controls are drawn. */
export function cosmosObjectMaterial(color: string): MeshStandardMaterial {
  return new MeshStandardMaterial({ color });
}
