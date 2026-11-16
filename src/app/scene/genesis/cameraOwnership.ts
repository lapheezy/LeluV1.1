/**
 * ==========================================================
 * LÉLU — CAMERA OWNERSHIP
 *
 * Three things can move the v1 camera, and until now they had no shared
 * rule about who was allowed to:
 *
 *   cinematic   — a reveal is framing an object the user asked for, and
 *                 that view has to survive chat opening and closing or the
 *                 framed object is lost exactly when it is being talked about
 *   user        — the user dragged, wheeled or panned: the camera is theirs
 *   autonomous  — nothing is holding it, so exploration and the presence
 *                 engine may drift the view
 *
 * The bug this fixes: opening chat ended the cinematic hold, so returning
 * to the world let the autonomous systems drift the camera away from the
 * object that had just been framed (and the cosmos rotation moved the
 * target), producing a different view every time chat closed.
 *
 * The rule: a cinematic claim lasts until the USER takes the camera. Chat
 * opening is not the user taking the camera; a new reveal replaces the
 * claim; letting go of a drag returns ownership to autonomous motion.
 * ==========================================================
 */

export type CameraOwner = "cinematic" | "user" | "autonomous";

type Listener = (owner: CameraOwner) => void;

let owner: CameraOwner = "autonomous";
const listeners = new Set<Listener>();

function dispatch(name: "genesis-user-camera-start" | "genesis-user-camera-end"): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(name));
}

function set(next: CameraOwner): void {
  if (owner === next) return;
  owner = next;
  if (typeof window !== "undefined") {
    (window as unknown as { __leluCameraOwner?: CameraOwner }).__leluCameraOwner = owner;
  }
  for (const listener of [...listeners]) listener(owner);
}

export function cameraOwner(): CameraOwner {
  return owner;
}

export function subscribeCameraOwner(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** A reveal frames an object and holds the view, across surfaces. */
export function claimCinematicCamera(): void {
  set("cinematic");
  dispatch("genesis-user-camera-start");
}

/** The user deliberately took the camera: the cinematic claim is over. */
export function noteUserCameraStart(): void {
  set("user");
  dispatch("genesis-user-camera-start");
}

/** The user let go: nobody is holding the camera, autonomous may resume. */
export function noteUserCameraEnd(): void {
  if (owner !== "user") return;
  set("autonomous");
  dispatch("genesis-user-camera-end");
}

/** Explicit release (e.g. leaving the world), only if a reveal owns it. */
export function releaseCinematicCamera(): void {
  if (owner !== "cinematic") return;
  set("autonomous");
  dispatch("genesis-user-camera-end");
}

export function resetCameraOwnershipForTests(): void {
  owner = "autonomous";
  listeners.clear();
}
