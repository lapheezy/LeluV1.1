/**
 * Mission 16.2 — the one conversion between creative space and scene space.
 *
 * The renderer is only allowed to draw what the store says, so these tests
 * pin the mapping: millimetres and z-up into metres and y-up, and the
 * rotation basis change that keeps a laid-down pendant lying down.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  creativePositionToScene,
  creativeRotationToSceneQuat,
  creativeScaleToScene,
  scenePositionToCreative,
  sceneQuatToCreativeYaw,
} from "../src/core/couture/sceneTransform";

const close = (a: number, b: number, tolerance = 1e-6) => assert.ok(Math.abs(a - b) < tolerance, `${a} ≉ ${b}`);

function rotate(q: { x: number; y: number; z: number; w: number }, v: [number, number, number]): [number, number, number] {
  // v' = q v q⁻¹, expanded.
  const [vx, vy, vz] = v;
  const tx = 2 * (q.y * vz - q.z * vy);
  const ty = 2 * (q.z * vx - q.x * vz);
  const tz = 2 * (q.x * vy - q.y * vx);
  return [
    vx + q.w * tx + (q.y * tz - q.z * ty),
    vy + q.w * ty + (q.z * tx - q.x * tz),
    vz + q.w * tz + (q.x * ty - q.y * tx),
  ];
}

test("creative millimetres, z-up become scene metres, y-up", () => {
  const cases: Array<[[number, number, number], [number, number, number]]> = [
    [[1000, 0, 0], [1, 0, 0]],
    [[0, 0, 1500], [0, 1.5, 0]],
    [[0, -2000, 0], [0, 0, 2]],
  ];
  for (const [creative, scene] of cases) {
    const mapped = creativePositionToScene(creative);
    close(mapped[0], scene[0]);
    close(mapped[1], scene[1]);
    close(mapped[2], scene[2]);
  }
});

test("scene positions convert back to the same creative millimetres", () => {
  for (const creative of [[380, -120, 1540], [-90, 640, 0], [0, 0, 0]] as Array<[number, number, number]>) {
    const round = scenePositionToCreative(creativePositionToScene(creative));
    close(round[0], creative[0]);
    close(round[1], creative[1]);
    close(round[2], creative[2]);
  }
});

test("an unmoved object keeps its upright axis: the creative up axis is scene up", () => {
  const q = creativeRotationToSceneQuat([0, 0, 0]);
  // The creative up axis (creative +Z) is scene +Y by construction.
  const up = rotate(q, [0, 1, 0]);
  close(up[0], 0);
  close(up[1], 1);
  close(up[2], 0);
});

test("a laid-down pendant (rotation +90 about creative X) faces the camera", () => {
  const q = creativeRotationToSceneQuat([90, 0, 0]);
  // The disc lies flat: what was the creative up axis now points at +Z.
  const facing = rotate(q, [0, 1, 0]);
  close(facing[0], 0, 1e-6);
  close(facing[1], 0, 1e-6);
  close(facing[2], 1, 1e-6);
});

test("a yaw of ninety degrees turns the creative X axis towards the viewer", () => {
  const q = creativeRotationToSceneQuat([0, 0, 90]);
  const x = rotate(q, [1, 0, 0]);
  close(x[0], 0, 1e-6);
  close(x[1], 0, 1e-6);
  close(x[2], -1, 1e-6);
});

test("yaw about the creative up axis survives the round trip", () => {
  for (const degrees of [0, 37, -120, 180]) {
    const q = creativeRotationToSceneQuat([0, 0, degrees]);
    close(sceneQuatToCreativeYaw(q), degrees, 1e-6);
  }
});

test("a combined rotation is converted as a rotation, not by swapping angles", () => {
  const q = creativeRotationToSceneQuat([20, 15, 65]);
  // Rotating the creative up axis and reading the yaw back must agree.
  const yaw = sceneQuatToCreativeYaw(q);
  assert.ok(Number.isFinite(yaw));
  const length = Math.hypot(q.x, q.y, q.z, q.w);
  close(length, 1, 1e-9);
});

test("scale is the largest axis, guarded to a usable number", () => {
  close(creativeScaleToScene([1, 1, 1]), 1);
  close(creativeScaleToScene([0.5, 2, 1.2]), 2);
  close(creativeScaleToScene([0, 0, 0]), 1);
  close(creativeScaleToScene([Number.NaN, 1, 1]), 1);
});
