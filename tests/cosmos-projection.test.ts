/**
 * ==========================================================
 * MISSION 17 / WP06 — THE COORDINATE CONTRACT
 *
 * Every expected number here is computed from the pinhole model by hand —
 * `halfHeight = distance · tan(fov / 2)` — and NOT by calling the same
 * helper the implementation calls. A test that re-derives the formula and
 * then agrees with itself proves nothing about whether the formula is right.
 *
 * The cases are the ones that actually broke: a canvas smaller than the
 * window, a nonzero offset, a retina buffer, a camera whose matrices are a
 * frame behind, a box behind the camera, a box off the frustum, and a
 * projection that cannot be performed at all.
 * ==========================================================
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { Matrix4, PerspectiveCamera, Vector3 } from "three";

import {
  VIEWPORT_SPACE,
  freshenCamera,
  insideViewport,
  ndcToViewport,
  projectBounds,
  viewportOf,
  viewportToBuffer,
  viewportToCanvasLocal,
  viewportToScreenshot,
  type ViewportBox,
} from "../src/core/cosmos/objects/CosmosProjection";
import type { Bounds3 } from "../src/core/cosmos/objects/CosmosObjectCamera";

const FOV = 50;
const DISTANCE = 10;
const HALF_HEIGHT = DISTANCE * Math.tan((FOV / 2) * (Math.PI / 180)); // 4.6631
const ASPECT = 800 / 600;
const HALF_WIDTH = HALF_HEIGHT * ASPECT; // 6.2174

/** A camera at (0,0,10) looking at the origin, with current matrices. */
function cameraAt(distance = DISTANCE): PerspectiveCamera {
  const camera = new PerspectiveCamera(FOV, ASPECT, 0.1, 1000);
  camera.position.set(0, 0, distance);
  camera.lookAt(0, 0, 0);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
  return camera;
}

function view(opts: Partial<ViewportBox> = {}): ViewportBox {
  return viewportOf(
    { left: 0, top: 0, width: 800, height: 600, ...(opts.left !== undefined ? { left: opts.left } : {}), ...(opts.top !== undefined ? { top: opts.top } : {}) },
    { width: opts.bufferWidth ?? 800, height: opts.bufferHeight ?? 600 },
    opts.dpr,
  );
}

function boxAt(x: number, y: number, z: number, half = 0.5): Bounds3 {
  return {
    min: [x - half, y - half, z - half],
    max: [x + half, y + half, z + half],
    center: [x, y, z],
    radius: Math.sqrt(3) * half,
  };
}

/** Where a world X offset lands on screen, from the pinhole model. */
function expectedX(worldX: number, at: ViewportBox, distance = DISTANCE): number {
  const halfW = distance * Math.tan((FOV / 2) * (Math.PI / 180)) * ASPECT;
  return at.left + at.width / 2 + (worldX / halfW) * (at.width / 2);
}

function expectedY(worldY: number, at: ViewportBox, distance = DISTANCE): number {
  const halfH = distance * Math.tan((FOV / 2) * (Math.PI / 180));
  return at.top + at.height / 2 - (worldY / halfH) * (at.height / 2);
}

/* ------------------------------------------------------- NDC → viewport */

test("the centre of the frustum is the centre of the canvas", () => {
  const at = view();
  assert.deepEqual(ndcToViewport([0, 0, 0], at), { x: 400, y: 300 });
  // +1 is the RIGHT edge horizontally and the TOP edge vertically: NDC's y
  // axis points up while the viewport's points down.
  assert.deepEqual(ndcToViewport([1, 1, 0], at), { x: 800, y: 0 });
  assert.deepEqual(ndcToViewport([-1, -1, 0], at), { x: 0, y: 600 });
});

test("a canvas offset from the window moves every reading by that offset", () => {
  const inside = view();
  const offset = view({ left: 24, top: 96 });
  const a = ndcToViewport([0.25, -0.5, 0], inside)!;
  const b = ndcToViewport([0.25, -0.5, 0], offset)!;
  assert.equal(b.x, a.x + 24);
  assert.equal(b.y, a.y + 96);
});

test("a non-finite NDC is refused, never rounded into the viewport", () => {
  const at = view();
  assert.equal(ndcToViewport([NaN, 0, 0], at), null);
  assert.equal(ndcToViewport([0, Infinity, 0], at), null);
});

/* ------------------------------------------------- world → viewport */

test("a world point lands where the pinhole model says, from the live camera", () => {
  const at = view();
  const projected = projectBounds(cameraAt(), boxAt(2, 0, 0, 0.0001), at);
  assert.equal(projected.space, VIEWPORT_SPACE);
  assert.equal(projected.failure, null);
  assert.ok(Math.abs(projected.center!.x - expectedX(2, at)) < 0.05, `${projected.center!.x} vs ${expectedX(2, at)}`);
  assert.ok(Math.abs(projected.center!.y - expectedY(0, at)) < 0.05);
});

test("a box projects to the rectangle its own corners describe", () => {
  const at = view();
  const projected = projectBounds(cameraAt(), boxAt(0, 0, 0), at);
  const [left, top, right, bottom] = projected.bounds!;
  /*
   * The extent is set by the NEAREST face, not by the box centre: the
   * corners at z = +0.5 are 9.5 m away, so they project 5% wider than a
   * point at the centre's 10 m. Getting this wrong in the expectation is
   * what a "box fits its corners" test is for.
   */
  const nearHalfH = (DISTANCE - 0.5) * Math.tan((FOV / 2) * (Math.PI / 180));
  const nearHalfW = nearHalfH * ASPECT;
  const halfW = (0.5 / nearHalfW) * (at.width / 2);
  const halfH = (0.5 / nearHalfH) * (at.height / 2);
  assert.ok(Math.abs(left - (400 - halfW)) < 0.05, `${left} vs ${400 - halfW}`);
  assert.ok(Math.abs(right - (400 + halfW)) < 0.05);
  assert.ok(Math.abs(top - (300 - halfH)) < 0.05);
  assert.ok(Math.abs(bottom - (300 + halfH)) < 0.05);
  // The centre is the centre of the BOX, not the object's origin.
  assert.ok(Math.abs(projected.center!.x - 400) < 0.05);
});

test("the parent transform is applied, and only once", () => {
  const at = view();
  const plain = projectBounds(cameraAt(), boxAt(0, 0, 0), at);
  const shifted = projectBounds(cameraAt(), boxAt(0, 0, 0), at, new Matrix4().makeTranslation(2, 0, 0));
  const delta = expectedX(2, at) - expectedX(0, at);
  assert.ok(Math.abs(shifted.center!.x - (plain.center!.x + delta)) < 0.05);

  /*
   * The regression this contract was written after: a box that already
   * carries its object's position, transformed by that same position again,
   * lands somewhere else entirely. An identity parent must change nothing.
   */
  const objectBox = boxAt(-1.6, 0.9, -4.43);
  const withIdentity = projectBounds(cameraAt(), objectBox, at, new Matrix4());
  const without = projectBounds(cameraAt(), objectBox, at);
  assert.deepEqual(withIdentity.center, without.center);

  const doubleApplied = projectBounds(cameraAt(), objectBox, at, new Matrix4().makeTranslation(-1.6, 0.9, -4.43));
  assert.ok(
    Math.abs(doubleApplied.center!.x - without.center!.x) > 10,
    "applying the object's own offset twice must be visibly different, not plausible",
  );
});

/* ------------------------------------------------------ device pixels */

test("devicePixelRatio is applied to the buffer exactly once", () => {
  const css = view();
  const retina = view({ bufferWidth: 1600, bufferHeight: 1200, dpr: 2 });
  const a = projectBounds(cameraAt(), boxAt(0, 0, 0), css);
  const b = projectBounds(cameraAt(), boxAt(0, 0, 0), retina);

  assert.deepEqual(a.center, b.center, "the CSS reading does not move with the ratio");
  assert.deepEqual(a.bounds, b.bounds);
  assert.ok(Math.abs(b.bufferCenter!.x - a.center!.x * 2) < 0.01);
  assert.equal(retina.dpr, 2);

  // The ratio is derived from the buffer when it is not given, so a renderer
  // that caps dpr (an adaptive cap, a browser zoom) is described correctly.
  const derived = viewportOf({ left: 0, top: 0, width: 800, height: 600 }, { width: 1200, height: 900 });
  assert.equal(derived.dpr, 1.5);
});

test("CSS → buffer and → screenshot conversions agree with their definitions", () => {
  const at = view({ left: 20, top: 10, bufferWidth: 1600, bufferHeight: 1200, dpr: 2 });
  assert.deepEqual(viewportToBuffer({ x: 120, y: 60 }, at), { x: 200, y: 100 });
  assert.deepEqual(viewportToCanvasLocal({ x: 120, y: 60 }, at), { x: 100, y: 50 });
  // A screenshot of the viewport is in CSS pixels: identity.
  assert.deepEqual(
    viewportToScreenshot({ x: 120, y: 60 }, { width: 800, height: 600, viewportWidth: 800, viewportHeight: 600 }),
    { x: 120, y: 60 },
  );
  // A scaled capture is scaled, once.
  assert.deepEqual(
    viewportToScreenshot({ x: 120, y: 60 }, { width: 400, height: 300, viewportWidth: 800, viewportHeight: 600 }),
    { x: 60, y: 30 },
  );
});

/* -------------------------------------------------------- stale state */

test("a camera that moved since the last frame is measured where it IS", () => {
  const at = view();
  const camera = cameraAt();
  // Move it without telling three — exactly what a 1 fps render loop leaves
  // behind: `matrixWorldInverse` still describes the previous frame.
  camera.position.set(0, 0, 20);

  const stale = new Vector3(2, 0, 0).project(camera); // what the old probe did
  const staleX = (stale.x * 0.5 + 0.5) * at.width;

  const projected = projectBounds(camera, boxAt(2, 0, 0, 0.0001), at);
  assert.ok(Math.abs(staleX - expectedX(2, at, 10)) < 0.05, "the stale reading is the OLD pose");
  assert.ok(Math.abs(projected.center!.x - expectedX(2, at, 20)) < 0.05, "the contract reads the new one");
  assert.ok(Math.abs(staleX - projected.center!.x) > 50, "and the two are not the same answer");
});

test("an aspect that no longer matches the surface is reported, not corrected", () => {
  const camera = cameraAt(); // aspect 4/3
  const portrait = viewportOf({ left: 0, top: 0, width: 400, height: 600 }, { width: 400, height: 600 });
  assert.equal(freshenCamera(camera, portrait), true);
  assert.equal(camera.aspect, ASPECT, "the projection matrix is what the renderer drew with");

  const projected = projectBounds(camera, boxAt(0, 0, 0), portrait);
  assert.equal(projected.aspectMismatch, true, "the measurement says so instead of hiding it");
});

/* ------------------------------------------------- refusal, not repair */

test("a box behind the camera is refused, not mirrored into view", () => {
  const projected = projectBounds(cameraAt(), boxAt(0, 0, 20), view());
  assert.equal(projected.behindCamera, true);
  assert.equal(projected.center, null);
  assert.equal(projected.bounds, null);
  assert.equal(projected.bufferCenter, null);
  assert.equal(projected.failure, null, "behind is not a failure — it is an answer");
});

test("a box off the frustum keeps its true (off-canvas) coordinates", () => {
  const at = view();
  const projected = projectBounds(cameraAt(), boxAt(100, 0, 0), at);
  assert.equal(projected.inFrustum, false);
  assert.equal(projected.failure, null);
  assert.ok(projected.center!.x > at.width, "clamping here is how a broken probe looks correct");
  assert.equal(insideViewport(projected.center, at), false);
});

test("a projection that cannot be performed says so", () => {
  const broken: Bounds3 = { min: [NaN, 0, 0], max: [1, 1, 1], center: [0, 0, 0], radius: 1 };
  assert.equal(projectBounds(cameraAt(), broken, view()).failure, "degenerate-bounds");
  assert.equal(projectBounds(cameraAt(), null, view()).failure, "degenerate-bounds");
  const empty: Bounds3 = { min: [0, 0, 0], max: [0, 0, 0], center: [0, 0, 0], radius: 0 };
  const projected = projectBounds(cameraAt(), empty, view());
  assert.equal(projected.failure, null, "a zero-size box still has a real position");
  assert.ok(Math.abs(projected.center!.x - 400) < 0.05);
});

/* ------------------------------------------------------------- resizing */

test("a resize between measurements re-measures, it does not cache", () => {
  const wide = view();
  const narrow = viewportOf({ left: 0, top: 0, width: 400, height: 600 }, { width: 400, height: 600 });
  const a = projectBounds(cameraAt(), boxAt(2, 0, 0, 0.0001), wide);
  const b = projectBounds(cameraAt(), boxAt(2, 0, 0, 0.0001), narrow);
  assert.ok(Math.abs(a.center!.x - expectedX(2, wide)) < 0.05);
  assert.ok(Math.abs(b.center!.x - expectedX(2, narrow)) < 0.05);
  assert.ok(Math.abs(a.center!.x - b.center!.x) > 50, "half the width is a different reading");
});

test("two measurements of an unchanged scene are identical", () => {
  const camera = cameraAt();
  const at = view();
  const first = projectBounds(camera, boxAt(-1.6, 0.9, -4.43), at);
  const second = projectBounds(camera, boxAt(-1.6, 0.9, -4.43), at);
  assert.deepEqual(second, first);
});
