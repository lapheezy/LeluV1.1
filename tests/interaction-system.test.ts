/**
 * ==========================================================
 * LÉLU — SHARED INTERACTION SYSTEM
 *
 * CATEGORY: unit. Geometry, state ownership and the hold gesture are
 * pure, so they are tested without a browser. These are the rules every
 * radial menu in the project depends on:
 *
 *   - a ring is never clipped by a viewport edge;
 *   - one menu is open at a time;
 *   - a hold opens and STAYS open after release;
 *   - a tap stays a tap;
 *   - a scroll cancels a pending hold;
 *   - the keyboard can open the same menu.
 * ==========================================================
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  InteractionStateManager,
  clamp,
  placeContextMenu,
  placeRadial,
  radialOptionPosition,
  radialOptionPositions,
} from "../src/core/interaction/index";
import { createHoldGesture } from "../src/core/interaction/GestureController";
import { INTERACTION_TOKENS } from "../src/core/interaction/tokens";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/* ------------------------------ geometry ------------------------------ */

test("a radial ring at the edge is kept whole inside the viewport", () => {
  for (const [width, height] of [
    [390, 844],
    [844, 390],
    [320, 320],
    [1440, 900],
  ]) {
    for (const anchor of [
      { left: 0, top: 0, width: 48, height: 48 },
      { left: width - 48, top: height - 48, width: 48, height: 48 },
      { left: width / 2, top: height / 2, width: 48, height: 48 },
    ]) {
      const placement = placeRadial(anchor, { width, height }, {
        itemCount: 8,
        optionSize: INTERACTION_TOKENS.size.option,
        preferredRadius: INTERACTION_TOKENS.radius.preferred,
      });
      const edge = placement.optionSize / 2 + INTERACTION_TOKENS.gap.edge;
      assert.ok(placement.centerX - placement.radius - edge >= -0.01, `${width}x${height}: left edge clipped`);
      assert.ok(placement.centerX + placement.radius + edge <= width + 0.01, `${width}x${height}: right edge clipped`);
      assert.ok(placement.centerY - placement.radius - edge >= -0.01, `${width}x${height}: top edge clipped`);
      assert.ok(placement.centerY + placement.radius + edge <= height + 0.01, `${width}x${height}: bottom edge clipped`);
    }
  }
});

test("a tiny viewport shrinks the ring rather than clipping it", () => {
  const placement = placeRadial(
    { left: 220, top: 0, width: 48, height: 48 },
    { width: 240, height: 240 },
    { itemCount: 6, optionSize: 56, preferredRadius: 104 },
  );
  assert.ok(placement.radius < 104, "the preferred radius was not reduced");
  assert.ok(placement.radius > 0);
});

test("radial options are distributed around the ring with no duplicates", () => {
  const positions = radialOptionPositions(8, 100);
  assert.equal(positions.length, 8);
  const keys = new Set(positions.map((p) => `${p.x.toFixed(3)}:${p.y.toFixed(3)}`));
  assert.equal(keys.size, 8);
  // First option is at the top, so it has a negative y and ~zero x.
  assert.ok(Math.abs(positions[0].x) < 0.001);
  assert.ok(positions[0].y < 0);
  const single = radialOptionPosition(0, 1, 50);
  assert.ok(Math.abs(single.x) < 0.001);
  assert.equal(single.y, -50);
});

test("a context menu flips above the control and is clamped sideways", () => {
  const below = placeContextMenu(
    { left: 140, top: 100, width: 48, height: 48 },
    { width: 230, height: 280 },
    { width: 390, height: 844 },
  );
  assert.equal(below.placement, "below");
  assert.ok(below.left >= 12);

  const flip = placeContextMenu(
    { left: 140, top: 700, width: 48, height: 48 },
    { width: 230, height: 280 },
    { width: 390, height: 844 },
  );
  assert.equal(flip.placement, "above");
  assert.ok(flip.top >= 12);
  assert.ok(flip.maxHeight > 0, "the menu has no height budget above the control");

  const edge = placeContextMenu(
    { left: 0, top: 100, width: 44, height: 44 },
    { width: 230, height: 100 },
    { width: 390, height: 844 },
  );
  assert.ok(edge.left >= 12, "menu ran off the left edge");
  assert.equal(clamp(-5, 0, 10), 0);
});

/* --------------------------- state ownership --------------------------- */

test("exactly one menu is open at a time, and subscribers see each change", () => {
  const manager = new InteractionStateManager();
  let changes = 0;
  const stop = manager.subscribe(() => {
    changes += 1;
  });
  const anchor = { left: 10, top: 10, width: 44, height: 44 };

  manager.open({ id: "one", kind: "radial", anchor });
  assert.equal(manager.openId, "one");
  manager.open({ id: "two", kind: "context", anchor });
  assert.equal(manager.openId, "two");
  assert.equal(manager.isOpen("one"), false);

  manager.close("one"); // not the open one: no change
  assert.equal(manager.openId, "two");
  assert.equal(changes, 2);

  manager.toggle({ id: "two", kind: "context", anchor });
  assert.equal(manager.openId, null);
  manager.close();
  assert.equal(changes, 3);
  stop();

  manager.open({ id: "three", kind: "radial", anchor });
  assert.equal(changes, 3, "an unsubscribed listener was still called");
});

/* ------------------------------- gesture ------------------------------- */

test("a hold opens once and survives release; a tap stays a tap", async () => {
  let taps = 0;
  let holds = 0;
  const gesture = createHoldGesture({ holdMs: 12, onTap: () => (taps += 1), onHold: () => (holds += 1) });

  gesture.onPointerDown({ pointerId: 1, clientX: 10, clientY: 10 });
  await sleep(30);
  assert.equal(holds, 1, "the hold did not fire");
  gesture.onPointerUp({ pointerId: 1, clientX: 10, clientY: 10 });
  assert.equal(taps, 0, "releasing after a hold also fired a tap");
  assert.equal(holds, 1, "the menu closed on release or opened twice");

  gesture.onPointerDown({ pointerId: 2, clientX: 10, clientY: 10 });
  gesture.onPointerUp({ pointerId: 2, clientX: 10, clientY: 10 });
  assert.equal(taps, 1);
  assert.equal(holds, 1);
});

test("movement past the threshold cancels the hold — a scroll is a scroll", async () => {
  let taps = 0;
  let holds = 0;
  let cancels = 0;
  const gesture = createHoldGesture({
    holdMs: 20,
    moveCancelPx: 8,
    onTap: () => (taps += 1),
    onHold: () => (holds += 1),
    onCancel: () => (cancels += 1),
  });
  gesture.onPointerDown({ pointerId: 3, clientX: 0, clientY: 0 });
  gesture.onPointerMove({ pointerId: 3, clientX: 0, clientY: 24 });
  await sleep(35);
  gesture.onPointerUp({ pointerId: 3, clientX: 0, clientY: 24 });
  assert.equal(holds, 0);
  assert.equal(taps, 0);
  assert.equal(cancels, 1);
});

test("the keyboard opens the same menu as a hold", () => {
  let holds = 0;
  let taps = 0;
  const withMenu = createHoldGesture({ onTap: () => (taps += 1), onHold: () => (holds += 1) });
  withMenu.onKeyDown({ key: "Enter", preventDefault: () => {} });
  assert.equal(holds, 1);
  assert.equal(taps, 0);

  const plain = createHoldGesture({ onTap: () => (taps += 1) });
  plain.onKeyDown({ key: " ", preventDefault: () => {} });
  assert.equal(taps, 1);
});
