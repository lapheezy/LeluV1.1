/**
 * LÉLU ASRE — Mission 3.5 volumetric intelligence: boundary vs interior,
 * surface↔volume conversion, measured information loss, representation
 * selection, SDF interpolation and uncertainty propagation.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { SparseVoxelGrid, iou, type Observation, type Vec3 } from "../src/core/asre/nre";
import { ballCells, boxCells } from "../src/core/asre/volume/shapes";
import {
  fillInterior,
  interpolate,
  measureBoundaryLoss,
  selectRepresentation,
  signedDistance,
  surfaceOf,
  uncertaintyReport,
  unionBox,
  volumeStats,
} from "../src/core/asre/volume/volumetric";
import { compareGrids } from "../src/core/asre/temporal";

const spec = { resolution: 0.00625, origin: [0, 0, 0] as Vec3, dims: [96, 96, 96] as Vec3, coordinateSystem: "y-up-right-handed" as const };
const mk = (id: string, confidence = 0.8, provenance: Observation["provenance"] = "OBSERVED"): Observation => ({
  id, capturedAt: 0, source: "test", modality: "voxel-grid", provenance, confidence, parameters: {}, fingerprint: `fp-${id}`, lineage: [],
});
const fill = mk("fill", 0.9, "INFERRED");
function gridOf(cells: Vec3[], o = mk("scan")): SparseVoxelGrid {
  const g = new SparseVoxelGrid(spec);
  g.fuse(o, cells);
  return g;
}

test("volumetric experiment: sphere r=8.77 → 2,872 cells, 744 boundary, 2,128 interior (74.09%)", () => {
  const g = gridOf(ballCells([24, 24, 24], 8.77));
  const s = volumeStats(g);
  assert.deepEqual([s.total, s.boundary, s.interior], [2872, 744, 2128]);
  assert.equal((s.interiorFraction * 100).toFixed(2), "74.09");
});

test("dense block 12³: 1,728 cells, 728 boundary; boundary + fill rebuilds all 1,000 interior cells", () => {
  const g = gridOf(boxCells([10, 10, 10], [12, 12, 12]));
  const s = volumeStats(g);
  assert.deepEqual([s.total, s.boundary, s.interior], [1728, 728, 1000]);
  const surface = surfaceOf(g);
  assert.equal(surface.size, 728);
  const { grid, filled } = fillInterior(surface, fill);
  assert.equal(filled, 1000);
  assert.equal(iou(grid, g), 1);
  assert.deepEqual(grid.countByProvenance(), { OBSERVED: 728, INFERRED: 1000, SYNTHESIZED: 0, INTERPOLATED: 0 });
});

test("boundary-only storage loses information that all-cell volumetric storage keeps", () => {
  // A sphere with a sealed internal cavity, and interior evidence of its own
  // (e.g. a second, interior-only measurement).
  const cavity = new Set(ballCells([24, 24, 24], 3).map((c) => c.join()));
  const shell = ballCells([24, 24, 24], 8.77).filter((c) => !cavity.has(c.join()));
  const g = gridOf(shell);
  g.fuse(mk("interior-probe", 0.6, "INFERRED"), ballCells([24, 24, 24], 6).filter((c) => !cavity.has(c.join())));
  const loss = measureBoundaryLoss(g, fill);
  assert.ok(loss.droppedByBoundaryOnly > 0);
  assert.equal(loss.falseFill, cavity.size, "the cavity is wrongly filled");
  assert.ok(loss.refillIou < 1);
  assert.ok(loss.interiorEvidenceLost > 0, "interior evidence cannot be rebuilt from a boundary");
  assert.equal(loss.volumetricExact, true);
  // and the plain solid sphere shows boundary + fill is exact when nothing is inside
  const solid = measureBoundaryLoss(gridOf(ballCells([24, 24, 24], 8.77)), fill);
  assert.equal(solid.refillIou, 1);
  assert.equal(solid.falseFill, 0);
});

test("representation selector weighs measured loss against the intended use", () => {
  const solid = gridOf(ballCells([24, 24, 24], 8.77));
  assert.equal(selectRepresentation(solid, "render").choice, "surface-mesh");
  assert.equal(selectRepresentation(solid, "measure-volume").choice, "boundary-voxels");
  const cavity = new Set(ballCells([24, 24, 24], 3).map((c) => c.join()));
  const hollow = gridOf(ballCells([24, 24, 24], 8.77).filter((c) => !cavity.has(c.join())));
  const d = selectRepresentation(hollow, "measure-volume");
  assert.equal(d.choice, "volumetric-voxels");
  assert.equal(d.measurements.falseFill, cavity.size);
  assert.equal(selectRepresentation(hollow, "store").choice, "volumetric-voxels");
  assert.ok(d.reasons[0].includes("measure-volume"));
});

test("signed distance is exact for a sphere (± one cell)", () => {
  const g = gridOf(ballCells([24, 24, 24], 8));
  const box = unionBox([g])!;
  const sdf = signedDistance(g, box);
  const [, ny, nz] = box.dim;
  let worst = 0;
  for (const [x, y, z] of [[24, 24, 24], [24, 24, 33], [16, 30, 24], [30, 30, 30]] as Vec3[]) {
    const i = ((x - box.lo[0]) * ny + (y - box.lo[1])) * nz + (z - box.lo[2]);
    const truth = Math.hypot(x + 0.5 - 24, y + 0.5 - 24, z + 0.5 - 24) - 8;
    worst = Math.max(worst, Math.abs(sdf[i] - truth));
  }
  assert.ok(worst <= 1, `max error ${worst}`);
});

test("temporal interpolation: halfway between two positions, marked INTERPOLATED, less certain", () => {
  const a = gridOf(ballCells([20, 24, 24], 5), mk("t0", 0.9));
  const b = gridOf(ballCells([32, 24, 24], 5), mk("t1", 0.9));
  const mid = interpolate(a, b, 0.5, { id: "t0.5", capturedAt: 500 });
  assert.deepEqual(mid.motion, [12, 0, 0]);
  const cmp = compareGrids(a, mid.grid, { searchRadius: 2 });
  assert.equal(cmp.bestTranslation.delta[0], 6);
  assert.ok(cmp.bestTranslation.iou > 0.8, `shape kept: ${cmp.bestTranslation.iou}`);
  assert.equal(mid.grid.size, a.size, "motion-compensated: the moving ball keeps its volume");
  const plain = interpolate(a, b, 0.5, { id: "plain", capturedAt: 500, motionCompensate: false });
  assert.ok(plain.grid.size < 0.6 * a.size, `plain SDF blending shrinks a moving object (${plain.grid.size} vs ${a.size})`);
  assert.deepEqual(Object.keys(uncertaintyReport(mid.grid)), ["INTERPOLATED"]);
  assert.ok(mid.meanUncertainty > 1 - 0.9, "uncertainty grows between observations");
  const end = interpolate(a, b, 1, { id: "t1-again", capturedAt: 1000 });
  assert.equal(iou(end.grid, b), 1, "t=1 reproduces the later state");
  assert.ok(Math.abs(end.meanConfidence - 0.9) < 1e-9, "no damping at an observed instant");
});
