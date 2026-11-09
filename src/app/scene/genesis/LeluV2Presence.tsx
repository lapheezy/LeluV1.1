/**
 * ==========================================================
 * LÉLU — ONE 3D PRESENCE IN THE SHARED WORLD
 *
 * The approved Forge rig is the ONLY body drawn here. There is no
 * billboard, no saved-image plane, no procedural stand-in and no
 * companion card in this scene. If the rig cannot load, she says so
 * instead of silently becoming a different LÉLU.
 *
 * She stands on the room floor in world coordinates. She can:
 *   - walk to a sensible place for what she is doing,
 *   - stay out of the Core, furniture, windows projected onto the floor,
 *     the room wall and the person's space,
 *   - be held and dragged with a pointer/touch, which pauses autonomy,
 *   - remember the placement the person chose.
 *
 * Window rectangles are raycast onto the floor, so an opened Browser or
 * Studio window becomes a real occupied area she steps around. The DOM
 * window itself is untouched: she never moves the user's work.
 * ==========================================================
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import * as THREE from "three";

import AvatarStore from "../../../core/avatar/AvatarProfile";
import ForgeClient, {
  FORGE_CHANGED_EVENT,
  type AvatarWorldState,
  type WorldState,
} from "../../../core/forge/ForgeClient";
import LeluModelSource, { type LeluModelState } from "../../../core/avatar/LeluModelSource";
import {
  clampToRoom,
  isOccupied,
  nearestFree,
  planSpatialTarget,
  stepTowards,
  type SpatialBounds,
  type SpatialObstacle,
} from "../../../core/avatar/LeluSpatial";
import { ACTIVITY_ACCENT, useLeluActivity } from "./avatar/leluActivity";
import LeluBody from "./avatar/LeluBody";
import { V2_LELU_POS } from "./GenesisV2CameraRig";

const BODY_HEIGHT = 2.42;
const CLEARANCE = 0.38;
const WALK_SPEED = 1.15;
const PLACE_KEY = "lelu.avatar.spatial.v1";

/** Fixed parts of the world that are never walkable. */
const SCENE_OBSTACLES: SpatialObstacle[] = [
  { id: "core", x: 0, z: 2.0, radius: 1.55 },
  { id: "studio", x: -4.5, z: -1.05, radius: 0.8 },
  { id: "lab", x: 4.5, z: -1.05, radius: 0.8 },
  { id: "vault", x: 0, z: -2.1, radius: 0.8 },
];

function readLocalPlace(): { position: [number, number, number]; facing: number } | null {
  try {
    const raw = window.localStorage.getItem(PLACE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { position?: unknown; facing?: unknown };
    if (!Array.isArray(parsed.position) || parsed.position.length < 3) return null;
    const [x, y, z] = parsed.position;
    if (![x, y, z].every((n) => typeof n === "number" && Number.isFinite(n))) return null;
    return { position: [x as number, y as number, z as number], facing: typeof parsed.facing === "number" ? parsed.facing : 0 };
  } catch {
    return null;
  }
}

function writeLocalPlace(position: THREE.Vector3, facing: number): void {
  try {
    window.localStorage.setItem(PLACE_KEY, JSON.stringify({ position: position.toArray(), facing, at: Date.now() }));
  } catch {
    /* storage can be unavailable; the server record is still attempted */
  }
}

export default function LeluV2Presence({ position: positionProp }: { position?: THREE.Vector3 }) {
  const { camera, gl } = useThree();
  const activity = useLeluActivity();
  const accent = ACTIVITY_ACCENT[activity];
  const [modelState, setModelState] = useState<LeluModelState>(() => LeluModelSource.get());
  const [world, setWorld] = useState<WorldState | null>(null);
  const [place, setPlace] = useState<AvatarWorldState | null>(null);
  const [dragging, setDragging] = useState(false);
  const [walking, setWalking] = useState(false);

  const group = useRef<THREE.Group>(null);
  const position = useRef(new THREE.Vector3(...(positionProp?.toArray() ?? V2_LELU_POS.toArray())));
  const target = useRef(position.current.clone());
  const yaw = useRef(0);
  const manual = useRef<[number, number] | null>(null);
  const drag = useRef<{ pointerId: number; x: number; y: number; moved: boolean } | null>(null);
  const windowObstacles = useRef<SpatialObstacle[]>([]);
  const worldObstacles = useRef<SpatialObstacle[]>([]);
  const lastWindowScan = useRef(0);
  const lastTargetPlan = useRef(0);
  const lastTelemetry = useRef(0);
  const walkingRef = useRef(false);
  const ray = useMemo(() => new THREE.Raycaster(), []);
  const hit = useMemo(() => new THREE.Vector3(), []);
  const plane = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 1, 0), -(position.current.y)), []);

  useEffect(() => LeluModelSource.subscribe(setModelState), []);
  useEffect(() => {
    const store = AvatarStore.getInstance();
    return store.subscribe(() => {
      /* The model source announces wardrobe/model changes; this keeps the
         presence subscribed to the same character profile as every surface. */
    });
  }, []);

  useEffect(() => {
    let alive = true;
    const load = () =>
      Promise.all([ForgeClient.world(), ForgeClient.avatar().catch(() => null)])
        .then(([nextWorld, avatarResult]) => {
          if (!alive) return;
          setWorld(nextWorld);
          const avatar = avatarResult?.avatar ?? nextWorld.avatar ?? null;
          setPlace(avatar);
          const local = readLocalPlace();
          const chosen = avatar?.position ?? local?.position;
          if (chosen && !positionProp) {
            position.current.set(chosen[0], chosen[1], chosen[2]);
            plane.constant = -chosen[1];
          }
          worldObstacles.current = (nextWorld.objects ?? [])
            .map((o) => ({
              id: `object:${o.id}`,
              x: o.position[0],
              z: o.position[2],
              // Her own worn pieces are not obstacles; furniture and props are.
              radius: o.attach ? 0 : Math.max(0.18, (o.height ?? 1) * 0.32),
            }))
            .filter((o) => o.radius > 0);
          target.current.copy(position.current);
          if (typeof yaw.current === "number" && avatar) yaw.current = avatar.facing;
        })
        .catch((error) => console.info("[LÉLU spatial] world unavailable", error instanceof Error ? error.message : error));
    void load();
    const changed = () => void load();
    window.addEventListener(FORGE_CHANGED_EVENT, changed);
    return () => {
      alive = false;
      window.removeEventListener(FORGE_CHANGED_EVENT, changed);
    };
  }, [positionProp, plane]);

  useEffect(() => {
    gl.domElement.dataset.leluAvatarRenderer = "3d";
    gl.domElement.dataset.leluAvatarName = "LeluV2SpatialPresence";
    return () => {
      delete gl.domElement.dataset.leluAvatarRenderer;
      delete gl.domElement.dataset.leluAvatarName;
      delete document.body.dataset.leluAvatarHover;
      delete document.body.dataset.leluAvatarDragging;
    };
  }, [gl]);

  const bounds = useMemo<SpatialBounds>(
    () => ({
      centre: [world?.origin?.centre?.[0] ?? 0, world?.origin?.centre?.[1] ?? 2.2],
      radius: world?.environment?.settings?.radius ?? 6.5,
      floorY: world?.origin?.floorY ?? -2.55,
    }),
    [world],
  );

  /** Project visible workspace windows onto the floor as occupied footprints. */
  function scanWindows(now: number): void {
    if (now - lastWindowScan.current < 650) return;
    lastWindowScan.current = now;
    const doc = gl.domElement.ownerDocument;
    const found: SpatialObstacle[] = [];
    // Current module windows are authoritative. Their bodies may contain
    // legacy .genesis-window-frame nodes; scanning both made one window two
    // obstacles and left two stale frames in the room. Fall back to those
    // classes only when no current module window exists.
    const current = [...doc.querySelectorAll<HTMLElement>("[data-lelu-module-window]")];
    const nodes: HTMLElement[] = current.length
      ? current
      : [...doc.querySelectorAll<HTMLElement>(
        ".genesis-window-frame, [data-testid='lelu-companion'], [data-lelu-chat-window]",
      )];
    nodes.forEach((node, index) => {
      const rect = node.getBoundingClientRect();
      if (rect.width < 90 || rect.height < 70) return;
      const style = doc.defaultView?.getComputedStyle(node);
      if (style?.display === "none" || style?.visibility === "hidden") return;
      const x = ((rect.left + rect.width / 2) / Math.max(1, window.innerWidth)) * 2 - 1;
      // The centre of a tall window can sit above the camera horizon, so its
      // ray never reaches the floor. The bottom edge is the part nearest the
      // floor the person sees; project that instead.
      const y = -(((Math.min(window.innerHeight - 1, rect.bottom - 4)) / Math.max(1, window.innerHeight)) * 2 - 1);
      ray.setFromCamera(new THREE.Vector2(x, y), camera);
      if (!ray.ray.intersectPlane(plane, hit)) return;
      const inside = clampToRoom([hit.x, hit.z], bounds, CLEARANCE);
      // A window covering a large part of the view projects to a large
      // floor footprint; cap it so it can never fill the whole room.
      const radius = THREE.MathUtils.clamp((rect.width / Math.max(1, window.innerWidth)) * 5.2, 0.55, 2.2);
      const kind = node.dataset.leluModuleWindow ?? "surface";
      found.push({ id: `window:${kind}:${index}:${rect.left.toFixed(0)}`, x: inside[0], z: inside[2], radius });
    });
    windowObstacles.current = found;
  }

  function obstacles(): SpatialObstacle[] {
    return [...SCENE_OBSTACLES, ...worldObstacles.current, ...windowObstacles.current];
  }

  function viewerPoint(): [number, number] | null {
    const d = Math.hypot(camera.position.x - bounds.centre[0], camera.position.z - bounds.centre[1]);
    // A camera far outside the room is not a person standing in it.
    return d < bounds.radius + 2.5 ? [camera.position.x, camera.position.z] : null;
  }

  function applyPosition(x: number, z: number): void {
    const free = isOccupied([x, z], obstacles(), CLEARANCE, viewerPoint())
      ? nearestFree([x, z], bounds, obstacles(), CLEARANCE, viewerPoint())
      : clampToRoom([x, z], bounds, CLEARANCE);
    position.current.set(free[0], bounds.floorY, free[2]);
    target.current.set(free[0], bounds.floorY, free[2]);
    plane.constant = -bounds.floorY;
  }

  async function persistPlacement(): Promise<void> {
    const at = position.current;
    writeLocalPlace(at, yaw.current);
    try {
      await ForgeClient.setAvatar({ position: [at.x, bounds.floorY, at.z], facing: yaw.current });
    } catch (error) {
      console.info("[LÉLU spatial] placement kept locally; server save unavailable", error instanceof Error ? error.message : error);
    }
    window.dispatchEvent(
      new CustomEvent("lelu:spatial-state", {
        detail: { position: at.toArray(), facing: yaw.current, persisted: true, manual: true },
      }),
    );
  }

  function beginDrag(event: ThreeEvent<PointerEvent>): void {
    if (event.button !== 0 && event.pointerType !== "touch") return;
    event.stopPropagation();
    drag.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, moved: false };
    gl.domElement.setPointerCapture?.(event.pointerId);
    document.body.dataset.leluAvatarHover = "true";
    document.body.dataset.leluAvatarDragging = "true";
    setDragging(true);
  }

  function moveDrag(event: ThreeEvent<PointerEvent>): void {
    const active = drag.current;
    if (!active || active.pointerId !== event.pointerId) return;
    event.stopPropagation();
    ray.setFromCamera(event.pointer, camera);
    if (!ray.ray.intersectPlane(plane, hit)) return;
    active.moved = active.moved || Math.hypot(event.clientX - active.x, event.clientY - active.y) > 2;
    applyPosition(hit.x, hit.z);
    manual.current = [position.current.x, position.current.z];
    // Write locally while the finger moves; the server save happens once on
    // release, not on every pointer event.
    writeLocalPlace(position.current, yaw.current);
  }

  function finishDrag(): void {
    const active = drag.current;
    if (!active) return;
    const pointerId = active.pointerId;
    drag.current = null;
    try {
      if (gl.domElement.hasPointerCapture?.(pointerId)) gl.domElement.releasePointerCapture(pointerId);
    } catch {
      /* the browser may already have released it */
    }
    delete document.body.dataset.leluAvatarDragging;
    document.body.dataset.leluAvatarHover = "false";
    gl.domElement.style.cursor = "";
    setDragging(false);
    void persistPlacement();
  }

  function endDrag(event: ThreeEvent<PointerEvent>): void {
    const active = drag.current;
    if (!active || active.pointerId !== event.pointerId) return;
    event.stopPropagation();
    finishDrag();
  }

  // Pointer capture can route the release to the canvas rather than to the
  // R3F object. The window-level release is the authority: without it a drag
  // stayed latched and the person's placement was never saved.
  useEffect(() => {
    const release = () => finishDrag();
    window.addEventListener("pointerup", release);
    window.addEventListener("pointercancel", release);
    window.addEventListener("blur", release);
    return () => {
      window.removeEventListener("pointerup", release);
      window.removeEventListener("pointercancel", release);
      window.removeEventListener("blur", release);
    };
    // finishDrag reads refs and the current floor only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useFrame((_, delta) => {
    const root = group.current;
    if (!root || !modelState || modelState.status !== "ready") return;
    const now = performance.now();
    const dt = Math.min(0.05, delta);
    scanWindows(now);

    const isDragging = Boolean(drag.current);
    if (!isDragging && now - lastTargetPlan.current > 900) {
      lastTargetPlan.current = now;
      const focus: [number, number] | null = ["WORKING", "BUILDING", "RENDERING", "SEARCHING", "BROWSING", "EXPLORING", "PRESENTING"].includes(activity)
        ? [0, 0.4]
        : null;
      const next = planSpatialTarget({
        activity,
        current: [position.current.x, position.current.z],
        preferred: manual.current,
        viewer: viewerPoint(),
        focus,
        bounds,
        obstacles: obstacles(),
        clearance: CLEARANCE,
      });
      target.current.set(next[0], next[1], next[2]);
    }

    if (!isDragging) {
      const to = target.current;
      const d = Math.hypot(to.x - position.current.x, to.z - position.current.z);
      if (d > 0.06) {
        // Smooth acceleration/deceleration, no teleporting.
        const speed = Math.min(WALK_SPEED, d * 1.8);
        const step = stepTowards(
          [position.current.x, position.current.z],
          [to.x, to.z],
          speed * dt,
          bounds,
          obstacles(),
          CLEARANCE,
          viewerPoint(),
        );
        if (step.moving) {
          const fromX = position.current.x;
          const fromZ = position.current.z;
          position.current.set(step.position[0], bounds.floorY, step.position[1]);
          const vx = step.position[0] - fromX;
          const vz = step.position[1] - fromZ;
          if (Math.abs(vx) + Math.abs(vz) > 0.0001) {
            const wantedYaw = Math.atan2(vx, vz);
            let diff = wantedYaw - yaw.current;
            while (diff > Math.PI) diff -= Math.PI * 2;
            while (diff < -Math.PI) diff += Math.PI * 2;
            yaw.current += diff * Math.min(1, dt * 7);
          }
        }
        walkingRef.current = step.moving;
      } else {
        walkingRef.current = false;
        // Idle: turn to the person, gently, from wherever she is.
        if (!drag.current) {
          const dx = camera.position.x - position.current.x;
          const dz = camera.position.z - position.current.z;
          if (Math.hypot(dx, dz) > 0.2) {
            const wantedYaw = Math.atan2(dx, dz);
            let diff = wantedYaw - yaw.current;
            while (diff > Math.PI) diff -= Math.PI * 2;
            while (diff < -Math.PI) diff += Math.PI * 2;
            yaw.current += diff * Math.min(1, dt * 1.6);
          }
        }
      }
    }

    if (walkingRef.current !== walking) setWalking(walkingRef.current);
    root.position.set(position.current.x, bounds.floorY, position.current.z);
    root.rotation.y = yaw.current;

    if (now - lastTelemetry.current > 1000) {
      lastTelemetry.current = now;
      // Screen projection of her chest, so interaction audits can press the
      // real 3D body instead of guessing a pixel from a screenshot.
      const screenWorld = new THREE.Vector3(position.current.x, bounds.floorY + 1.2, position.current.z).project(camera);
      const canvasRect = gl.domElement.getBoundingClientRect();
      const screen = {
        x: Math.round(canvasRect.left + ((screenWorld.x + 1) / 2) * canvasRect.width),
        y: Math.round(canvasRect.top + ((1 - screenWorld.y) / 2) * canvasRect.height),
        visible: screenWorld.z > -1 && screenWorld.z < 1,
      };
      gl.domElement.dataset.leluAvatarScreen = JSON.stringify(screen);
      const data = {
        position: [Number(position.current.x.toFixed(3)), bounds.floorY, Number(position.current.z.toFixed(3))],
        facing: Number(yaw.current.toFixed(3)),
        activity,
        walking: walkingRef.current,
        dragging: isDragging,
        obstacles: obstacles().length,
        windowObstacles: windowObstacles.current.length,
        windowObstacleDetail: windowObstacles.current,
        worldObjectObstacles: worldObstacles.current.length,
        environment: world?.environment?.id ?? null,
        target: target.current.toArray().map((n) => Number(n.toFixed(3))),
        camera: camera.position.toArray().map((n) => Number(n.toFixed(3))),
        cameraRotation: [camera.rotation.x, camera.rotation.y, camera.rotation.z].map((n) => Number(n.toFixed(3))),
        projectedChest: screen,
        at: Date.now(),
      };
      gl.domElement.dataset.leluSpatial = JSON.stringify(data);
      window.dispatchEvent(new CustomEvent("lelu:spatial-state", { detail: data }));
    }
  });

  const model = modelState.status === "ready" ? modelState.model : null;
  useEffect(() => {
    if (!model) return;
    gl.domElement.dataset.leluAvatarModel = model.key;
    return () => {
      delete gl.domElement.dataset.leluAvatarModel;
    };
  }, [gl, model]);
  const initial = positionProp ?? (place ? new THREE.Vector3(...place.position) : V2_LELU_POS);

  return (
    <group
      ref={group}
      name="LeluV2SpatialPresence"
      position={[initial.x, initial.y, initial.z]}
      onPointerDown={beginDrag}
      onPointerMove={moveDrag}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onPointerOver={(event) => {
        event.stopPropagation();
        document.body.dataset.leluAvatarHover = "true";
        if (gl.domElement.style.cursor !== "grabbing") gl.domElement.style.cursor = "grab";
      }}
      onPointerOut={() => {
        if (!drag.current) {
          document.body.dataset.leluAvatarHover = "false";
          gl.domElement.style.cursor = "";
        }
      }}
    >
      <pointLight position={[0, 1.25, 0]} intensity={1.35} distance={5.5} color={accent} />

      {model ? (
        <LeluBody
          glb={model.glb}
          clips={model.clips}
          activity={activity}
          height={BODY_HEIGHT}
          life={false}
          walking={walking}
        />
      ) : (
        <Html position={[0, 1.25, 0]} center zIndexRange={[4, 0]} style={{ pointerEvents: "none" }}>
          <div
            data-testid="lelu-avatar-unavailable"
            style={{
              maxWidth: 190,
              padding: "7px 10px",
              borderRadius: 9,
              border: "1px solid rgba(251,113,133,0.55)",
              background: "rgba(24,6,14,0.88)",
              color: "#fecdd3",
              font: "600 10px/1.4 system-ui, sans-serif",
              textAlign: "center",
            }}
          >
            {modelState.status === "loading" ? "Loading LÉLU’s 3D body…" : "LÉLU’s 3D body is unavailable — she will not be replaced by a 2D stand-in."}
          </div>
        </Html>
      )}

      {/* A real world-space hit volume: hold anywhere on her to move her. */}
      <mesh position={[0, BODY_HEIGHT / 2, 0]} name="LeluDragHandle" userData={{ drag: true }}>
        <cylinderGeometry args={[0.52, 0.62, BODY_HEIGHT, 12]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} colorWrite={false} />
      </mesh>

      <mesh position={[0, 0.006, 0]} rotation={[-Math.PI / 2, 0, 0]} raycast={() => null}>
        <ringGeometry args={[0.58, 0.78, 48]} />
        <meshBasicMaterial
          color={dragging ? "#fbbf24" : accent}
          transparent
          opacity={dragging ? 0.9 : 0.45}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          toneMapped={false}
          side={THREE.DoubleSide}
        />
      </mesh>
    </group>
  );
}
