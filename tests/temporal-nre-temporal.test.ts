/**
 * NRE — temporal engine.
 *
 * The invariants that matter: history is append-only, every snapshot is
 * independently recoverable, differences are measured correctly, and two
 * different objects are never conflated.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  NreGridMismatchError,
  NreIdentityError,
  MemorySnapshotStore,
  SnapshotNotFoundError,
  accumulateSnapshots,
  buildSparseVoxels,
  compareVoxelSets,
  createGrid,
  createTemporalObject,
  diffSeries,
  diffSnapshots,
  history,
  interpolateVoxels,
  loadHistory,
  recordSnapshot,
  restoreSnapshot,
  snapshotRecord,
  translationMatrix,
  transformVoxels,
  voxelCount,
  withConfidence,
} from "../src/temporal/nre/index.ts";
import type { Observation, SparseVoxels, TemporalObject } from "../src/temporal/nre/index.ts";
import { sphereShell, filledBox } from "../src/temporal/nre/index.ts";
import { makeObservation } from "../src/temporal/nre/index.ts";

const G = createGrid({ cellSize: 0.05, resolution: [24, 24, 24] });

function obs(id: string, confidence: number, sourceId = "reference:front"): Observation {
  return makeObservation(
    {
      id,
      sequence: 1,
      sourceId,
      sourceKind: "image",
      modality: "single-image",
      capturedAt: "2026-11-17T00:00:00.000Z",
      confidence,
      producer: "fixture:test",
      producerKind: "fixture",
      licence: "n/a",
      inputs: [{ id: "fixture", sha256: null }],
      parameters: { note: "test" },
      notes: ["temporal test"],
    },
    "2026-11-17T00:00:00.000Z",
  );
}

function shell(confidence = 0.6): SparseVoxels {
  return withConfidence(sphereShell(G, [0.6, 0.6, 0.6], 0.3, 0.05), confidence);
}

function grown(confidence = 0.6): SparseVoxels {
  return withConfidence(
    buildSparseVoxels(G, [
      ...cellsOf(shell()),
      ...cellsOf(filledBox(G, { min: [16, 8, 10], max: [18, 12, 13] })),
    ]),
    confidence,
  );
}

function cellsOf(voxels: SparseVoxels): Array<[number, number, number]> {
  const out: Array<[number, number, number]> = [];
  for (let v = 0; v < voxelCount(voxels); v++) {
    out.push([voxels.coords[v * 3], voxels.coords[v * 3 + 1], voxels.coords[v * 3 + 2]]);
  }
  return out;
}

async function seedHistory(store: MemorySnapshotStore): Promise<{ object: TemporalObject; ids: string[]; shas: string[] }> {
  let object = createTemporalObject({ objectId: "object-a", createdAt: "2026-11-17T00:00:00.000Z" });
  const ids: string[] = [];
  const shas: string[] = [];
  const steps: Array<{ voxels: SparseVoxels; confidence: number; at: string }> = [
    { voxels: shell(0.6), confidence: 0.6, at: "2026-11-17T00:00:01.000Z" },
    { voxels: grown(0.55), confidence: 0.55, at: "2026-11-17T00:00:02.000Z" },
    { voxels: grown(0.8), confidence: 0.8, at: "2026-11-17T00:00:03.000Z" },
  ];
  steps.forEach((step, index) => {
    void index;
  });
  for (const step of steps) {
    const recorded = await recordSnapshot(
      object,
      { voxels: step.voxels, observations: [obs(`obs-${step.at}`, step.confidence)], createdAt: step.at },
      store,
    );
    object = recorded.object;
    ids.push(recorded.record.id);
    shas.push(recorded.containerSha256);
  }
  return { object, ids, shas };
}

test("snapshots chain by parent and history follows the links", async () => {
  const store = new MemorySnapshotStore();
  const { object, ids } = await seedHistory(store);

  assert.equal(object.snapshots.length, 3);
  assert.equal(object.head, ids[2]);
  assert.equal(snapshotRecord(object, ids[1]).parentId, ids[0]);
  assert.equal(snapshotRecord(object, ids[2]).parentId, ids[1]);

  const chain = history(object);
  assert.deepEqual(chain.map((r) => r.id), ids);
  assert.deepEqual(chain.map((r) => r.ordinal), [0, 1, 2]);
});

test("every snapshot is independently recoverable from its own bytes", async () => {
  const store = new MemorySnapshotStore();
  const { object, ids } = await seedHistory(store);

  for (const id of ids) {
    const restored = await restoreSnapshot(object, id, store);
    assert.equal(restored.record.id, id);
    assert.ok(restored.snapshot.manifest.voxelCount > 0);
    assert.equal(restored.snapshot.voxels.coords.length / 3, restored.snapshot.manifest.voxelCount);
  }

  const all = await loadHistory(object, store);
  assert.equal(all.length, 3);
  assert.equal(all[0].snapshot.voxels.coords.length / 3, snapshotRecord(object, ids[0]).voxelCount);
  await assert.rejects(() => restoreSnapshot(object, "snp-does-not-exist", store), SnapshotNotFoundError);
});

test("appending a snapshot never modifies earlier evidence", async () => {
  const store = new MemorySnapshotStore();
  const { object, ids, shas } = await seedHistory(store);
  const before = await store.get(shas[0]);
  const beforeSnapshot = await restoreSnapshot(object, ids[0], store);

  const accumulated = await accumulateSnapshots(object, [ids[1], ids[2]], store, { createdAt: "2026-11-17T00:00:04.000Z" });
  const after = await store.get(shas[0]);
  const afterSnapshot = await restoreSnapshot(accumulated.object, ids[0], store);

  assert.deepEqual(Array.from(before), Array.from(after), "the stored container of snapshot 1 must be byte-identical");
  assert.deepEqual(Array.from(beforeSnapshot.snapshot.voxels.coords), Array.from(afterSnapshot.snapshot.voxels.coords));
  assert.equal(accumulated.object.snapshots[0].containerSha256, shas[0]);
  assert.equal(accumulated.object.snapshots.length, 4, "accumulation appends; it does not replace");
});

test("accumulation fuses occupancy and confidence with noisy-OR", async () => {
  const store = new MemorySnapshotStore();
  const { object, ids } = await seedHistory(store);
  const accumulated = await accumulateSnapshots(object, [ids[1], ids[2]], store, { createdAt: "2026-11-17T00:00:04.000Z" });

  const expected = 1 - (1 - 0.55) * (1 - 0.8);
  assert.ok(Math.abs(accumulated.record.confidence - expected) < 1e-6, `fused confidence ${accumulated.record.confidence} ≠ ${expected}`);
  assert.equal(accumulated.record.state, "accumulated");
  assert.deepEqual(accumulated.record.sourceSnapshotIds, [ids[1], ids[2]]);

  const source = await restoreSnapshot(object, ids[1], store);
  assert.equal(accumulated.record.voxelCount, voxelCount(source.snapshot.voxels), "identical geometry must not grow during fusion");
  assert.equal(accumulated.contributions.length, 2);
  for (const contribution of accumulated.contributions) {
    assert.equal(contribution.onlyInContribution, 0, "no cell of a contribution may be dropped");
    assert.equal(contribution.onlyInAccumulated, 0, "no cell may be invented");
  }

  const restored = await restoreSnapshot(accumulated.object, accumulated.record.id, store);
  const fusedConfidences = restored.snapshot.voxels.attributes.confidence;
  assert.ok(fusedConfidences, "the accumulated snapshot must carry fused confidence");
  for (let i = 0; i < fusedConfidences.length; i++) {
    assert.ok(Math.abs(fusedConfidences[i] - expected) < 1e-6);
  }
});

test("accumulation needs two distinct snapshots", async () => {
  const store = new MemorySnapshotStore();
  const { object, ids } = await seedHistory(store);
  await assert.rejects(() => accumulateSnapshots(object, [ids[0]], store), /at least two/);
  await assert.rejects(() => accumulateSnapshots(object, [ids[0], ids[0]], store), /same snapshot twice/);
});

test("differences are classified by evidence, not by resemblance", async () => {
  const store = new MemorySnapshotStore();
  const { object, ids } = await seedHistory(store);
  const [a, b, c] = await loadHistory(object, store);

  const expanded = diffSnapshots(a.snapshot, b.snapshot);
  assert.equal(expanded.kind, "expanded");
  assert.equal(expanded.onlyA, 0);
  assert.ok(expanded.onlyB > 0);

  const improved = diffSnapshots(b.snapshot, c.snapshot);
  assert.equal(improved.kind, "improved-confidence");
  assert.equal(improved.onlyA, 0);
  assert.equal(improved.onlyB, 0);
  assert.ok(improved.snapshotConfidenceB > improved.snapshotConfidenceA);

  const repeated = diffSnapshots(b.snapshot, b.snapshot);
  assert.equal(repeated.kind, "reobserved");
  assert.equal(repeated.iou, 1);

  // A translation of the same shape must be recognised as movement.
  const moved = transformVoxels(b.snapshot.voxels, translationMatrix(3 * G.cellSize, 1 * G.cellSize, 0), {});
  const recorded = await recordSnapshot(
    object,
    { voxels: moved.voxels, observations: [obs("obs-moved", 0.6)], createdAt: "2026-11-17T00:00:09.000Z" },
    store,
  );
  const movedSnapshot = await restoreSnapshot(recorded.object, recorded.record.id, store);
  const movement = diffSnapshots(b.snapshot, movedSnapshot.snapshot);
  assert.equal(movement.kind, "rigid-movement", movement.explains);
  assert.ok(Math.abs(movement.centroidShift[0] - 3 * G.cellSize) < 1e-9);

  // A strict subset (cells removed, none added) is a shrink.
  const subsetCells = cellsOf(grown()).filter(([, j]) => j >= 10);
  const subset = withConfidence(buildSparseVoxels(G, subsetCells), 0.6);
  const subsetRecord = await recordSnapshot(object, { voxels: subset, observations: [obs("obs-subset", 0.6)], createdAt: "2026-11-17T00:00:10.000Z" }, store);
  const subsetSnapshot = await restoreSnapshot(subsetRecord.object, subsetRecord.record.id, store);
  const shrunk = diffSnapshots(b.snapshot, subsetSnapshot.snapshot);
  assert.equal(shrunk.kind, "shrunk", shrunk.explains);
  assert.ok(shrunk.onlyA > 0 && shrunk.onlyB === 0);

  // A different shape at the same centroid must NOT be called movement either.
  const smaller = withConfidence(sphereShell(G, [0.6, 0.6, 0.6], 0.18, 0.05), 0.6);
  const smallerRecord = await recordSnapshot(object, { voxels: smaller, observations: [obs("obs-small", 0.6)], createdAt: "2026-11-17T00:00:11.000Z" }, store);
  const smallerSnapshot = await restoreSnapshot(smallerRecord.object, smallerRecord.record.id, store);
  const deformed = diffSnapshots(b.snapshot, smallerSnapshot.snapshot);
  assert.equal(deformed.kind, "geometry-changed", deformed.explains);
  assert.ok(deformed.onlyA > 0 && deformed.onlyB > 0);

  const series = await diffSeries(object, store);
  assert.equal(series.length, object.snapshots.length - 1);
  assert.equal(series[0].diff.kind, "expanded");
  assert.equal(series[1].diff.kind, "improved-confidence");
});

test("comparison refuses different objects and different lattices", async () => {
  const store = new MemorySnapshotStore();
  const { object } = await seedHistory(store);
  const other = createTemporalObject({ objectId: "object-b", createdAt: "2026-11-17T00:00:00.000Z" });
  const otherRecord = await recordSnapshot(other, { voxels: shell(0.6), observations: [obs("obs-b", 0.6)], createdAt: "2026-11-17T00:00:01.000Z" }, store);

  const mine = await restoreSnapshot(object, object.snapshots[0].id, store);
  const theirs = await restoreSnapshot(otherRecord.object, otherRecord.record.id, store);
  assert.throws(() => diffSnapshots(mine.snapshot, theirs.snapshot), NreIdentityError);

  const coarseGrid = createGrid({ cellSize: 0.05, resolution: [12, 12, 12] });
  const coarse = buildSparseVoxels(coarseGrid, [[1, 1, 1]]);
  assert.throws(() => compareVoxelSets(mine.snapshot.voxels, coarse), NreGridMismatchError);
});

test("interpolation is marked as a hypothesis, not an observation", async () => {
  const store = new MemorySnapshotStore();
  const { object, ids } = await seedHistory(store);
  const first = await restoreSnapshot(object, ids[0], store);
  const second = await restoreSnapshot(object, ids[1], store);

  const blended = interpolateVoxels(first.snapshot, second.snapshot, 0.5);
  const recorded = await recordSnapshot(
    object,
    {
      voxels: blended.voxels,
      observations: [],
      state: "interpolated",
      sourceSnapshotIds: [ids[0], ids[1]],
      createdAt: "2026-11-17T00:00:05.000Z",
      summary: blended.note,
    },
    store,
  );

  assert.equal(recorded.record.state, "interpolated");
  assert.deepEqual(recorded.record.sourceSnapshotIds, [ids[0], ids[1]]);
  assert.equal(recorded.record.confidence, 0, "an interpolation has no observations, so it carries no evidence");
  assert.match(recorded.record.summary, /hypothesis between measurements/);
  assert.ok(recorded.record.voxelCount >= Math.min(first.record.voxelCount, second.record.voxelCount));
  assert.ok(recorded.record.voxelCount <= Math.max(first.record.voxelCount, second.record.voxelCount));
  assert.equal(snapshotRecord(recorded.object, ids[0]).state, "observed", "the sources stay marked as observed");
  assert.throws(() => interpolateVoxels(first.snapshot, second.snapshot, 1.5), /within \[0,1\]/);
});

test("interpolation refuses different object identities", async () => {
  const store = new MemorySnapshotStore();
  const a = createTemporalObject({ objectId: "object-a", createdAt: "2026-11-17T00:00:00.000Z" });
  const b = createTemporalObject({ objectId: "object-b", createdAt: "2026-11-17T00:00:00.000Z" });
  const ra = await recordSnapshot(a, { voxels: shell(0.6), observations: [obs("a", 0.6)], createdAt: "2026-11-17T00:00:01.000Z" }, store);
  const rb = await recordSnapshot(b, { voxels: shell(0.6), observations: [obs("b", 0.6)], createdAt: "2026-11-17T00:00:01.000Z" }, store);
  const sa = await restoreSnapshot(ra.object, ra.record.id, store);
  const sb = await restoreSnapshot(rb.object, rb.record.id, store);
  assert.throws(() => interpolateVoxels(sa.snapshot, sb.snapshot, 0.5), /SAME object/);
});

test("transformVoxels reports cells that leave the lattice instead of clipping silently", async () => {
  const voxels = shell(0.6);
  const moved = transformVoxels(voxels, translationMatrix(-10, 0, 0), {});
  assert.ok(moved.unmapped > 0, "moving off the lattice must be counted");
  assert.equal(voxelCount(moved.voxels), 0);
});

test("a recorded snapshot keeps the summary and transform it was given", async () => {
  const store = new MemorySnapshotStore();
  const object = createTemporalObject({ objectId: "object-c", createdAt: "2026-11-17T00:00:00.000Z" });
  const recorded = await recordSnapshot(
    object,
    {
      voxels: shell(0.5),
      observations: [obs("obs-c", 0.5)],
      transform: { id: "t1", kind: "rigid", matrix: translationMatrix(0.1, 0, 0), note: "one cell right" },
      summary: "custom summary",
      createdAt: "2026-11-17T00:00:02.000Z",
    },
    store,
  );
  const restored = await restoreSnapshot(recorded.object, recorded.record.id, store);
  assert.equal(restored.snapshot.manifest.snapshot.summary, "custom summary");
  assert.equal(restored.snapshot.manifest.snapshot.transform.kind, "rigid");
  assert.equal(restored.snapshot.manifest.snapshot.transform.matrix[12], 0.1);
});
