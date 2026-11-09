/**
 * Mission 10 — screen perception: the pure parts (change detection and
 * which frames a turn carries). The live capture is verified by
 * scripts/verify-screen-e2e.cjs in a real browser.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { framesForPrompt, lumaSignature, signatureDistance, type SharedFrame } from "../src/core/perception/ScreenShare";

const solid = (r: number, g: number, b: number, n = 4) => {
  const px = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i += 1) px.set([r, g, b, 255], i * 4);
  return px;
};

test("luminance signature: one byte per pixel, weighted like the eye", () => {
  assert.deepEqual([...lumaSignature(solid(255, 255, 255, 2))], [255, 255]);
  assert.deepEqual([...lumaSignature(solid(0, 0, 0, 2))], [0, 0]);
  assert.equal(lumaSignature(solid(0, 255, 0, 1))[0], 150, "green dominates perceived brightness (255 × 0.587, rounded)");
});

test("an unchanged screen is distance 0; a full black→white flip is 1; a small edit is small", () => {
  const a = lumaSignature(solid(200, 200, 200, 100));
  assert.equal(signatureDistance(a, a), 0);
  assert.equal(signatureDistance(lumaSignature(solid(0, 0, 0, 100)), lumaSignature(solid(255, 255, 255, 100))), 1);
  const b = new Uint8ClampedArray(a);
  b[0] = 0; // one pixel of 100 changed completely
  const d = signatureDistance(a, b);
  assert.ok(d > 0 && d < 0.02, `a one-pixel change (${d}) stays under the 0.02 "meaningful change" threshold`);
  assert.equal(signatureDistance(a, new Uint8ClampedArray(3)), 1, "different shapes never compare as equal");
});

test("a turn carries the latest frame; asking about a change adds the one before it", () => {
  const f = (at: number): SharedFrame => ({ at, dataUrl: `data:${at}`, width: 1, height: 1, change: 1 });
  assert.deepEqual(framesForPrompt([], "what is this?"), []);
  assert.deepEqual(framesForPrompt([f(1), f(2)], "what is this?").map((x) => x.at), [2]);
  assert.deepEqual(framesForPrompt([f(1), f(2), f(3)], "what changed on my screen?").map((x) => x.at), [2, 3]);
  assert.deepEqual(framesForPrompt([f(1)], "what changed?").map((x) => x.at), [1], "nothing before the first frame");
});
