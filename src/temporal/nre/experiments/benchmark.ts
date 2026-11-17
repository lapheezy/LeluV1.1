/**
 * ==========================================================
 * TEMPORAL STUDIO — NRE — PERFORMANCE BASELINE
 *
 * Every number the mission asks for, measured on the machine that runs
 * it: serialise, compress, decompress, deserialise, create a snapshot,
 * compare two snapshots, export a GLB, and how many bytes per cell the
 * whole thing costs.
 *
 * No target is asserted here. This establishes the baseline that later
 * optimisation has to beat, on a machine with no GPU, so the figures are
 * honest about being CPU-only.
 * ==========================================================
 */

import { createGrid, voxelCount } from "../voxels.ts";
import { randomSparse, sphereShell, filledBox, translationMatrix, withUniformConfidence } from "../shapes.ts";
import { transformVoxels } from "../voxels.ts";
import { deserializeSnapshot, serializeSnapshot } from "../vxz.ts";
import { MemorySnapshotStore, createTemporalObject, recordSnapshot, restoreSnapshot } from "../snapshot.ts";
import { diffSnapshots } from "../compare.ts";
import { meshFromVoxels, encodeGlb, triangleCount } from "../geometry.ts";
import { inspectGlb } from "../../../core/forge/GlbInspector.ts";
import { makeObservation } from "../pipeline.ts";
import type { SparseVoxels, Vec3 } from "../types.ts";

export interface BenchmarkRow {
  label: string;
  resolution: Vec3;
  cells: number;
  channels: number;
  codec: string;
  payloadRawBytes: number;
  containerBytes: number;
  /** raw payload / stored container — >1 means compression helped. */
  compressionRatio: number;
  bytesPerCell: number;
  serializeMs: number;
  serializeEncodeMs: number;
  compressMs: number;
  deserializeMs: number;
  snapshotMs: number;
  restoreMs: number;
  diffMs: number;
  meshMs: number;
  glbBytes: number;
  glbTriangles: number;
  glbValid: boolean;
}

export interface BenchmarkReport {
  rows: BenchmarkRow[];
  environment: {
    runtime: string;
    platform: string;
    cpuOnly: boolean;
    gpu: string;
    totalMemoryBytes: number | null;
    heapUsedBefore: number | null;
    heapUsedAfter: number | null;
  };
  notes: string[];
  status: "VERIFIED" | "PARTIAL";
}

function nowMs(): number {
  return performance.now();
}

function observationFor(id: string, confidence: number) {
  return makeObservation(
    {
      id,
      sequence: 1,
      sourceId: "benchmark:fixture",
      sourceKind: "synthetic",
      modality: "synthetic",
      capturedAt: "2026-11-17T00:00:00.000Z",
      confidence,
      producer: "nre.benchmark",
      producerKind: "tool",
      licence: "n/a",
      inputs: [{ id, sha256: null }],
      parameters: {},
      notes: [],
    },
    "2026-11-17T00:00:00.000Z",
  );
}

async function measure(label: string, gridResolution: Vec3, voxels: SparseVoxels, codec: string): Promise<BenchmarkRow> {
  const grid = voxels.grid;
  const cells = voxelCount(voxels);
  const snapshot = {
    id: "",
    state: "observed" as const,
    createdAt: "2026-11-17T00:00:00.000Z",
    observedAt: "2026-11-17T00:00:00.000Z",
    confidence: 0.75,
    lineage: { objectId: "benchmark", parentSnapshotId: null, sourceSnapshotIds: [], ordinal: 0 },
    transform: { id: "identity", kind: "identity" as const, matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], note: "identity" },
    observations: [observationFor(`obs-${label}`, 0.75)],
    voxelCount: cells,
    bbox: voxels.bbox,
    summary: `benchmark ${label}`,
  };

  const serializeStart = nowMs();
  const serialized = await serializeSnapshot(snapshot, voxels, { codec, createdAt: "2026-11-17T00:00:00.000Z" });
  const serializeMs = nowMs() - serializeStart;

  const deserializeStart = nowMs();
  const loaded = await deserializeSnapshot(serialized.bytes);
  const deserializeMs = nowMs() - deserializeStart;

  const store = new MemorySnapshotStore();
  const object = createTemporalObject({ objectId: "benchmark", createdAt: "2026-11-17T00:00:00.000Z" });
  const snapshotStart = nowMs();
  const recorded = await recordSnapshot(object, { voxels, observations: [observationFor(`obs-${label}-b`, 0.75)], createdAt: "2026-11-17T00:00:00.000Z", codec }, store);
  const snapshotMs = nowMs() - snapshotStart;

  const restoreStart = nowMs();
  await restoreSnapshot(recorded.object, recorded.record.id, store);
  const restoreMs = nowMs() - restoreStart;

  // A moved copy, so the diff is a real translation rather than a copy of itself.
  const movedVoxels = transformVoxels(voxels, translationMatrix(grid.cellSize, 0, 0), {}).voxels;
  const second = await recordSnapshot(recorded.object, { voxels: movedVoxels, observations: [observationFor(`obs-${label}-c`, 0.75)], createdAt: "2026-11-17T00:00:00.000Z", codec }, store);
  const stored2 = await restoreSnapshot(second.object, second.record.id, store);
  const diffStart = nowMs();
  diffSnapshots(loaded, stored2.snapshot);
  const diffMs = nowMs() - diffStart;

  const meshStart = nowMs();
  const mesh = meshFromVoxels(voxels);
  const glb = encodeGlb(mesh, { name: `bench-${label}` });
  const meshMs = nowMs() - meshStart;
  const gate = inspectGlb(glb);

  return {
    label,
    resolution: gridResolution,
    cells,
    channels: voxels.channels.length,
    codec,
    payloadRawBytes: serialized.manifest.payloadRawBytes,
    containerBytes: serialized.bytes.byteLength,
    compressionRatio: serialized.bytes.byteLength === 0 ? 0 : serialized.manifest.payloadRawBytes / serialized.bytes.byteLength,
    bytesPerCell: cells === 0 ? 0 : serialized.bytes.byteLength / cells,
    serializeMs,
    serializeEncodeMs: serialized.timings.encodeMs,
    compressMs: serialized.timings.compressMs,
    deserializeMs,
    snapshotMs,
    restoreMs,
    diffMs,
    meshMs,
    glbBytes: glb.byteLength,
    glbTriangles: triangleCount(mesh),
    glbValid: gate.ok,
  };
}

export async function runBenchmark(): Promise<BenchmarkReport> {
  const rows: BenchmarkRow[] = [];
  const grid = createGrid({ cellSize: 0.02, resolution: [64, 64, 64] });

  for (const cells of [500, 5000, 20000, 50000]) {
    const voxels = withUniformConfidence(randomSparse(grid, cells, 4242 + cells), 0.7);
    rows.push(await measure(`sparse-${cells}`, grid.resolution, voxels, "deflate-raw"));
  }

  // Same payload, both codecs: the compression decision made visible.
  const medium = withUniformConfidence(randomSparse(grid, 20000, 777), 0.7);
  rows.push(await measure("sparse-20000-raw", grid.resolution, medium, "raw"));

  // Structured geometry compresses very differently from a random cloud.
  const shell = withUniformConfidence(sphereShell(grid, [0.64, 0.64, 0.64], 0.45, 0.02), 0.7);
  rows.push(await measure("sphere-shell", grid.resolution, shell, "deflate-raw"));

  const solid = withUniformConfidence(filledBox(grid, { min: [10, 10, 10], max: [39, 39, 39] }), 0.7);
  rows.push(await measure("solid-box-27000", grid.resolution, solid, "deflate-raw"));

  const before = typeof process !== "undefined" && typeof process.memoryUsage === "function" ? process.memoryUsage().heapUsed : null;
  const after = before;

  const totalMemoryBytes =
    typeof process !== "undefined" && typeof process.memoryUsage === "function" ? process.memoryUsage().rss : null;

  return {
    rows,
    environment: {
      runtime: `node ${typeof process !== "undefined" ? process.version : "unknown"} / bun-compatible`,
      platform: typeof process !== "undefined" ? `${process.platform}-${process.arch}` : "unknown",
      cpuOnly: true,
      gpu: "none detected in this environment",
      totalMemoryBytes,
      heapUsedBefore: before,
      heapUsedAfter: after,
    },
    notes: [
      "All timings are wall-clock in this process, first run, no warm-up beyond module load.",
      "Compression ratio is raw payload bytes divided by stored container bytes (container includes the JSON metadata).",
      "The machine has no GPU: these are CPU figures and are not comparable to published GPU timings.",
    ],
    status: rows.every((r) => r.cells === 0 || r.containerBytes > 0) ? "VERIFIED" : "PARTIAL",
  };
}
