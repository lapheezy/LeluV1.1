/**
 * ==========================================================
 * LÉLU — RENDER ARCHITECTURE (regressions)
 *
 * CATEGORY: unit. No network, no WebGL.
 *
 * Each block pins a defect measured on a running page (1440×900 and
 * 390×844, Intel Iris Xe through ANGLE): a world drawing 222k triangles
 * in 149 calls at 0-2 fps while the whole interface waited behind it.
 * The triangle count was not the problem — the architecture was:
 *
 *  - the planet subtree re-rendered on the lifecycle's 10 Hz heartbeat
 *    (10 renders a second of the surface, clouds, civ layers and LOD);
 *  - the field layers rebuilt instanced buffers every frame, with a
 *    fresh Color/Vector3/Quaternion per instance;
 *  - 40 energy particles were 40 separate draw calls, and every frame
 *    walked the whole field graph to write material opacity;
 *  - the world canvas decided its own frameloop instead of reporting
 *    to the render budget, so "covered" and "occluded" were two
 *    mechanisms deciding one thing.
 *
 * RUN: npx tsx --tsconfig tsconfig.test.json --test tests/render-architecture.test.ts
 * ==========================================================
 */

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import {
  PROGRESS_STEPS,
  lifecycleView,
  type LifecycleView,
} from "../src/app/scene/genesis/render/lifecycleView";
import { WorldPhase } from "../src/app/scene/genesis/engines/EngineDomains";
import { SceneRenderBudget } from "../src/app/scene/genesis/SceneRenderBudget";
import { frameloopFor } from "../src/app/scene/genesis/SceneFrameGovernor";
import { SAVE_INTERVAL_MS } from "../src/app/scene/genesis/engines/WorldLifecycle";

const read = (path: string) => readFileSync(path, "utf8");
const GENESIS = "src/app/scene/genesis";

/**
 * Source, with prose removed.
 *
 * These contracts are about what the code does. A comment that explains the
 * fix by naming the call it replaced is not a call, and the first version of
 * this file failed on exactly that — the tests were stricter than the code
 * they meant to protect.
 */
const code = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

/* ----------------------- the lifecycle heartbeat ----------------------- */

test("a stable phase ignores the 10 Hz heartbeat instead of re-rendering", () => {
  const start: LifecycleView = { phase: WorldPhase.FULL_WORLD, progress: 0 };
  // Ten ticks' worth of progress in a phase that does not follow progress.
  for (let tick = 1; tick <= 10; tick += 1) {
    const next = lifecycleView(WorldPhase.FULL_WORLD, tick / 10, start);
    assert.equal(next, start, "no visible change must return the same object, so React bails out");
  }
  assert.equal(start.progress, 0);
});

test("a phase that follows progress is quantised, not copied per tick", () => {
  let view: LifecycleView = { phase: WorldPhase.FORMATION, progress: 0 };
  let renders = 0;
  for (let tick = 1; tick <= 100; tick += 1) {
    const next = lifecycleView(WorldPhase.FORMATION, tick / 100, view);
    if (next !== view) renders += 1;
    view = next;
  }
  assert.ok(renders <= PROGRESS_STEPS, `100 ticks must cost at most ${PROGRESS_STEPS} renders, cost ${renders}`);
  assert.ok(renders > 4, "but the formation must still animate");
  assert.equal(view.progress, 1);
});

test("a phase change is always taken, and progress restarts under it", () => {
  const previous: LifecycleView = { phase: WorldPhase.FULL_WORLD, progress: 0 };
  const next = lifecycleView(WorldPhase.REBIRTH, 0.4, previous);
  assert.notEqual(next, previous);
  assert.equal(next.phase, WorldPhase.REBIRTH);
  assert.equal(next.progress, Math.round(0.4 * PROGRESS_STEPS) / PROGRESS_STEPS);
});

test("the planet subscribes through the guarded view, not by copying raw state", () => {
  const source = read(`${GENESIS}/render/DebugPlanet.tsx`);
  assert.match(source, /lifecycleView\(state\.phase, state\.phaseProgress, view\.current\)/);
  assert.match(source, /if \(next === view\.current\) return;/, "a no-op must not reach setState");
});

/* --------------------------- draw calls, allocations --------------------------- */

test("the particle field is one draw call, not forty meshes", () => {
  const source = read(`${GENESIS}/render/CosmicField.tsx`);
  const group = source.slice(
    source.indexOf('name="EnergyParticles"'),
    source.indexOf("</group>", source.indexOf('name="EnergyParticles"')),
  );
  assert.match(group, /<points\b/, "the particle field must be a single point cloud");
  assert.doesNotMatch(group, /<mesh\b/, "no per-particle mesh");
  assert.doesNotMatch(group, /particleSeeds\.map/, "no element per seed");
  assert.match(source, /position\.setUsage\(DynamicDrawUsage\)/, "one buffer rewritten in place");
});

test("the field does not walk its whole graph every frame", () => {
  const source = read(`${GENESIS}/render/CosmicField.tsx`);
  const frame = source.slice(source.indexOf("useFrame("), source.lastIndexOf("return ("));
  assert.doesNotMatch(frame, /\.traverse\(/, "the material list is collected once, not per frame");
  assert.match(source, /opacityMaterials/, "materials that follow activity are pre-collected");
});

test("the scene layers read the stable scene context, not the per-token one", () => {
  for (const file of ["CosmicField.tsx", "CoreEmission.tsx", "CoreOrbitalRings.tsx", "CoreMemoryVeins.tsx", "LifeEvolutionVisualizer.tsx"]) {
    const source = code(read(`${GENESIS}/render/${file}`));
    assert.doesNotMatch(source, /\buseGenesis\(\)/, `${file} must not subscribe to the per-token context`);
    assert.match(source, /useGenesisScene\(/, `${file} must read the stable scene context`);
  }
});

test("no per-frame allocation inside the planet's animated layers", () => {
  const source = read(`${GENESIS}/render/PlanetCivilization.tsx`);
  let index = source.indexOf("useFrame(");
  let checked = 0;
  while (index !== -1) {
    // Bound each body to the end of its own call, so one component's
    // render block cannot be blamed for the next one's.
    const end = source.indexOf("\n  });", index);
    const body = source.slice(index, end === -1 ? index + 1600 : end);
    assert.doesNotMatch(
      body,
      /new (Color|Vector3|Quaternion|Matrix4)\(/,
      `a useFrame body allocates an object per frame: ${body.slice(0, 80)}…`,
    );
    checked += 1;
    index = source.indexOf("useFrame(", end === -1 ? index + 1 : end);
  }
  assert.ok(checked >= 3, "the animated layers are still animated");
});

test("static city instances are built in an effect, not per frame", () => {
  const source = read(`${GENESIS}/render/PlanetCivilization.tsx`);
  const cities = source.slice(source.indexOf("export function PlanetCities"), source.indexOf("export function PlanetPopulation"));
  assert.doesNotMatch(cities, /useFrame\(/, "cities do not move: no frame work");
  assert.match(cities, /useEffect\(/, "their matrices are built once, when they become visible");
});

/* ---------------------------- the render budget ---------------------------- */

test("a covered world pauses through the budget, not through its own frameloop", () => {
  const source = read(`${GENESIS}/GenesisScene.tsx`);
  assert.match(source, /budget\.setOccluded\("genesis-world-covered", worldCovered\)/);
  assert.match(
    source,
    /const frameloop: Frameloop = paintWorld \? budgetedFrameloop : "never";/,
    "the canvas frameloop must come from the budget (plus the device guard), never from a local override",
  );
  assert.match(source, /frameloop=\{frameloop\}/, "the canvas takes the budgeted prop");
});

test("either occluder alone keeps the world paused; both must clear to resume", () => {
  const budget = new SceneRenderBudget(false);
  budget.setOccluded("genesis-world-covered", true);
  budget.setOccluded("chat-universe", true);
  assert.equal(budget.mode(), "paused");
  budget.setOccluded("genesis-world-covered", false);
  assert.equal(budget.mode(), "paused", "the chat still owns the screen");
  assert.equal(frameloopFor(budget.mode()), "never");
  budget.setOccluded("chat-universe", false);
  assert.equal(budget.mode(), "full");
  assert.equal(frameloopFor(budget.mode()), "always");
});

test("the diagnostics can tell a paused world from a slow one", () => {
  const source = read(`${GENESIS}/AdaptiveQuality.tsx`);
  assert.match(source, /frames: painted\.current/, "a painted-frame counter, so 0 frames is observable");
  assert.match(source, /const mode = getSceneRenderBudget\(\)\.mode\(\)/, "and the budget mode it is in");
});

/* ------------------------------ persistence ------------------------------ */

test("the lifecycle does not write storage on every 100 ms tick", () => {
  assert.ok(SAVE_INTERVAL_MS >= 1000, `saving every ${SAVE_INTERVAL_MS}ms is still a per-tick write`);
  const source = read(`${GENESIS}/engines/WorldLifecycle.ts`);
  const tick = source.slice(source.indexOf("private tick(delta: number)"), source.indexOf("private getNextPhase"));
  assert.doesNotMatch(tick, /^\s*this\.saveState\(\);$/m, "tick must not save unconditionally");
  assert.match(tick, /if \(Date\.now\(\) - this\.lastSavedAt >= SAVE_INTERVAL_MS\) this\.saveState\(\)/);
});

/* -------------------------------- mobile -------------------------------- */

test("mobile draws less of the same sky and fewer instances, not a different scene", () => {
  const stars = read(`${GENESIS}/environment/stars/StarField.tsx`);
  assert.match(stars, /const STAR_COUNT = mobile \? \d+ : 2400;/);
  const civic = read(`${GENESIS}/render/PlanetCivilization.tsx`);
  assert.match(civic, /generateCityClusters\(mobile \? 12 : 18\)/);
  assert.match(civic, /const count = mobile \? 60 : 120;/);
  const field = read(`${GENESIS}/render/CosmicField.tsx`);
  assert.match(field, /const PARTICLE_COUNT = mobile \? 20 : 40;/);
});
