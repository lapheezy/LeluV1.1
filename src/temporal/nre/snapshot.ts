/**
 * ==========================================================
 * TEMPORAL STUDIO — NRE — TEMPORAL SNAPSHOT ENGINE
 *
 * Observations accumulate; evidence is never replaced.
 *
 * Every snapshot is written as its own .vxz container and referenced by
 * digest, so restoring snapshot 2 does not require snapshot 3, and an
 * accumulated snapshot never rewrites the observations it was built
 * from. The object record below is the only mutable thing, and it is
 * append-only in spirit: `recordSnapshot` returns a NEW object.
 *
 * Four things that look similar in numbers and must not be confused:
 *
 *   same object, observed again     → state "observed", new ordinal
 *   more observations, more trust   → state "observed", higher confidence
 *   the object itself changed       → cells differ, no rigid shift fits
 *   the object moved                → the shape survives a cell shift
 *
 * The engine records which one happened (see compare.ts) and, for
 * interpolation, marks the result "interpolated" so a synthesised state
 * can never be mistaken for a measured one.
 * ==========================================================
 */

import type { NreSnapshot, Observation, SnapshotManifest, SnapshotState, SparseVoxels, TransformRecord } from "./types.ts";
import { deserializeSnapshot, serializeSnapshot } from "./vxz.ts";
import { sha256Hex } from "./hash.ts";
import { IDENTITY_MATRIX, cellCenter, denseIndexOf, fuseConfidence, isInside, unionVoxels, voxelCount } from "./voxels.ts";
import { buildSparseVoxels } from "./voxels.ts";
import { DEFAULT_CONFIDENCE_CHANNEL } from "./voxels.ts";
import { compareVoxelSets, diffSnapshots, type SnapshotDiff } from "./compare.ts";

export interface SnapshotRecord {
  /** Content-addressed snapshot id ("snp-…"), shared with the manifest. */
  id: string;
  ordinal: number;
  state: SnapshotState;
  parentId: string | null;
  sourceSnapshotIds: string[];
  createdAt: string;
  observedAt: string | null;
  confidence: number;
  /** Digest of the stored container bytes — the identity of the file. */
  containerSha256: string;
  containerBytes: number;
  voxelCount: number;
  summary: string;
}

export interface TemporalObject {
  /** Stable identity of the observed thing across its whole history. */
  objectId: string;
  label: string;
  createdAt: string;
  /** Append-only, in ordinal order. */
  snapshots: SnapshotRecord[];
  head: string | null;
}

export interface SnapshotStore {
  put(sha256: string, bytes: Uint8Array): Promise<void>;
  get(sha256: string): Promise<Uint8Array>;
  has(sha256: string): Promise<boolean>;
  list(): Promise<string[]>;
}

export class SnapshotNotFoundError extends Error {
  constructor(id: string) {
    super(`Snapshot "${id}" is not part of this temporal object's history.`);
    this.name = "SnapshotNotFoundError";
  }
}

/** In-memory store. Fast, disposable, used by tests and by the browser session. */
export class MemorySnapshotStore implements SnapshotStore {
  private readonly entries = new Map<string, Uint8Array>();

  async put(sha256: string, bytes: Uint8Array): Promise<void> {
    this.entries.set(sha256, bytes.slice());
  }

  async get(sha256: string): Promise<Uint8Array> {
    const bytes = this.entries.get(sha256);
    if (!bytes) throw new SnapshotNotFoundError(`container ${sha256}`);
    return bytes.slice();
  }

  async has(sha256: string): Promise<boolean> {
    return this.entries.has(sha256);
  }

  async list(): Promise<string[]> {
    return [...this.entries.keys()];
  }

  /** Total bytes held — used by the performance report. */
  byteSize(): number {
    let total = 0;
    for (const bytes of this.entries.values()) total += bytes.byteLength;
    return total;
  }
}

export interface FsSnapshotStore extends SnapshotStore {
  directory: string;
}

/**
 * Filesystem store for a worker on a machine with a disk. The Node import
 * is dynamic so this module stays importable in a browser bundle.
 */
export async function createFsSnapshotStore(directory: string): Promise<FsSnapshotStore> {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  await fs.mkdir(directory, { recursive: true });
  const fileFor = (sha256: string) => path.join(directory, `${sha256}.vxz`);
  return {
    directory,
    async put(sha256, bytes) {
      const target = fileFor(sha256);
      const temporary = `${target}.${process.pid}.tmp`;
      await fs.writeFile(temporary, bytes);
      await fs.rename(temporary, target);
    },
    async get(sha256) {
      try {
        return new Uint8Array(await fs.readFile(fileFor(sha256)));
      } catch {
        throw new SnapshotNotFoundError(`container ${sha256}`);
      }
    },
    async has(sha256) {
      try {
        await fs.access(fileFor(sha256));
        return true;
      } catch {
        return false;
      }
    },
    async list() {
      const names = await fs.readdir(directory);
      return names.filter((n) => n.endsWith(".vxz")).map((n) => n.slice(0, -4));
    },
  };
}

export function createTemporalObject(input: { objectId: string; label?: string; createdAt?: string }): TemporalObject {
  if (!input.objectId) throw new Error("A temporal object needs an objectId; observations cannot be attributed to nothing.");
  return {
    objectId: input.objectId,
    label: input.label ?? input.objectId,
    createdAt: input.createdAt ?? new Date().toISOString(),
    snapshots: [],
    head: null,
  };
}

export function snapshotRecord(object: TemporalObject, id: string): SnapshotRecord {
  const record = object.snapshots.find((s) => s.id === id);
  if (!record) throw new SnapshotNotFoundError(id);
  return record;
}

/** Root → head order, following parent links rather than array order. */
export function history(object: TemporalObject, fromId?: string): SnapshotRecord[] {
  const start = fromId ?? object.head;
  const chain: SnapshotRecord[] = [];
  let cursor = start;
  const seen = new Set<string>();
  while (cursor) {
    if (seen.has(cursor)) throw new Error(`Snapshot history contains a cycle at "${cursor}".`);
    seen.add(cursor);
    const record = snapshotRecord(object, cursor);
    chain.push(record);
    cursor = record.parentId;
  }
  return chain.reverse();
}

export interface RecordSnapshotInput {
  voxels: SparseVoxels;
  observations?: Observation[];
  state?: SnapshotState;
  parentId?: string | null;
  sourceSnapshotIds?: string[];
  transform?: TransformRecord;
  observedAt?: string | null;
  createdAt?: string;
  summary?: string;
  codec?: string;
}

export interface RecordSnapshotResult {
  object: TemporalObject;
  record: SnapshotRecord;
  manifest: SnapshotManifest;
  bytes: Uint8Array;
  containerSha256: string;
}

/**
 * Serialise one observation into the history.
 *
 * `createdAt` defaults to now; pass a fixed value for reproducible
 * fixtures. The returned object is a copy — the caller's object is not
 * modified, so nothing already recorded can be lost by a failed append.
 */
export async function recordSnapshot(
  object: TemporalObject,
  input: RecordSnapshotInput,
  store: SnapshotStore,
): Promise<RecordSnapshotResult> {
  const observations = input.observations ?? [];
  const parentId = input.parentId === undefined ? object.head : input.parentId;
  const parent = parentId ? snapshotRecord(object, parentId) : null;
  const state = input.state ?? "observed";
  const createdAt = input.createdAt ?? new Date().toISOString();
  const confidence = fuseConfidence(observations.map((o) => o.confidence));

  const snapshot: SnapshotManifest = {
    id: "",
    state,
    createdAt,
    observedAt: input.observedAt ?? (observations[0]?.capturedAt ?? null),
    confidence,
    lineage: {
      objectId: object.objectId,
      parentSnapshotId: parent?.id ?? null,
      sourceSnapshotIds: input.sourceSnapshotIds ?? [],
      ordinal: object.snapshots.length,
    },
    transform: input.transform ?? {
      id: "identity",
      kind: "identity",
      matrix: [...IDENTITY_MATRIX],
      note: "no transform applied",
    },
    observations,
    voxelCount: 0,
    bbox: { min: [0, 0, 0], max: [0, 0, 0] },
    summary:
      input.summary ??
      `${state} snapshot from ${observations.length} observation${observations.length === 1 ? "" : "s"} at ${voxelCount(input.voxels)} cells`,
  };

  const { bytes, manifest } = await serializeSnapshot(snapshot, input.voxels, {
    codec: input.codec ?? "deflate-raw",
    createdAt,
  });
  const containerSha256 = await sha256Hex(bytes);
  await store.put(containerSha256, bytes);

  const record: SnapshotRecord = {
    id: manifest.snapshot.id,
    ordinal: manifest.snapshot.lineage.ordinal,
    state: manifest.snapshot.state,
    parentId: manifest.snapshot.lineage.parentSnapshotId,
    sourceSnapshotIds: manifest.snapshot.lineage.sourceSnapshotIds,
    createdAt: manifest.snapshot.createdAt,
    observedAt: manifest.snapshot.observedAt,
    confidence: manifest.snapshot.confidence,
    containerSha256,
    containerBytes: bytes.byteLength,
    voxelCount: manifest.voxelCount,
    summary: manifest.snapshot.summary,
  };

  const next: TemporalObject = {
    ...object,
    snapshots: [...object.snapshots, record],
    head: record.id,
  };
  return { object: next, record, manifest: manifest.snapshot, bytes, containerSha256 };
}

/** Recover one snapshot from its own bytes — no other snapshot is read. */
export async function restoreSnapshot(
  object: TemporalObject,
  id: string,
  store: SnapshotStore,
): Promise<{ record: SnapshotRecord; snapshot: NreSnapshot }> {
  const record = snapshotRecord(object, id);
  const bytes = await store.get(record.containerSha256);
  const snapshot = await deserializeSnapshot(bytes);
  if (snapshot.manifest.snapshot.id !== record.id) {
    throw new Error(
      `Restored container identifies itself as "${snapshot.manifest.snapshot.id}" but the record expects "${record.id}".`,
    );
  }
  if (snapshot.manifest.snapshot.lineage.objectId !== object.objectId) {
    throw new Error(
      `Restored container belongs to object "${snapshot.manifest.snapshot.lineage.objectId}", not "${object.objectId}".`,
    );
  }
  return { record, snapshot };
}

/** Every snapshot in the history, recovered from its own container. */
export async function loadHistory(
  object: TemporalObject,
  store: SnapshotStore,
  options: { fromId?: string } = {},
): Promise<Array<{ record: SnapshotRecord; snapshot: NreSnapshot }>> {
  const out: Array<{ record: SnapshotRecord; snapshot: NreSnapshot }> = [];
  for (const record of history(object, options.fromId)) {
    out.push(await restoreSnapshot(object, record.id, store));
  }
  return out;
}

export interface AccumulationResult extends RecordSnapshotResult {
  /** Per-pair differences between the accumulated result and each contribution. */
  contributions: Array<{ id: string; onlyInContribution: number; onlyInAccumulated: number }>;
}

/**
 * Fuse two or more snapshots into a new accumulated snapshot.
 *
 * Occupancy is the union and confidence is noisy-OR over the evidence
 * that actually landed on each cell. A cell absent from one snapshot is
 * NOT negative evidence, so it is skipped rather than fused as zero.
 * The source snapshots remain untouched and independently recoverable.
 */
export async function accumulateSnapshots(
  object: TemporalObject,
  ids: ReadonlyArray<string>,
  store: SnapshotStore,
  options: { createdAt?: string; summary?: string; codec?: string } = {},
): Promise<AccumulationResult> {
  if (ids.length < 2) throw new Error("Accumulation needs at least two snapshots; one snapshot is already its own evidence.");
  const unique = [...new Set(ids)];
  if (unique.length !== ids.length) throw new Error("Accumulation was given the same snapshot twice.");

  const loaded: Array<{ record: SnapshotRecord; snapshot: NreSnapshot }> = [];
  for (const id of unique) loaded.push(await restoreSnapshot(object, id, store));
  const grids = loaded.map((entry) => entry.snapshot.voxels.grid);
  const reference = grids[0];
  for (const grid of grids.slice(1)) {
    if (grid.cellSize !== reference.cellSize || grid.resolution.some((r, i) => r !== reference.resolution[i])) {
      throw new Error("Accumulation across different lattices is not defined; resample or re-encode first.");
    }
  }

  const fused = unionVoxels(loaded.map((entry) => entry.snapshot.voxels), reference);
  const observationsById = new Map<string, Observation>();
  for (const entry of loaded) {
    for (const observation of entry.snapshot.manifest.snapshot.observations) observationsById.set(observation.id, observation);
  }
  const observations = [...observationsById.values()];

  const recorded = await recordSnapshot(
    object,
    {
      voxels: fused,
      observations,
      state: "accumulated",
      sourceSnapshotIds: unique,
      createdAt: options.createdAt,
      codec: options.codec,
      summary:
        options.summary ??
        `accumulated from ${unique.length} snapshots: ${unique.join(", ")}; occupancy union with noisy-OR confidence fusion`,
    },
    store,
  );

  const contributions = unique.map((id) => {
    const source = loaded.find((entry) => entry.record.id === id)!.snapshot.voxels;
    const metrics = compareVoxelSets(source, fused);
    return { id, onlyInContribution: metrics.onlyA, onlyInAccumulated: metrics.onlyB };
  });

  return { ...recorded, contributions };
}

/**
 * Interpolate between two observed snapshots.
 *
 * Weight at t: a cell keeps w = (1−t) from A plus t from B and is
 * occupied when w ≥ 0.5. The threshold is inclusive so t = 0.5 does not
 * drop evidence held by both sides. Confidence is linearly blended over
 * the same weights. The result is a hypothesis between measurements —
 * the caller must record it with state "interpolated".
 */
export function interpolateVoxels(a: NreSnapshot, b: NreSnapshot, t: number): { voxels: SparseVoxels; note: string } {
  if (!(t >= 0 && t <= 1)) throw new Error(`Interpolation parameter must be within [0,1], got ${t}.`);
  if (a.manifest.snapshot.lineage.objectId !== b.manifest.snapshot.lineage.objectId) {
    throw new Error("Interpolation requires two snapshots of the SAME object; different identities are not interpolatable.");
  }
  const grid = a.voxels.grid;
  if (b.voxels.grid.cellSize !== grid.cellSize || b.voxels.grid.resolution.some((r, i) => r !== grid.resolution[i])) {
    throw new Error("Interpolation requires the same lattice on both snapshots.");
  }

  const weight = new Map<number, { i: number; j: number; k: number; w: number; ca: number[]; cb: number[] }>();
  const add = (voxels: SparseVoxels, share: number, slot: "ca" | "cb") => {
    const confidence = voxels.attributes.confidence;
    for (let v = 0; v < voxelCount(voxels); v++) {
      const i = voxels.coords[v * 3], j = voxels.coords[v * 3 + 1], k = voxels.coords[v * 3 + 2];
      const key = denseIndexOf(grid, i, j, k);
      let entry = weight.get(key);
      if (!entry) {
        entry = { i, j, k, w: 0, ca: [], cb: [] };
        weight.set(key, entry);
      }
      entry.w += share;
      if (confidence) entry[slot].push(confidence[v]);
    }
  };
  add(a.voxels, 1 - t, "ca");
  add(b.voxels, t, "cb");

  const cells: Array<[number, number, number]> = [];
  const confidences: number[] = [];
  for (const entry of weight.values()) {
    if (entry.w < 0.5) continue;
    cells.push([entry.i, entry.j, entry.k]);
    const evidence = [...entry.ca, ...entry.cb];
    confidences.push(evidence.length > 0 ? evidence.reduce((s, c) => s + c, 0) / evidence.length : 0);
  }

  const voxels = buildSparseVoxels(grid, cells, {
    occupancy: a.voxels.occupancy,
    channels: confidences.length > 0 ? [DEFAULT_CONFIDENCE_CHANNEL] : [],
    attributes: confidences.length > 0 ? { confidence: confidences } : {},
  });
  return {
    voxels,
    note: `interpolated at t=${t.toFixed(3)} between ${a.manifest.id} and ${b.manifest.id}; ${voxels.coords.length / 3} cells pass the 0.5 weight threshold — a hypothesis between measurements, not a measurement`,
  };
}

export interface SeriesDiffEntry {
  from: string;
  to: string;
  diff: SnapshotDiff;
}

/** Differences between consecutive snapshots in the history. */
export async function diffSeries(
  object: TemporalObject,
  store: SnapshotStore,
  options: { fromId?: string } = {},
): Promise<SeriesDiffEntry[]> {
  const loaded = await loadHistory(object, store, options);
  const out: SeriesDiffEntry[] = [];
  for (let i = 1; i < loaded.length; i++) {
    out.push({
      from: loaded[i - 1].record.id,
      to: loaded[i].record.id,
      diff: diffSnapshots(loaded[i - 1].snapshot, loaded[i].snapshot),
    });
  }
  return out;
}

/** A cell centre in world space, re-exported so callers do not import voxels.ts for one function. */
export function worldCenter(snapshot: NreSnapshot, index: number): [number, number, number] {
  const { coords, grid } = snapshot.voxels;
  return cellCenter(grid, coords[index * 3], coords[index * 3 + 1], coords[index * 3 + 2]);
}

/** Whether every cell of `a` exists in `b` and vice versa (exact same set). */
export function sameOccupancy(a: SparseVoxels, b: SparseVoxels): boolean {
  const metrics = compareVoxelSets(a, b);
  return metrics.onlyA === 0 && metrics.onlyB === 0;
}

export { isInside };
