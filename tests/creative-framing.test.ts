/**
 * Regression for the \"Focus frames the floor\" defect (M16.3 WP02).
 *
 * The dock used to fly the camera to `origin + 0.5 m` and aim at the origin.
 * A chair's origin is the floor between its legs and its seat sits ~0.45 m
 * above it, so at 0.5 m the seat was ~42 degrees off-axis — outside the 49 and
 * 46 degree vertical fields of view the scene uses — and Focus showed the
 * floor. Framing is now derived from the object's own bounding radius.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { frameForBounds } from "../src/core/couture/sceneTransform";

const HALF_FOV = 46 / 2; // degrees, the narrowest vertical field in the scene

test("a chair-sized object is framed whole, not clipped", () => {
  const centre: [number, number, number] = [0, 0.45, 0];
  const radius = 0.35; // half the diagonal of a ~0.47 m chair
  const { eye, centre: target, distance } = frameForBounds(centre, radius, [0, 0, -1]);

  // The camera sits back along the viewing direction, not on top of the object.
  assert.equal(target[0], centre[0]);
  assert.ok(distance >= radius * 2.6, `distance ${distance} must scale with the object`);

  // The worst-case point on the bounding sphere is inside the frustum.
  const angularRadius = (Math.atan(radius / distance) * 180) / Math.PI;
  assert.ok(angularRadius < HALF_FOV, `angular radius ${angularRadius.toFixed(1)} must sit inside ${HALF_FOV}`);

  // And the eye is in front of the object, on the requested side.
  assert.ok(eye[2] > centre[2], "camera must be on the +z side when looking along -z");
  assert.ok(Math.abs(eye[1] - centre[1]) < 1e-9, "a level view must stay level");
});

test("a 26 mm pendant is not left as a dot", () => {
  const { distance } = frameForBounds([0, 0, 0], 0.018, [0, 0, -1]);
  assert.ok(distance >= 0.85, "small objects get a minimum working distance");
});

test("a large object pushes the camera back instead of clipping", () => {
  const radius = 3;
  const { distance } = frameForBounds([0, 1, 0], radius, [0, 0, -1]);
  assert.ok(distance >= radius * 2.6);
});

test("a degenerate direction still yields a usable camera", () => {
  const { eye, distance } = frameForBounds([1, 2, 3], 0.2, [0, 0, 0]);
  assert.ok(Number.isFinite(eye[0]) && Number.isFinite(eye[1]) && Number.isFinite(eye[2]));
  assert.ok(distance > 0);
});
