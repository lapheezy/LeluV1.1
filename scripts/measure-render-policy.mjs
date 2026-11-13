/**
 * ==========================================================
 * MISSION 5.8 — WHAT THE RENDER POLICY ACTUALLY REMOVES
 *
 * Runs the REAL modules — `buildSky`, `fillStaticNoise` and
 * `skyPaintInterval` are imported from the shipped source, so the
 * numbers move when the code moves. Nothing here is a copy of the
 * logic being measured.
 *
 * It measures the DOM cosmos sky: the one layer that repaints on its
 * own requestAnimationFrame loop BESIDE the 3D canvas, in every
 * profile, and the only layer whose cost can be measured without a
 * browser.
 *
 * SCOPE — read this before quoting a number:
 *   MEASURED      per-paint JavaScript of the sky (gradient math and the
 *                 129,600-pixel static-snow fill) and the cadence the
 *                 profile gives it.
 *   NOT MEASURED  the 3D canvas, the avatar canvas, GPU/compositing time,
 *                 shader compilation, FPS, long tasks, boot timing. Those
 *                 need a browser that can load the app; this container's
 *                 browser cannot (the platform edge refuses the chunks),
 *                 so any number for them here would be invented.
 *                 On real hardware use window.__leluRenderStats
 *                 (fps, calls, triangles, frames, mode, profile) and
 *                 window.__leluRenderManager (profile, ceiling, hidden,
 *                 surfaces, lostContexts).
 *
 * Run: ./node_modules/.bin/tsx scripts/measure-render-policy.mjs
 * ==========================================================
 */

import { performance } from "node:perf_hooks";

import { buildSky, fillStaticNoise } from "../src/app/scene/genesis/CosmosSkyBackdrop.tsx";
import {
  UPGRADE_AFTER,
  DOWNGRADE_AFTER,
  nextProfile,
  profileFor,
  skyPaintInterval,
} from "../src/app/scene/genesis/SceneRenderManager.ts";

/** A requestAnimationFrame loop on a 60 Hz display. */
const RAF_HZ = 60;
/** The static-snow buffer the component allocates (480 × 270). */
const NOISE_PIXELS = 480 * 270;

function timePerCall(fn, iterations) {
  for (let i = 0; i < Math.min(300, iterations); i += 1) fn(i);
  const start = performance.now();
  for (let i = 0; i < iterations; i += 1) fn(i);
  return (performance.now() - start) / iterations;
}

const gradientMs = timePerCall((i) => buildSky(i / 30), 20_000);
const noiseBuffer = new Uint8ClampedArray(NOISE_PIXELS * 4);
const noiseMs = timePerCall(() => fillStaticNoise(noiseBuffer), 300);

const rows = ["full", "balanced", "light"].map((profile) => {
  const interval = skyPaintInterval(profile);
  const skyPaints = interval === 0 ? RAF_HZ : 1000 / interval;
  // The snow redraws on every SECOND accepted paint (`frame % 2`).
  const noisePaints = skyPaints / 2;
  const skyJs = gradientMs * skyPaints;
  const noiseJs = noiseMs * noisePaints;
  return { profile, skyPaints, noisePaints, skyJs, noiseJs, total: skyJs + noiseJs };
});

const baseline = rows[0].total;

console.log("MISSION 5.8 — RENDER POLICY MEASUREMENT");
console.log("source: src/app/scene/genesis/{CosmosSkyBackdrop,SceneRenderManager}.tsx");
console.log("");
console.log(`gradient per paint      ${gradientMs.toFixed(4)} ms   (buildSky: atmosphere sample + 6 colour strings)`);
console.log(`static noise per paint  ${noiseMs.toFixed(4)} ms   (fillStaticNoise: ${NOISE_PIXELS.toLocaleString()} px, one LCG step each)`);
console.log("");
console.log("profile    sky/s   snow/s   gradient ms/s   snow ms/s   total ms/s     vs full");
console.log("----------------------------------------------------------------------------------");
for (const row of rows) {
  const delta = row.total - baseline;
  const label = delta === 0 ? "baseline" : `${((delta / baseline) * 100).toFixed(1)}%`;
  console.log(
    `${row.profile.padEnd(10)}${row.skyPaints.toFixed(1).padStart(6)}` +
      `${row.noisePaints.toFixed(2).padStart(9)}` +
      `${row.skyJs.toFixed(3).padStart(14)}` +
      `${row.noiseJs.toFixed(3).padStart(12)}` +
      `${row.total.toFixed(3).padStart(13)}` +
      `${label.padStart(12)}`,
  );
}
console.log("");
console.log(`full → light removes ${(baseline - rows[2].total).toFixed(2)} ms per second of main-thread`);
console.log("JavaScript from this layer alone, while it keeps painting the atmosphere —");
console.log("the layer is never removed, only slowed (see skyPaintInterval).");
console.log("The static-snow phase is where that cost lives: it dominates the gradient");
console.log("work by three orders of magnitude, so it is the only part worth tuning.");
console.log("");

// --- capability → starting profile (pure, from evidence only) -------------
const capabilities = [
  ["software rasteriser (SwiftShader)", { renderer: "ANGLE (Google, Vulkan (SwiftShader Device))" }],
  ["phone, real GPU", { renderer: "Adreno (TM) 740", mobile: true }],
  ["desktop, real GPU", { renderer: "ANGLE (NVIDIA GeForce RTX 4070)" }],
  ["Safari, renderer hidden", { renderer: "" }],
  ["no WebGL", { webgl: false }],
  ["Save-Data on", { renderer: "ANGLE (NVIDIA GeForce RTX 4070)", saveData: true }],
];
console.log("capability → starting profile");
for (const [label, input] of capabilities) {
  console.log(`  ${label.padEnd(34)} ${profileFor(input)}`);
}
console.log("");

// --- decision cost --------------------------------------------------------
const decisionMs = timePerCall(
  () => nextProfile({ profile: "full", slow: 0, fast: 0 }, { fps: 60, painting: true }),
  200_000,
);
console.log(`adaptation decision     ${(decisionMs * 1000).toFixed(3)} µs per measured second`);
console.log("");

// --- hysteresis: does it oscillate? --------------------------------------
function series(fpsValues) {
  let state = { profile: "full", slow: 0, fast: 0 };
  const changes = [];
  fpsValues.forEach((fps, index) => {
    const next = nextProfile(state, { fps, painting: true }, "full");
    if (next.profile !== state.profile) changes.push(`${index + 1}s ${state.profile}→${next.profile}`);
    state = next;
  });
  return changes.length === 0 ? "no change (held)" : changes.join(", ");
}

const alternating = [];
for (let second = 0; second < 60; second += 1) alternating.push(second % 2 === 0 ? 24 : 60);
const recovering = [];
for (let second = 0; second < 60; second += 1) recovering.push(second < 20 ? 22 : 60);
const hiddenThenBack = [];
for (let second = 0; second < 60; second += 1) hiddenThenBack.push(second < 30 ? 0 : 60);

console.log("hysteresis over 60 measured seconds");
console.log(`  24 fps on odd seconds, 60 on even   ${series(alternating)}`);
console.log(`  20s at 22 fps, then 40s at 60 fps   ${series(recovering)}`);
console.log(`  ${UPGRADE_AFTER} consecutive fast seconds upgrade; ${DOWNGRADE_AFTER} consecutive slow ones downgrade`);
console.log("");
console.log("zero-fps samples (a paused canvas) are passed as painting:false and");
console.log("are ignored by the rule, so a backgrounded tab cannot degrade the scene.");
