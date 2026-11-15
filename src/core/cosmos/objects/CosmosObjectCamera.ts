/**
 * ==========================================================
 * LÉLU — COSMOS OBJECT CAMERA
 *
 * The camera has to understand the objects, not guess at them. This is
 * plain arithmetic over the geometry that is already in the store: the
 * extent of one part, the box that holds an object and its children, and
 * the distance at which that box fits inside the real view frustum for
 * the real viewport.
 *
 * No model is asked where to stand. The result is a camera position and
 * a look-at point, which the existing OrbitControls path flies to — so
 * the move is smooth, interruptible by the user's own drag, and bounded
 * by the same distance clamp as every other navigation in the app.
 * ==========================================================
 */

import type { CosmosObject, Vec3 } from "./CosmosObjectTypes";

export interface CameraViewport {
  /** vertical field of view, degrees, the camera's own value */
  fov: number;
  /** width / height of the drawing surface */
  aspect: number;
}

export interface CameraPose {
  position: Vec3;
  lookAt: Vec3;
  distance: number;
  /** how much of the frame the subject takes: 1 = exactly filling it */
  fill: number;
}

export interface Bounds3 {
  min: Vec3;
  max: Vec3;
  center: Vec3;
  /** radius of the sphere around it: what fitting actually needs */
  radius: number;
}

export type CosmosCameraMode = "all" | "selected" | "assembly" | "focus" | "home" | "previous" | "zoom";

export interface CosmosCameraRequest {
  mode: CosmosCameraMode;
  /** which object: id, or part of its name */
  object?: string;
  /** zoom: 1.6 = closer by 1.6×, 0.6 = further away */
  factor?: number;
  /** where the request came from, for the honest reply */
  because?: string;
}

const DEFAULT_HOME: CameraPose = { position: [0, 0, 6.8], lookAt: [0, 0, 0], distance: 6.8, fill: 0.2 };
export const COSMOS_HOME_POSE: CameraPose = DEFAULT_HOME;

/** Half-extents of one primitive, in its own units. */
export function partExtent(shape: string, size: Record<string, number>): Vec3 {
  const w = size.width ?? size.radius ?? size.radiusTop ?? 0.1;
  const h = size.height ?? size.radius ?? 0.1;
  const d = size.depth ?? size.radius ?? 0.1;
  switch (shape) {
    case "box":
      return [Math.max(w, 1e-4) / 2, Math.max(h, 1e-4) / 2, Math.max(d, 1e-4) / 2];
    case "plane":
      return [Math.max(w, 1e-4) / 2, 1e-3, Math.max(size.height ?? d, 1e-4) / 2];
    case "cylinder":
    case "cone":
    case "capsule":
      return [Math.max(size.radius ?? w, 1e-4), Math.max(size.height ?? h, 1e-4) / 2, Math.max(size.radius ?? d, 1e-4)];
    case "torus":
      return [
        Math.max((size.radius ?? 0.1) + (size.tube ?? 0.02), 1e-4),
        Math.max((size.radius ?? 0.1) + (size.tube ?? 0.02), 1e-4),
        Math.max(size.tube ?? 0.02, 1e-4),
      ];
    default:
      // sphere, icosahedron, dodecahedron, octahedron and anything unknown
      return [Math.max(size.radius ?? w ?? 0.05, 1e-4), Math.max(size.radius ?? h ?? 0.05, 1e-4), Math.max(size.radius ?? d ?? 0.05, 1e-4)];
  }
}

/** The box around one object's own geometry, in Cosmos world units. */
export function objectBounds(object: CosmosObject): Bounds3 {
  return boundsOfList([object]) as Bounds3;
}

/** The box around a set of objects, each with its own frame applied. */
export function boundsOfList(objects: CosmosObject[]): Bounds3 | null {
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  let any = false;
  for (const object of objects) {
    if (!object.visible) continue;
    const s = object.frame.scale;
    for (const part of object.scene.objects) {
      const [ex, ey, ez] = partExtent(part.shape, part.size ?? {});
      const cx = object.frame.position[0] + part.position[0] * s;
      const cy = object.frame.position[1] + part.position[1] * s;
      const cz = object.frame.position[2] + part.position[2] * s;
      min[0] = Math.min(min[0], cx - ex * s);
      min[1] = Math.min(min[1], cy - ey * s);
      min[2] = Math.min(min[2], cz - ez * s);
      max[0] = Math.max(max[0], cx + ex * s);
      max[1] = Math.max(max[1], cy + ey * s);
      max[2] = Math.max(max[2], cz + ez * s);
      any = true;
    }
  }
  if (!any) return null;
  return finish(min, max);
}

/** An object plus the objects inside it, which is what "the assembly" means. */
export function assemblyOf(object: CosmosObject, all: CosmosObject[]): CosmosObject[] {
  const out: CosmosObject[] = [object];
  const byId = new Map(all.map((o) => [o.id, o]));
  const walk = (id: string) => {
    const current = byId.get(id);
    if (!current) return;
    for (const childId of current.children) {
      const child = byId.get(childId);
      if (!child) continue;
      out.push(child);
      walk(child.id);
    }
  };
  walk(object.id);
  return out;
}

function finish(min: Vec3, max: Vec3): Bounds3 {
  const center: Vec3 = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
  const half: Vec3 = [(max[0] - min[0]) / 2, (max[1] - min[1]) / 2, (max[2] - min[2]) / 2];
  // The sphere around the box: fitting the sphere guarantees none of the box
  // is cut off, however the camera is later orbited.
  const radius = Math.max(0.25, Math.hypot(half[0], half[1], half[2]));
  return { min, max, center, radius };
}

/**
 * Where to stand so `bounds` fits inside the viewport, from a slightly high
 * three-quarter-ish direction that matches the Cosmos' own default view.
 */
export function framePose(bounds: Bounds3, viewport: CameraViewport, opts?: { padding?: number; direction?: Vec3 }): CameraPose {
  const padding = Math.min(4, Math.max(1.05, opts?.padding ?? 1.35));
  const vFov = (Math.min(170, Math.max(10, viewport.fov || 55)) * Math.PI) / 180;
  const aspect = Math.min(8, Math.max(0.2, viewport.aspect || 1));
  const hFov = 2 * Math.atan(Math.tan(vFov / 2) * aspect);
  // The tighter of the two axes decides: a narrow phone in portrait must back
  // off further than a wide desktop, or the object is clipped at the sides.
  /*
   * Fit the BOX, axis by axis — not the sphere around it. The sphere is
   * dominated by the object's tallest measurement, and on a portrait phone
   * (horizontal FOV is the narrow one) spreading that height across the
   * narrow axis parked the camera 11 m from a 1.8 m chair: framed by the
   * numbers, 100 px on screen, read as "the object did not render".
   */
  const half: Vec3 = [
    Math.max(1e-3, (bounds.max[0] - bounds.min[0]) / 2),
    Math.max(1e-3, (bounds.max[1] - bounds.min[1]) / 2),
    Math.max(1e-3, (bounds.max[2] - bounds.min[2]) / 2),
  ];
  const fitWidth = half[0] / Math.tan(hFov / 2);
  const fitHeight = half[1] / Math.tan(vFov / 2);
  const reach = Math.max(fitWidth, fitHeight) * padding + half[2];
  const distance = Math.max(0.6, reach);
  const dir = normalize(opts?.direction ?? [0, 0.22, 1]);
  return {
    position: [bounds.center[0] + dir[0] * distance, bounds.center[1] + dir[1] * distance, bounds.center[2] + dir[2] * distance],
    lookAt: bounds.center,
    distance,
    fill: Math.min(1, Math.max(fitWidth, fitHeight) * padding / distance),
  };
}

/** Move the camera in or out along the same view direction. */
export function zoomPose(pose: CameraPose, factor: number): CameraPose {
  const k = Math.min(4, Math.max(0.2, factor || 1));
  const dx = pose.position[0] - pose.lookAt[0];
  const dy = pose.position[1] - pose.lookAt[1];
  const dz = pose.position[2] - pose.lookAt[2];
  const distance = Math.max(0.15, pose.distance / k);
  const scale = distance / Math.max(0.0001, pose.distance);
  return {
    position: [pose.lookAt[0] + dx * scale, pose.lookAt[1] + dy * scale, pose.lookAt[2] + dz * scale],
    lookAt: pose.lookAt,
    distance,
    fill: pose.fill,
  };
}

/**
 * The pose for a request, or the reason it cannot be honoured. Everything is
 * computed here, so the bridge in the scene only has to fly the camera.
 */
export function poseFor(
  request: CosmosCameraRequest,
  objects: CosmosObject[],
  viewport: CameraViewport,
  previous: CameraPose | null,
): { ok: true; pose: CameraPose; subject: string } | { ok: false; reason: string } {
  const visible = objects.filter((o) => o.visible && (o.place === "cosmos" || o.place === "gallery"));
  const find = (ref?: string) => {
    if (!ref) return undefined;
    const q = ref.toLowerCase();
    return (
      visible.find((o) => o.id === ref) ??
      [...visible].reverse().find((o) => o.name.toLowerCase().includes(q))
    );
  };
  switch (request.mode) {
    case "home":
      return { ok: true, pose: COSMOS_HOME_POSE, subject: "the home view" };
    case "previous":
      if (!previous) return { ok: false, reason: "there is no earlier camera position to go back to yet" };
      return { ok: true, pose: previous, subject: "the previous view" };
    case "all": {
      if (!visible.length) return { ok: false, reason: "there are no objects to frame — the Cosmos is waiting for one" };
      const bounds = boundsOfList(visible);
      if (!bounds) return { ok: false, reason: "the objects have no geometry to frame" };
      return { ok: true, pose: framePose(bounds, viewport, { padding: 1.45 }), subject: `all ${visible.length} objects` };
    }
    case "focus":
    case "selected":
    case "zoom":
    case "assembly": {
      // The caller passes the object it means ("selected" is resolved to an id
      // by the tool); with no object named, the newest one is the subject.
      const ref = request.object;
      const target = ref ? find(ref) : visible[visible.length - 1];
      if (!target) return { ok: false, reason: ref ? `nothing in the Cosmos matches “${ref}”` : "nothing is selected and there is nothing to focus" };
      const set = request.mode === "assembly" ? assemblyOf(target, visible) : [target];
      const bounds = boundsOfList(set);
      if (!bounds) return { ok: false, reason: `“${target.name}” has no visible geometry` };
      const base = framePose(bounds, viewport, { padding: request.mode === "zoom" ? 1.1 : 1.5 });
      if (request.mode !== "zoom") return { ok: true, pose: base, subject: `“${target.name}”${set.length > 1 ? ` and the ${set.length - 1} object(s) inside it` : ""}` };
      return { ok: true, pose: zoomPose(base, request.factor ?? 1.6), subject: `closer on “${target.name}”` };
    }
    default:
      return { ok: false, reason: `unknown camera mode “${request.mode}”` };
  }
}

function normalize(v: Vec3): Vec3 {
  const len = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / len, v[1] / len, v[2] / len];
}

/* ------------------------------------------------------------------ */
/* the bus: tools and UI ask, the scene answers                        */
/* ------------------------------------------------------------------ */

type Listener = (request: CosmosCameraRequest) => void;

/**
 * A camera request is an intent, not a command to a particular canvas: the
 * bridge inside the Cosmos scene is the only listener, and it is also the
 * only place that knows the camera's fov and the viewport's aspect. If no
 * scene is mounted, the request simply has no listener — and the tool says
 * so rather than claiming the camera moved.
 */
class CosmosCameraBusImpl {
  private listeners = new Set<Listener>();

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  get live(): boolean {
    return this.listeners.size > 0;
  }

  request(request: CosmosCameraRequest): boolean {
    for (const listener of this.listeners) {
      try {
        listener(request);
      } catch {
        /* a broken listener must not break the Cosmos */
      }
    }
    return this.listeners.size > 0;
  }
}

export const cosmosCameraBus = new CosmosCameraBusImpl();

/* ------------------------------------------------------------------ */
/* the view: opening and closing the Cosmos itself                     */
/* ------------------------------------------------------------------ */

export interface CosmosViewRequest {
  mode: "open" | "close";
  /** frame the objects as soon as the scene is up */
  frame?: boolean;
}

type ViewListener = (request: CosmosViewRequest) => void;

/**
 * Opening the Cosmos is an app-level transition (close the conversation, go
 * home, hide the dashboard, frame the objects). Core code asks for it here
 * instead of reaching into the UI stores, so the tool stays a tool and the
 * transition stays in one place.
 */
class CosmosViewBusImpl {
  private listeners = new Set<ViewListener>();

  subscribe(listener: ViewListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  get live(): boolean {
    return this.listeners.size > 0;
  }

  request(request: CosmosViewRequest): boolean {
    for (const listener of this.listeners) {
      try {
        listener(request);
      } catch {
        /* a broken listener must not break the Cosmos */
      }
    }
    return this.listeners.size > 0;
  }
}

export const cosmosViewBus = new CosmosViewBusImpl();
