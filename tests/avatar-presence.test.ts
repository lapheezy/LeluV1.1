/**
 * ==========================================================
 * LÉLU — ONE PRESENCE (Step 3)
 *
 * She is one persistent presence: one LeluCharacter (one canvas),
 * positioned by the existing space planner, the home's hero spot,
 * or your hand — never a window, never re-mounted per screen.
 * The placement rules are pure and tested here; the live canvas
 * continuity is measured in docs/acceptance/avatar-step-3.
 * ==========================================================
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { blocksSomething, choosePlace, edgeRest } from "../src/app/scene/genesis/avatar/presencePlacement";
import type { SpaceLayout } from "../src/app/scene/genesis/avatar/spatialPresence";

const space = (over: Partial<SpaceLayout> = {}): SpaceLayout => ({
  viewport: { width: 1440, height: 900 },
  safe: { top: 0, right: 0, bottom: 0, left: 0 },
  chat: null,
  panels: [],
  composer: null,
  controls: [],
  reducedMotion: false,
  ...over,
});
const box = (left: number, top: number, width = 200, height = 300) => ({ left, top, width, height });
const plan = (hidden: boolean) => ({ hidden, rect: box(1000, 100) });

test("placement order: world, your spot, the hero spot, the planner, an edge", () => {
  const hero = box(500, 40, 400, 330);
  assert.equal(choosePlace({ inWorld: true, placed: null, onHome: true, hero, plan: plan(false), space: space(), compact: false }).place, "world");
  assert.equal(choosePlace({ inWorld: false, placed: box(50, 50), onHome: true, hero, plan: plan(false), space: space(), compact: false }).place, "placed");
  assert.deepEqual(choosePlace({ inWorld: false, placed: null, onHome: true, hero, plan: plan(false), space: space(), compact: false }), { place: "hero", target: hero });
  assert.equal(choosePlace({ inWorld: false, placed: null, onHome: false, hero: null, plan: plan(false), space: space(), compact: false }).place, "planned");
  assert.equal(choosePlace({ inWorld: false, placed: null, onHome: false, hero: null, plan: plan(true), space: space(), compact: false }).place, "edge");
});

test("where you put her is kept until it would cover the composer or a control", () => {
  const composer = box(0, 800, 1440, 100);
  const s = space({ composer });
  assert.equal(choosePlace({ inWorld: false, placed: box(600, 700), onHome: false, hero: null, plan: plan(false), space: s, compact: false }).place, "planned", "over the composer: she steps aside");
  assert.equal(blocksSomething(box(600, 700), s), true);
  assert.equal(blocksSomething(box(600, 100), s), false);
});

test("when nothing fits she rests small at the least obstructive edge — not hidden, not over a control", () => {
  // A phone with a full-screen sheet: composer at the bottom, header controls at the top right.
  const s = space({
    viewport: { width: 390, height: 844 },
    chat: box(0, 0, 390, 844),
    composer: box(0, 760, 390, 84),
    controls: [box(300, 0, 90, 60), box(0, 0, 60, 60)],
  });
  const rest = edgeRest(s, true);
  assert.equal(blocksSomething(rest, s, 0), false, "covers neither the composer nor a control");
  assert.ok(rest.width <= 80 && rest.height <= 110, "small");
  assert.ok(rest.left + rest.width <= 390 && rest.left >= 0, "inside the screen");
});

test("one presence: one LeluCharacter, no portals, no window chrome", () => {
  const src = readFileSync("src/app/scene/genesis/avatar/LeluCompanion.tsx", "utf8");
  assert.equal((src.match(/<LeluCharacter\b/g) ?? []).length, 1, "exactly one character in the presence");
  assert.doesNotMatch(src, /createPortal/, "no per-screen portals that re-mount her");
  assert.doesNotMatch(src, /lelu-companion-bar|lelu-companion-resize|nwse-resize/, "no title bar, no resize grip");
  assert.match(src, /transform: `translate3d\(/, "moved by transform, not by re-mounting");
  const scene = readFileSync("src/app/scene/genesis/GenesisScene.tsx", "utf8");
  assert.equal((scene.match(/<LeluCompanion \/>/g) ?? []).length, 1, "mounted once, at app level");
});

test("dropped on a control, she settles in the nearest free spot instead", async () => {
  const { nearestFree, blocksSomething: blocks } = await import("../src/app/scene/genesis/avatar/presencePlacement");
  const s = space({ viewport: { width: 844, height: 390 }, controls: [box(80, 60, 300, 120)] });
  const drop = box(100, 80, 200, 200);
  assert.equal(blocks(drop, s), true);
  const spot = nearestFree(drop, s)!;
  assert.ok(spot, "a free spot exists");
  assert.equal(blocks(spot, s), false);
  assert.ok(Math.hypot(spot.left - drop.left, spot.top - drop.top) < 300, "near where she was dropped");
  const full = space({ viewport: { width: 400, height: 400 }, controls: [box(0, 0, 400, 400)] });
  assert.equal(nearestFree(drop, full), null, "nowhere free: she keeps her own place");
});
