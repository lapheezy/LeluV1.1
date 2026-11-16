/**
 * ==========================================================
 * MISSION 17 / WP05 — CAPABILITY LIFETIME AND EXPLICIT OVERRIDE
 *
 * WP04 recorded a Cosmos that could not be seen: a real GPU was
 * profiled "light" and stopped painting, and nothing could lift it,
 * because the only evidence that could have — frames — is exactly what
 * giving up removes. These tests pin the four rules that fix it:
 *
 *  - capability is re-read when the SURFACE changes, and a reassessment
 *    whose evidence is unchanged is not a new decision (no oscillation);
 *  - a profile demoted by MEASUREMENT describes the surface it was
 *    measured on, so replacing that surface re-derives it;
 *  - hardware evidence outranks measurement, forever;
 *  - an explicit request is a FLOOR below the capability ceiling, is
 *    refused when there is no GPU, and never bypasses a lost context.
 * ==========================================================
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  CAPABILITY_RECHECK_MS,
  DOWNGRADE_AFTER,
  DOWNGRADE_TO_LIGHT_AFTER,
  SceneRenderManager,
  capabilitySignature,
  overrideVerdict,
  profileFor,
  profileReason,
  readRenderOverride,
  type CapabilityInput,
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
}

/** A capable discrete/integrated GPU: the machine WP04 could not paint on. */
const GPU: CapabilityInput = {
  renderer:
    "ANGLE (Intel, Intel(R) Iris(R) Xe Graphics (0x00009A49) Direct3D11 vs_5_0 ps_5_0, D3D11)",
  webgl: true,
};

const SOFTWARE: CapabilityInput = {
  renderer: "ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)",
  webgl: true,
};

function setup(now: () => number = () => 0) {
  const budget = new SceneRenderBudget(false);
  const doc = new FakeHost();
  const win = new FakeHost();
  const manager = new SceneRenderManager(budget, { document: doc, window: win }, now);
  return { budget, doc, win, manager };
}

/**
 * Feed slow seconds until the profile has stopped moving (both steps).
 *
 * The second step is deliberately much longer than the first: leaving balanced
 * is what removes the world, so it needs a sustained run, not a transient.
 */
function demote(manager: SceneRenderManager): void {
  for (let second = 0; second < DOWNGRADE_AFTER + DOWNGRADE_TO_LIGHT_AFTER; second += 1) {
    manager.reportFrameRate(1, true);
  }
}

function source(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

/* ------------------------------------------------- explicit configuration */

test("an explicit render request is read from configuration, and nothing else is", () => {
  assert.equal(readRenderOverride(""), null, "no parameter: the automatic policy");
  assert.equal(readRenderOverride("?perf-world"), null, "an unrelated flag is not an override");
  assert.equal(readRenderOverride("?render=maybe"), null, "a typo must degrade to the default, never to a guess");

  const gpu = readRenderOverride("?render=gpu");
  assert.ok(gpu);
  assert.equal(gpu.profile, "full");
  assert.equal(gpu.source, "url:render=gpu");
  assert.match(gpu.reason, /explicit \?render=gpu/, "the request carries the reason it exists");

  assert.equal(readRenderOverride("?render=GPU")?.profile, "full", "case does not matter");
  assert.equal(readRenderOverride("?render=balanced")?.profile, "balanced");
});

test("an override is refused where there is no GPU to paint with", () => {
  assert.equal(overrideVerdict({ webgl: false }), "refused:no-webgl");
  assert.equal(overrideVerdict(SOFTWARE), "refused:software");
  assert.equal(overrideVerdict(GPU), "applied");
  assert.equal(overrideVerdict({ renderer: "" }), "applied", "an unreadable string is not evidence of weakness");
});

/* ---------------------------------------------------- capability signature */

test("capability is compared by evidence, not by object identity", () => {
  assert.equal(
    capabilitySignature({ renderer: "ANGLE (X)", narrow: true }),
    capabilitySignature({ renderer: " angle (x) ", narrow: true }),
    "whitespace and case are not capability changes",
  );
  assert.notEqual(
    capabilitySignature({ renderer: "a", narrow: true }),
    capabilitySignature({ renderer: "a", narrow: false }),
    "a rotation is",
  );
  assert.notEqual(capabilitySignature({ webgl: true }), capabilitySignature({ webgl: false }));
  assert.notEqual(capabilitySignature({ saveData: true }), capabilitySignature({}));
});

test("the profile explains itself", () => {
  const override = { profile: "full" as const, reason: "test", source: "test" };
  assert.equal(profileReason({ webgl: false }, "light", null), "capability:no-webgl");
  assert.equal(profileReason(SOFTWARE, "light", null), "capability:software");
  assert.equal(profileReason({ renderer: "x", saveData: true }, "light", null), "capability:save-data");
  assert.equal(profileReason({ renderer: "x", narrow: true }, "balanced", null), "capability:narrow");
  assert.equal(profileReason(GPU, "full", null), "capability");
  assert.equal(profileReason(GPU, "balanced", null), "measurement:slow");
  assert.equal(profileReason(GPU, "full", override), "override");
});

/* -------------------------------------------------------- reassessment */

test("reassessing with unchanged evidence is not a new decision", () => {
  const { manager } = setup();
  manager.setCapability(GPU);
  const settled = manager.getSnapshot();

  assert.equal(manager.reassessCapability(GPU, "resize"), false);
  assert.equal(manager.reassessCapability({ ...GPU, renderer: ` ${GPU.renderer?.toUpperCase()} ` }, "resize"), false);
  assert.equal(manager.getSnapshot(), settled, "no new snapshot, so no subscriber re-renders");
});

test("a rotation re-reads the viewport and the profile follows it", () => {
  const { manager } = setup();
  manager.setCapability({ ...GPU, narrow: true });
  assert.equal(manager.getSnapshot().profile, "balanced");
  assert.equal(manager.getSnapshot().reason, "capability:narrow");

  assert.equal(manager.reassessCapability({ ...GPU, narrow: false }, "orientation"), true);
  assert.equal(manager.getSnapshot().profile, "full", "landscape on a wide surface may paint fully");
  assert.equal(manager.getSnapshot().ceiling, "full");

  assert.equal(manager.reassessCapability({ ...GPU, narrow: true }, "orientation"), true);
  assert.equal(manager.getSnapshot().profile, "balanced", "and back to portrait");
});

test("a measured demotion is re-derived when the surface it measured is gone", () => {
  const { manager } = setup(() => 1000);
  manager.setCapability({ ...GPU, narrow: true });
  assert.equal(manager.getSnapshot().assessedAt, 1000);

  demote(manager);
  assert.equal(manager.getSnapshot().profile, "light", "the world stopped painting");
  assert.equal(manager.getSnapshot().reason, "measurement:slow");

  // The same surface is not new evidence: a demoted profile must not flap
  // back the moment something asks again.
  assert.equal(manager.reassessCapability({ ...GPU, narrow: true }, "resize"), false);
  assert.equal(manager.getSnapshot().profile, "light", "no oscillation without new evidence");

  // A different surface is: those frames were measured on the old one.
  assert.equal(manager.reassessCapability({ ...GPU, narrow: false }, "orientation"), true);
  assert.equal(manager.getSnapshot().profile, "full", "the new surface gets its own measurement");
  assert.equal(manager.getSnapshot().reason, "capability");
});

test("hardware evidence outranks measurement, and reassessment cannot lift it", () => {
  const { manager } = setup();
  manager.setCapability(SOFTWARE);
  assert.equal(manager.getSnapshot().profile, "light");
  assert.equal(manager.getSnapshot().reason, "capability:software");

  for (let second = 0; second < 120; second += 1) manager.reportFrameRate(120, true);
  assert.equal(manager.getSnapshot().profile, "light", "a rasteriser does not adapt a GPU into existence");

  manager.reassessCapability({ ...SOFTWARE, webgl: false }, "context-restored");
  assert.equal(manager.getSnapshot().profile, "light");
  assert.equal(manager.getSnapshot().reason, "capability:no-webgl");
});

test("a restored context reports the renderer it came back with", () => {
  const { manager } = setup();
  manager.setCapability(GPU);
  assert.equal(manager.getSnapshot().profile, "full");

  assert.equal(manager.observeRenderer(String(GPU.renderer)), false, "the same renderer is not evidence");
  assert.equal(manager.getSnapshot().profile, "full");

  assert.equal(manager.observeRenderer(String(SOFTWARE.renderer)), true);
  assert.equal(manager.getSnapshot().profile, "light", "a software fallback must stop the world painting");
  assert.equal(manager.getSnapshot().reason, "capability:software");
});

/* ------------------------------------------------------------- overrides */

test("an override keeps a capable GPU painting through a slow measurement", () => {
  const { manager } = setup();
  manager.setCapability(GPU);
  demote(manager);
  assert.equal(manager.getSnapshot().profile, "light");

  assert.equal(manager.setOverride({ profile: "full", reason: "test", source: "url:render=gpu" }), true);
  assert.equal(manager.getSnapshot().profile, "full");
  assert.equal(manager.getSnapshot().override?.source, "url:render=gpu");
  assert.equal(manager.getSnapshot().reason, "override");

  for (let second = 0; second < DOWNGRADE_AFTER * 2; second += 1) manager.reportFrameRate(1, true);
  assert.equal(manager.getSnapshot().profile, "full", "the floor holds");
  assert.ok(manager.getSnapshot().demotionsHeld > 0, "and the holds are counted, not silent");
});

test("releasing the override returns the device to automatic policy", () => {
  const { manager } = setup();
  manager.setCapability(GPU);
  manager.setOverride({ profile: "full", reason: "test", source: "url:render=gpu" });
  assert.equal(manager.getSnapshot().profile, "full");

  assert.equal(manager.setOverride(null), true);
  assert.equal(manager.getSnapshot().override, null);
  assert.equal(manager.getSnapshot().reason, "capability");

  demote(manager);
  assert.equal(manager.getSnapshot().profile, "light", "with no override, a slow device is still protected");
});

test("an override never out-ranks the hardware underneath it", () => {
  const { manager } = setup();
  manager.setCapability({ ...GPU, narrow: true });
  assert.equal(manager.getSnapshot().profile, "balanced");

  assert.equal(manager.setOverride({ profile: "full", reason: "test", source: "url:render=gpu" }), true);
  assert.equal(manager.getSnapshot().profile, "balanced", "a phone with ?render=gpu is still a phone");
  assert.equal(manager.getSnapshot().ceiling, "balanced");
});

test("an override is refused on hardware that cannot paint, and says why", () => {
  const { manager } = setup();
  manager.setCapability(SOFTWARE);

  assert.equal(manager.setOverride({ profile: "full", reason: "test", source: "url:render=gpu" }), false);
  const snapshot = manager.getSnapshot();
  assert.equal(snapshot.override, null, "nothing was granted");
  assert.equal(snapshot.overrideRefused, "refused:software");
  assert.equal(snapshot.profile, "light", "and the safety policy stands");
});

test("an override cannot bypass a lost context, nor a hidden page", () => {
  const { budget, doc, manager } = setup();
  manager.registerSurface("genesis-world", "world");
  manager.setCapability(GPU);
  manager.setOverride({ profile: "full", reason: "test", source: "url:render=gpu" });
  assert.equal(manager.getSnapshot().worldPainting, true);

  manager.reportContextLost("genesis-world");
  assert.equal(budget.mode(), "paused", "the budget is the one authority on suspending, and it still is");
  assert.equal(manager.getSnapshot().worldPainting, false);

  manager.reportContextRestored("genesis-world");
  assert.equal(budget.mode(), "full");
  assert.equal(manager.getSnapshot().worldPainting, true, "and it recovers on its own");

  doc.hidden = true;
  doc.emit("visibilitychange");
  assert.equal(manager.getSnapshot().worldPainting, false);
});

/* ------------------------------------------------------------ diagnostics */

test("the snapshot answers \"is it painting, and if not why\" without extra work", () => {
  const { manager } = setup(() => 500);
  assert.equal(manager.getSnapshot().assessedAt, 0, "nothing assessed yet");
  assert.equal(manager.getSnapshot().worldPainting, true, "the default profile may paint");

  manager.setCapability(GPU);
  const painted = manager.getSnapshot();
  assert.equal(painted.assessedAt, 500);
  assert.equal(painted.reason, "capability");
  assert.equal(painted.capability.renderer, GPU.renderer);
  assert.equal(manager.lastSample(), null);

  manager.reportFrameRate(24, true);
  assert.deepEqual(manager.lastSample(), { fps: 24, painting: true, at: 500 });

  manager.setCapability({ renderer: "", webgl: false });
  assert.equal(manager.getSnapshot().worldPainting, false, "no WebGL means nothing is painted");

  // A capability "light" is the only one with nothing to draw with.
  manager.setCapability(SOFTWARE);
  demote(manager);
  assert.equal(manager.getSnapshot().profile, "light");
  assert.equal(manager.getSnapshot().worldPainting, false, "a rasteriser has no world to paint on demand");
});

/* ----------------------------------------------------------- architecture */

test("the scene re-reads capability on viewport and orientation changes, coalesced", () => {
  const scene = source("src/app/scene/genesis/GenesisScene.tsx");
  assert.match(scene, /window\.addEventListener\("resize", onResize\)/);
  assert.match(scene, /window\.visualViewport\?\.addEventListener\("resize", onResize\)/);
  assert.match(scene, /addEventListener\("orientationchange", onOrientation\)/);
  assert.match(scene, /screen\?\.orientation\?\.addEventListener\?\.\("change", onOrientation\)/);
  assert.match(scene, /CAPABILITY_RECHECK_MS/, "a burst of resize events is one decision");
  assert.match(scene, /manager\.reassessCapability\(/, "through the one manager, not a second policy");
  assert.doesNotMatch(scene, /useFrame\([^)]*reassess/, "and never per rendered frame");

  // WP05 changes WHEN capability is read, not WHO decides the frame loop — and
  // a measured "light" animates nothing without throwing the world away.
  assert.match(scene, /const canPaintAtAll = !softwareGL \|\| Boolean\(perfWorld\);/);
  assert.match(scene, /const paintWorld = canPaintAtAll && profile !== "light";/);
  assert.match(
    scene,
    /const staticWorld = canPaintAtAll && measuredLight && budgetedFrameloop !== "never";/,
  );
  assert.match(
    scene,
    /const frameloop: Frameloop = paintWorld\s*\?\s*budgetedFrameloop\s*:\s*staticWorld\s*\?\s*"demand"\s*:\s*"never";/,
  );
  assert.match(scene, /readRenderOverride\(window\.location\.search\)/, "the override is configuration");
  assert.ok(CAPABILITY_RECHECK_MS > 0);
  assert.equal(profileFor(GPU), "full");
});

test("the snapshot publishes why it is demoting, and how long the world has been gone", () => {
  const { manager } = setup(() => 4000);
  manager.setCapability(GPU);
  assert.equal(manager.slowSamples(), 0);
  assert.equal(manager.getSnapshot().lightSince, 0, "nothing has been taken away yet");

  for (let second = 0; second < DOWNGRADE_AFTER - 1; second += 1) {
    manager.reportFrameRate(10, true);
  }
  assert.equal(
    manager.slowSamples(),
    DOWNGRADE_AFTER - 1,
    "the run toward a demotion is readable before it happens, without publishing",
  );

  demote(manager);
  const gone = manager.getSnapshot();
  assert.equal(gone.profile, "light");
  assert.equal(gone.lightSince, 4000, "when the world was taken away, on the manager's own clock");
  assert.equal(
    gone.worldPainting,
    true,
    "a measured light keeps a world to draw: the canvas is mounted, painting on demand",
  );
  manager.reportFrameRate(1, true);
  assert.equal(gone.profile, "light", "and further slow seconds cannot demote further");
  assert.equal(
    manager.getSnapshot().lightSince,
    4000,
    "when the world was taken away does not move while it stays away",
  );

  manager.reassessCapability({ ...GPU, narrow: true }, "orientation");
  assert.equal(manager.getSnapshot().lightSince, 0, "re-derived on a new surface: light since is not stale");
});

test("the context guard reports what came back, and diagnostics publish the reason", () => {
  const guard = source("src/app/scene/genesis/render/RenderContextGuard.tsx");
  assert.match(guard, /manager\.reportContextRestored\(id\)/);
  assert.match(guard, /manager\.observeRenderer\(/);

  const adaptive = source("src/app/scene/genesis/AdaptiveQuality.tsx");
  assert.match(adaptive, /profileReason: snapshot\.reason/);
  assert.match(adaptive, /painting: snapshot\.worldPainting/);
  assert.match(adaptive, /override: snapshot\.override\?\.source \?\? null/);
  assert.match(adaptive, /contextLost: snapshot\.lostContexts\[0\] \?\? null/);
  assert.match(
    adaptive,
    /manager\.reportFrameRate\(fps, mode === "full"\)/,
    "a paused canvas still reports \"not painting\", never \"slow\"",
  );
});
