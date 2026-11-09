/**
 * ==========================================================
 * LÉLU — CAMERA POSE MEMORY
 *
 * The v1 world is unmounted, not hidden, while chat owns a phone screen
 * (surface/Surface: `cosmosRendered` false renders no scene). The graph
 * survives that — it is in memory, not in the canvas — but the camera did
 * not: every remount began at the canvas default pose, so coming back from
 * chat flew the view home even though the user was looking at one object.
 *
 * This remembers the pose the world was left at for the rest of the
 * session. It holds numbers only (no three.js objects), so it can be
 * restored by a controller that has not mounted yet, and it is
 * deliberately NOT persisted across a reload: a reload is a new session,
 * and the world's opening composition is part of the scene, not state.
 * ==========================================================
 */

export interface CameraPose {
  position: [number, number, number];
  target: [number, number, number];
  fov?: number;
  savedAt: number;
}

type Vec3 = [number, number, number];

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function vec3(value: unknown): Vec3 | null {
  if (!Array.isArray(value) || value.length !== 3) return null;
  const [x, y, z] = value;
  if (!finite(x) || !finite(y) || !finite(z)) return null;
  return [x, y, z];
}

let pose: CameraPose | null = null;

/** Remember where the world was left. Invalid numbers are refused, not stored. */
export function rememberCameraPose(next: { position: unknown; target: unknown; fov?: unknown }): void {
  const position = vec3(next.position);
  const target = vec3(next.target);
  if (!position || !target) return;
  // A camera exactly on its target has no view direction; restoring it would
  // leave OrbitControls with a degenerate up vector.
  if (Math.hypot(position[0] - target[0], position[1] - target[1], position[2] - target[2]) < 1e-4) return;
  const fov = finite(next.fov) && next.fov > 0 && next.fov < 180 ? next.fov : undefined;
  pose = { position, target, fov, savedAt: Date.now() };
}

/** The pose to restore, or null for a world that has not been left yet. */
export function recallCameraPose(): CameraPose | null {
  return pose;
}

export function forgetCameraPose(): void {
  pose = null;
}
