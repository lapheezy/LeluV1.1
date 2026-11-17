/**
 * LÉLU ASRE — temporal snapshots: parent links, diffs, verified replay,
 * restoration, and measured change classification.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { SparseVoxelGrid, iou, type Observation, type Vec3 } from "../src/core/asre/nre";
import { SnapshotIntegrityError, SnapshotStore, compareGrids } from "../src/core/asre/temporal";
import { ballCells, translateCells } from "../src/core/asre/volume/shapes";

const spec = { resolution: 0.01, origin: [0, 0, 0] as Vec3, dims: [64, 64, 64] as Vec3, coordinateSystem: "y-up-right-handed" as const };
let n = 0;
function obs(confidence = 0.7, provenance: Observation["provenance"] = "OBSERVED"): Observation {
  n++;
  return { id: `o${n}`, capturedAt: n, source: "test", modality: "voxel-grid", provenance, confidence, parameters: {}, fingerprint: `fp${n}`, lineage: [] };
}
function gridOf(cells: Vec3[], o = obs()): SparseVoxelGrid {
  const g = new SparseVoxelGrid(spec);
  g.fuse(o, cells);
  return g;
}

test("snapshots form a parented history; each stores only its diff", () => {
  const store = new SnapshotStore();
  const g = gridOf(ballCells([20, 20, 20], 5));
  const s1 = store.commit(g, { label: "first view" });
  g.fuse(obs(0.6), ballCells([24, 20, 20], 5));
  const s2 = store.commit(g, { label: "second view" });
  assert.equal(s1.parentId, null);
  assert.equal(s2.parentId, s1.id);
  assert.equal(s1.diff.added.length, s1.cellCount);
  assert.ok(s2.diff.added.length > 0 && s2.diff.changed.length > 0);
  assert.ok(s2.diff.added.length + s2.diff.changed.length < s2.cellCount, "unaffected cells are not repeated in the diff");
  assert.deepEqual(store.lineage(s2.id).map((s) => s.label), ["first view", "second view"]);
});

test("historical reconstruction replays diffs and verifies the recorded hash", () => {
  const store = new SnapshotStore({ cacheLimit: 1 });
  const g = gridOf(ballCells([20, 20, 20], 6));
  const states: SparseVoxelGrid[] = [g.clone()];
  store.commit(g, { label: "s1" });
  for (let i = 0; i < 4; i++) {
    g.fuse(obs(0.3 + i * 0.1), ballCells([20 + i, 22, 20], 4 + i));
    for (const c of ballCells([10, 10, 10], 2)) g.delete(...c); // a no-op until something exists there
    states.push(g.clone());
    store.commit(g, { label: `s${i + 2}` });
  }
  store.dropCache();
  const ids = store.list().map((s) => s.id);
  ids.forEach((id, i) => {
    const back = store.replay(id);
    assert.equal(iou(back, states[i]), 1);
    for (const [code, cell] of states[i].entries()) assert.deepEqual(back.getByCode(code), cell);
  });
});

test("tampered history is refused, not silently restored", () => {
  const store = new SnapshotStore();
  const g = gridOf(ballCells([20, 20, 20], 4));
  const s = store.commit(g, { label: "s" });
  store.dropCache();
  // A frozen snapshot cannot be edited in place…
  assert.throws(() => ((s as { label: string }).label = "x"), TypeError);
  // …but its diff arrays could be mutated by a buggy caller: replay must catch it.
  s.diff.added.pop();
  assert.throws(() => store.replay(s.id), SnapshotIntegrityError);
});

test("restore commits an old state as a new head; nothing is rewritten", () => {
  const store = new SnapshotStore();
  const g = gridOf(ballCells([20, 20, 20], 4));
  const s1 = store.commit(g, { label: "small" });
  g.fuse(obs(), ballCells([20, 20, 20], 8));
  const s2 = store.commit(g, { label: "big" });
  const r = store.restore(s1.id);
  assert.equal(store.headId, r.id);
  assert.equal(r.parentId, s2.id);
  assert.deepEqual(r.transformations, [{ kind: "restore", fromSnapshot: s1.id }]);
  // restored geometry equals s1; the evidence table keeps every observation (append-only)
  const restored = store.materialize(r.id);
  const original = store.materialize(s1.id);
  assert.equal(iou(restored, original), 1);
  for (const [code, cell] of original.entries()) assert.equal(restored.getByCode(code)!.confidence, cell.confidence);
  assert.equal(store.list().length, 3);
});

test("observation tables must extend the parent's", () => {
  const store = new SnapshotStore();
  store.commit(gridOf(ballCells([20, 20, 20], 3)), { label: "a" });
  assert.throws(() => store.commit(gridOf(ballCells([20, 20, 20], 3)), { label: "unrelated" }), SnapshotIntegrityError);
});

test("temporal expansion is classified from measurements", () => {
  const c = compareGrids(gridOf(ballCells([30, 30, 30], 5)), gridOf(ballCells([30, 30, 30], 7)));
  assert.equal(c.classification, "expansion");
  assert.equal(c.removed, 0);
  assert.ok(c.volumeRatio > 2.5);
});

test("rigid movement is classified with the measured translation", () => {
  const base = ballCells([30, 30, 30], 6);
  const c = compareGrids(gridOf(base), gridOf(translateCells(base, [3, 0, -2])));
  assert.equal(c.classification, "rigid-translation");
  assert.deepEqual(c.bestTranslation.delta, [3, 0, -2]);
  assert.equal(c.bestTranslation.iou, 1);
  assert.ok(c.iou < 0.8, "plain overlap alone would have called it a large change");
});

test("contraction, deformation and unchanged", () => {
  const big = gridOf(ballCells([30, 30, 30], 7));
  assert.equal(compareGrids(big, gridOf(ballCells([30, 30, 30], 5))).classification, "contraction");
  assert.equal(compareGrids(big, gridOf(ballCells([30, 30, 30], 7))).classification, "unchanged");
  const blob = gridOf([...ballCells([30, 30, 30], 4), ...ballCells([38, 30, 30], 4)]);
  assert.equal(compareGrids(big, blob).classification, "deformation");
});
