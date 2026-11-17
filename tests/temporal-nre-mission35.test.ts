/**
 * Mission 3.5 — volumetric preservation, adaptive representation,
 * interpolation with uncertainty, and honest Experiment A reporting.
 *
 * These tests assert measured properties, not intentions: that interior
 * cells survive serialisation, that a boundary does not, that a punched
 * shell is refused rather than filled, that classifications come from
 * cell statistics, and that interpolation never claims to be observation.
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

import {
  buildSparseVoxels,
  createGrid,
  deserializeSnapshot,
  serializeSnapshot,
  voxelCount,
  withConfidence,
} from "../src/temporal/nre/index.ts";
import type { SnapshotManifest } from "../src/temporal/nre/index.ts";
import { boxShell, filledBox, filledSphere, planeSheet, randomSparse, sphereShell, translationMatrix } from "../src/temporal/nre/index.ts";
import { transformVoxels } from "../src/temporal/nre/index.ts";
import { unionVoxels } from "../src/temporal/nre/index.ts";
import { connectedComponents, measureVolume, measureVolumeRoundTrip, solidFromSurface, surfaceFromSolid } from "../src/temporal/nre/volume.ts";
import { analyseMotion, analyseRepresentation } from "../src/temporal/nre/select.ts";
import { interpolateSnapshots, interpolateTransform } from "../src/temporal/nre/interpolate.ts";
import {
  runInterpolationExperiment,
  runPerformance35,
  runRepresentationExperiment,
  runVolumeExperiment,
} from "../src/temporal/nre/experiments/mission35.ts";
import { MemorySnapshotStore, createTemporalObject, recordSnapshot, restoreSnapshot } from "../src/temporal/nre/index.ts";
import { makeObservation, planSingleImageReconstruction } from "../src/temporal/nre/index.ts";
import { encodeGlb, meshFromVoxels, voxelizeMesh } from "../src/temporal/nre/geometry.ts";
import { inspectGlb, readGlbGeometry } from "../src/core/forge/GlbInspector.ts";

const G16 = createGrid({ cellSize: 0.05, resolution: [16, 16, 16] });
const G24 = createGrid({ cellSize: 0.05, resolution: [24, 24, 24] });

function cellsOf(voxels: ReturnType<typeof filledBox>): Array<[number, number, number]> {
  const out: Array<[number, number, number]> = [];
  for (let v = 0; v < voxelCount(voxels); v++) out.push([voxels.coords[v * 3], voxels.coords[v * 3 + 1], voxels.coords[v * 3 + 2]]);
  return out;
}

const manifest = (cells: number): SnapshotManifest => ({
  id: "",
  state: "observed",
  createdAt: "2026-11-17T00:00:00.000Z",
  observedAt: null,
  confidence: 0.7,
  lineage: { objectId: "mission35", parentSnapshotId: null, sourceSnapshotIds: [], ordinal: 0 },
  transform: { id: "identity", kind: "identity", matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], note: "identity" },
  observations: [],
  voxelCount: cells,
  bbox: { min: [0, 0, 0], max: [0, 0, 0] },
  summary: "mission 3.5 test",
});

test("WP1: interior fraction is measured, and a solid is mostly interior", () => {
  const solid = filledBox(G16, { min: [2, 2, 2], max: [13, 13, 13] });
  const metrics = measureVolume(solid);
  assert.equal(metrics.cells, 1728);
  assert.equal(metrics.boundaryCells, 728);
  assert.equal(metrics.interiorCells, 1000);
  assert.ok(metrics.interiorFraction > 0.5, `interior fraction ${metrics.interiorFraction}`);
  assert.equal(metrics.components, 1);

  const shell = boxShell(G16, { min: [2, 2, 2], max: [13, 13, 13] });
  const shellMetrics = measureVolume(shell);
  assert.equal(shellMetrics.interiorCells, 0);
  assert.equal(shellMetrics.cells, 728);
});

test("WP1: the container keeps every interior cell, byte for byte", async () => {
  const solid = withConfidence(filledSphere(G16, [0.4, 0.4, 0.4], 0.3), 0.7);
  const { bytes } = await serializeSnapshot(manifest(voxelCount(solid)), solid, { createdAt: "2026-11-17T00:00:00.000Z" });
  const loaded = await deserializeSnapshot(bytes);
  assert.equal(voxelCount(loaded.voxels), voxelCount(solid), "no cell may be dropped by serialisation");
  assert.deepEqual(Array.from(loaded.voxels.coords), Array.from(solid.coords));
  assert.equal(loaded.manifest.occupancy, solid.occupancy);
});

test("WP1: a boundary mesh loses the interior, and solidifying recovers it", () => {
  const solid = withConfidence(filledBox(G16, { min: [2, 2, 2], max: [13, 13, 13] }), 0.7);
  const surface = surfaceFromSolid(solid);
  assert.equal(voxelCount(surface), 728, "a boundary can only carry the shell");

  const rebuilt = solidFromSurface(surface);
  assert.equal(rebuilt.closed, true, "a closed shell must be recognised as closed");
  assert.equal(rebuilt.enclosedCells, 1000);
  assert.equal(voxelCount(rebuilt.volume), 1728, "boundary + closure recovers the solid exactly");

  const inferred = rebuilt.volume.attributes.inferred;
  assert.ok(inferred, "inferred cells must be flagged");
  assert.equal(inferred.reduce((s, v) => s + v, 0), 1000, "exactly the recovered interior is marked inferred");
  const confidences = rebuilt.volume.attributes.confidence;
  assert.equal(confidences?.filter((c) => c === 0).length, 1000, "inferred cells carry confidence 0, not invented confidence");

  const roundTrip = measureVolumeRoundTrip(solid);
  assert.equal(roundTrip.direction, "volume→surface→volume");
  assert.equal(roundTrip.iou, 1);
  assert.equal(roundTrip.lossFraction, 0);
});

test("WP1: an open shell is refused, not filled", () => {
  const shell = boxShell(G16, { min: [2, 2, 2], max: [13, 13, 13] });
  const punched = buildSparseVoxels(
    G16,
    cellsOf(shell).filter(([i, j, k]) => !(i === 2 && j >= 7 && j <= 9 && k >= 7 && k <= 9)),
  );
  const result = solidFromSurface(punched);
  assert.equal(result.closed, false, "a hole lets the outside flood in, so nothing is enclosed");
  assert.equal(result.enclosedCells, 0);
  assert.equal(voxelCount(result.volume), voxelCount(punched), "no geometry may be invented around a leak");
  assert.ok(result.notes.some((n) => /open/.test(n)));
});

test("WP2: every shape is classified from measurement, with reasons", async () => {
  const report = await runRepresentationExperiment();
  assert.equal(report.summary.failed, 0, JSON.stringify(report.cases.filter((c) => !c.pass), null, 1));
  assert.equal(report.summary.status, "VERIFIED");

  const solid = report.cases.find((c) => c.name === "solid box");
  assert.equal(solid?.actual, "volumetric");
  assert.equal(solid?.storage, "sparse-volume");
  assert.ok(solid?.rejected && solid.rejected > 0, "the rejected representation must be stated");
  assert.ok(solid?.reasons.some((r) => /a boundary mesh would keep only 728/.test(r)));

  const hollow = report.cases.find((c) => c.name === "closed shell");
  assert.equal(hollow?.actual, "hollow");

  const points = report.cases.find((c) => c.name === "point cloud");
  assert.equal(points?.actual, "point-cloud");
  assert.ok(points?.metrics.isolatedFraction && points.metrics.isolatedFraction > 0.9);

  const sheet = report.cases.find((c) => c.name === "flat sheet");
  assert.equal(sheet?.actual, "sparse-surface");

  const articulated = report.cases.find((c) => c.name === "two blocks moving differently");
  assert.equal(articulated?.actual, "articulated", JSON.stringify(articulated?.temporal));
  assert.ok(articulated?.temporal && articulated.temporal.componentShifts.length >= 2);

  const deforming = report.cases.find((c) => c.name === "surface change, no rigid explanation");
  assert.equal(deforming?.actual, "deforming");
});

test("WP2: motion is measured per component, so articulation is not guessed", () => {
  const a = withConfidence(filledBox(G24, { min: [3, 3, 3], max: [6, 6, 6] }), 0.7);
  const b = withConfidence(filledBox(G24, { min: [15, 3, 3], max: [18, 6, 6] }), 0.7);
  const before = unionVoxels([a, b], G24);
  const after = unionVoxels(
    [
      transformVoxels(a, translationMatrix(3 * G24.cellSize, 0, 0), {}).voxels,
      transformVoxels(b, translationMatrix(0, 0, 4 * G24.cellSize), {}).voxels,
    ],
    G24,
  );
  assert.equal(connectedComponents(before).length, 2);

  const motion = analyseMotion(before, after);
  assert.equal(motion.componentShifts.length, 2);
  const shifts = motion.componentShifts.map((s) => s.shift.join(","));
  assert.equal(new Set(shifts).size, 2, "the two parts must report different shifts");
  assert.ok(motion.componentShifts.every((s) => s.match > 0.99), JSON.stringify(motion.componentShifts));
});

test("WP3: interpolation labels, confidence propagation and uncertainty", async () => {
  const store = new MemorySnapshotStore();
  let object = createTemporalObject({ objectId: "interp-test", createdAt: "2026-11-17T00:00:00.000Z" });
  const start = withConfidence(sphereShell(G24, [0.5, 0.5, 0.5], 0.3, 0.05), 0.5);
  const end = withConfidence(transformVoxels(start, translationMatrix(4 * G24.cellSize, 0, 0), {}).voxels, 0.9);

  const observation = (id: string, confidence: number) =>
    makeObservation({
      id,
      sequence: 1,
      sourceId: "fixture",
      sourceKind: "synthetic",
      modality: "synthetic",
      capturedAt: "2026-11-17T00:00:00.000Z",
      confidence,
      producer: "test",
      producerKind: "fixture",
      licence: "n/a",
      inputs: [],
      parameters: {},
      notes: [],
    });

  const first = await recordSnapshot(object, { voxels: start, observations: [observation("a", 0.5)], createdAt: "2026-11-17T00:00:01.000Z" }, store);
  object = first.object;
  const second = await recordSnapshot(object, { voxels: end, observations: [observation("b", 0.9)], createdAt: "2026-11-17T00:00:02.000Z" }, store);
  object = second.object;
  const a = await restoreSnapshot(object, first.record.id, store);
  const b = await restoreSnapshot(object, second.record.id, store);

  for (const method of ["occupancy-blend", "rigid", "correspondence"] as const) {
    const mid = interpolateSnapshots(a.snapshot, b.snapshot, 0.5, { method, correspondenceRadius: 6 });
    assert.equal(mid.state, "interpolated", `${method} must label its output interpolated`);
    assert.ok(mid.metrics.cells > 0);
    // Uncertainty is 0 only where BOTH endpoints support a cell — that is
    // agreement, not a missing measurement. It must be > 0 wherever evidence
    // is one-sided.
    if (mid.metrics.fromAOnly + mid.metrics.fromBOnly > 0) {
      assert.ok(mid.metrics.meanUncertainty > 0, `${method} must report uncertainty halfway between observations`);
    }
    assert.ok(mid.metrics.meanConfidence <= 0.9 + 1e-9, `${method} must not invent confidence above the best observation`);
    assert.deepEqual(mid.sources, [a.record.id, b.record.id]);
    assert.match(mid.note, /interpolated|blend|interpolation/);

    const atZero = interpolateSnapshots(a.snapshot, b.snapshot, 0, { method, correspondenceRadius: 6 });
    assert.ok(atZero.metrics.meanUncertainty < 1e-9, `${method} must be certain at t=0 (nothing interpolated)`);
  }

  const rigid = interpolateSnapshots(a.snapshot, b.snapshot, 0.5, { method: "rigid", correspondenceRadius: 6 });
  assert.ok(rigid.metrics.meanDisplacementCells > 0, "rigid interpolation must place cells between the endpoints");

  const correspondence = interpolateSnapshots(a.snapshot, b.snapshot, 0.5, { method: "correspondence", correspondenceRadius: 6 });
  assert.ok(correspondence.metrics.fromBoth > 0, "correspondence must keep the shared surface");
  assert.ok(correspondence.metrics.agreement > 0 && correspondence.metrics.agreement <= 1);
});

test("WP3: transform interpolation slerps rotation and matches at the endpoints", () => {
  const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const target = [0, 0, -1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 1, 2, 3, 1];
  const zero = interpolateTransform(identity, target, 0);
  const one = interpolateTransform(identity, target, 1);
  const half = interpolateTransform(identity, target, 0.5);

  for (let i = 0; i < 16; i++) {
    assert.ok(Math.abs(zero[i] - identity[i]) < 1e-9, `t=0 must equal the source at ${i}`);
    assert.ok(Math.abs(one[i] - target[i]) < 1e-9, `t=1 must equal the target at ${i}`);
  }
  assert.ok(Math.abs(Math.hypot(half[0], half[1], half[2]) - 1) < 1e-9, "rotation columns stay unit length");
  assert.ok(Math.abs(half[13] - 1) < 1e-9, "translation interpolates linearly");
  assert.throws(() => interpolateTransform(identity, target, 1.4), /within \[0,1\]/);
});

test("WP1/WP7: the volume experiment reports real preservation and loss numbers", async () => {
  const report = await runVolumeExperiment();
  assert.equal(report.summary.status, "VERIFIED");
  assert.ok(report.summary.containerPreservedAll, "every case must survive the container intact");
  assert.ok(report.summary.boundaryLossMeanFraction > 0.05, `mean boundary loss ${report.summary.boundaryLossMeanFraction}`);

  const solid = report.cases.find((c) => c.name === "solid-box-12³");
  assert.ok(solid);
  assert.equal(solid.containerIou, 1);
  assert.equal(solid.glbCells, 728);
  assert.ok(solid.glbLossFraction > 0.57 && solid.glbLossFraction < 0.58);
  assert.equal(solid.solidifiedClosed, true);
  assert.equal(solid.solidifyIou, 1, "boundary plus closure recovers the whole solid");

  const punched = report.cases.find((c) => c.name === "punched-shell (open)");
  assert.ok(punched);
  assert.equal(punched.solidifiedClosed, false);
  assert.equal(punched.solidifiedCells, punched.glbCells, "an open shell must not be filled");

  for (const c of report.cases) {
    assert.ok(c.glbValid || c.name === "sparse-cloud", `${c.name} GLB should pass the gate`);
    assert.ok(c.compressionRatio > 0);
  }
});

test("WP7: performance rows cover conversion, interpolation and export", async () => {
  const report = await runPerformance35();
  assert.equal(report.status, "VERIFIED");
  const operations = report.rows.map((r) => r.operation);
  for (const required of ["measureVolume", "solidFromSurface", "boundaryOf", "measureVolumeRoundTrip", "serialize", "encodeGlb", "interpolate(correspondence)"]) {
    assert.ok(operations.includes(required), `missing ${required}`);
  }
  assert.ok(report.memory.volumeBytes > report.memory.surfaceBytes, "a volume stores more cells than its boundary");
  assert.ok(report.memory.overheadFactor > 1);
  for (const row of report.rows) assert.ok(row.milliseconds >= 0 && Number.isFinite(row.milliseconds));
});

test("WP5: Experiment A is reported honestly, whether it ran or not", () => {
  const artifact = "artifacts/mission3/experiment_a.json";
  if (existsSync(artifact)) {
    const report = JSON.parse(readFileSync(artifact, "utf8")) as {
      status: string;
      gate: { accepted: boolean; vertices: number; triangles: number };
      numerical: { cells: number; representation: string };
      container: { bytes: number };
      export: { accepted: boolean; roundTripIou: number };
    };
    assert.ok(report.numerical.cells > 0, "a real run must produce cells");
    assert.ok(report.gate.vertices > 0 && report.gate.triangles > 0);
    assert.ok(report.container.bytes > 0);
    // Our own export is re-inspected by the same gate that accepted the input.
    assert.equal(report.export.accepted, true);
    assert.ok(report.export.roundTripIou > 0.5, `round trip IoU ${report.export.roundTripIou}`);
    return;
  }

  const plan = planSingleImageReconstruction({
    imageSha256: "c".repeat(64),
    imageBytes: 10,
    grid: G16,
    cpuOnly: true,
    availableVramGb: 0,
    modelAvailable: false,
  });
  assert.equal(plan.status, "BLOCKED");
  assert.ok(plan.blockers.length > 0);
});

/* ------------------------------------------------------------------ WP4/WP6 */

test("WP4: a solid exports to a GLB the production gate accepts, and it reads back", () => {
  const solid = filledSphere(G24, [0.6, 0.6, 0.6], 0.44);
  const metrics = measureVolume(solid);
  const mesh = meshFromVoxels(solid);
  const glb = encodeGlb(mesh, { name: "mission35-export", generator: "nre-mission35-test" });

  assert.equal(Buffer.from(glb.slice(0, 4)).toString("latin1"), "glTF", "the file must carry the glTF magic");
  const gate = inspectGlb(glb);
  assert.equal(gate.ok, true, JSON.stringify(gate.problems));
  assert.ok(gate.geometry.triangles > 1000, `expected a real mesh, got ${gate.geometry.triangles} triangles`);

  // Bounds come from the accessor, so a viewer that never reads the buffer
  // still knows how big the object is.
  const extent = gate.geometry.bounds?.size ?? [];
  assert.ok(extent.every((e) => e > 0.7 && e < 1.0), `unexpected out-of-lattice bounds: ${JSON.stringify(extent)}`);

  // A boundary export cannot carry every cell: 12 triangles per cell would be
  // the "every cell as a cube" count, and this must be far below it.
  assert.ok(
    gate.geometry.triangles < metrics.cells * 12,
    `a boundary export emitted ${gate.geometry.triangles} triangles for ${metrics.cells} cells`,
  );

  const back = voxelizeMesh(readGlbGeometry(glb), G24, { samplesPerCell: 3 });
  assert.ok(voxelCount(back) > 0, "reading our own GLB must recover occupied cells");
});

const FOUNDRY_GLB = "leluverse/assets/characters/lelu_character/foundry/v002_base/lelu_foundry.glb";

test(
  "WP6: an existing production GLB still passes the same gate",
  { skip: existsSync(FOUNDRY_GLB) ? false : "foundry asset is not present in this checkout" },
  () => {
    const gate = inspectGlb(new Uint8Array(readFileSync(FOUNDRY_GLB)));
    assert.equal(gate.ok, true, JSON.stringify(gate.problems));
    assert.ok(gate.geometry.triangles > 100_000, `expected a production mesh, got ${gate.geometry.triangles}`);
  },
);
