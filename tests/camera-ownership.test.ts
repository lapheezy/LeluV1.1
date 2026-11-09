import test from "node:test";
import assert from "node:assert/strict";

import {
  cameraOwner,
  claimCinematicCamera,
  noteUserCameraEnd,
  noteUserCameraStart,
  releaseCinematicCamera,
  resetCameraOwnershipForTests,
} from "../src/app/scene/genesis/cameraOwnership";

test("nothing owns the camera until something asks", () => {
  resetCameraOwnershipForTests();
  assert.equal(cameraOwner(), "autonomous");
});

test("a reveal owns the camera and keeps it without further claims", () => {
  resetCameraOwnershipForTests();
  claimCinematicCamera();
  assert.equal(cameraOwner(), "cinematic");
  // Reading the state (as chat opening/closing does) never releases it.
  assert.equal(cameraOwner(), "cinematic");
});

test("a deliberate gesture takes the camera from the reveal", () => {
  resetCameraOwnershipForTests();
  claimCinematicCamera();
  noteUserCameraStart();
  assert.equal(cameraOwner(), "user");
});

test("letting go returns the camera to autonomous motion", () => {
  resetCameraOwnershipForTests();
  claimCinematicCamera();
  noteUserCameraStart();
  noteUserCameraEnd();
  assert.equal(cameraOwner(), "autonomous");
});

test("an explicit release ends a reveal", () => {
  resetCameraOwnershipForTests();
  claimCinematicCamera();
  releaseCinematicCamera();
  assert.equal(cameraOwner(), "autonomous");
});

test("an explicit release never overrides a user who is holding the camera", () => {
  resetCameraOwnershipForTests();
  noteUserCameraStart();
  releaseCinematicCamera();
  assert.equal(cameraOwner(), "user");
});

test("a new reveal takes the camera back from autonomous motion", () => {
  resetCameraOwnershipForTests();
  claimCinematicCamera();
  noteUserCameraStart();
  noteUserCameraEnd();
  claimCinematicCamera();
  assert.equal(cameraOwner(), "cinematic");
});
