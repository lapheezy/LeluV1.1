/**
 * ==========================================================
 * LÉLU — ORBITAL NAVIGATION (geometry + composition)
 *
 * CATEGORY: unit — pure geometry, plus the composition the
 * navigator must keep: orbs on an ellipse around the Core,
 * stable positions, touch-sized targets, no full-width bar and
 * no expanding panel of pills.
 *
 * The defect this pins: the navigation used to be a row of
 * pill-shaped tabs across the Earth, and expanding it covered
 * the world with a panel of more pills.
 * ==========================================================
 */

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  adjacentGap,
  orbitBounds,
  orbitRing,
  pointAt,
  satelliteOffsets,
  ORBIT_SPAN_DEG,
} from "../src/app/scene/spatial/orbitLayout";
import { dockGroups } from "../src/app/scene/spatial/capabilityGroups";

const root = process.cwd();
const read = (file: string) => readFileSync(path.join(root, file), "utf8");

test("the categories sit on an orbit around the Core, one orb each", () => {
  const groups = dockGroups();
  assert.ok(groups.length >= 4, "the navigation has categories to place");
  const ring = orbitRing(groups.length);

  assert.equal(ring.length, groups.length, "one position per category");
  assert.equal(ring[Math.floor(groups.length / 2)].angle, 0, "one orb sits straight above the Core");
  assert.ok(Math.abs(ring[0].angle + ORBIT_SPAN_DEG / 2) < 1e-9, "the fan is symmetric");
  assert.ok(Math.abs(ring[ring.length - 1].angle - ORBIT_SPAN_DEG / 2) < 1e-9);

  const unique = new Set(ring.map((point) => `${point.x.toFixed(4)},${point.y.toFixed(4)}`));
  assert.equal(unique.size, ring.length, "every orb has its own position");
  for (const point of ring) {
    assert.ok(point.y <= 0, "no category is placed below the Core (off the bottom of the screen)");
  }
});

test("positions depend only on the category count: travelling never moves an orb", () => {
  const first = orbitRing(5);
  const again = orbitRing(5);
  assert.deepEqual(first, again);
  // The navigator computes the ring from the count alone, not from the
  // current scene — that is what makes the map learnable.
  const nav = read("src/app/scene/spatial/SpatialNavigator.tsx");
  assert.match(nav, /useMemo\(\(\) => orbitRing\(groups\.length\), \[groups\.length\]\)/);
  assert.doesNotMatch(nav, /orbitRing\([^)]*spatial\.current/);
});

test("orbs do not touch, and the whole orbit fits a phone", () => {
  const ring = orbitRing(dockGroups().length);
  // The phone geometry the stylesheet uses at 375–430px.
  const rx = 117;
  const ry = 104;
  const orb = 52;
  assert.ok(adjacentGap(ring, rx, ry) > orb, `adjacent orbs must not overlap (${adjacentGap(ring, rx, ry)}px gap for ${orb}px orbs)`);

  const bounds = orbitBounds(ring, rx, ry, orb);
  assert.ok(bounds.width <= 360, `the orbit is wider than the phone band (${bounds.width}px)`);
  assert.ok(bounds.right - bounds.left <= 360);
  assert.ok(bounds.top <= 0 && bounds.bottom > 0, "the orbit is drawn above the Core");
});

test("a category's destinations orbit the category, not the whole screen", () => {
  for (const angle of [0, -42, -84, 42, 84]) {
    const offsets = satelliteOffsets(5, angle, 62);
    assert.equal(offsets.length, 5);
    assert.equal(new Set(offsets.map((offset) => `${offset.dx},${offset.dy}`)).size, 5, "each destination has its own place");
    assert.ok(Math.max(...offsets.map((offset) => offset.dy)) <= 0.5, `no destination drops below its category (${angle}°)`);
    assert.ok(
      Math.min(...offsets.map((offset) => Math.hypot(offset.dx, offset.dy))) >= 52,
      "destinations stay clear of their category orb",
    );
    for (let i = 0; i < offsets.length; i += 1) {
      for (let j = i + 1; j < offsets.length; j += 1) {
        /* 46px orbs are boxes, not circles: they clear when one axis does. */
        const dx = Math.abs(offsets[i].dx - offsets[j].dx);
        const dy = Math.abs(offsets[i].dy - offsets[j].dy);
        assert.ok(
          Math.max(dx, dy) >= 46,
          `destination orbs do not overlap one another (${dx.toFixed(1)}×${dy.toFixed(1)}px at ${angle}°)`,
        );
      }
    }
    // The cluster stays local: never a panel spanning the world.
    const extent = Math.max(...offsets.map((offset) => Math.hypot(offset.dx, offset.dy))) + 23;
    assert.ok(extent <= 134, `a satellite cluster stays small (${extent}px)`);
  }
});

test("the navigator renders orbs, not a bar of tabs", () => {
  const nav = read("src/app/scene/spatial/SpatialNavigator.tsx");
  assert.match(nav, /data-spatial-nav/);
  assert.match(nav, /orbitRing\(/, "category positions come from the orbit");
  assert.match(nav, /satelliteOffsets\(/, "destinations orbit their category");
  assert.match(nav, /data-spatial-group-orb=/, "each category is its own orb");
  assert.match(nav, /data-spatial-scene=\{entry\.scene\}/, "each destination is its own orb");
  assert.match(nav, /<SavedWorlds compact=\{compact\} \/>/);
  assert.match(nav, /data-spatial-control="core"/, "the Core is the anchor you return to");
  assert.doesNotMatch(nav, /\.lsn-bar|gridTemplateColumns: "repeat\(7/, "no row of tabs");
});

test("the resting orbit is not a full-width glass bar", () => {
  const css = read("src/app/scene/genesis/home/spatialNav.css");
  assert.doesNotMatch(css, /\.lsn-bar/, "the pill bar is gone from the stylesheet");
  assert.match(css, /\.lso-field \{ position: absolute; inset: 0; pointer-events: none; \}/);
  // Only the orbs own the pointer: the space between them is the world.
  assert.match(css, /\.lso-orb \{[\s\S]*?pointer-events: auto;/);
  assert.match(css, /\.lso-hint \{[\s\S]*?pointer-events: none;/);

  const size = (selector: string) => {
    const block = css.match(new RegExp(`\\${selector}\\s*\\{[^}]*\\}`));
    assert.ok(block, `${selector} has a rule`);
    const width = Number(block![0].match(/width:\s*(\d+)px/)?.[1]);
    const height = Number(block![0].match(/height:\s*(\d+)px/)?.[1]);
    return { width, height };
  };
  for (const selector of [".lso-category", ".lso-satellite"]) {
    const { width, height } = size(selector);
    assert.ok(width >= 44 && height >= 44, `${selector} is ${width}x${height}, below a 44px touch target`);
  }
});
