/**
 * Mission 16 — where a new creation is put.
 *
 * Regression for the bug that made the dock look dead: the placement helper
 * used to hand three.js a plain-object shim as the target of
 * `getWorldDirection`, which calls `.normalize()` on it, so every build threw
 * `target.set(...).normalize is not a function` before anything was created.
 * These tests pin the maths and, by using a plain camera, keep the helper free
 * of three.js runtime assumptions.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { creativePlacementInFront, setCreativeCamera } from "../src/app/scene/genesis/cosmos/creativeGesture";

const close = (a: number, b: number, tolerance = 1e-6) => assert.ok(Math.abs(a - b) < tolerance, `${a} ≉ ${b}`);

function cameraAt(position: [number, number, number], forward: [number, number, number]) {
  return {
    position: { x: position[0], y: position[1], z: position[2] },
    getDirection: () => ({ x: forward[0], y: forward[1], z: forward[2] }),
  };
}

test("without a live camera there is no placement to make", () => {
  setCreativeCamera(null);
  assert.equal(creativePlacementInFront(), null);
});

test("a creation lands the requested distance ahead of the eye, in creative millimetres", () => {
  setCreativeCamera(cameraAt([0, 0, 5], [0, 0, -1]));
  const spot = creativePlacementInFront(2.2);
  assert.ok(spot);
  close(spot[0], 0);
  close(spot[1], -2800); // creative Y is -scene Z
  close(spot[2], 0);
});

test("the eye's height becomes the creation's creative height", () => {
  setCreativeCamera(cameraAt([0, 1, 0], [0, 0, -1]));
  const spot = creativePlacementInFront(2);
  assert.ok(spot);
  close(spot[2], 1000); // creative Z is scene Y
  close(spot[1], 2000); // creative Y is −scene Z, so a camera looking down −Z moves it positive
});

test("the sideways step is horizontal, perpendicular to the view", () => {
  setCreativeCamera(cameraAt([0, 0, 5], [0, 0, -1]));
  const left = creativePlacementInFront(2, -1);
  const right = creativePlacementInFront(2, 1);
  assert.ok(left && right);
  close(right[0] - left[0], 2000);
  close(right[1], left[1]);
});

test("a direction that is not unit length does not change the distance", () => {
  setCreativeCamera(cameraAt([0, 0, 5], [0, 0, -7]));
  const spot = creativePlacementInFront(2.2);
  assert.ok(spot);
  close(spot[1], -2800);
});

test("the camera is never asked for anything it does not provide", () => {
  // The exact shape three.js used to be handed: no normalize(), no clone().
  const plain = cameraAt([2, 3, 4], [0, 1, 0]);
  assert.deepEqual(Object.keys(plain).sort(), ["getDirection", "position"]);
  setCreativeCamera(plain);
  const spot = creativePlacementInFront(3);
  assert.ok(spot);
  close(spot[0], 2000);
  close(spot[2], 6000); // 3 m up from y = 3
});
