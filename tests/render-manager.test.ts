/**
 * ==========================================================
 * MISSION 5.8 — RENDERING OWNERSHIP, SUSPENSION, ADAPTATION
 *
 * The architecture this mission added, pinned so it cannot quietly
 * regress:
 *
 *  - the manager only ever SUSPENDS through SceneRenderBudget (one
 *    authority for the frame loop, never a second opinion);
 *  - suspension is released when the surface that caused it goes
 *    away (a lost context that is never restored must not pause the
 *    app forever);
 *  - a device's capability sets a CEILING that measurement cannot
 *    exceed (a software rasteriser never adapts back to WebGL);
 *  - a canvas that painted nothing is not a slow canvas — the rule
 *    that stops a backgrounded tab from degrading the scene.
 * ==========================================================
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  DOWNGRADE_AFTER,
  SceneRenderManager,
  UPGRADE_AFTER,
  nextProfile,
  profileFor,
  skyPaintInterval,
  type AdaptationState,
  type VisibilityHost,
} from "../src/app/scene/genesis/SceneRenderManager";
import { SceneRenderBudget } from "../src/app/scene/genesis/SceneRenderBudget";

/** A document/window stand-in that owns nothing but its listeners. */
class FakeHost implements VisibilityHost {
  hidden = false;
  private handlers = new Map<string, Set<() => void>>();

  addEventListener(type: string, listener: () => void): void {
    let set = this.handlers.get(type);
    if (!set) {
      set = new Set();
      this.handlers.set(type, set);
    }
    set.add(listener);
  }

  removeEventListener(type: string, listener: () => void): void {
    this.handlers.get(type)?.delete(listener);
  }

  emit(type: string): void {
    for (const listener of [...(this.handlers.get(type) ?? [])]) listener();
  }

  get listenerCount(): number {
    let count = 0;
    for (const set of this.handlers.values()) count += set.size;
    return count;
  }
}

function setup() {
  const budget = new SceneRenderBudget(false);
  const doc = new FakeHost();
  const win = new FakeHost();
  const manager = new SceneRenderManager(budget, { document: doc, window: win });
  return { budget, doc, win, manager };
}

const settle: AdaptationState = { profile: "full", slow: 0, fast: 0 };

function source(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

/* ---------------------------------------------------------------- profiles */

test("a software rasteriser is profiled light, from the renderer string", () => {
  assert.equal(
    profileFor({
      renderer:
        "ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)",
    }),
    "light",
  );
  assert.equal(profileFor({ renderer: "llvmpipe (LLVM 15.0.7, 256 bits)" }), "light");
});

test("a phone is balanced, never light — mobile is not evidence of a broken GPU", () => {
  assert.equal(profileFor({ renderer: "ANGLE (Apple, Apple M2, OpenGL ES 3.0)", mobile: true }), "balanced");
  assert.equal(profileFor({ renderer: "Adreno (TM) 740", narrow: true }), "balanced");
});

test("an UNREADABLE renderer string is not evidence of weakness", () => {
  // Safari hides WEBGL_debug_renderer_info. Guessing "light" from a blank
  // string would blank the world on a perfectly capable browser.
  assert.equal(profileFor({ renderer: "" }), "full");
  assert.equal(profileFor({ renderer: "", webgl: true }), "full");
});

test("no WebGL at all, or Save-Data, is light", () => {
  assert.equal(profileFor({ webgl: false }), "light");
  assert.equal(profileFor({ renderer: "ANGLE (NVIDIA GeForce RTX 4070)", saveData: true }), "light");
});

/* ----------------------------------------------------------- sky cadence */

test("the profile slows the DOM sky down but never stops it", () => {
  assert.equal(skyPaintInterval("full"), 0, "full follows the frame loop");
  assert.ok(skyPaintInterval("balanced") > 0);
  assert.ok(skyPaintInterval("light") > skyPaintInterval("balanced"));
  // A light device's sky IS the cosmos: a cadence of Infinity would mean
  // "never paint" and the identity would be gone.
  assert.ok(Number.isFinite(skyPaintInterval("light")));
});

/* -------------------------------------------------------- adaptation rule */

test("three slow seconds step the profile down exactly once", () => {
  let state = settle;
  for (let second = 1; second < DOWNGRADE_AFTER; second += 1) {
    state = nextProfile(state, { fps: 20, painting: true });
    assert.equal(state.profile, "full", `second ${second} must not step down yet`);
  }
  state = nextProfile(state, { fps: 20, painting: true });
  assert.equal(state.profile, "balanced");
  // And it does not cascade: light needs three MORE slow seconds.
  state = nextProfile(state, { fps: 20, painting: true });
  assert.equal(state.profile, "balanced");
  assert.equal(state.slow, 1);
});

test("one healthy second resets the slow count", () => {
  const state = nextProfile({ profile: "full", slow: DOWNGRADE_AFTER - 1, fast: 0 }, { fps: 60, painting: true });
  assert.equal(state.profile, "full");
  assert.equal(state.slow, 0);
});

test("an unpainted second never changes the profile", () => {
  // The rule that keeps a backgrounded tab from degrading the scene: a
  // paused canvas reports zero frames, and zero is not a slow measurement.
  const dirty: AdaptationState = { profile: "full", slow: 0, fast: 0 };
  assert.equal(nextProfile(dirty, { fps: 0, painting: false }), dirty, "same object: no re-render");
  assert.equal(nextProfile(dirty, { fps: 0, painting: true }), dirty, "no frames is not slow");
  assert.equal(nextProfile(dirty, { fps: Number.NaN, painting: true }), dirty);
  assert.equal(
    nextProfile({ profile: "balanced", slow: 2, fast: 3 }, { fps: 0, painting: false }).slow,
    0,
    "a stale count must not survive a pause",
  );
});

test("between the thresholds the profile holds and stops counting", () => {
  const state = nextProfile({ profile: "full", slow: 0, fast: 10 }, { fps: 45, painting: true });
  assert.equal(state.profile, "full");
  assert.equal(state.fast, 0);
});

test("quality is restored only after a long fast run", () => {
  let state: AdaptationState = { profile: "balanced", slow: 0, fast: 0 };
  for (let second = 1; second < UPGRADE_AFTER; second += 1) {
    state = nextProfile(state, { fps: 60, painting: true });
    assert.equal(state.profile, "balanced", `second ${second} must not upgrade yet`);
  }
  state = nextProfile(state, { fps: 60, painting: true });
  assert.equal(state.profile, "full");
});

test("measurement can never lift a device above its capability ceiling", () => {
  let state: AdaptationState = { profile: "light", slow: 0, fast: 0 };
  for (let second = 0; second < UPGRADE_AFTER * 4; second += 1) {
    state = nextProfile(state, { fps: 60, painting: true }, "light");
  }
  assert.equal(state.profile, "light", "a software rasteriser does not adapt a GPU into existence");
});

/* ----------------------------------------------------- page visibility */

test("a hidden page is suspended through the budget, and resumes when shown", () => {
  const { budget, doc, manager } = setup();
  manager.registerSurface("genesis-world", "world");
  assert.equal(budget.mode(), "full");

  doc.hidden = true;
  doc.emit("visibilitychange");
  assert.equal(budget.mode(), "paused", "nothing visible is lost while hidden");
  assert.equal(manager.getSnapshot().hidden, true);

  doc.hidden = false;
  doc.emit("visibilitychange");
  assert.equal(budget.mode(), "full");
});

test("registering a surface while already hidden starts suspended", () => {
  const { budget, doc, manager } = setup();
  doc.hidden = true;
  manager.registerSurface("genesis-world", "world");
  assert.equal(budget.mode(), "paused", "a restored background tab must not paint first and ask later");
});

/* ---------------------------------------------------------- context loss */

test("a lost context pauses the scene; restoring it resumes", () => {
  const { budget, manager } = setup();
  manager.registerSurface("genesis-world", "world");
  manager.registerSurface("lelu-avatar", "avatar");

  manager.reportContextLost("genesis-world");
  assert.equal(manager.isContextLost("genesis-world"), true);
  assert.equal(budget.mode(), "paused", "nothing may keep drawing into a dead context");

  manager.reportContextRestored("genesis-world");
  assert.equal(budget.mode(), "full");
});

test("an unmounted canvas releases its own suspension", () => {
  const { budget, manager } = setup();
  manager.registerSurface("genesis-world", "world");
  manager.reportContextLost("genesis-world");
  assert.equal(budget.mode(), "paused");

  manager.unregisterSurface("genesis-world");
  assert.equal(budget.mode(), "full", "a canvas that no longer exists must not pause the app forever");
});

/* -------------------------------------------------------------- ownership */

test("visibility is watched only while a surface exists", () => {
  const { doc, win, manager } = setup();
  assert.equal(doc.listenerCount + win.listenerCount, 0, "no surfaces, no listeners");

  manager.registerSurface("a");
  assert.ok(doc.listenerCount > 0);
  manager.registerSurface("b");
  manager.unregisterSurface("a");
  assert.ok(doc.listenerCount > 0, "one surface left: keep watching");

  manager.unregisterSurface("b");
  assert.equal(doc.listenerCount + win.listenerCount, 0, "every listener leaves with the last surface");
});

test("the snapshot is identity-stable and lists each surface once", () => {
  const { manager } = setup();
  const first = manager.getSnapshot();
  assert.equal(first, manager.getSnapshot(), "unchanged state must not re-render subscribers");

  manager.registerSurface("a", "world");
  manager.registerSurface("a", "world");
  const second = manager.getSnapshot();
  assert.notEqual(second, first);
  assert.deepEqual(second.surfaces, [{ id: "a", kind: "world" }]);
});

/* ---------------------------------------------------------- architecture */

test("the manager suspends through the budget and never decides a frameloop", () => {
  const manager = source("src/app/scene/genesis/SceneRenderManager.ts");
  assert.match(manager, /budget\.setOccluded\(/, "suspension must be an occluder on the one budget");
  assert.doesNotMatch(manager, /setFrameloop\(/, "no direct frame-loop control");
  assert.doesNotMatch(
    manager,
    /from "\.\/SceneFrameGovernor"/,
    "a second mechanism deciding the frame loop is the bug this fixes",
  );
});

test("the measured frame rate reaches the manager with its painting flag", () => {
  const adaptive = source("src/app/scene/genesis/AdaptiveQuality.tsx");
  assert.match(
    adaptive,
    /manager\.reportFrameRate\(fps, mode === "full"\)/,
    "a paused canvas must report \"not painting\", not \"slow\"",
  );
  assert.match(adaptive, /profile: manager\.profile\(\)/, "the profile is published for diagnostics");
});

test("the world paints only when the device can AND the budget allows", () => {
  const scene = source("src/app/scene/genesis/GenesisScene.tsx");
  assert.match(scene, /const paintWorld = \(!softwareGL \|\| Boolean\(perfWorld\)\) && profile !== "light";/);
  assert.match(
    scene,
    /const frameloop: Frameloop = paintWorld \? budgetedFrameloop : "never";/,
    "the frameloop stays derived from the budget, never from a literal",
  );
});

test("both canvases register a surface and recover from context loss", () => {
  const world = source("src/app/scene/genesis/GenesisScene.tsx");
  const avatar = source("src/app/scene/genesis/avatar/LeluCharacter3D.tsx");
  assert.match(world, /<RenderContextGuard id="genesis-world" kind="world" \/>/);
  assert.match(avatar, /<RenderContextGuard id="lelu-avatar" kind="avatar" \/>/);
  const guard = source("src/app/scene/genesis/render/RenderContextGuard.tsx");
  assert.match(guard, /webglcontextlost/);
  assert.match(guard, /webglcontextrestored/);
  assert.match(guard, /event\.preventDefault\(\)/, "the spec requires preventDefault for restoration to be attempted");
});
