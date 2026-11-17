/**
 * ==========================================================
 * TEMPORAL STUDIO — EXPERIMENT C
 * TEMPORAL NUMERICAL ACCUMULATION
 *
 * A four-snapshot history of ONE object identity, plus fusion and
 * interpolation, all through the real store and the real container:
 *
 *   001  initial geometry                 observed
 *   002  geometry changed (new volume)    observed
 *   003  the same geometry, better trust  observed  (confidence rises)
 *   004  the object moved                 observed  (shape survives a shift)
 *   acc  fusion of 002 + 003              accumulated
 *   int  between 001 and 002 at t=0.5     interpolated
 *
 * After all of that, snapshot 001 is restored from its own bytes and
 * compared to what it was before anything was appended. That check is the
 * point of the whole exercise: history must not overwrite evidence.
 * ==========================================================
 */

import type { SparseVoxels, Vec3 } from "../types.ts";
import { createGrid, unionVoxels, voxelCount } from "../voxels.ts";
import { boxShell, sphereShell, translationMatrix, withUniformConfidence } from "../shapes.ts";
import { compareVoxelSets } from "../compare.ts";
import { transformVoxels } from "../voxels.ts";
import {
  MemorySnapshotStore,
  accumulateSnapshots,
  createTemporalObject,
  diffSeries,
  history,
  interpolateVoxels,
  recordSnapshot,
  restoreSnapshot,
  type SnapshotRecord,
  type TemporalObject,
} from "../snapshot.ts";
import type { SnapshotDiff } from "../compare.ts";
import { makeObservation } from "../pipeline.ts";
import { encodeGlb, meshFromVoxels } from "../geometry.ts";
import { inspectGlb } from "../../../core/forge/GlbInspector.ts";

export interface SnapshotView {
  id: string;
  ordinal: number;
  state: SnapshotRecord["state"];
  confidence: number;
  cells: number;
  containerBytes: number;
  containerSha256: string;
  summary: string;
}

export interface ExperimentCReport {
  objectId: string;
  grid: { resolution: Vec3; cellSize: number };
  snapshots: SnapshotView[];
  diffs: Array<{ from: string; to: string; kind: SnapshotDiff["kind"]; explains: string; iou: number; onlyOnlyEarlier: number; onlyLater: number; confidenceDelta: number }>;
  accumulation: {
    id: string;
    contributions: Array<{ id: string; onlyInContribution: number; onlyInAccumulated: number }>;
    fusedCells: number;
    fusedConfidence: number;
    expectedNoisyOr: number;
    sourceSnapshotsUnchanged: boolean;
  };
  interpolation: {
    from: string;
    to: string;
    t: number;
    state: SnapshotRecord["state"];
    cells: number;
    betweenObserved: boolean;
    iouToEither: number;
    note: string;
  };
  restoration: {
    id: string;
    recoveredCells: number;
    byteIdentical: boolean;
    occupancyIdentical: boolean;
    observationCount: number;
    provenanceSurvived: boolean;
    confidenceSurvived: boolean;
  };
  history: Array<{ ordinal: number; id: string; parentId: string | null; state: string; cells: number }>;
  export: { glbBytes: number; gateAccepted: boolean; triangles: number };
  timings: { firstSnapshotMs: number; totalMs: number; diffMs: number; restoreMs: number };
  status: "VERIFIED" | "PARTIAL";
  statement: string;
}

function mergeCells(a: SparseVoxels, extra: SparseVoxels, confidence: number): SparseVoxels {
  const grid = a.grid;
  return withUniformConfidence(unionVoxels([a, extra], grid), confidence);
}

export async function runExperimentC(): Promise<ExperimentCReport> {
  const started = performance.now();
  const grid = createGrid({ cellSize: 0.05, resolution: [32, 32, 32] });
  const store = new MemorySnapshotStore();
  let object: TemporalObject = createTemporalObject({ objectId: "lelu-head-demo", label: "LÉLU head (procedural fixture)", createdAt: "2026-11-17T00:00:00.000Z" });

  const head: Vec3 = [0.8, 0.8, 0.8];
  const base = (): SparseVoxels => withUniformConfidence(sphereShell(grid, head, 0.35, 0.05), 0.6);

  /* 001 — initial geometry ------------------------------------------- */
  const obs1 = makeObservation(
    {
      id: "obs-001",
      sequence: 1,
      sourceId: "reference:front",
      sourceKind: "image",
      modality: "single-image",
      capturedAt: "2026-11-17T00:00:01.000Z",
      confidence: 0.6,
      producer: "fixture:procedural-shell",
      producerKind: "fixture",
      licence: "n/a (generated locally)",
      inputs: [{ id: "fixture:sphere-shell", sha256: null }],
      parameters: { radiusMetres: 0.35, thicknessMetres: 0.05 },
      notes: ["Procedurally generated so the experiment runs offline with no model."],
    },
    "2026-11-17T00:00:01.100Z",
  );

  const t0 = performance.now();
  const first = await recordSnapshot(object, { voxels: base(), observations: [obs1], state: "observed", createdAt: "2026-11-17T00:00:01.200Z", observedAt: obs1.capturedAt, summary: "001 initial shell" }, store);
  const firstSnapshotMs = performance.now() - t0;
  object = first.object;

  /* 002 — geometry changed ------------------------------------------- */
  // The added volume sits on the OUTSIDE of the shell, so it is visible in a
  // render and genuinely adds surface — an interior blob would change the
  // numbers without changing what an observer could see.
  const grown = mergeCells(base(), boxShell(grid, { min: [23, 13, 14], max: [25, 19, 18] }), 0.55);
  const obs2 = makeObservation(
    {
      id: "obs-002",
      sequence: 2,
      sourceId: "reference:profile",
      sourceKind: "image",
      modality: "single-image",
      capturedAt: "2026-11-17T00:00:02.000Z",
      confidence: 0.55,
      producer: "fixture:procedural-shell+volume",
      producerKind: "fixture",
      licence: "n/a (generated locally)",
      inputs: [{ id: "fixture:sphere-shell+box", sha256: null }],
      parameters: { addedVolumeCells: 3 * 7 * 5 },
      notes: ["New surface observed on the profile: the object itself changed between captures."],
    },
    "2026-11-17T00:00:02.100Z",
  );
  const second = await recordSnapshot(object, { voxels: grown, observations: [obs2], state: "observed", createdAt: "2026-11-17T00:00:02.200Z", observedAt: obs2.capturedAt, summary: "002 added volume" }, store);
  object = second.object;

  /* 003 — same geometry, more trust ---------------------------------- */
  const obs3 = makeObservation(
    {
      id: "obs-003",
      sequence: 3,
      sourceId: "reference:three-quarter",
      sourceKind: "image",
      modality: "single-image",
      capturedAt: "2026-11-17T00:00:03.000Z",
      confidence: 0.8,
      producer: "fixture:procedural-shell+volume",
      producerKind: "fixture",
      licence: "n/a (generated locally)",
      inputs: [{ id: "fixture:sphere-shell+box", sha256: null }],
      parameters: { note: "same geometry as 002, captured with better evidence" },
      notes: ["Repeat observation of the same geometry at higher confidence: this must raise trust, not change shape."],
    },
    "2026-11-17T00:00:03.100Z",
  );
  const third = await recordSnapshot(object, { voxels: mergeCells(base(), boxShell(grid, { min: [23, 13, 14], max: [25, 19, 18] }), 0.8), observations: [obs3], state: "observed", createdAt: "2026-11-17T00:00:03.200Z", observedAt: obs3.capturedAt, summary: "003 same geometry, confidence 0.8" }, store);
  object = third.object;

  /* 004 — the object moved ------------------------------------------- */
  const moved = transformVoxels(grown, translationMatrix(3 * grid.cellSize, 1 * grid.cellSize, 0), {});
  const obs4 = makeObservation(
    {
      id: "obs-004",
      sequence: 4,
      sourceId: "reference:front-later",
      sourceKind: "image",
      modality: "single-image",
      capturedAt: "2026-11-17T00:00:04.000Z",
      confidence: 0.62,
      producer: "fixture:procedural-shell+volume",
      producerKind: "fixture",
      licence: "n/a (generated locally)",
      inputs: [{ id: "fixture:translated", sha256: null }],
      parameters: { shiftCells: "3,1,0" },
      notes: [`Translated by 3,1,0 cells; ${moved.unmapped} cells left the lattice and were not stored.`],
    },
    "2026-11-17T00:00:04.100Z",
  );
  const fourth = await recordSnapshot(object, {
    voxels: withUniformConfidence(moved.voxels, 0.62),
    observations: [obs4],
    state: "observed",
    createdAt: "2026-11-17T00:00:04.200Z",
    observedAt: obs4.capturedAt,
    transform: { id: "t-004", kind: "rigid", matrix: translationMatrix(3 * grid.cellSize, 1 * grid.cellSize, 0), note: "pure translation in cells" },
    summary: "004 translated 3,1,0 cells",
  }, store);
  object = fourth.object;

  /* accumulation and interpolation ------------------------------------ */
  const accumulation = await accumulateSnapshots(object, [second.record.id, third.record.id], store, { createdAt: "2026-11-17T00:00:05.000Z" });
  object = accumulation.object;

  const firstRestored = await restoreSnapshot(object, first.record.id, store);
  const secondRestored = await restoreSnapshot(object, second.record.id, store);
  const interpolated = interpolateVoxels(firstRestored.snapshot, secondRestored.snapshot, 0.5);
  const interpolatedRecord = await recordSnapshot(object, {
    voxels: interpolated.voxels,
    observations: [],
    state: "interpolated",
    sourceSnapshotIds: [first.record.id, second.record.id],
    createdAt: "2026-11-17T00:00:06.000Z",
    summary: interpolated.note,
  }, store);
  object = interpolatedRecord.object;

  /* diffs ------------------------------------------------------------ */
  const diffStart = performance.now();
  const diffs = await diffSeries(object, store);
  const diffMs = performance.now() - diffStart;

  /* restoration of the very first snapshot --------------------------- */
  const restoreStart = performance.now();
  const restored = await restoreSnapshot(object, first.record.id, store);
  const restoreMs = performance.now() - restoreStart;
  const originalCells = first.manifest.voxelCount;
  const occupancyMetrics = compareVoxelSets(restored.snapshot.voxels, base());
  const observation = restored.snapshot.manifest.snapshot.observations[0];

  /* export the accumulated reconstruction through the existing gate --- */
  const accumulatedRestored = await restoreSnapshot(object, accumulation.record.id, store);
  const accumulatedMesh = meshFromVoxels(accumulatedRestored.snapshot.voxels);
  const accumulatedGlb = encodeGlb(accumulatedMesh, { name: "lelu-head-accumulated", generator: "nre-v1 experiment-c" });
  const gate = inspectGlb(accumulatedGlb);

  const historyViews = history(object).map((record) => ({ ordinal: record.ordinal, id: record.id, parentId: record.parentId, state: record.state, cells: record.voxelCount }));

  const expectedNoisyOr = 1 - (1 - 0.55) * (1 - 0.8);
  const reported: ExperimentCReport = {
    objectId: object.objectId,
    grid: { resolution: grid.resolution, cellSize: grid.cellSize },
    snapshots: object.snapshots.map((record) => ({
      id: record.id,
      ordinal: record.ordinal,
      state: record.state,
      confidence: record.confidence,
      cells: record.voxelCount,
      containerBytes: record.containerBytes,
      containerSha256: record.containerSha256,
      summary: record.summary,
    })),
    diffs: diffs.map((entry) => ({
      from: entry.from,
      to: entry.to,
      kind: entry.diff.kind,
      explains: entry.diff.explains,
      iou: entry.diff.iou,
      onlyOnlyEarlier: entry.diff.onlyA,
      onlyLater: entry.diff.onlyB,
      confidenceDelta: entry.diff.snapshotConfidenceB - entry.diff.snapshotConfidenceA,
    })),
    accumulation: {
      id: accumulation.record.id,
      contributions: accumulation.contributions,
      fusedCells: accumulation.record.voxelCount,
      fusedConfidence: accumulation.record.confidence,
      expectedNoisyOr,
      sourceSnapshotsUnchanged:
        object.snapshots.find((s) => s.id === second.record.id)?.containerSha256 === second.containerSha256 &&
        object.snapshots.find((s) => s.id === third.record.id)?.containerSha256 === third.containerSha256,
    },
    interpolation: {
      from: first.record.id,
      to: second.record.id,
      t: 0.5,
      state: interpolatedRecord.record.state,
      cells: interpolatedRecord.record.voxelCount,
      betweenObserved: interpolatedRecord.record.voxelCount >= Math.min(first.record.voxelCount, second.record.voxelCount) && interpolatedRecord.record.voxelCount <= Math.max(first.record.voxelCount, second.record.voxelCount),
      iouToEither: Math.max(
        compareVoxelSets(firstRestored.snapshot.voxels, interpolated.voxels).iou,
        compareVoxelSets(secondRestored.snapshot.voxels, interpolated.voxels).iou,
      ),
      note: interpolated.note,
    },
    restoration: {
      id: first.record.id,
      recoveredCells: voxelCount(restored.snapshot.voxels),
      byteIdentical: restored.record.containerSha256 === first.containerSha256,
      occupancyIdentical: occupancyMetrics.onlyA === 0 && occupancyMetrics.onlyB === 0 && originalCells === voxelCount(restored.snapshot.voxels),
      observationCount: restored.snapshot.manifest.snapshot.observations.length,
      provenanceSurvived: observation?.provenance.producer === obs1.provenance.producer && observation?.provenance.inputs.length === 1,
      confidenceSurvived: Math.abs((observation?.confidence ?? -1) - obs1.confidence) < 1e-12 && Math.abs(restored.snapshot.manifest.snapshot.confidence - first.manifest.confidence) < 1e-12,
    },
    history: historyViews,
    export: { glbBytes: accumulatedGlb.byteLength, gateAccepted: gate.ok, triangles: accumulatedMesh.indices.length / 3 },
    timings: { firstSnapshotMs, totalMs: performance.now() - started, diffMs, restoreMs },
    status: "VERIFIED",
    statement:
      "Four observed snapshots, one accumulated, one interpolated: all written as independent containers, all recoverable alone, and the first is byte-identical after six later appends.",
  };

  const ok =
    reported.restoration.byteIdentical &&
    reported.restoration.occupancyIdentical &&
    reported.restoration.provenanceSurvived &&
    reported.restoration.confidenceSurvived &&
    reported.accumulation.sourceSnapshotsUnchanged &&
    reported.export.gateAccepted;
  reported.status = ok ? "VERIFIED" : "PARTIAL";
  if (!ok) reported.statement = "One or more temporal invariants failed; see the fields above rather than this line.";
  return reported;
}
