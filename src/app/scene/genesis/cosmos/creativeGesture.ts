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

/* ---------------- selection ---------------- */

export interface CreativeSelection {
  objectId: string;
  componentId?: string;
}

let selection: CreativeSelection | null = null;
const selectionListeners = new Set<(selection: CreativeSelection | null) => void>();

export function getCreativeSelection(): CreativeSelection | null {
  return selection;
}

export function selectCreativeObject(next: CreativeSelection | null): void {
  if (selection?.objectId === next?.objectId && selection?.componentId === next?.componentId) return;
  selection = next;
  for (const listener of selectionListeners) listener(next);
}

export function subscribeCreativeSelection(listener: (selection: CreativeSelection | null) => void): () => void {
  selectionListeners.add(listener);
  return () => {
    selectionListeners.delete(listener);
  };
}

/** Editing mode for the on-canvas manipulation. */
export type CreativeTool = "select" | "move" | "rotate" | "scale";

/**
 * The live camera, published by the creative layer so the dock can put a new
 * creation where the person is actually looking instead of at a hard-coded
 * corner of the universe.
 */
type CameraLike = {
  position: { x: number; y: number; z: number };
  getWorldDirection: (target: { x: number; y: number; z: number; set: (x: number, y: number, z: number) => unknown }) => unknown;
};

let liveCamera: CameraLike | null = null;

export function setCreativeCamera(camera: CameraLike | null): void {
  liveCamera = camera;
}

/** Creative-store millimetres (z-up) for a point `metres` in front of the eye. */
export function creativePlacementInFront(metres = 2.2, side = 0): [number, number, number] | null {
  if (!liveCamera) return null;
  const dir = { x: 0, y: 0, z: -1, set(x: number, y: number, z: number) { this.x = x; this.y = y; this.z = z; return this; } };
  liveCamera.getWorldDirection(dir);
  const rightX = -dir.z;
  const rightZ = dir.x;
  const length = Math.hypot(rightX, rightZ) || 1;
  const x = liveCamera.position.x + (dir.x / Math.hypot(dir.x, dir.y, dir.z || 1)) * metres + (rightX / length) * side;
  const y = liveCamera.position.y + (dir.y / Math.hypot(dir.x, dir.y, dir.z || 1)) * metres;
  const z = liveCamera.position.z + (dir.z / Math.hypot(dir.x, dir.y, dir.z || 1)) * metres + (rightZ / length) * side;
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
