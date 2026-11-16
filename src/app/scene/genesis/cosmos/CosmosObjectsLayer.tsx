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
import { Box3, Frustum, Group, Matrix4, MeshStandardMaterial, PerspectiveCamera, Plane, Raycaster, Sphere, Vector2, Vector3 } from "three";
import CosmosObjectStore from "../../../../core/cosmos/objects/CosmosObjectStore";
import type { CosmosObject, CosmosObjectState } from "../../../../core/cosmos/objects/CosmosObjectTypes";
import { cosmosCameraBus, poseFor, objectBounds, type Bounds3, type CameraPose } from "../../../../core/cosmos/objects/CosmosObjectCamera";
import {
  VIEWPORT_SPACE,
  freshenCamera,
  insideViewport,
  ndcToViewport,
  projectBounds,
  viewportOf,
  viewportToCanvasLocal,
  type ProjectedObject,
} from "../../../../core/cosmos/objects/CosmosProjection";
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
  const { camera, size, scene, gl, invalidate } = useThree();
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

      /*
       * THE VIEWPORT IS THE CANVAS' OWN BOX.
       *
       * Not `window.innerWidth`: the canvas can be offset, letterboxed or
       * smaller than the window, and a screenshot is of the window. The
       * ratio comes from the buffer the renderer actually allocated, because
       * an adaptive `dpr` makes it differ from window.devicePixelRatio.
       */
      const element = gl.domElement;
      const view = viewportOf(
        element.getBoundingClientRect(),
        { width: element.width, height: element.height },
        gl.getPixelRatio(),
      );
      /* The camera's matrices must describe where it is NOW: three updates
         `matrixWorldInverse` inside its render pass, so at 1 fps a camera that
         has flown since the last frame still carries the old one. */
      const aspectMismatch = freshenCamera(perspective, view);
      const height = view.height;
      const frustum = new Frustum().setFromProjectionMatrix(new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));

      /* The rendered group for each canonical id, so a box is transformed by
         what the scene graph applies — a scaled ring group, a rotating parent —
         rather than by the store's numbers alone. */
      const groupById = new Map<string, Group>();
      scene.traverse((node: import("three").Object3D) => {
        const id = (node.userData as { cosmosObjectId?: unknown } | undefined)?.cosmosObjectId;
        if (typeof id === "string" && !groupById.has(id)) groupById.set(id, node as unknown as Group);
      });
      /*
       * THE BOX THAT GETS PROJECTED IS THE BOX THAT GETS DRAWN.
       *
       * `objectBounds()` is a MODEL: it exists so the camera can fit an object
       * before it is mounted, and it multiplies the object's scale into part
       * positions and extents. The pixels come from the group's geometry under
       * the scene graph's real transforms. When the two disagree, the pixels
       * are right — so the rendered world box is what this projects, and the
       * model is reported beside it for comparison rather than trusted.
       */
      const renderedBounds = (object: CosmosObject): Bounds3 | null => {
        const group = groupById.get(object.id);
        if (!group) return null;
        group.updateWorldMatrix(true, true);
        const box = new Box3().setFromObject(group, true);
        if (box.isEmpty()) return null;
        const center = box.getCenter(new Vector3());
        const radius = box.getBoundingSphere(new Sphere()).radius;
        return {
          min: [box.min.x, box.min.y, box.min.z],
          max: [box.max.x, box.max.y, box.max.z],
          center: [center.x, center.y, center.z],
          radius,
        };
      };
      const project = (object: CosmosObject): ProjectedObject =>
        projectBounds(perspective, renderedBounds(object), view);
      /* The same object measured the model's way, for the record. */
      const projectModel = (object: CosmosObject): ProjectedObject =>
        projectBounds(perspective, objectBounds(object), view, groupById.get(object.id)?.parent?.matrixWorld);
      /*
       * The group's own place in the world, and where its ORIGIN projects to.
       * A box centre and an object origin are different claims, and telling
       * them apart is how a "projection is wrong" report turns into "the
       * bounds are not what you assumed".
       */
      const groupWorld = (object: CosmosObject) => {
        const group = groupById.get(object.id);
        if (!group) return null;
        const origin = new Vector3();
        group.getWorldPosition(origin);
        const worldBox = renderedBounds(object);
        const corner = origin.clone().project(perspective);
        return {
          world: [Number(origin.x.toFixed(3)), Number(origin.y.toFixed(3)), Number(origin.z.toFixed(3))],
          worldMin: worldBox ? worldBox.min.map((n) => Number(n.toFixed(3))) : null,
          worldMax: worldBox ? worldBox.max.map((n) => Number(n.toFixed(3))) : null,
          originCenter: ndcToViewport([corner.x, corner.y, corner.z], view),
          scale: [group.scale.x, group.scale.y, group.scale.z],
          rotationY: Number((group.rotation.y % (Math.PI * 2)).toFixed(3)),
          parent: group.parent?.type ?? null,
          parentPosition: group.parent ? [Number(group.parent.position.x.toFixed(3)), Number(group.parent.position.y.toFixed(3)), Number(group.parent.position.z.toFixed(3))] : null,
        };
      };

      /* 1. what the store has, measured in viewport CSS pixels */
      const fromStore = store.list().map((object) => {
        const distance = camera.position.distanceTo(new Vector3(...object.frame.position));
        const fovRad = ((perspective.fov ?? 50) * Math.PI) / 180;
        const projected = project(object);
        return {
          id: object.id,
          name: object.name,
          place: object.place,
          visible: object.visible,
          /* Drawn only when visible AND placed where this layer draws it. */
          drawable: object.visible && (object.place === "cosmos" || object.place === "gallery"),
          scale: object.frame.scale,
          sceneParts: object.scene.objects.length,
          distance: Number(distance.toFixed(2)),
          /* The coordinate contract, spelled out with every reading. */
          space: projected.space,
          center: projected.center,
          bounds: projected.bounds,
          bufferCenter: projected.bufferCenter,
          behindCamera: projected.behindCamera,
          onScreen: insideViewport(projected.center, view),
          failure: projected.failure,
          aspectMismatch: projected.aspectMismatch,
          inFrustum: projected.inFrustum,
          sceneGraph: groupWorld(object),
          modelView: (() => {
            const model = projectModel(object);
            return { center: model.center, bounds: model.bounds && model.bounds.map((n) => Number(n.toFixed(1))) };
          })(),
          pixelsPerMetre: Math.round((height / 2) / Math.tan(fovRad / 2) / Math.max(0.001, distance)),
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
        viewport: {
          space: VIEWPORT_SPACE,
          left: Number(view.left.toFixed(2)),
          top: Number(view.top.toFixed(2)),
          width: Number(view.width.toFixed(2)),
          height: Number(view.height.toFixed(2)),
          buffer: [view.bufferWidth, view.bufferHeight],
          dpr: view.dpr,
          aspectMismatch,
        },
        camera: {
          aspect: Number((perspective.aspect ?? 0).toFixed(3)),
          surfaceAspect: Number((view.width / Math.max(1, view.height)).toFixed(3)),
          viewport: [view.width, view.height],
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
          /* (x, y) are VIEWPORT CSS pixels, the same space `center` is in. */
          const local = viewportToCanvasLocal({ x, y }, view);
          ray.setFromCamera(new Vector2((local.x / view.width) * 2 - 1, -(local.y / view.height) * 2 + 1), camera);
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

    /*
     * A MEASUREMENT HOOK, NOT A FEATURE.
     *
     * "Which pixels are this object" is a question only the renderer can
     * answer truthfully. It answers by not drawing the object for one frame:
     * the pixels that change between the two captures are exactly the ones the
     * object was covering. That is an identity mask — no colour rule, no
     * material or lighting assumption, and a yaw-rotated silhouette comes out
     * as the silhouette itself rather than as its axis-aligned box.
     *
     * It touches nothing that persists: no store write, no canonical id, no
     * placement, no selection, no renderer. The flag lives on the scene node
     * and the caller restores it; a React re-render would restore it anyway,
     * which is why the mask is only valid for the frame it was asked for.
     */
    const setObjectVisible = (id: string, on: boolean) => {
      let found = false;
      scene.traverse((node: import("three").Object3D) => {
        if (found) return;
        if ((node.userData as { cosmosObjectId?: unknown } | undefined)?.cosmosObjectId === id) {
          node.visible = on;
          found = true;
        }
      });
      if (found) invalidate();
      return found;
    };

    (window as unknown as { __cosmosObjectIdentity?: unknown }).__cosmosObjectIdentity = {
      setVisible: setObjectVisible,
      /*
       * Read the identity mask straight out of the renderer's own frame buffer.
       *
       * A compositor screenshot costs seconds on this host and lets the
       * animation move between the two frames, so the diff would contain every
       * object that turned. Two direct renders in the same task cannot drift:
       * nothing in the scene advances between them, and the pixels come from
       * the renderer that drew the frame a person is looking at. No second
       * renderer, no render target, no state kept. Rows come back bottom-up
       * and are flipped here so the mask is in the same top-left space as a
       * screenshot.
       */
      identityMask: (id: string) => {
        const width = gl.domElement.width;
        const height = gl.domElement.height;
        const ctx = gl.getContext() as WebGLRenderingContext | WebGL2RenderingContext;
        const grab = () => {
          gl.render(scene, camera);
          const buffer = new Uint8Array(width * height * 4);
          ctx.readPixels(0, 0, width, height, ctx.RGBA, ctx.UNSIGNED_BYTE, buffer);
          return buffer;
        };
        const before = grab();
        const found = setObjectVisible(id, false);
        let after: Uint8Array;
        try {
          after = grab();
        } finally {
          /*
           * Restored in a `finally`: a capture that throws halfway through
           * (a lost context, a driver hiccup) must not leave an object
           * invisible in a scene the user is looking at. The repaint after
           * the restore is best-effort for the same reason.
           */
          setObjectVisible(id, true);
          try {
            gl.render(scene, camera);
          } catch {
            /* the frame loop will repaint when it next runs */
          }
        }
        if (!found) return null;

        const luminance = (buffer: Uint8Array, index: number) =>
          0.2126 * buffer[index] + 0.7152 * buffer[index + 1] + 0.0722 * buffer[index + 2];
        const mask = new Uint8Array(width * height);
        let changed = 0;
        for (let y = 0; y < height; y += 1) {
          for (let x = 0; x < width; x += 1) {
            const topDown = y * width + x;
            const bottomUp = (height - 1 - y) * width + x;
            /* The two renders are consecutive in one task, so nothing in the
               scene advanced between them: any difference at all is the
               object. A generous threshold here is what dropped a chair's
               thin legs from its own silhouette. */
            if (Math.abs(luminance(before, bottomUp * 4) - luminance(after, bottomUp * 4)) > 2) {
              mask[topDown] = 1;
              changed += 1;
            }
          }
        }
        const seen = new Uint8Array(width * height);
        const components: Array<{ area: number; box: [number, number, number, number]; centre: [number, number] }> = [];
        for (let y = 0; y < height; y += 1) {
          for (let x = 0; x < width; x += 1) {
            const start = y * width + x;
            if (seen[start] || !mask[start]) continue;
            const stack = [start];
            seen[start] = 1;
            let area = 0, left = x, right = x, top = y, bottom = y, sumX = 0, sumY = 0;
            while (stack.length) {
              const at = stack.pop() as number;
              const ax = at % width;
              const ay = (at / width) | 0;
              area += 1;
              sumX += ax;
              sumY += ay;
              if (ax < left) left = ax;
              if (ax > right) right = ax;
              if (ay < top) top = ay;
              if (ay > bottom) bottom = ay;
              const neighbours = [at - 1, at + 1, at - width, at + width];
              for (let n = 0; n < neighbours.length; n += 1) {
                const next = neighbours[n];
                if (next < 0 || next >= mask.length) continue;
                if (Math.abs((next % width) - ax) > 1) continue;
                if (seen[next] || !mask[next]) continue;
                seen[next] = 1;
                stack.push(next);
              }
            }
            if (area >= 20) components.push({ area, box: [left, top, right, bottom], centre: [Math.round(sumX / area), Math.round(sumY / area)] });
          }
        }
        components.sort((a, b) => b.area - a.area);
        const union = components.length
          ? [
              Math.min(...components.map((c) => c.box[0])),
              Math.min(...components.map((c) => c.box[1])),
              Math.max(...components.map((c) => c.box[2])),
              Math.max(...components.map((c) => c.box[3])),
            ] as [number, number, number, number]
          : null;
        const totalArea = components.reduce((sum, c) => sum + c.area, 0);
        const centroid = totalArea
          ? ([Math.round(components.reduce((sum, c) => sum + c.centre[0] * c.area, 0) / totalArea), Math.round(components.reduce((sum, c) => sum + c.centre[1] * c.area, 0) / totalArea)] as [number, number])
          : null;
        return {
          buffer: [width, height] as [number, number],
          dpr: gl.getPixelRatio(),
          changedPixels: changed,
          area: totalArea,
          bbox: union,
          centroid,
          components: components.length,
          largest: components.slice(0, 3),
        };
      },
      /*
       * The frame the mask was measured against, straight from the same
       * buffer: a capture without a compositor round-trip, at the same instant
       * as the numbers. Returned as a PNG data URL so it can be written beside
       * the measurements.
       */
      capture: (scale = 1) => {
        const width = gl.domElement.width;
        const height = gl.domElement.height;
        const ctx = gl.getContext() as WebGLRenderingContext | WebGL2RenderingContext;
        gl.render(scene, camera);
        const buffer = new Uint8Array(width * height * 4);
        ctx.readPixels(0, 0, width, height, ctx.RGBA, ctx.UNSIGNED_BYTE, buffer);
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const target = canvas.getContext("2d");
        if (!target) return null;
        const image = target.createImageData(width, height);
        for (let y = 0; y < height; y += 1) {
          const source = (height - 1 - y) * width * 4;
          image.data.set(buffer.subarray(source, source + width * 4), y * width * 4);
        }
        target.putImageData(image, 0, 0);
        if (scale === 1) return canvas.toDataURL("image/png");
        const small = document.createElement("canvas");
        small.width = Math.max(1, Math.round(width * scale));
        small.height = Math.max(1, Math.round(height * scale));
        const sctx = small.getContext("2d");
        if (!sctx) return null;
        sctx.drawImage(canvas, 0, 0, small.width, small.height);
        return small.toDataURL("image/png");
      },
      visibility: () => {
        const out: Record<string, boolean> = {};
        scene.traverse((node: import("three").Object3D) => {
          const id = (node.userData as { cosmosObjectId?: unknown } | undefined)?.cosmosObjectId;
          if (typeof id === "string") out[id] = node.visible;
        });
        return out;
      },
    };
  }, [camera, size.width, size.height, invalidate]);

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
