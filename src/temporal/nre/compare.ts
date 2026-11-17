/**
 * ==========================================================
 * TEMPORAL STUDIO — NRE — NUMERICAL COMPARISON
 *
 * What changed between two numerical representations, measured rather
 * than asserted. Every number here is computed from occupied cells, so
 * it survives a round trip through a file unchanged.
 *
 * The important part is `classifyChange`. "The voxel sets differ" has
 * four very different meanings and they must not be conflated:
 *
 *   1. the same object observed again        → same cells, similar confidence
 *   2. multiple observations raising trust   → same cells, higher confidence
 *   3. the object itself changed shape       → cells appear and disappear
 *   4. the object moved                      → the shape survives a shift
 *
 * Only (4) is tested by actually translating one set onto the other and
 * counting the match; if that test fails, the honest answer is "the
 * geometry changed", not "it moved".
 * ==========================================================
 */

import type { NreSnapshot, SparseVoxels, Vec3 } from "./types.ts";
import { cellCenter, denseIndexOf, occupancyKeySet, voxelCount } from "./voxels.ts";

export class NreGridMismatchError extends Error {
  constructor(detail: string) {
    super(`Cannot compare representations on different lattices: ${detail}`);
    this.name = "NreGridMismatchError";
  }
}

export class NreIdentityError extends Error {
  constructor(a: string, b: string) {
    super(
      `Snapshots "${a}" and "${b}" have different object identities; refusing to compare them as the same object. ` +
        `Two observations are not the same object because they look alike — an identity or correspondence is required.`,
    );
    this.name = "NreIdentityError";
  }
}

function assertSameGrid(a: SparseVoxels, b: SparseVoxels): void {
  const ga = a.grid;
  const gb = b.grid;
  if (ga.cellSize !== gb.cellSize) throw new NreGridMismatchError(`cell size ${ga.cellSize} vs ${gb.cellSize}`);
  if (ga.resolution.some((r, i) => r !== gb.resolution[i])) {
    throw new NreGridMismatchError(`resolution ${ga.resolution.join("×")} vs ${gb.resolution.join("×")}`);
  }
  if (ga.origin.some((o, i) => o !== gb.origin[i])) {
    throw new NreGridMismatchError(`origin [${ga.origin.join(",")}] vs [${gb.origin.join(",")}]`);
  }
}

export interface SetMetrics {
  countA: number;
  countB: number;
  shared: number;
  onlyA: number;
  onlyB: number;
  /** |A∩B| / |A∪B|. 0 when both are empty. */
  iou: number;
  /** |A∩B| / |A∪B|, the same value named for disclosure. */
  jaccard: number;
  /** How much of A survives: |A∩B| / |A|. */
  containment: number;
  /** (|AΔB|) / |A∪B| — the fraction of the union that is disagreement. */
  symmetricDifferenceFraction: number;
  centroidA: Vec3;
  centroidB: Vec3;
  centroidShift: Vec3;
  /** Largest nearest-neighbour distance from A into B, in cells (capped at probeRadius). */
  maxDisplacementCells: number;
  meanDisplacementCells: number;
  /** Cells of A with no B cell within probeRadius. */
  unmatchedBeyondProbe: number;
  bboxDeltaSize: Vec3;
}

/** Offsets ordered by increasing distance, so a nearest-cell search stops at the first hit. */
function probeOffsets(radius: number): Array<[number, number, number, number]> {
  const out: Array<[number, number, number, number]> = [];
  for (let i = -radius; i <= radius; i++) {
    for (let j = -radius; j <= radius; j++) {
      for (let k = -radius; k <= radius; k++) {
        out.push([i, j, k, i * i + j * j + k * k]);
      }
    }
  }
  return out.sort((a, b) => a[3] - b[3] || a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
}

const PROBE_RADIUS = 4;
const OFFSETS = probeOffsets(PROBE_RADIUS);

/** Measure the difference between two voxel sets on the same lattice. */
export function compareVoxelSets(a: SparseVoxels, b: SparseVoxels, options: { probeRadius?: number } = {}): SetMetrics {
  assertSameGrid(a, b);
  const grid = a.grid;
  const keysA = occupancyKeySet(a);
  const keysB = occupancyKeySet(b);
  const countA = voxelCount(a);
  const countB = voxelCount(b);

  let shared = 0;
  for (const key of keysA) if (keysB.has(key)) shared++;
  const onlyA = countA - shared;
  const onlyB = countB - shared;
  const union = countA + countB - shared;

  const centroidOf = (voxels: SparseVoxels): Vec3 => {
    const n = voxelCount(voxels);
    if (n === 0) return [grid.origin[0], grid.origin[1], grid.origin[2]];
    const sum: Vec3 = [0, 0, 0];
    for (let v = 0; v < n; v++) {
      const center = cellCenter(grid, voxels.coords[v * 3], voxels.coords[v * 3 + 1], voxels.coords[v * 3 + 2]);
      sum[0] += center[0];
      sum[1] += center[1];
      sum[2] += center[2];
    }
    return [sum[0] / n, sum[1] / n, sum[2] / n];
  };

  const centroidA = centroidOf(a);
  const centroidB = centroidOf(b);

  const probeRadius = options.probeRadius ?? PROBE_RADIUS;
  const offsets = options.probeRadius ? probeOffsets(probeRadius) : OFFSETS;
  let maxDisplacement = 0;
  let totalDisplacement = 0;
  let unmatched = 0;
  const [nx, ny, nz] = grid.resolution;

  for (let v = 0; v < countA; v++) {
    const i = a.coords[v * 3], j = a.coords[v * 3 + 1], k = a.coords[v * 3 + 2];
    let best = -1;
    for (const [di, dj, dk, squared] of offsets) {
      if (squared > probeRadius * probeRadius) break;
      const ni = i + di, nj = j + dj, nk = k + dk;
      if (ni < 0 || nj < 0 || nk < 0 || ni >= nx || nj >= ny || nk >= nz) continue;
      if (keysB.has(denseIndexOf(grid, ni, nj, nk))) {
        best = squared;
        break;
      }
    }
    if (best < 0) {
      unmatched++;
      maxDisplacement = Math.max(maxDisplacement, probeRadius);
      totalDisplacement += probeRadius;
    } else {
      const distance = Math.sqrt(best);
      maxDisplacement = Math.max(maxDisplacement, distance);
      totalDisplacement += distance;
    }
  }

  return {
    countA,
    countB,
    shared,
    onlyA,
    onlyB,
    iou: union === 0 ? 0 : shared / union,
    jaccard: union === 0 ? 0 : shared / union,
    containment: countA === 0 ? 1 : shared / countA,
    symmetricDifferenceFraction: union === 0 ? 0 : (onlyA + onlyB) / union,
    centroidA,
    centroidB,
    centroidShift: [centroidB[0] - centroidA[0], centroidB[1] - centroidA[1], centroidB[2] - centroidA[2]],
    maxDisplacementCells: maxDisplacement,
    meanDisplacementCells: countA === 0 ? 0 : totalDisplacement / countA,
    unmatchedBeyondProbe: unmatched,
    bboxDeltaSize: [
      b.bbox.max[0] - b.bbox.min[0] - (a.bbox.max[0] - a.bbox.min[0]),
      b.bbox.max[1] - b.bbox.min[1] - (a.bbox.max[1] - a.bbox.min[1]),
      b.bbox.max[2] - b.bbox.min[2] - (a.bbox.max[2] - a.bbox.min[2]),
    ],
  };
}

export type ChangeKind =
  | "no-change"
  | "reobserved"
  | "improved-confidence"
  | "confidence-regressed"
  | "expanded"
  | "shrunk"
  | "rigid-movement"
  | "geometry-changed";

export interface SnapshotDiff extends SetMetrics {
  objectId: string;
  snapshotA: string;
  snapshotB: string;
  /** Aggregate confidence of each snapshot, 0..1. */
  snapshotConfidenceA: number;
  snapshotConfidenceB: number;
  /** f64 max absolute per-cell confidence change over shared cells. */
  maxConfidenceDelta: number;
  meanConfidenceA: number;
  meanConfidenceB: number;
  transformChanged: boolean;
  kind: ChangeKind;
  /** Why that classification, in words, referencing the measurement. */
  explains: string;
}

function confidenceStats(a: SparseVoxels, b: SparseVoxels): { maxDelta: number; meanA: number; meanB: number } {
  const confA = a.attributes.confidence;
  const confB = b.attributes.confidence;
  const nA = voxelCount(a);
  const nB = voxelCount(b);
  if (!confA && !confB) return { maxDelta: 0, meanA: 0, meanB: 0 };

  let sumA = 0;
  for (let v = 0; v < nA; v++) sumA += confA?.[v] ?? 0;
  let sumB = 0;
  for (let v = 0; v < nB; v++) sumB += confB?.[v] ?? 0;

  // Per-cell delta only where the cell exists in both sets; a cell that
  // appeared or disappeared is an occupancy change, not a confidence one.
  let maxDelta = 0;
  if (confA && confB) {
    const indexOfA = new Map<number, number>();
    for (let v = 0; v < nA; v++) {
      indexOfA.set(denseIndexOf(a.grid, a.coords[v * 3], a.coords[v * 3 + 1], a.coords[v * 3 + 2]), v);
    }
    for (let v = 0; v < nB; v++) {
      const key = denseIndexOf(b.grid, b.coords[v * 3], b.coords[v * 3 + 1], b.coords[v * 3 + 2]);
      const av = indexOfA.get(key);
      if (av === undefined) continue;
      maxDelta = Math.max(maxDelta, Math.abs(confB[v] - confA[av]));
    }
  }

  return {
    maxDelta,
    meanA: nA === 0 ? 0 : sumA / nA,
    meanB: nB === 0 ? 0 : sumB / nB,
  };
}

/**
 * Does B look like A translated by an integer cell offset? Tests the
 * candidate shift implied by the centroid difference and counts how much
 * of A lands on B. Rotation is not tested: a lattice cannot represent an
 * arbitrary rotation without resampling, so a rotated object is reported
 * as changed geometry with the resampling loss already measured.
 */
function rigidShiftMatch(a: SparseVoxels, b: SparseVoxels, shift: Vec3): number {
  const grid = a.grid;
  const [di, dj, dk] = shift.map((s) => Math.round(s / grid.cellSize));
  if (di === 0 && dj === 0 && dk === 0) return 0;
  const keysB = occupancyKeySet(b);
  let matched = 0;
  const n = voxelCount(a);
  for (let v = 0; v < n; v++) {
    const ni = a.coords[v * 3] + di, nj = a.coords[v * 3 + 1] + dj, nk = a.coords[v * 3 + 2] + dk;
    const key = denseIndexOf(grid, ni, nj, nk);
    if (key !== -1 && keysB.has(key)) matched++;
  }
  return n === 0 ? 0 : matched / n;
}

/** Compare two loaded snapshots, refusing to conflate different objects. */
export function diffSnapshots(a: NreSnapshot, b: NreSnapshot): SnapshotDiff {
  const idA = a.manifest.snapshot.lineage.objectId;
  const idB = b.manifest.snapshot.lineage.objectId;
  if (idA !== idB) throw new NreIdentityError(a.manifest.id, b.manifest.id);

  const metrics = compareVoxelSets(a.voxels, b.voxels);
  const confidence = confidenceStats(a.voxels, b.voxels);

  let kind: ChangeKind;
  let explains: string;
  const identical = metrics.onlyA === 0 && metrics.onlyB === 0;
  const shiftMatch = identical ? 1 : rigidShiftMatch(a.voxels, b.voxels, metrics.centroidShift);

  if (identical && metrics.countA > 0) {
    if (a.manifest.snapshot.confidence > b.manifest.snapshot.confidence + 1e-9) {
      kind = "confidence-regressed";
      explains = `Identical occupancy but aggregate confidence FELL from ${a.manifest.snapshot.confidence.toFixed(4)} to ${b.manifest.snapshot.confidence.toFixed(4)}; recorded as a regression, not an improvement.`;
    } else if (b.manifest.snapshot.confidence > a.manifest.snapshot.confidence + 1e-9) {
      kind = "improved-confidence";
      explains = `Identical occupancy; aggregate confidence rose from ${a.manifest.snapshot.confidence.toFixed(4)} to ${b.manifest.snapshot.confidence.toFixed(4)} — the same object seen with more or better evidence.`;
    } else {
      kind = "reobserved";
      explains = "Identical occupancy and unchanged confidence: the same object observed again, contributing repeat evidence rather than new geometry.";
    }
  } else if (metrics.onlyA > 0 && metrics.onlyB > 0 && shiftMatch >= 0.95) {
    kind = "rigid-movement";
    explains = `Geometry survives a ${Math.round(metrics.centroidShift[0] / a.voxels.grid.cellSize)},${Math.round(metrics.centroidShift[1] / a.voxels.grid.cellSize)},${Math.round(metrics.centroidShift[2] / a.voxels.grid.cellSize)} cell shift with ${(shiftMatch * 100).toFixed(1)}% of cells landing on the later set: consistent with movement, not deformation.`;
  } else if (metrics.onlyA === 0 && metrics.onlyB > 0) {
    kind = "expanded";
    explains = `${metrics.onlyB} cells appeared and none disappeared: new surface was observed, the earlier evidence is still present.`;
  } else if (metrics.onlyB === 0 && metrics.onlyA > 0) {
    kind = "shrunk";
    explains = `${metrics.onlyA} cells disappeared and none appeared: the later observation does not support part of the earlier surface.`;
  } else {
    kind = "geometry-changed";
    explains = `${metrics.onlyA} cells only in the earlier snapshot, ${metrics.onlyB} only in the later one, and only ${(shiftMatch * 100).toFixed(1)}% match under the best integer shift: the shape itself changed.`;
  }

  return {
    ...metrics,
    objectId: idA,
    snapshotA: a.manifest.id,
    snapshotB: b.manifest.id,
    snapshotConfidenceA: a.manifest.snapshot.confidence,
    snapshotConfidenceB: b.manifest.snapshot.confidence,
    maxConfidenceDelta: confidence.maxDelta,
    meanConfidenceA: confidence.meanA,
    meanConfidenceB: confidence.meanB,
    transformChanged: JSON.stringify(a.manifest.snapshot.transform.matrix) !== JSON.stringify(b.manifest.snapshot.transform.matrix),
    kind,
    explains,
  };
}
