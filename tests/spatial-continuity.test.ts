/**
 * Phase 2.7 — the two continuities that outlive a surface.
 *
 * The camera memory is what makes \"chat closed, the world is back\" mean the
 * same view rather than the opening composition; the companion dock is what
 * keeps the world actually visible on a phone. Both are pure enough to test
 * without a canvas.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  forgetCameraPose,
  recallCameraPose,
  rememberCameraPose,
} from "../src/app/scene/genesis/cameraPoseMemory";
import * as dockGeometry from "../src/app/scene/genesis/avatar/companionDock";

test("a remembered view comes back exactly as it was left", () => {
  forgetCameraPose();
  rememberCameraPose({ position: [5.38, 0.65, 7.9], target: [2.2, -1.35, 2.2], fov: 52 });
  const pose = recallCameraPose();
  assert.ok(pose);
  assert.deepEqual(pose.position, [5.38, 0.65, 7.9]);
  assert.deepEqual(pose.target, [2.2, -1.35, 2.2]);
  assert.equal(pose.fov, 52);
});

test("a world that was never left has nothing to restore", () => {
  forgetCameraPose();
  assert.equal(recallCameraPose(), null);
});

test("an unusable pose is refused instead of poisoning the camera", () => {
  forgetCameraPose();
  rememberCameraPose({ position: [Number.NaN, 0, 0], target: [0, 0, 0] });
  assert.equal(recallCameraPose(), null, "NaN position");
  rememberCameraPose({ position: [1, 1, 1], target: [1, 1, 1] });
  assert.equal(recallCameraPose(), null, "camera sitting on its target has no view direction");
  rememberCameraPose({ position: [0, 0, 6], target: [0, 0, 0], fov: 400 });
  const pose = recallCameraPose();
  assert.ok(pose);
  assert.equal(pose.fov, undefined, "an impossible field of view is dropped, not clamped");
});

test("her window steps out of the frame while the world is being looked at", () => {
  const { immersiveDock, IMMERSIVE_DOCK } = dockGeometry;
  for (const viewport of [
    { width: 375, height: 812 },
    { width: 390, height: 844 },
    { width: 430, height: 932 },
  ]) {
    const dock = immersiveDock(viewport);
    assert.equal(dock.width, IMMERSIVE_DOCK.width);
    assert.equal(dock.left + dock.width, viewport.width - 12, "clear of the right edge");
    assert.ok(dock.top + dock.height <= viewport.height - 116, "above the navigation bar");
    assert.ok(dock.top > viewport.height / 2, "out of the middle of the frame");
    // The footprint she covers while the user is looking at the world.
    assert.ok(dock.width * dock.height < viewport.width * viewport.height * 0.04, "a corner, not a third of the screen");
  }
  const desktop = immersiveDock({ width: 1440, height: 900 });
  assert.ok(desktop.left + desktop.width <= 1440);
});
