/**
 * ==========================================================
 * LÉLU — CAMERA AUTHORITY
 *
 * One question, one answer: may this camera update run?
 *
 * Three things move the v1 camera and, until now, each decided for
 * itself whether it was allowed:
 *
 *   spatial runtime  — a transition publishes a pose per frame
 *   object framing   — a reveal frames the objects the user asked for
 *   planet drift     — the controls target eases back to the origin so a
 *                      descent into the LÉLU planet stays coherent
 *
 * Their rules overlapped, so a framed view was dragged back to the origin
 * by the drift the moment the cinematic claim was released, and an
 * interrupted transition kept publishing its frozen pose forever. The
 * symptom looked like "the camera moves on its own" and "the objects are
 * not where they were drawn".
 *
 * The contract, in the order that decides it:
 *
 *   1. A transition may write only while it is ACTUALLY travelling. An
 *      interrupted transition has stopped; it must not keep posing the
 *      camera, and it must hand OrbitControls back so the user can orbit.
 *   2. A cinematic claim (a reveal, a framing) outranks an older
 *      transition: the newest request wins.
 *   3. The planet drift is a LOCAL correction. It runs only while the
 *      camera is near the planet it is meant to serve, so standing out in
 *      the Cosmos looking at framed objects is never nudged.
 *
 * Pure, so the rules are testable without a browser — and so every writer
 * asks the same question instead of re-deriving it.
 * ==========================================================
 */

import type { CameraOwner } from "./cameraOwnership";

/** The smallest shape of a transition this decision needs. */
export interface TransitionClaim {
  /** True once the flight was interrupted: it is no longer moving. */
  interrupted: boolean;
}

/**
 * May the spatial runtime pose the camera right now?
 *
 * Only while a transition is genuinely in flight, and never while a newer
 * cinematic claim (a reveal) owns the view. An interrupted transition is
 * silent — it stopped where it stopped, and the user has the camera.
 */
export function spatialMayPose(transition: TransitionClaim | null, owner: CameraOwner): boolean {
  if (!transition) return false;
  if (transition.interrupted) return false;
  return owner !== "cinematic";
}

/**
 * May the planet-return drift ease the camera this frame?
 *
 * The drift exists so descending into the planet keeps a sane target. Out in
 * the Cosmos — framing objects at the ring, say — it must not run at all, or
 * every framed view slides back toward the origin. `distance` is the camera's
 * distance to the planet centre and `nearPlanet` the range in which a descent
 * is possible.
 *
 * A cinematic or user claim also silences it: a reveal outranks a nudge, and
 * a hand on the camera outranks both.
 */
export function driftMayMove(owner: CameraOwner, distance: number, nearPlanet: number): boolean {
  if (owner !== "autonomous") return false;
  if (!Number.isFinite(distance) || !Number.isFinite(nearPlanet)) return false;
  return distance < nearPlanet;
}

/**
 * How close to the origin the drift target has to be before nudging it is
 * pointless. Without this the lerp runs forever on a target that is already
 * home, and every one of those frames re-derives the camera from it.
 */
export const DRIFT_EPSILON = 1e-3;

/** Whether the drift still has work to do on this target. */
export function driftHasWork(target: readonly [number, number, number], epsilon = DRIFT_EPSILON): boolean {
  return Math.hypot(target[0], target[1], target[2]) > epsilon;
}
