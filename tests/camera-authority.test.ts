/**
 * Mission 17, WP04 — who may move the camera.
 *
 * The defect these pin: a framed view did not survive. The planet-return drift
 * eased the controls target back to the origin from anywhere in the Cosmos, and
 * an interrupted spatial transition kept re-publishing its frozen pose (and
 * held OrbitControls disabled), so objects slid out of frame with nobody
 * touching anything and taps landed where the object used to be.
 *
 * These tests are about the DECISION each writer has to ask for before it
 * touches the camera — not about whether a request was issued.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { driftHasWork, driftMayMove, spatialMayPose } from "../src/app/scene/genesis/cameraAuthority";
import {
  cameraOwner,
  claimCinematicCamera,
  noteUserCameraEnd,
  noteUserCameraStart,
  releaseCinematicCamera,
  resetCameraOwnershipForTests,
} from "../src/app/scene/genesis/cameraOwnership";
import SpatialRuntime from "../src/app/scene/spatial/SpatialRuntime";
import { PLANET_RADIUS } from "../src/app/scene/genesis/render/PlanetExplorer";

const NEAR_PLANET = PLANET_RADIUS + 5;

/* ------------------------------------------------------------------ */
/* a transition may pose the camera only while it is actually flying    */
/* ------------------------------------------------------------------ */

test("an interrupted flight stops posing the camera for good", () => {
  assert.equal(spatialMayPose({ interrupted: false }, "autonomous"), true);
  // The flight stopped where it stopped: it must never write again, or it
  // overwrites whatever the user or a reveal did after the interruption.
  assert.equal(spatialMayPose({ interrupted: true }, "autonomous"), false);
});

test("a reveal outranks an older flight", () => {
  assert.equal(spatialMayPose({ interrupted: false }, "cinematic"), false);
  assert.equal(
    spatialMayPose({ interrupted: false }, "user"),
    true,
    "a hand on the camera does not cancel a flight that is still travelling",
  );
});

test("with no flight at all, nothing is posed", () => {
  assert.equal(spatialMayPose(null, "autonomous"), false);
  assert.equal(spatialMayPose(null, "cinematic"), false);
});

/* ------------------------------------------------------------------ */
/* the planet drift is local, and yields                               */
/* ------------------------------------------------------------------ */

test("the planet drift cannot run out in the Cosmos", () => {
  // Standing off the ring, framing objects: the camera is nowhere near the
  // planet, so the drift must not ease anything. This is the write that used
  // to drag a framed view back to the origin.
  assert.equal(driftMayMove("autonomous", 14, NEAR_PLANET), false);
  assert.equal(driftMayMove("autonomous", 30, NEAR_PLANET), false);
  // Descending into the planet it exists to serve: allowed.
  assert.equal(driftMayMove("autonomous", PLANET_RADIUS + 1, NEAR_PLANET), true);
});

test("a reveal or a hand silences the drift even near the planet", () => {
  assert.equal(driftMayMove("cinematic", PLANET_RADIUS + 1, NEAR_PLANET), false);
  assert.equal(driftMayMove("user", PLANET_RADIUS + 1, NEAR_PLANET), false);
});

test("the drift stops once its target is already home", () => {
  assert.equal(driftHasWork([0, 0, 0]), false);
  assert.equal(driftHasWork([1e-4, 0, 0]), false);
  assert.equal(driftHasWork([0.4, 0.2, -0.3]), true);
});

test("bad numbers never authorise a camera write", () => {
  assert.equal(driftMayMove("autonomous", Number.NaN, NEAR_PLANET), false);
  assert.equal(driftMayMove("autonomous", 1, Number.POSITIVE_INFINITY), false);
  assert.equal(driftHasWork([Number.NaN, 0, 0]), false);
});

/* ------------------------------------------------------------------ */
/* the claim the writers read                                          */
/* ------------------------------------------------------------------ */

test("a reveal holds the camera until the user takes it", () => {
  resetCameraOwnershipForTests();
  claimCinematicCamera();
  assert.equal(cameraOwner(), "cinematic");
  // A reveal is ended by a user gesture or an explicit release — not by chat
  // opening, and not by another frame.
  assert.equal(driftMayMove(cameraOwner(), 1, NEAR_PLANET), false);
  noteUserCameraStart();
  assert.equal(cameraOwner(), "user");
  noteUserCameraEnd();
  assert.equal(cameraOwner(), "autonomous");

  claimCinematicCamera();
  releaseCinematicCamera();
  assert.equal(cameraOwner(), "autonomous");
  resetCameraOwnershipForTests();
});

/* ------------------------------------------------------------------ */
/* the runtime stops being a writer when interrupted                   */
/* ------------------------------------------------------------------ */

test("an interrupted runtime does not move its camera pose on later events", () => {
  SpatialRuntime.resetForTests();
  const runtime = SpatialRuntime.getInstance();
  runtime.start("core");
  runtime.travel("galaxy");
  assert.ok(runtime.getState().transition, "the flight started");

  const midFlight = { ...runtime.getState().camera.position };
  runtime.interrupt();
  const stopped = { ...runtime.getState().camera.position };
  assert.equal(runtime.getState().transition?.interrupted, true);
  assert.equal(spatialMayPose(runtime.getState().transition, "autonomous"), false);

  // Notifications that used to re-apply the frozen pose.
  runtime.hover("galaxy");
  runtime.hover(null);
  runtime.setSpatialUI("focused");
  assert.deepEqual(runtime.getState().camera.position, stopped, "the pose is frozen, not re-applied");

  // Straightening the flight up again makes it a writer once more.
  runtime.resume();
  assert.equal(spatialMayPose(runtime.getState().transition, "autonomous"), true);
  SpatialRuntime.resetForTests();
});
