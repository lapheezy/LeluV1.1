/**
 * ==========================================================
 * LÉLU — CREATIVE MANIPULATION GESTURE LOCK
 *
 * One shared flag: while the person is dragging a creative
 * object, the Cosmos camera must not also orbit. The camera rig
 * reads this in its own pointer handlers, so there is exactly one
 * answer to "is this gesture for the object or for the camera?".
 *
 * Nothing here holds scene state — it is a gesture mutex, not an
 * object authority.
 * ==========================================================
 */

let active = false;
const listeners = new Set<(active: boolean) => void>();

export function beginCreativeGesture(): void {
  if (active) return;
  active = true;
  for (const listener of listeners) listener(true);
}

export function endCreativeGesture(): void {
  if (!active) return;
  active = false;
  for (const listener of listeners) listener(false);
}

export function isCreativeGesture(): boolean {
  return active;
}

export function subscribeCreativeGesture(listener: (active: boolean) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/* ---------------- selection and focus (owned by core) ---------------- */

export {
  getCreativeSelection,
  selectCreativeObject,
  subscribeCreativeSelection,
  requestCreativeFocus,
  subscribeCreativeFocus,
  hasCreativeFocusListener,
  type CreativeSelection,
} from "../../../../core/couture/selection";

/** Editing mode for the on-canvas manipulation. */
export type CreativeTool = "select" | "move" | "rotate" | "scale";

/**
 * The live camera, published by the creative layer so the dock can put a new
 * creation where the person is actually looking instead of at a hard-coded
 * corner of the universe.
 */
type CameraLike = {
  position: { x: number; y: number; z: number };
  /** The camera's forward axis. Supplied by the layer, which owns the THREE camera. */
  getDirection: () => { x: number; y: number; z: number };
};

let liveCamera: CameraLike | null = null;

export function setCreativeCamera(camera: CameraLike | null): void {
  liveCamera = camera;
}

/** Creative-store millimetres (z-up) for a point `metres` in front of the eye. */
export function creativePlacementInFront(metres = 2.2, side = 0): [number, number, number] | null {
  if (!liveCamera) return null;
  const dir = liveCamera.getDirection();
  const length = Math.hypot(dir.x, dir.y, dir.z) || 1;
  const fx = dir.x / length;
  const fy = dir.y / length;
  const fz = dir.z / length;
  // Right-hand horizontal perpendicular: forward × up.
  const rightX = -fz;
  const rightZ = fx;
  const rightLength = Math.hypot(rightX, rightZ) || 1;
  const x = liveCamera.position.x + fx * metres + (rightX / rightLength) * side;
  const y = liveCamera.position.y + fy * metres;
  const z = liveCamera.position.z + fz * metres + (rightZ / rightLength) * side;
  return [x * 1000, -z * 1000, y * 1000];
}
let tool: CreativeTool = "select";
const toolListeners = new Set<(tool: CreativeTool) => void>();

export function getCreativeTool(): CreativeTool {
  return tool;
}

export function setCreativeTool(next: CreativeTool): void {
  if (tool === next) return;
  tool = next;
  for (const listener of toolListeners) listener(next);
}

export function subscribeCreativeTool(listener: (tool: CreativeTool) => void): () => void {
  toolListeners.add(listener);
  return () => {
    toolListeners.delete(listener);
  };
}
