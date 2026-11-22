/**
 * ==========================================================
 * LÉLUVERSE — CAMERA FLIGHT
 *
 * The smooth camera + OrbitControls flight GenesisCameraController
 * runs for `cosmos-navigate` and `planet-navigate`. Moved here
 * unchanged from the controller so it can be tested without the
 * scene, plus the two rules it was missing:
 *
 *   1. ONE flight at a time. Each call used to start its own
 *      requestAnimationFrame loop and nothing stopped the last one,
 *      so two navigations in quick succession (a minimap tap, then
 *      LÉLU's navigate, or a ring tap followed by its room's arrival)
 *      left two loops lerping the same camera toward different
 *      targets until the older one ran out.
 *   2. The USER wins. A flight stops the moment the user takes the
 *      camera (cameraOwnership says "user"); a cinematic claim does
 *      not stop it — that is LÉLU, not the user.
 *
 * OrbitControls remains the only controller; this only moves the
 * camera and its target through it.
 * ==========================================================
 */

import type { PerspectiveCamera, Vector3 } from "three";
import { cameraOwner } from "./cameraOwnership";

interface FlightControls {
  target: Vector3;
  update: () => unknown;
}

let activeFlight = 0;
let flying = false;

/** Cancel whichever flight is in progress (if any). */
export function cancelCameraFlight(): void {
  activeFlight += 1;
  flying = false;
}

/** True while a flight started by flyCameraTo is still moving the camera. */
export function cameraFlightActive(): boolean {
  return flying;
}

/** Smoothly fly the camera + OrbitControls target to a destination. */
export function flyCameraTo(
  camera: PerspectiveCamera,
  controls: FlightControls,
  targetPos: Vector3,
  lookAt: Vector3,
  duration = 1.5,
  frame: (cb: () => void) => unknown = (cb) => requestAnimationFrame(cb),
  now: () => number = () => performance.now(),
): void {
  const id = ++activeFlight;
  const startPos = camera.position.clone();
  const startTarget = controls.target.clone();
  let progress = 0;
  let lastTime = now();
  flying = true;

  function animate() {
    if (id !== activeFlight) return; // superseded by a newer flight
    if (cameraOwner() === "user") {
      flying = false;
      return; // the user took the camera
    }
    const t1 = now();
    const dt = (t1 - lastTime) / 1000;
    lastTime = t1;
    progress += dt / duration;
    const t = Math.min(1, progress);
    const ease = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;

    camera.position.lerpVectors(startPos, targetPos, ease);
    controls.target.lerpVectors(startTarget, lookAt, ease);
    controls.update();

    if (t < 1) {
      frame(animate);
    } else {
      flying = false;
    }
  }
  frame(animate);
}
