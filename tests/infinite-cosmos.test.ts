/**
 * ==========================================================
 * LÉLU — INFINITE COSMOS ENGINE
 *
 * CATEGORY: unit. The real engine singleton, no renderer.
 *
 * What the scene relies on and what used to be wrong:
 *   - the first preload must reach subscribers, or the star field
 *     mounts empty and stays empty until the camera crosses a
 *     40-unit chunk boundary;
 *   - coordinates are deterministic: the same chunk regenerates
 *     with the same ids and positions after it was dropped;
 *   - exploring streams new regions in and the loaded set stays
 *     bounded, however far the camera goes or however many
 *     destinations are preloaded;
 *   - the flattened render data is shared, not rebuilt for every
 *     subscriber on every change.
 * ==========================================================
 */

import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";

import InfiniteCosmos from "../src/app/scene/genesis/engines/InfiniteCosmos";

const SIZE = InfiniteCosmos.getChunkSize();

function engine(): InfiniteCosmos {
  return InfiniteCosmos.getInstance();
}

beforeEach(() => {
  engine().updateCameraPosition(0, 0, 0);
  engine().reset();
});

test("preloading notifies subscribers, so the first frame is not an empty sky", () => {
  const cosmos = engine();
  cosmos.clear();
  let calls = 0;
  const unsubscribe = cosmos.subscribe(() => { calls += 1; });
  cosmos.preloadAround(0, 0, 0);
  unsubscribe();
  assert.ok(calls >= 1, "a preload that fills chunks must emit");
  assert.ok(cosmos.getRenderableData().stars.length > 0);
});

test("a preload that adds nothing new does not emit", () => {
  const cosmos = engine();
  cosmos.preloadAround(0, 0, 0);
  let calls = 0;
  const unsubscribe = cosmos.subscribe(() => { calls += 1; });
  cosmos.preloadAround(0, 0, 0);
  unsubscribe();
  assert.equal(calls, 0);
});

test("the same coordinates regenerate the same content", () => {
  const cosmos = engine();
  const far = { x: 37 * SIZE + 3, y: -12 * SIZE + 7, z: 5 * SIZE + 1 };
  cosmos.updateCameraPosition(far.x, far.y, far.z);
  const before = cosmos.getChunkAt(far.x, far.y, far.z);
  assert.ok(before, "the camera's own chunk is loaded");
  const snapshot = JSON.stringify({ ...before, lastAccessed: 0 });

  // Leave, so the chunk is dropped, then come back.
  cosmos.updateCameraPosition(0, 0, 0);
  assert.equal(cosmos.getChunkAt(far.x, far.y, far.z), undefined, "far chunk was unloaded");
  cosmos.updateCameraPosition(far.x, far.y, far.z);
  const after = cosmos.getChunkAt(far.x, far.y, far.z);
  assert.ok(after);
  assert.equal(JSON.stringify({ ...after, lastAccessed: 0 }), snapshot);
});

test("ids are unique across the loaded set (no duplicated chunks or stars)", () => {
  const cosmos = engine();
  cosmos.updateCameraPosition(SIZE * 2.5, 0, 0);
  cosmos.preloadAround(SIZE * 2.5, 0, 0);
  const { stars, galaxies } = cosmos.getRenderableData();
  assert.equal(new Set(stars.map((s) => s.id)).size, stars.length);
  assert.equal(new Set(galaxies.map((g) => g.id)).size, galaxies.length);
  const keys = cosmos.getChunks().map((c) => `${c.coord.cx},${c.coord.cy},${c.coord.cz}`);
  assert.equal(new Set(keys).size, keys.length);
});

test("exploring streams in regions that were never generated", () => {
  const cosmos = engine();
  const generatedAtStart = cosmos.getTotalGenerated();
  const x = 500 * SIZE;
  assert.equal(cosmos.isPositionLoaded(x, 0, 0), false);
  cosmos.updateCameraPosition(x, 0, 0);
  assert.equal(cosmos.isPositionLoaded(x, 0, 0), true);
  assert.ok(cosmos.getTotalGenerated() > generatedAtStart);
  assert.deepEqual(cosmos.getCameraChunk(), { cx: 500, cy: 0, cz: 0 });
});

test("the loaded set stays bounded on a long walk and under repeated preloads", () => {
  const cosmos = engine();
  const cap = InfiniteCosmos.getMaxLoadedChunks();
  for (let step = 0; step < 60; step += 1) {
    cosmos.updateCameraPosition(step * SIZE, (step % 7) * SIZE, -step * SIZE);
    assert.ok(cosmos.getLoadedCount() <= cap, `loaded ${cosmos.getLoadedCount()} > cap ${cap} at step ${step}`);
  }
  for (let i = 0; i < 40; i += 1) {
    cosmos.preloadAround(i * 13 * SIZE, -i * 9 * SIZE, i * 4 * SIZE);
    assert.ok(cosmos.getLoadedCount() <= cap, `loaded ${cosmos.getLoadedCount()} > cap ${cap} after preload ${i}`);
  }
  // Whatever was evicted, the camera's own neighbourhood never is.
  const camera = cosmos.getCameraPosition();
  assert.equal(cosmos.isPositionLoaded(camera.x, camera.y, camera.z), true);
});

test("render data is shared between subscribers until something changes", () => {
  const cosmos = engine();
  const a = cosmos.getRenderableData();
  const b = cosmos.getRenderableData();
  assert.equal(a, b, "same snapshot when nothing changed");
  cosmos.updateCameraPosition(9 * SIZE, 0, 0);
  const c = cosmos.getRenderableData();
  assert.notEqual(c, a, "a new snapshot after streaming");
});

test("moving inside one chunk does not regenerate or emit", () => {
  const cosmos = engine();
  let calls = 0;
  const unsubscribe = cosmos.subscribe(() => { calls += 1; });
  const generated = cosmos.getTotalGenerated();
  cosmos.updateCameraPosition(1, 2, 3);
  cosmos.updateCameraPosition(SIZE - 1, SIZE - 1, SIZE - 1);
  unsubscribe();
  assert.equal(calls, 0);
  assert.equal(cosmos.getTotalGenerated(), generated);
});
