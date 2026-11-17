/**
 * ==========================================================
 * LÉLU ASRE — FLIPBOOK RECONSTRUCTION (WP2)
 *
 * The layered-snapshot idea: every observation is a persistent page.
 * Turning a page never repaints the whole book:
 *
 *   1. new information    occupied cells the state did not have
 *   2. conflicts          occupied cells the observation saw THROUGH
 *                         (free-space evidence)
 *   3. affected regions   the 8³ blocks touched by 1 or 2
 *   4. refine             apply additions and Bayesian carving
 *                         inside affected blocks only
 *   5. preserve           every cell outside them is verified
 *                         identical to the previous page
 *   6. confidence         noisy-OR over DISTINCT fingerprints —
 *                         a repeated page changes nothing
 *   7. history            each page is a snapshot (diff + records)
 *
 * Carving rule for a conflict: with current occupancy confidence c
 * and free-space confidence q, the posterior is
 *     P(occ) = c(1−q) / (c(1−q) + (1−c)q)
 * and the cell is carved when P(occ) < 0.5; otherwise the conflict
 * is kept on record and the cell stays.
 * ==========================================================
 */

import { mortonDecode, mortonEncode } from "../nre/morton";
import { SparseVoxelGrid } from "../nre/SparseVoxelGrid";
import type { Observation, Vec3 } from "../nre/types";
import { SnapshotStore, type Snapshot, type TransformRecord } from "./SnapshotStore";

export interface Page {
  observation: Observation;
  /** Cells the observation saw occupied, with optional per-cell probability. */
  occupied: Array<Vec3 | { x: number; y: number; z: number; p?: number }>;
  /** Cells the observation saw empty (rays passed through them). */
  free?: Vec3[];
  /** Confidence that a "free" cell really is empty (default: observation.confidence). */
  freeConfidence?: number;
}

export interface PageReport {
  snapshot: Snapshot | null;
  duplicate: boolean;
  newCells: number;
  reinforcedCells: number;
  conflicts: number;
  carved: number;
  conflictsKept: number;
  affectedBlocks: number;
  affectedCellsBefore: number;
  preservedCells: number;
  /** True when every cell outside the affected blocks is identical to the previous page. */
  unaffectedVerified: boolean;
  ms: number;
}

const BLOCK = 8;
const blockKey = (x: number, y: number, z: number) => mortonEncode(Math.floor(x / BLOCK), Math.floor(y / BLOCK), Math.floor(z / BLOCK));

function sameCell(a: SparseVoxelGrid, b: SparseVoxelGrid, code: number): boolean {
  const ca = a.getByCode(code), cb = b.getByCode(code);
  if (!ca || !cb) return ca === cb;
  if (ca.confidence !== cb.confidence || ca.provenance !== cb.provenance || ca.evidence.length !== cb.evidence.length) return false;
  return ca.evidence.every((e, i) => e.obs === cb.evidence[i].obs && e.p === cb.evidence[i].p);
}

export class Flipbook {
  readonly store = new SnapshotStore({ cacheLimit: 4 });
  private state: SparseVoxelGrid;

  constructor(initial: SparseVoxelGrid, label = "initial") {
    this.state = initial.clone();
    this.store.commit(this.state, { label, transformations: [{ kind: "note", text: "flipbook opened" }] });
  }

  get current(): SparseVoxelGrid {
    return this.state.clone();
  }

  turn(page: Page, label = page.observation.id): PageReport {
    const t0 = performance.now();
    const before = this.state;
    const empty: PageReport = { snapshot: null, duplicate: true, newCells: 0, reinforcedCells: 0, conflicts: 0, carved: 0, conflictsKept: 0, affectedBlocks: 0, affectedCellsBefore: 0, preservedCells: before.size, unaffectedVerified: true, ms: 0 };
    if (before.getObservations().some((o) => o.fingerprint === page.observation.fingerprint)) return { ...empty, ms: performance.now() - t0 };

    // 1–3: analyse against the current page without changing it
    const occ = page.occupied.map((c) => (Array.isArray(c) ? { x: c[0], y: c[1], z: c[2], p: undefined } : c));
    const affected = new Set<number>();
    let newCells = 0;
    for (const c of occ) {
      if (!before.has(c.x, c.y, c.z)) newCells++;
      affected.add(blockKey(c.x, c.y, c.z));
    }
    const q = page.freeConfidence ?? page.observation.confidence;
    const conflicts: Vec3[] = [];
    for (const f of page.free ?? []) {
      if (before.has(...f)) {
        conflicts.push(f);
        affected.add(blockKey(...f));
      }
    }
    let affectedCellsBefore = 0;
    for (const code of before.codes()) {
      const [x, y, z] = mortonDecode(code);
      if (affected.has(blockKey(x, y, z))) affectedCellsBefore++;
    }

    // 4: refine inside the affected blocks only
    const next = before.clone();
    const { index } = next.addObservation(page.observation);
    let reinforced = 0;
    for (const c of occ) {
      const existed = next.has(c.x, c.y, c.z);
      if (next.addEvidence(c.x, c.y, c.z, index, c.p ?? page.observation.confidence) && existed) reinforced++;
    }
    let carved = 0;
    for (const f of conflicts) {
      const cell = next.get(...f);
      if (!cell) continue;
      const c = cell.confidence;
      const post = (c * (1 - q)) / (c * (1 - q) + (1 - c) * q);
      if (post < 0.5) {
        next.delete(...f);
        carved++;
      }
    }

    // 5: everything outside the affected blocks must be untouched
    let preserved = 0;
    let verified = true;
    for (const code of before.codes()) {
      const [x, y, z] = mortonDecode(code);
      if (affected.has(blockKey(x, y, z))) continue;
      if (sameCell(before, next, code)) preserved++;
      else verified = false;
    }

    // 7: history
    const transformations: TransformRecord[] = [
      { kind: "fuse", observationId: page.observation.id, added: newCells, reinforced, duplicate: false },
      ...(carved ? [{ kind: "carve" as const, observationId: page.observation.id, removed: carved }] : []),
      { kind: "note", text: `affected ${affected.size} blocks of ${BLOCK}³; ${conflicts.length - carved} conflicts kept on record` },
    ];
    this.state = next;
    const snapshot = this.store.commit(next, { label, transformations });
    return {
      snapshot,
      duplicate: false,
      newCells,
      reinforcedCells: reinforced,
      conflicts: conflicts.length,
      carved,
      conflictsKept: conflicts.length - carved,
      affectedBlocks: affected.size,
      affectedCellsBefore,
      preservedCells: preserved,
      unaffectedVerified: verified,
      ms: performance.now() - t0,
    };
  }
}

/**
 * Simulated orthographic depth camera looking along one axis direction at a
 * ground-truth grid: first occupied cell on each ray is "occupied", cells in
 * front of it (inside `box`) are "free"; rays that hit nothing are free
 * end to end. Used to drive experiments with a known answer.
 */
export function observeAlongAxis(truth: SparseVoxelGrid, axis: 0 | 1 | 2, sign: 1 | -1, box: { min: Vec3; max: Vec3 }): { occupied: Vec3[]; free: Vec3[] } {
  const occupied: Vec3[] = [];
  const free: Vec3[] = [];
  const [u, v] = [0, 1, 2].filter((a) => a !== axis);
  for (let a = box.min[u]; a <= box.max[u]; a++)
    for (let b = box.min[v]; b <= box.max[v]; b++) {
      const start = sign > 0 ? box.min[axis] : box.max[axis];
      const end = sign > 0 ? box.max[axis] : box.min[axis];
      for (let t = start; sign > 0 ? t <= end : t >= end; t += sign) {
        const c: Vec3 = [0, 0, 0];
        c[axis] = t;
        c[u] = a;
        c[v] = b;
        if (truth.has(c[0], c[1], c[2])) {
          occupied.push(c);
          break;
        }
        free.push(c);
      }
    }
  return { occupied, free };
}
