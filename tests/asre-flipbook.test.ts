/**
 * LÉLU ASRE — WP2 flipbook: pages add information, resolve conflicts,
 * touch only affected regions, never double-count, and keep history.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { SparseVoxelGrid, iou, type Observation, type Vec3 } from "../src/core/asre/nre";
import { Flipbook, observeAlongAxis } from "../src/core/asre/temporal";
import { ballCells, boxCells } from "../src/core/asre/volume/shapes";

const spec = { resolution: 0.01, origin: [0, 0, 0] as Vec3, dims: [64, 64, 64] as Vec3, coordinateSystem: "y-up-right-handed" as const };
const ob = (id: string, confidence: number, provenance: Observation["provenance"] = "OBSERVED", fp = id): Observation => ({
  id, capturedAt: 0, source: "sim", modality: "depth-map", provenance, confidence, parameters: {}, fingerprint: fp, lineage: [],
});
function truth(): SparseVoxelGrid {
  const g = new SparseVoxelGrid(spec);
  g.fuse(ob("truth", 1), [...ballCells([32, 20, 32], 9), ...ballCells([32, 36, 32], 6), ...boxCells([30, 41, 30], [4, 6, 4])]);
  return g;
}
const box = { min: [18, 8, 18] as Vec3, max: [46, 50, 46] as Vec3 };
function prior(): SparseVoxelGrid {
  const g = new SparseVoxelGrid(spec);
  g.fuse(ob("hull-prior", 0.5, "INFERRED"), boxCells(box.min, [29, 43, 29]));
  return g;
}
const VIEWS: Array<[0 | 1 | 2, 1 | -1]> = [[0, 1], [0, -1], [2, 1], [2, -1], [1, 1], [1, -1]];

test("each page adds information and carves conflicts; IoU to the truth rises monotonically", () => {
  const t = truth();
  const book = new Flipbook(prior());
  let last = iou(book.current, t);
  let carvedTotal = 0;
  for (const [axis, sign] of VIEWS) {
    const { occupied, free } = observeAlongAxis(t, axis, sign, box);
    const r = book.turn({ observation: ob(`view${axis}${sign}`, 0.8), occupied, free });
    assert.equal(r.duplicate, false);
    assert.equal(r.carved, r.conflicts, "confident free space carves the weak prior");
    carvedTotal += r.carved;
    assert.equal(r.unaffectedVerified, true);
    const now = iou(book.current, t);
    assert.ok(now >= last, `IoU must not drop: ${last} → ${now}`);
    last = now;
  }
  assert.ok(carvedTotal > 0);
  assert.equal(last, 1, "this truth is fully explained by axis views");
  assert.equal(book.store.list().length, 7);
});

test("a repeated page changes nothing: no new snapshot, no confidence gain", () => {
  const t = truth();
  const book = new Flipbook(prior());
  const view = observeAlongAxis(t, 0, 1, box);
  book.turn({ observation: ob("v", 0.8), ...view });
  const before = book.current;
  const r = book.turn({ observation: ob("v-again", 0.8, "OBSERVED", "v"), ...view });
  assert.equal(r.duplicate, true);
  assert.equal(r.snapshot, null);
  assert.equal(book.store.list().length, 2);
  for (const [code, cell] of before.entries()) assert.equal(book.current.getByCode(code)!.confidence, cell.confidence);
});

test("a local page touches only its region; everything else is verified identical", () => {
  const t = truth();
  const book = new Flipbook(prior());
  for (const [axis, sign] of VIEWS) book.turn({ observation: ob(`view${axis}${sign}`, 0.8), ...observeAlongAxis(t, axis, sign, box) });
  const sizeBefore = book.current.size;
  // close-up of the head only
  const local = observeAlongAxis(t, 0, 1, { min: [18, 40, 26], max: [46, 50, 38] });
  const r = book.turn({ observation: ob("close-up", 0.95), ...local });
  assert.equal(r.unaffectedVerified, true);
  assert.ok(r.preservedCells > 0.8 * sizeBefore, `preserved ${r.preservedCells} of ${sizeBefore}`);
  assert.ok(r.affectedCellsBefore < 0.2 * sizeBefore);
});

test("weak free-space evidence against a confident cell is recorded, not carved", () => {
  const g = new SparseVoxelGrid(spec);
  g.fuse(ob("strong", 0.95), [[5, 5, 5]]);
  const book = new Flipbook(g);
  const r = book.turn({ observation: ob("glimpse", 0.3), occupied: [], free: [[5, 5, 5]] });
  assert.equal(r.conflicts, 1);
  assert.equal(r.carved, 0);
  assert.equal(r.conflictsKept, 1);
  assert.ok(book.current.has(5, 5, 5));
});

test("every page is a recoverable snapshot", () => {
  const t = truth();
  const book = new Flipbook(prior());
  const states = [book.current];
  for (const [axis, sign] of VIEWS.slice(0, 3)) {
    book.turn({ observation: ob(`view${axis}${sign}`, 0.8), ...observeAlongAxis(t, axis, sign, box) });
    states.push(book.current);
  }
  book.store.dropCache();
  book.store.list().forEach((s, i) => assert.equal(iou(book.store.replay(s.id), states[i]), 1));
});

test("limitation kept honest: a sealed cavity no ray reaches is never carved", () => {
  const t = new SparseVoxelGrid(spec);
  const hole = new Set(ballCells([32, 30, 32], 4).map((c) => c.join()));
  t.fuse(ob("truth", 1), ballCells([32, 30, 32], 12).filter((c) => !hole.has(c.join())));
  const book = new Flipbook(prior());
  for (const [axis, sign] of VIEWS) book.turn({ observation: ob(`view${axis}${sign}`, 0.8), ...observeAlongAxis(t, axis, sign, box) });
  const final = book.current;
  let stillFilled = 0;
  for (const c of hole) if (final.has(...(c.split(",").map(Number) as Vec3))) stillFilled++;
  assert.equal(stillFilled, hole.size, "the cavity remains as unverified prior (INFERRED) cells");
  assert.ok(iou(final, t) < 1);
  for (const c of hole) assert.equal(final.get(...(c.split(",").map(Number) as Vec3))!.provenance, 2, "cavity cells are only INFERRED, never OBSERVED");
});
