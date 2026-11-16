/**
 * M15.3 WP04: her world's first paint and the walk deadline.
 * Measured evidence: docs/missions/m15-home/avatar-15.3/wp04/.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import AvatarCommandBus, { type AvatarCommand } from "../src/core/avatar/AvatarCommandBus";

test("WP04: a command carries the bus's own deadline, on the issue clock", async () => {
  const bus = AvatarCommandBus.getInstance();
  let seen: AvatarCommand | null = null;
  const off = bus.subscribe((c) => { seen = c; });
  const pending = bus.issue("move", "walk to the studio", 20_000, { place: "studio" });
  off();
  assert.ok(seen);
  const c = seen as AvatarCommand;
  assert.equal(c.timeoutMs, 20_000, "the deadline the presence reports against is the bus's, unchanged");
  assert.ok(Math.abs(c.issuedAt - Date.now()) < 1000);
  bus.confirm(c.id, "test");
  assert.equal(await pending, "test");
});

test("WP04: her progress report is timed from the bus deadline (not a fixed 17 s that pre-empted arrival)", () => {
  const presence = readFileSync("src/app/scene/genesis/LeluV2Presence.tsx", "utf8");
  assert.doesNotMatch(presence, /\}, 17_000\);/);
  assert.match(presence, /command\.issuedAt \+ command\.timeoutMs - REPORT_MARGIN_MS - Date\.now\(\)/);
  assert.match(presence, /const REPORT_MARGIN_MS = 400;/);
  // The 20 s requirement itself is untouched.
  assert.match(readFileSync("src/core/router/AvatarResolver.ts", "utf8"), /motion\.kind === "move" \? 20_000/);
});

test("WP04: a covered scene is prepared with its OWN renderer, in bounded slices, without drawing", () => {
  const governor = readFileSync("src/app/scene/genesis/SceneFrameGovernor.tsx", "utf8");
  assert.match(governor, /useCoveredPreparation\(mode === "paused"\)/);
  assert.match(governor, /gl\.compile\(scene, camera\)/, "programs are submitted by the canvas's own renderer");
  assert.match(governor, /next\.getUniforms\(\);/, "one program's first use per slice");
  assert.match(governor, /gl\.initTexture\(t\);/, "one texture per slice");
  assert.doesNotMatch(governor, /new WebGLRenderer|getContext\("webgl|\.render\(scene/, "no second renderer or context, and no frame drawn under the cover");
});

test("WP04: the GPU is probed once per page, not on every environment refresh", () => {
  const env = readFileSync("src/core/cognition/SystemEnvironment.ts", "utf8");
  assert.match(env, /if \(gpuProbe\) return gpuProbe;/);
  assert.match(env, /gpuProbe = probeGpuNow\(\);/);
});
