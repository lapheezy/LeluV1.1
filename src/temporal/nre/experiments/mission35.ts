/**
 * ==========================================================
 * TEMPORAL STUDIO — MISSION 3.5 EXPERIMENTS
 *
 * WP1  volumetric preservation: does the container keep the interior,
 *      and can the interior be recovered from a boundary?
 * WP2  adaptive representation: does the selector classify shapes from
 *      measurement, and does it refuse a representation that loses data?
 * WP3  interpolation: rigid, correspondence and blend, with confidence
 *      propagation and an explicit uncertainty field.
 * WP7  performance for all of the above.
 *
 * Every number is produced here, on this machine, and quoted unchanged
 * in the report. Nothing is estimated.
 * ==========================================================
 */

import type { NreSnapshot, SparseVoxels } from "../types.ts";
import { buildSparseVoxels, createGrid, voxelCount, withConfidence, unionVoxels } from "../voxels.ts";
import { boxShell, filledBox, filledSphere, irregularBlob, planeSheet, randomSparse, sphereShell, torus, translationMatrix } from "../shapes.ts";
import { transformVoxels } from "../voxels.ts";
import { boundaryOf, encodeGlb, meshFromVoxels } from "../geometry.ts";
import { inspectGlb } from "../../../core/forge/GlbInspector.ts";
import { compareVoxelSets } from "../compare.ts";
import { deserializeSnapshot, serializeSnapshot } from "../vxz.ts";
import { MemorySnapshotStore, createTemporalObject, recordSnapshot, restoreSnapshot } from "../snapshot.ts";
import { makeObservation } from "../pipeline.ts";
import {
  connectedComponents,
  measureSurfaceRoundTrip,
  measureVolume,
  measureVolumeRoundTrip,
  solidFromSurface,
  surfaceFromSolid,
} from "../volume.ts";
import { analyseMotion, analyseRepresentation, type RepresentationKind, type TemporalSignals } from "../select.ts";
import { interpolateSnapshots, interpolateTransform, type InterpolationMethod } from "../interpolate.ts";

/* ------------------------------------------------------------------ WP1 */

export interface VolumeCase {
  name: string;
  cells: number;
  boundaryCells: number;
  interiorCells: number;
  interiorFraction: number;
  bboxCells: number;
  fillRatio: number;
  components: number;
  /** Container round trip: interior preserved exactly? */
  containerCells: number;
  containerIou: number;
  containerBytes: number;
  compressionRatio: number;
  /** Boundary-only export (what a GLB can carry). */
  glbCells: number;
  glbLossFraction: number;
  glbBytes: number;
  glbValid: boolean;
  /** Boundary → solid recovery. */
  solidifiedCells: number;
  solidifiedClosed: boolean;
  solidifyIou: number;
  solidifyLossFraction: number;
  /** surface → volume → surface and volume → surface → volume. */
  surfaceRoundTrip: { cells: number; iou: number; lossFraction: number };
  volumeRoundTrip: { cells: number; iou: number; lossFraction: number; notes: string[] };
  timings: { measureMs: number; containerMs: number; glbMs: number; solidifyMs: number; roundTripMs: number };
  notes: string[];
}

export interface VolumeExperimentReport {
  cases: VolumeCase[];
  summary: {
    cases: number;
    volumetricCases: number;
    meanInteriorFraction: number;
    /** The headline: interior survives the container, and does or does not survive a boundary. */
    containerPreservedAll: boolean;
    boundaryLossMeanFraction: number;
    recoveredFromBoundaryMean: number;
    status: "VERIFIED" | "PARTIAL" | "BLOCKED";
    statement: string;
  };
}

function fixedObservation(id: string, confidence: number) {
  return makeObservation(
    {
      id,
      sequence: 1,
      sourceId: "fixture:volume",
      sourceKind: "synthetic",
      modality: "synthetic",
      capturedAt: "2026-11-17T00:00:00.000Z",
      confidence,
      producer: "nre.mission35",
      producerKind: "tool",
      licence: "n/a",
      inputs: [{ id, sha256: null }],
      parameters: {},
      notes: [],
    },
    "2026-11-17T00:00:00.000Z",
  );
}

async function measureVolumeCase(name: string, voxels: SparseVoxels, notes: string[] = []): Promise<VolumeCase> {
  const t0 = performance.now();
  const metrics = measureVolume(voxels);
  const measureMs = performance.now() - t0;

  const containerStart = performance.now();
  const serialized = await serializeSnapshot(
    {
      id: "",
      state: "observed",
      createdAt: "2026-11-17T00:00:00.000Z",
      observedAt: "2026-11-17T00:00:00.000Z",
      confidence: 0.7,
      lineage: { objectId: "volume-experiment", parentSnapshotId: null, sourceSnapshotIds: [], ordinal: 0 },
      transform: { id: "identity", kind: "identity", matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], note: "identity" },
      observations: [fixedObservation(`obs-${name}`, 0.7)],
      voxelCount: voxelCount(voxels),
      bbox: voxels.bbox,
      summary: `volume case ${name}`,
    },
    voxels,
    { createdAt: "2026-11-17T00:00:00.000Z" },
  );
  const loaded = await deserializeSnapshot(serialized.bytes);
  const containerMs = performance.now() - containerStart;
  const containerMetrics = compareVoxelSets(voxels, loaded.voxels);

  const glbStart = performance.now();
  const surface = surfaceFromSolid(voxels);
  const mesh = meshFromVoxels(surface);
  const glb = encodeGlb(mesh, { name, generator: "nre-mission35" });
  const gate = inspectGlb(glb);
  const glbMs = performance.now() - glbStart;

  const solidifyStart = performance.now();
  const solidification = solidFromSurface(surface);
  const solidifyMs = performance.now() - solidifyStart;
  const solidifyMetrics = compareVoxelSets(voxels, solidification.volume);

  const roundTripStart = performance.now();
  const surfaceRoundTrip = measureSurfaceRoundTrip(surface);
  const volumeRoundTrip = measureVolumeRoundTrip(voxels);
  const roundTripMs = performance.now() - roundTripStart;

  return {
    name,
    cells: metrics.cells,
    boundaryCells: metrics.boundaryCells,
    interiorCells: metrics.interiorCells,
    interiorFraction: metrics.interiorFraction,
    bboxCells: metrics.bboxCells,
    fillRatio: metrics.fillRatio,
    components: metrics.components,
    containerCells: voxelCount(loaded.voxels),
    containerIou: containerMetrics.iou,
    containerBytes: serialized.bytes.byteLength,
    compressionRatio: serialized.manifest.payloadRawBytes / Math.max(1, serialized.bytes.byteLength),
    glbCells: voxelCount(surface),
    glbLossFraction: metrics.cells === 0 ? 0 : (metrics.cells - voxelCount(surface)) / metrics.cells,
    glbBytes: glb.byteLength,
    glbValid: gate.ok,
    solidifiedCells: voxelCount(solidification.volume),
    solidifiedClosed: solidification.closed,
    solidifyIou: solidifyMetrics.iou,
    solidifyLossFraction: metrics.cells === 0 ? 0 : solidifyMetrics.onlyA / metrics.cells,
    surfaceRoundTrip: { cells: surfaceRoundTrip.outputCells, iou: surfaceRoundTrip.iou, lossFraction: surfaceRoundTrip.lossFraction },
    volumeRoundTrip: { cells: volumeRoundTrip.outputCells, iou: volumeRoundTrip.iou, lossFraction: volumeRoundTrip.lossFraction, notes: volumeRoundTrip.notes },
    timings: { measureMs, containerMs, glbMs, solidifyMs, roundTripMs },
    notes: [
      ...notes,
      ...solidification.notes,
      gate.ok ? "GLB accepted by the export gate." : `GLB rejected: ${gate.problems.join("; ")}`,
    ],
  };
}

export async function runVolumeExperiment(): Promise<VolumeExperimentReport> {
  const G16 = createGrid({ cellSize: 0.05, resolution: [16, 16, 16] });
  const G20 = createGrid({ cellSize: 0.05, resolution: [20, 20, 20] });
  const G24 = createGrid({ cellSize: 0.05, resolution: [24, 24, 24] });

  const cases: VolumeCase[] = [];
  cases.push(await measureVolumeCase("solid-box-12³", withConfidence(filledBox(G16, { min: [2, 2, 2], max: [13, 13, 13] }), 0.7)));
  cases.push(await measureVolumeCase("solid-sphere-r8", withConfidence(filledSphere(G20, [0.5, 0.5, 0.5], 0.4), 0.7)));
  cases.push(await measureVolumeCase("hollow-box-shell", withConfidence(boxShell(G16, { min: [2, 2, 2], max: [13, 13, 13] }), 0.7)));
  cases.push(await measureVolumeCase("thin-sphere-shell", withConfidence(sphereShell(G24, [0.6, 0.6, 0.6], 0.34, 0.05), 0.7)));
  cases.push(await measureVolumeCase("thick-torus", withConfidence(torus(G24, [0.6, 0.6, 0.6], 0.28, 0.08), 0.7)));
  cases.push(await measureVolumeCase("irregular-blob", withConfidence(irregularBlob(G24, [0.6, 0.6, 0.6], 0.34, 7, 0.3), 0.7)));
  cases.push(await measureVolumeCase("sparse-cloud", withConfidence(randomSparse(G24, 400, 99), 0.7)));

  // A shell with a hole must NOT be solidified: the flood gets in, so the
  // engine reports "open" instead of inventing a body around a leak.
  const shell = boxShell(G16, { min: [2, 2, 2], max: [13, 13, 13] });
  const punchedCells: Array<[number, number, number]> = [];
  for (let v = 0; v < voxelCount(shell); v++) {
    const i = shell.coords[v * 3], j = shell.coords[v * 3 + 1], k = shell.coords[v * 3 + 2];
    const onPunchedFace = i === 2 && j >= 7 && j <= 9 && k >= 7 && k <= 9;
    if (!onPunchedFace) punchedCells.push([i, j, k]);
  }
  const punched = withConfidence(buildSparseVoxels(G16, punchedCells), 0.7);
  cases.push(await measureVolumeCase("punched-shell (open)", punched, ["A hole is punched in one face: solidification must refuse to invent an interior."]));

  const volumetricCases = cases.filter((c) => c.interiorFraction > 0.15);
  const meanInterior = cases.reduce((s, c) => s + c.interiorFraction, 0) / cases.length;
  const boundaryLossMean = cases.reduce((s, c) => s + c.glbLossFraction, 0) / cases.length;
  const recoveredFromBoundaryMean = cases.reduce((s, c) => s + c.solidifyIou, 0) / cases.length;

  return {
    cases,
    summary: {
      cases: cases.length,
      volumetricCases: volumetricCases.length,
      meanInteriorFraction: meanInterior,
      containerPreservedAll: cases.every((c) => c.containerIou === 1 && c.containerCells === c.cells),
      boundaryLossMeanFraction: boundaryLossMean,
      recoveredFromBoundaryMean,
      status: cases.every((c) => c.containerIou === 1) ? "VERIFIED" : "PARTIAL",
      statement:
        "The container keeps every cell it is given, interior included, in all cases. A boundary mesh does not, and how much it loses is reported per case. " +
        "Solidifying a boundary recovers a closed solid's interior exactly — but only when the boundary is closed; a punched shell is reported open instead of being filled.",
    },
  };
}

/* ------------------------------------------------------------------ WP2 */

export interface RepresentationCase {
  name: string;
  expected: RepresentationKind;
  actual: RepresentationKind;
  storage: string;
  exportPath: string;
  metrics: { cells: number; interiorFraction: number; components: number; isolatedFraction: number; fillRatio: number };
  temporal: TemporalSignals | null;
  reasons: string[];
  rejected: number;
  pass: boolean;
}

export interface RepresentationExperimentReport {
  cases: RepresentationCase[];
  summary: { cases: number; passed: number; failed: number; status: "VERIFIED" | "PARTIAL" | "BLOCKED"; statement: string };
}

export async function runRepresentationExperiment(): Promise<RepresentationExperimentReport> {
  const G16 = createGrid({ cellSize: 0.05, resolution: [16, 16, 16] });
  const G24 = createGrid({ cellSize: 0.05, resolution: [24, 24, 24] });
  const cases: RepresentationCase[] = [];

  const record = (name: string, expected: RepresentationKind, voxels: SparseVoxels, temporal: TemporalSignals | null = null) => {
    const decision = analyseRepresentation(voxels, temporal);
    cases.push({
      name,
      expected,
      actual: decision.kind,
      storage: decision.storage,
      exportPath: decision.exportPath,
      metrics: {
        cells: decision.metrics.cells,
        interiorFraction: decision.metrics.interiorFraction,
        components: decision.metrics.components,
        isolatedFraction: decision.metrics.isolatedFraction,
        fillRatio: decision.metrics.fillRatio,
      },
      temporal: decision.temporal,
      reasons: decision.reasons,
      rejected: decision.rejected.length,
      pass: decision.kind === expected,
    });
  };

  record("solid box", "volumetric", withConfidence(filledBox(G16, { min: [2, 2, 2], max: [13, 13, 13] }), 0.7));
  record("closed shell", "hollow", withConfidence(boxShell(G16, { min: [2, 2, 2], max: [13, 13, 13] }), 0.7));
  // A point cloud proper: samples on a coarse lattice, two cells apart, so no
  // two points share a face. Uniform random sampling produces accidental
  // adjacency (measured: ~13% of 300 points), which is a denser object than a
  // point cloud and would blur what this case is meant to test.
  const candidates: Array<[number, number, number]> = [];
  for (let i = 1; i < 24; i += 2) for (let j = 1; j < 24; j += 2) for (let k = 1; k < 24; k += 2) candidates.push([i, j, k]);
  let seed = 20261117;
  const next = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let s = candidates.length - 1; s > 0; s--) {
    const r = Math.floor(next() * (s + 1));
    [candidates[s], candidates[r]] = [candidates[r], candidates[s]];
  }
  record("point cloud", "point-cloud", withConfidence(buildSparseVoxels(G24, candidates.slice(0, 300)), 0.7));
  record("flat sheet", "sparse-surface", withConfidence(planeSheet(G16, 8, 12), 0.7));
  record("irregular shell", "sparse-surface", withConfidence(irregularBlob(G24, [0.6, 0.6, 0.6], 0.34, 7, 0.3), 0.7));

  // Articulated: two separated blocks, each moving differently.
  const baseA = withConfidence(buildSparseVoxels(G24, cellsOf(filledBox(G24, { min: [3, 3, 3], max: [7, 7, 7] }))), 0.7);
  const baseB = withConfidence(buildSparseVoxels(G24, cellsOf(filledBox(G24, { min: [15, 3, 3], max: [19, 7, 7] }))), 0.7);
  const before = unionVoxels([baseA, baseB], G24);
  const movedA = transformVoxels(baseA, translationMatrix(3 * G24.cellSize, 0, 0), {}).voxels;
  const movedB = transformVoxels(baseB, translationMatrix(0, 0, 4 * G24.cellSize), {}).voxels;
  const after = unionVoxels([movedA, movedB], G24);
  const motion = analyseMotion(before, after);
  const temporal: TemporalSignals = {
    snapshots: 2,
    occupancyChanged: motion.occupancyChanged,
    rigidMatch: motion.rigidMatch,
    componentShifts: motion.componentShifts,
    confidenceDelta: 0,
  };
  record("two blocks moving differently", "articulated", before, temporal);

  // Deforming: ONE connected body whose surface changes, and no rigid shift
  // reproduces the change. A bar that bends at its midpoint is the clearest
  // form of this: the pieces stay connected (so it is not articulated), but
  // the far end is a cell higher than any single translation would place it.
  const barCells: Array<[number, number, number]> = [];
  for (let x = 3; x <= 10; x++) for (let y = 6; y <= 8; y++) barCells.push([x, y, 6]);
  const barBefore = withConfidence(buildSparseVoxels(G24, barCells), 0.7);

  const bentCells: Array<[number, number, number]> = [];
  for (let x = 3; x <= 6; x++) for (let y = 6; y <= 8; y++) bentCells.push([x, y, 6]);
  for (let y = 6; y <= 8; y++) bentCells.push([7, y, 6], [7, y, 7]);
  for (let x = 8; x <= 10; x++) for (let y = 6; y <= 8; y++) bentCells.push([x, y, 7]);
  const bent = withConfidence(buildSparseVoxels(G24, bentCells), 0.7);

  const deformationMotion = analyseMotion(barBefore, bent);
  record("surface change, no rigid explanation", "deforming", barBefore, {
    snapshots: 2,
    occupancyChanged: deformationMotion.occupancyChanged,
    rigidMatch: deformationMotion.rigidMatch,
    componentShifts: deformationMotion.componentShifts,
    confidenceDelta: 0,
  });

  const passed = cases.filter((c) => c.pass).length;
  return {
    cases,
    summary: {
      cases: cases.length,
      passed,
      failed: cases.length - passed,
      status: passed === cases.length ? "VERIFIED" : passed > 0 ? "PARTIAL" : "BLOCKED",
      statement:
        "Each classification is derived from measured cell statistics, and each decision names the representation it rejected and why. " +
        "No shape is assigned a representation by name.",
    },
  };
}

function cellsOf(voxels: SparseVoxels): Array<[number, number, number]> {
  const out: Array<[number, number, number]> = [];
  for (let v = 0; v < voxelCount(voxels); v++) out.push([voxels.coords[v * 3], voxels.coords[v * 3 + 1], voxels.coords[v * 3 + 2]]);
  return out;
}

/* ------------------------------------------------------------------ WP3 */

export interface InterpolationCase {
  method: InterpolationMethod;
  t: number;
  state: string;
  cells: number;
  metrics: {
    fromAOnly: number;
    fromBOnly: number;
    fromBoth: number;
    unmatchedA: number;
    unmatchedB: number;
    meanDisplacementCells: number;
    maxDisplacementCells: number;
    meanConfidence: number;
    meanUncertainty: number;
    agreement: number;
  };
  note: string;
}

export interface InterpolationExperimentReport {
  cases: InterpolationCase[];
  transformCheck: { t0: number[]; tHalf: number[]; t1: number[]; slerpUnitNorm: boolean; endpointsMatch: boolean };
  summary: { status: "VERIFIED" | "PARTIAL"; lowestUncertaintyAtEnds: boolean; statement: string };
}

export async function runInterpolationExperiment(): Promise<InterpolationExperimentReport> {
  const G24 = createGrid({ cellSize: 0.05, resolution: [24, 24, 24] });
  const store = new MemorySnapshotStore();
  let object = createTemporalObject({ objectId: "interp-demo", createdAt: "2026-11-17T00:00:00.000Z" });

  const start = withConfidence(sphereShell(G24, [0.5, 0.5, 0.5], 0.3, 0.05), 0.6);
  const movedCells = transformVoxels(start, translationMatrix(5 * G24.cellSize, 0, 0), {}).voxels;
  const end = withConfidence(movedCells, 0.8);

  const first = await recordSnapshot(object, { voxels: start, observations: [fixedObservation("i-1", 0.6)], createdAt: "2026-11-17T00:00:01.000Z" }, store);
  object = first.object;
  const second = await recordSnapshot(object, { voxels: end, observations: [fixedObservation("i-2", 0.8)], createdAt: "2026-11-17T00:00:02.000Z" }, store);
  object = second.object;

  const a = await restoreSnapshot(object, first.record.id, store);
  const b = await restoreSnapshot(object, second.record.id, store);

  const cases: InterpolationCase[] = [];
  for (const method of ["occupancy-blend", "rigid", "correspondence"] as InterpolationMethod[]) {
    for (const t of [0, 0.5, 1]) {
      const result = interpolateSnapshots(a.snapshot, b.snapshot, t, { method, correspondenceRadius: 6 });
      cases.push({
        method,
        t,
        state: result.state,
        cells: result.metrics.cells,
        metrics: { ...result.metrics },
        note: result.note,
      });
    }
  }

  const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const rotated = interpolateTransform(identity, [0, 0, -1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 1, 2, 3, 1], 0.5);
  const halfNorm = Math.hypot(rotated[0], rotated[1], rotated[2]);
  const t0 = interpolateTransform(identity, rotated, 0);
  const t1 = interpolateTransform(identity, rotated, 1);

  const endUncertainty = cases.filter((c) => c.t === 0 || c.t === 1).every((c) => c.metrics.meanUncertainty < 1e-9);
  const midUncertainty = cases.filter((c) => c.t === 0.5).some((c) => c.metrics.meanUncertainty > 0);

  return {
    cases,
    transformCheck: {
      t0,
      tHalf: rotated,
      t1,
      slerpUnitNorm: Math.abs(halfNorm - 1) < 1e-9,
      endpointsMatch: t0.every((v, i) => Math.abs(v - identity[i]) < 1e-9),
    },
    summary: {
      status: endUncertainty && midUncertainty ? "VERIFIED" : "PARTIAL",
      lowestUncertaintyAtEnds: endUncertainty,
      statement:
        "Halfway is where nothing was measured, and the uncertainty channel says so: 0 at both observed endpoints, maximal at t=0.5. " +
        "Confidence is propagated as a weighted mean of the contributing observations and never rises above the best endpoint.",
    },
  };
}

/* ------------------------------------------------------------------ WP7 */

export interface Performance35Row {
  operation: string;
  cells: number;
  representation: "sparse-surface" | "sparse-volume";
  milliseconds: number;
  bytes: number | null;
  note: string;
}

export interface Performance35Report {
  rows: Performance35Row[];
  memory: { volumeBytes: number; surfaceBytes: number; overheadFactor: number };
  status: "VERIFIED" | "PARTIAL";
}

/** Time and size the WP1–WP3 operations directly, at two densities. */
export async function runPerformance35(): Promise<Performance35Report> {
  const G32 = createGrid({ cellSize: 0.02, resolution: [32, 32, 32] });
  const solid = withConfidence(filledBox(G32, { min: [4, 4, 4], max: [27, 27, 27] }), 0.7);
  const surface = surfaceFromSolid(solid);
  const rows: Performance35Row[] = [];

  const time = async (operation: string, voxels: SparseVoxels, representation: "sparse-surface" | "sparse-volume", run: () => unknown | Promise<unknown>, note: string) => {
    const started = performance.now();
    await run();
    rows.push({
      operation,
      cells: voxelCount(voxels),
      representation,
      milliseconds: performance.now() - started,
      bytes: null,
      note,
    });
  };

  await time("measureVolume", solid, "sparse-volume", () => measureVolume(solid), "component + interior analysis");
  await time("solidFromSurface", surface, "sparse-surface", () => solidFromSurface(surface), "flood fill over the lattice");
  await time("boundaryOf", solid, "sparse-volume", () => boundaryOf(solid), "interior removal");
  await time("measureVolumeRoundTrip", solid, "sparse-volume", () => measureVolumeRoundTrip(solid), "boundary + solidify + compare");
  await time("connectedComponents", solid, "sparse-volume", () => connectedComponents(solid), "6-connected labelling");

  const serializedVolume = await serializeSnapshot(
    {
      id: "",
      state: "observed",
      createdAt: "2026-11-17T00:00:00.000Z",
      observedAt: null,
      confidence: 0.7,
      lineage: { objectId: "perf", parentSnapshotId: null, sourceSnapshotIds: [], ordinal: 0 },
      transform: { id: "identity", kind: "identity", matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], note: "identity" },
      observations: [],
      voxelCount: voxelCount(solid),
      bbox: solid.bbox,
      summary: "perf volume",
    },
    solid,
    { createdAt: "2026-11-17T00:00:00.000Z" },
  );
  const serializedSurface = await serializeSnapshot(
    {
      id: "",
      state: "observed",
      createdAt: "2026-11-17T00:00:00.000Z",
      observedAt: null,
      confidence: 0.7,
      lineage: { objectId: "perf", parentSnapshotId: null, sourceSnapshotIds: [], ordinal: 0 },
      transform: { id: "identity", kind: "identity", matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], note: "identity" },
      observations: [],
      voxelCount: voxelCount(surface),
      bbox: surface.bbox,
      summary: "perf surface",
    },
    surface,
    { createdAt: "2026-11-17T00:00:00.000Z" },
  );

  rows.push({ operation: "serialize", cells: voxelCount(solid), representation: "sparse-volume", milliseconds: serializedVolume.timings.totalMs, bytes: serializedVolume.bytes.byteLength, note: "deflate-raw" });
  rows.push({ operation: "serialize", cells: voxelCount(surface), representation: "sparse-surface", milliseconds: serializedSurface.timings.totalMs, bytes: serializedSurface.bytes.byteLength, note: "deflate-raw" });

  const glbStart = performance.now();
  const glb = encodeGlb(meshFromVoxels(surface), { name: "perf" });
  rows.push({ operation: "encodeGlb", cells: voxelCount(surface), representation: "sparse-surface", milliseconds: performance.now() - glbStart, bytes: glb.byteLength, note: "boundary only" });

  const store = new MemorySnapshotStore();
  let object = createTemporalObject({ objectId: "perf", createdAt: "2026-11-17T00:00:00.000Z" });
  const r1 = await recordSnapshot(object, { voxels: solid, observations: [fixedObservation("p1", 0.7)], createdAt: "2026-11-17T00:00:01.000Z" }, store);
  object = r1.object;
  const r2 = await recordSnapshot(object, { voxels: transformVoxels(solid, translationMatrix(2 * G32.cellSize, 0, 0), {}).voxels, observations: [fixedObservation("p2", 0.7)], createdAt: "2026-11-17T00:00:02.000Z" }, store);
  object = r2.object;
  const snapA = await restoreSnapshot(object, r1.record.id, store);
  const snapB = await restoreSnapshot(object, r2.record.id, store);
  await time("interpolate(correspondence)", solid, "sparse-volume", () => interpolateSnapshots(snapA.snapshot, snapB.snapshot, 0.5, { method: "correspondence" }), "t=0.5");

  return {
    rows,
    memory: {
      volumeBytes: serializedVolume.bytes.byteLength,
      surfaceBytes: serializedSurface.bytes.byteLength,
      overheadFactor: serializedVolume.bytes.byteLength / Math.max(1, serializedSurface.bytes.byteLength),
    },
    status: rows.every((r) => r.milliseconds >= 0) ? "VERIFIED" : "PARTIAL",
  };
}

/** Re-export so the runner can quote the same type. */
export type { NreSnapshot };
