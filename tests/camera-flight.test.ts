/**
 * ==========================================================
 * LÉLU — CAMERA FLIGHT: ONE AT A TIME, THE USER WINS
 *
 * CATEGORY: unit. Real three.js vectors and the real camera
 * ownership module; the frame clock is driven by hand.
 * ==========================================================
 */

import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";

if (typeof globalThis.window === "undefined") {
  (globalThis as Record<string, unknown>).window = globalThis;
}
if (typeof (globalThis as Record<string, unknown>).dispatchEvent !== "function") {
  const target = new EventTarget();
  Object.assign(globalThis, {
    addEventListener: target.addEventListener.bind(target),
    removeEventListener: target.removeEventListener.bind(target),
    dispatchEvent: target.dispatchEvent.bind(target),
  });
}
if (typeof (globalThis as Record<string, unknown>).CustomEvent === "undefined") {
  (globalThis as Record<string, unknown>).CustomEvent = class extends Event {
    detail: unknown;
    constructor(type: string, init?: { detail?: unknown }) {
      super(type);
      this.detail = init?.detail;
    }
  };
}

import { PerspectiveCamera, Vector3 } from "three";
import { flyCameraTo, cameraFlightActive, cancelCameraFlight } from "../src/app/scene/genesis/cameraFlight";
import { noteUserCameraEnd, noteUserCameraStart, claimCinematicCamera, cameraOwner } from "../src/app/scene/genesis/cameraOwnership";

/** A hand-driven frame clock: step() runs every queued frame callback once. */
function clock() {
  let t = 0;
  let queue: Array<() => void> = [];
  return {
    now: () => t,
    frame: (cb: () => void) => { queue.push(cb); },
    step(ms: number) {
      t += ms;
      const run = queue;
      queue = [];
      for (const cb of run) cb();
    },
    pending: () => queue.length,
  };
}

function rig() {
  const camera = new PerspectiveCamera();
  camera.position.set(0, 0, 10);
  const controls = { target: new Vector3(0, 0, 0), update: () => undefined };
  return { camera, controls };
}

beforeEach(() => {
  cancelCameraFlight();
  // Return ownership to autonomous whatever the last test left.
  noteUserCameraStart();
  noteUserCameraEnd();
});

test("a flight arrives at its destination", () => {
  const c = clock();
  const { camera, controls } = rig();
  flyCameraTo(camera, controls, new Vector3(5, 0, 0), new Vector3(5, 0, -10), 1, c.frame, c.now);
  assert.equal(cameraFlightActive(), true);
  for (let i = 0; i < 20; i += 1) c.step(100);
  assert.deepEqual(camera.position.toArray(), [5, 0, 0]);
  assert.deepEqual(controls.target.toArray(), [5, 0, -10]);
  assert.equal(cameraFlightActive(), false);
});

test("a newer flight supersedes the older one instead of fighting it", () => {
  const c = clock();
  const { camera, controls } = rig();
  flyCameraTo(camera, controls, new Vector3(100, 0, 0), new Vector3(100, 0, -10), 1, c.frame, c.now);
  c.step(200);
  flyCameraTo(camera, controls, new Vector3(0, 50, 0), new Vector3(0, 50, -10), 1, c.frame, c.now);
  // Only the newest flight keeps scheduling frames.
  c.step(16);
  assert.equal(c.pending(), 1, "exactly one flight loop is alive");
  for (let i = 0; i < 20; i += 1) c.step(100);
  assert.deepEqual(camera.position.toArray(), [0, 50, 0]);
  assert.deepEqual(controls.target.toArray(), [0, 50, -10]);
});

test("the user taking the camera stops a flight where it is", () => {
  const c = clock();
  const { camera, controls } = rig();
  flyCameraTo(camera, controls, new Vector3(100, 0, 0), new Vector3(100, 0, -10), 1, c.frame, c.now);
  c.step(300);
  noteUserCameraStart();
  assert.equal(cameraOwner(), "user");
  const held = camera.position.clone();
  for (let i = 0; i < 20; i += 1) c.step(100);
  assert.deepEqual(camera.position.toArray(), held.toArray(), "the camera stays where the user grabbed it");
  assert.equal(cameraFlightActive(), false);
});

test("LÉLU's cinematic claim is not the user and does not stop a flight", () => {
  const c = clock();
  const { camera, controls } = rig();
  flyCameraTo(camera, controls, new Vector3(5, 0, 0), new Vector3(5, 0, -10), 1, c.frame, c.now);
  c.step(200);
  claimCinematicCamera();
  for (let i = 0; i < 20; i += 1) c.step(100);
  assert.deepEqual(camera.position.toArray(), [5, 0, 0]);
});
