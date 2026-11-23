/**
 * ==========================================================
 * LÉLU ASRE — TEMPORAL SNAPSHOTS
 *
 * A snapshot is a persistent numerical state of a reconstruction.
 * Each one stores only its DIFF against its parent plus the records
 * of what produced it; any snapshot is rebuilt by replaying diffs
 * from its root, and the rebuilt grid must hash to the value
 * recorded at commit time — otherwise restore fails loudly.
 *
 *   root ─▶ s1 ─▶ s2 ─▶ s3 (head)
 *                  └──▶ s2b         (branches are allowed)
 *
 * Observation tables are append-only along a chain: a child's
 * observation list starts with its parent's, so evidence indices
 * recorded in any ancestor diff stay valid.
 * ==========================================================
 */

import { encodeGrid } from "../nre/serialize.ts";
import { sha256Hex } from "../nre/hash.ts";
import { SparseVoxelGrid } from "../nre/SparseVoxelGrid.ts";
import type { Aabb, Cell, Observation, Vec3 } from "../nre/types.ts";

export type TransformRecord =
  | { kind: "fuse"; observationId: string; added: number; reinforced: number; duplicate: boolean }
  | { kind: "carve"; observationId: string; removed: number }
  | { kind: "translate"; delta: Vec3 }
  | { kind: "replace-region"; region: Aabb; component?: string; reason: string }
  | { kind: "interpolate"; fromSnapshot: string; toSnapshot: string; t: number }
  | { kind: "restore"; fromSnapshot: string }
  | { kind: "note"; text: string };

export interface GridDiff {
  added: Array<[number, Cell]>;
  removed: number[];
  changed: Array<[number, Cell]>;
}

export interface Snapshot {
  id: string;
  parentId: string | null;
  createdAt: number;
  label: string;
  /** Full observation-id table of this snapshot's grid, in index order. */
  observationIds: string[];
  transformations: TransformRecord[];
  diff: GridDiff;
  cellCount: number;
  /** SHA-256 of the snapshot's canonical .lnre encoding. */
  contentHash: string;
}

function cellEqual(a: Cell, b: Cell): boolean {
  if (a.confidence !== b.confidence || a.provenance !== b.provenance || a.evidence.length !== b.evidence.length) return false;
  for (let i = 0; i < a.evidence.length; i++) if (a.evidence[i].obs !== b.evidence[i].obs || a.evidence[i].p !== b.evidence[i].p) return false;
  return true;
}

function copyCell(c: Cell): Cell {
  return { confidence: c.confidence, provenance: c.provenance, evidence: c.evidence.map((e) => ({ ...e })) };
}

export function diffGrids(before: SparseVoxelGrid | null, after: SparseVoxelGrid): GridDiff {
  const diff: GridDiff = { added: [], removed: [], changed: [] };
  for (const [code, cell] of after.entries()) {
    const prev = before?.getByCode(code);
    if (!prev) diff.added.push([code, copyCell(cell)]);
    else if (!cellEqual(prev, cell)) diff.changed.push([code, copyCell(cell)]);
  }
  if (before) for (const code of before.codes()) if (!after.getByCode(code)) diff.removed.push(code);
  return diff;
}

export function gridHash(grid: SparseVoxelGrid): string {
  return sha256Hex(encodeGrid(grid));
}

export class SnapshotIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SnapshotIntegrityError";
  }
}

export class SnapshotStore {
  private readonly snapshots = new Map<string, Snapshot>();
  private readonly cache = new Map<string, SparseVoxelGrid>();
  private head: string | null = null;
  private counter = 0;

  private readonly options: { cacheLimit?: number; now?: () => number };
  constructor(options: { cacheLimit?: number; now?: () => number } = {}) {
    this.options = options;
  }

  get headId(): string | null {
    return this.head;
  }

  get(id: string): Snapshot | undefined {
    return this.snapshots.get(id);
  }

  list(): Snapshot[] {
    return [...this.snapshots.values()];
  }

  /**
   * Commit `grid` as a child of `parentId` (default: head). The grid is copied;
   * later edits to the caller's grid never reach the stored history.
   */
  commit(grid: SparseVoxelGrid, meta: { label: string; transformations?: TransformRecord[]; parentId?: string | null; id?: string }): Snapshot {
    const parentId = meta.parentId === undefined ? this.head : meta.parentId;
    const parent = parentId ? this.materialize(parentId) : null;
    const observationIds = grid.getObservations().map((o) => o.id);
    if (parentId) {
      const parentIds = this.snapshots.get(parentId)!.observationIds;
      for (let i = 0; i < parentIds.length; i++) {
        if (observationIds[i] !== parentIds[i]) throw new SnapshotIntegrityError(`observation table of the new state does not extend snapshot ${parentId}'s (index ${i})`);
      }
    }
    const id = meta.id ?? `snap-${String(++this.counter).padStart(4, "0")}`;
    if (this.snapshots.has(id)) throw new SnapshotIntegrityError(`snapshot id ${id} already exists`);
    const snapshot: Snapshot = {
      id,
      parentId,
      createdAt: (this.options.now ?? Date.now)(),
      label: meta.label,
      observationIds,
      transformations: meta.transformations ?? [],
      diff: diffGrids(parent, grid),
      cellCount: grid.size,
      contentHash: gridHash(grid),
    };
    this.snapshots.set(id, Object.freeze(snapshot));
    this.remember(id, grid.clone());
    this.head = id;
    return snapshot;
  }

  /** Root-to-snapshot chain (the observation sequence that produced it). */
  lineage(id: string): Snapshot[] {
    const chain: Snapshot[] = [];
    let cur: string | null = id;
    while (cur) {
      const s = this.snapshots.get(cur);
      if (!s) throw new SnapshotIntegrityError(`unknown snapshot ${cur}`);
      chain.push(s);
      cur = s.parentId;
    }
    return chain.reverse();
  }

  /**
   * Historical reconstruction: rebuild the grid of `id` by replaying diffs from
   * its root. Never served from cache — this is the proof the history is complete.
   */
  replay(id: string): SparseVoxelGrid {
    const chain = this.lineage(id);
    const target = chain[chain.length - 1];
    const grid = new SparseVoxelGrid(this.specOf(id));
    for (const o of this.observationsFor(target.observationIds)) grid.addObservation(o);
    for (const s of chain) {
      for (const code of s.diff.removed) grid.deleteByCode(code);
      for (const [code, cell] of s.diff.added) grid.setCellByCode(code, cell);
      for (const [code, cell] of s.diff.changed) grid.setCellByCode(code, cell);
    }
    const hash = gridHash(grid);
    if (hash !== target.contentHash) throw new SnapshotIntegrityError(`replay of ${id} hashes to ${hash.slice(0, 12)}, recorded ${target.contentHash.slice(0, 12)}`);
    return grid;
  }

  /** The grid of a snapshot (copy). Uses the cache when possible, replay otherwise. */
  materialize(id: string): SparseVoxelGrid {
    const cached = this.cache.get(id);
    if (cached) return cached.clone();
    const grid = this.replay(id);
    this.remember(id, grid.clone());
    return grid;
  }

  /** Make an old snapshot current again by committing it as a new head (history is never rewritten). */
  restore(id: string, label = `restore ${id}`): Snapshot {
    const target = this.materialize(id);
    if (!this.head) return this.commit(target, { label, transformations: [{ kind: "restore", fromSnapshot: id }], parentId: null });
    // Keep the head's append-only observation table; re-index the old cells' evidence by observation id.
    const headGrid = this.materialize(this.head);
    const grid = new SparseVoxelGrid(target.spec);
    for (const o of headGrid.getObservations()) grid.addObservation(o);
    const remap = target.getObservations().map((o) => {
      const at = grid.observationIndex(o.id);
      return at >= 0 ? at : grid.addObservation(o).index;
    });
    for (const [code, cell] of target.entries()) grid.setCellByCode(code, { ...cell, evidence: cell.evidence.map((e) => ({ obs: remap[e.obs], p: e.p })) });
    return this.commit(grid, { label, transformations: [{ kind: "restore", fromSnapshot: id }], parentId: this.head });
  }

  /** Drop all cached grids (tests use this to force replay). */
  dropCache(): void {
    this.cache.clear();
  }

  /* ------------------------------- internals ------------------------------- */

  private readonly observationRegistry = new Map<string, Observation>();
  private readonly specs = new Map<string, SparseVoxelGrid["spec"]>();

  private remember(id: string, grid: SparseVoxelGrid): void {
    for (const o of grid.getObservations()) this.observationRegistry.set(o.id, o);
    this.specs.set(id, grid.spec);
    this.cache.set(id, grid);
    const limit = this.options.cacheLimit ?? 8;
    while (this.cache.size > limit) {
      const oldest = this.cache.keys().next().value as string;
      if (oldest === id) break;
      this.cache.delete(oldest);
    }
  }

  private observationsFor(ids: string[]): Observation[] {
    return ids.map((oid) => {
      const o = this.observationRegistry.get(oid);
      if (!o) throw new SnapshotIntegrityError(`observation ${oid} is not in the store`);
      return o;
    });
  }

  private specOf(id: string): SparseVoxelGrid["spec"] {
    const s = this.specs.get(id);
    if (!s) throw new SnapshotIntegrityError(`no grid spec recorded for ${id}`);
    return s;
  }
}
