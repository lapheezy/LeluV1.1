/**
 * ==========================================================
 * TEMPORAL STUDIO — NRE — INTERPOLATION WITH UNCERTAINTY
 *
 * Three ways to stand between two observations, each honest about what
 * it knows:
 *
 *   occupancy-blend   no correspondence at all. A cell is present at time
 *                     t if its evidence weight passes 0.5. It answers
 *                     "how much of the change has happened", not "where".
 *   rigid             one transform explains the change. Cells are moved
 *                     along the interpolated transform, which places
 *                     geometry between the endpoints instead of fading it.
 *   correspondence    every cell of A is matched to the nearest cell of B
 *                     within a radius and moved along its own displacement.
 *                     This is surface deformation interpolation, and cells
 *                     with no match are reported, not silently dropped.
 *
 * Every result carries `state: "interpolated"` and a per-cell
 * `uncertainty` channel: 4t(1−t)·(1−agreement), which is 0 at both
 * observed ends and maximal halfway where nothing was measured. Confidence
 * is propagated as the weighted mean of the contributing observations —
 * never increased by interpolation.
 * ==========================================================
 */

import type { AttributeChannel, NreSnapshot, SparseVoxels } from "./types.ts";
import { buildSparseVoxels, cellCenter, denseIndexOf, occupancyKeySet, voxelCount } from "./voxels.ts";

export type InterpolationMethod = "occupancy-blend" | "rigid" | "correspondence";

export interface InterpolationMetrics {
  cells: number;
  /** Cells whose evidence came from A only / B only / both. */
  fromAOnly: number;
  fromBOnly: number;
  fromBoth: number;
  /** Cells of A / B that found no correspondence within the radius. */
  unmatchedA: number;
  unmatchedB: number;
  meanDisplacementCells: number;
  maxDisplacementCells: number;
  meanConfidence: number;
  meanUncertainty: number;
  /** Share of occupied cells supported by both endpoints. */
  agreement: number;
}

export interface InterpolationResult {
  voxels: SparseVoxels;
  method: InterpolationMethod;
  t: number;
  state: "interpolated";
  sources: [string, string];
  metrics: InterpolationMetrics;
  note: string;
}

const UNCERTAINTY_CHANNEL: AttributeChannel = {
  name: "uncertainty",
  kind: "f32",
  components: 1,
  quantisation: null,
  componentsMeaning: ["interpolation-uncertainty"],
};

const CONFIDENCE_CHANNEL: AttributeChannel = {
  name: "confidence",
  kind: "f32",
  components: 1,
  quantisation: null,
  componentsMeaning: ["confidence"],
};

function assertComparable(a: NreSnapshot, b: NreSnapshot): void {
  if (a.manifest.snapshot.lineage.objectId !== b.manifest.snapshot.lineage.objectId) {
    throw new Error(
      `Interpolation requires snapshots of the SAME object; "${a.manifest.snapshot.lineage.objectId}" and "${b.manifest.snapshot.lineage.objectId}" are different identities.`,
    );
  }
  const ga = a.voxels.grid;
  const gb = b.voxels.grid;
  if (ga.cellSize !== gb.cellSize || ga.resolution.some((r, i) => r !== gb.resolution[i])) {
    throw new Error("Interpolation requires the same lattice on both snapshots.");
  }
}

function offsetsByDistance(radius: number): Array<[number, number, number, number]> {
  const out: Array<[number, number, number, number]> = [];
  for (let i = -radius; i <= radius; i++) {
    for (let j = -radius; j <= radius; j++) {
      for (let k = -radius; k <= radius; k++) out.push([i, j, k, i * i + j * j + k * k]);
    }
  }
  return out.sort((x, y) => x[3] - y[3]);
}

interface Accumulator {
  i: number;
  j: number;
  k: number;
  weight: number;
  fromA: number;
  fromB: number;
  confidenceSum: number;
  confidenceWeight: number;
}

class WeightedCells {
  private readonly cells = new Map<number, Accumulator>();
  constructor(private readonly grid: SparseVoxels["grid"]) {}

  add(i: number, j: number, k: number, weight: number, side: "a" | "b", confidence: number): void {
    if (weight <= 0) return;
    const key = denseIndexOf(this.grid, i, j, k);
    if (key === -1) return;
    let entry = this.cells.get(key);
    if (!entry) {
      entry = { i, j, k, weight: 0, fromA: 0, fromB: 0, confidenceSum: 0, confidenceWeight: 0 };
      this.cells.set(key, entry);
    }
    entry.weight += weight;
    if (side === "a") entry.fromA += weight;
    else entry.fromB += weight;
    if (confidence > 0) {
      entry.confidenceSum += confidence * weight;
      entry.confidenceWeight += weight;
    }
  }

  build(t: number): { voxels: SparseVoxels; fromAOnly: number; fromBOnly: number; fromBoth: number } {
    const kept: Accumulator[] = [];
    for (const entry of this.cells.values()) if (entry.weight >= 0.5) kept.push(entry);
    const confidence: number[] = [];
    const uncertainty: number[] = [];
    let fromAOnly = 0, fromBOnly = 0, fromBoth = 0;

    for (const entry of kept) {
      const total = entry.fromA + entry.fromB;
      const mix = total === 0 ? 0 : Math.min(entry.fromA, entry.fromB) / total;
      if (entry.fromA > 0 && entry.fromB > 0) fromBoth++;
      else if (entry.fromA > 0) fromAOnly++;
      else fromBOnly++;
      confidence.push(entry.confidenceWeight === 0 ? 0 : entry.confidenceSum / entry.confidenceWeight);
      // 4t(1−t) is 0 at both measured ends; (1−2·mix) is 0 where both
      // endpoints agree on the cell and 1 where only one of them does.
      uncertainty.push(Math.min(1, 4 * t * (1 - t) * (1 - 2 * mix)));
    }

    const voxels = buildSparseVoxels(
      this.grid,
      kept.map((entry) => [entry.i, entry.j, entry.k] as [number, number, number]),
      {
        channels: [CONFIDENCE_CHANNEL, UNCERTAINTY_CHANNEL],
        attributes: { confidence, uncertainty },
      },
    );
    return { voxels, fromAOnly, fromBOnly, fromBoth };
  }
}

function summarise(
  result: { voxels: SparseVoxels; fromAOnly: number; fromBOnly: number; fromBoth: number },
  extras: { unmatchedA: number; unmatchedB: number; displacements: number[] },
  t: number,
  method: InterpolationMethod,
  sources: [string, string],
  note: string,
): InterpolationResult {
  const confidence = result.voxels.attributes.confidence ?? new Float64Array(0);
  const uncertainty = result.voxels.attributes.uncertainty ?? new Float64Array(0);
  const cells = voxelCount(result.voxels);
  const mean = (values: Float64Array) => (values.length === 0 ? 0 : values.reduce((s, v) => s + v, 0) / values.length);
  const displacements = extras.displacements;

  return {
    voxels: result.voxels,
    method,
    t,
    state: "interpolated",
    sources,
    metrics: {
      cells,
      fromAOnly: result.fromAOnly,
      fromBOnly: result.fromBOnly,
      fromBoth: result.fromBoth,
      unmatchedA: extras.unmatchedA,
      unmatchedB: extras.unmatchedB,
      meanDisplacementCells: displacements.length === 0 ? 0 : displacements.reduce((s, v) => s + v, 0) / displacements.length,
      maxDisplacementCells: displacements.length === 0 ? 0 : Math.max(...displacements),
      meanConfidence: mean(confidence),
      meanUncertainty: mean(uncertainty),
      agreement: cells === 0 ? 0 : result.fromBoth / cells,
    },
    note,
  };
}

/**
 * Interpolate between two observed snapshots.
 *
 * `method` defaults to "correspondence", which is the only one that can
 * place surface points between the endpoints; pass "occupancy-blend" when
 * the surfaces are unrelated and no displacement should be invented, or
 * "rigid" when the change is a single translation.
 */
export function interpolateSnapshots(
  a: NreSnapshot,
  b: NreSnapshot,
  t: number,
  options: { method?: InterpolationMethod; correspondenceRadius?: number } = {},
): InterpolationResult {
  assertComparable(a, b);
  if (!(t >= 0 && t <= 1)) throw new Error(`Interpolation parameter must be within [0,1], got ${t}.`);
  const method = options.method ?? "correspondence";
  const sources: [string, string] = [a.manifest.snapshot.id, b.manifest.snapshot.id];
  const grid = a.voxels.grid;
  const radius = options.correspondenceRadius ?? 3;
  const offsets = offsetsByDistance(radius);
  const [nx, ny, nz] = grid.resolution;

  const cellOf = (voxels: SparseVoxels, index: number): [number, number, number] => [
    voxels.coords[index * 3],
    voxels.coords[index * 3 + 1],
    voxels.coords[index * 3 + 2],
  ];

  if (method === "occupancy-blend") {
    const cells = new WeightedCells(grid);
    for (let v = 0; v < voxelCount(a.voxels); v++) {
      const [i, j, k] = cellOf(a.voxels, v);
      cells.add(i, j, k, 1 - t, "a", a.voxels.attributes.confidence?.[v] ?? 0);
    }
    for (let v = 0; v < voxelCount(b.voxels); v++) {
      const [i, j, k] = cellOf(b.voxels, v);
      cells.add(i, j, k, t, "b", b.voxels.attributes.confidence?.[v] ?? 0);
    }
    const built = cells.build(t);
    return summarise(
      built,
      { unmatchedA: 0, unmatchedB: 0, displacements: [] },
      t,
      method,
      sources,
      `occupancy blend at t=${t.toFixed(3)}: no correspondence is assumed, so cell positions are not moved — this answers how much of the change has happened, not where it happened.`,
    );
  }

  const keysB = occupancyKeySet(b.voxels);
  const keysA = occupancyKeySet(a.voxels);
  const cells = new WeightedCells(grid);
  const displacements: number[] = [];
  let unmatchedA = 0;
  let unmatchedB = 0;

  if (method === "rigid") {
    const shift = [0, 1, 2].map((axis) => {
      const centre = (voxels: SparseVoxels) => {
        let sum = 0;
        for (let v = 0; v < voxelCount(voxels); v++) sum += voxels.coords[v * 3 + axis];
        return voxelCount(voxels) === 0 ? 0 : sum / voxelCount(voxels);
      };
      return centre(b.voxels) - centre(a.voxels);
    });

    for (let v = 0; v < voxelCount(a.voxels); v++) {
      const [i, j, k] = cellOf(a.voxels, v);
      const ni = Math.round(i + shift[0] * t);
      const nj = Math.round(j + shift[1] * t);
      const nk = Math.round(k + shift[2] * t);
      cells.add(ni, nj, nk, 1 - t, "a", a.voxels.attributes.confidence?.[v] ?? 0);
      displacements.push(Math.hypot(ni - i, nj - j, nk - k));
    }
    for (let v = 0; v < voxelCount(b.voxels); v++) {
      const [i, j, k] = cellOf(b.voxels, v);
      const ni = Math.round(i - shift[0] * (1 - t));
      const nj = Math.round(j - shift[1] * (1 - t));
      const nk = Math.round(k - shift[2] * (1 - t));
      cells.add(ni, nj, nk, t, "b", b.voxels.attributes.confidence?.[v] ?? 0);
    }
    const built = cells.build(t);
    return summarise(
      built,
      { unmatchedA: 0, unmatchedB: 0, displacements },
      t,
      method,
      sources,
      `rigid interpolation at t=${t.toFixed(3)} along the measured centroid shift (${shift.map((s) => s.toFixed(2)).join(", ")} cells); shape is assumed constant between endpoints.`,
    );
  }

  // correspondence
  let sumDisplacement = 0;
  let matchedCount = 0;
  for (let v = 0; v < voxelCount(a.voxels); v++) {
    const [i, j, k] = cellOf(a.voxels, v);
    let best: [number, number, number] | null = null;
    let bestDistance = Infinity;
    for (const [di, dj, dk, squared] of offsets) {
      if (squared > radius * radius) break;
      const ni = i + di, nj = j + dj, nk = k + dk;
      if (ni < 0 || nj < 0 || nk < 0 || ni >= nx || nj >= ny || nk >= nz) continue;
      if (!keysB.has(denseIndexOf(grid, ni, nj, nk))) continue;
      best = [ni, nj, nk];
      bestDistance = Math.sqrt(squared);
      break;
    }
    const confidence = a.voxels.attributes.confidence?.[v] ?? 0;
    if (!best) {
      unmatchedA++;
      cells.add(i, j, k, 1 - t, "a", confidence);
      continue;
    }
    matchedCount++;
    sumDisplacement += bestDistance;
    displacements.push(bestDistance);
    cells.add(
      Math.round(i + (best[0] - i) * t),
      Math.round(j + (best[1] - j) * t),
      Math.round(k + (best[2] - k) * t),
      1 - t,
      "a",
      confidence,
    );
  }

  for (let v = 0; v < voxelCount(b.voxels); v++) {
    const [i, j, k] = cellOf(b.voxels, v);
    let best: [number, number, number] | null = null;
    for (const [di, dj, dk, squared] of offsets) {
      if (squared > radius * radius) break;
      const ni = i + di, nj = j + dj, nk = k + dk;
      if (ni < 0 || nj < 0 || nk < 0 || ni >= nx || nj >= ny || nk >= nz) continue;
      if (!keysA.has(denseIndexOf(grid, ni, nj, nk))) continue;
      best = [ni, nj, nk];
      break;
    }
    const confidence = b.voxels.attributes.confidence?.[v] ?? 0;
    if (!best) {
      unmatchedB++;
      cells.add(i, j, k, t, "b", confidence);
      continue;
    }
    cells.add(
      Math.round(i + (best[0] - i) * (1 - t)),
      Math.round(j + (best[1] - j) * (1 - t)),
      Math.round(k + (best[2] - k) * (1 - t)),
      t,
      "b",
      confidence,
    );
  }

  const built = cells.build(t);
  void sumDisplacement;
  void matchedCount;
  return summarise(
    built,
    { unmatchedA, unmatchedB, displacements },
    t,
    method,
    sources,
    `correspondence interpolation at t=${t.toFixed(3)} within a ${radius}-cell radius: ${unmatchedA} cell(s) of the earlier and ${unmatchedB} of the later snapshot had no counterpart and were left in place, still marked interpolated.`,
  );
}

/* ------------------------------------------------------------------ *
 * Transform interpolation (rigid)
 * ------------------------------------------------------------------ */

/**
 * Column-major 4×4 → translation, per-axis scale and a ROW-major 3×3
 * rotation. The row/column distinction is the whole bug surface here: the
 * quaternion formulas below are stated for row-major matrices, and feeding
 * them column-major values silently transposes the rotation (t=1 then
 * fails to reproduce the target matrix, which is exactly how this was
 * caught).
 */
function decompose(matrix: ReadonlyArray<number>): {
  translation: [number, number, number];
  scale: [number, number, number];
  /** row-major: rotation[row][col] */
  rotation: [number, number, number, number, number, number, number, number, number];
} {
  const translation: [number, number, number] = [matrix[12], matrix[13], matrix[14]];
  const cx: [number, number, number] = [matrix[0], matrix[1], matrix[2]];
  const cy: [number, number, number] = [matrix[4], matrix[5], matrix[6]];
  const cz: [number, number, number] = [matrix[8], matrix[9], matrix[10]];
  const scale: [number, number, number] = [
    Math.hypot(cx[0], cx[1], cx[2]) || 1,
    Math.hypot(cy[0], cy[1], cy[2]) || 1,
    Math.hypot(cz[0], cz[1], cz[2]) || 1,
  ];
  return {
    translation,
    scale,
    rotation: [
      cx[0] / scale[0], cy[0] / scale[1], cz[0] / scale[2],
      cx[1] / scale[0], cy[1] / scale[1], cz[1] / scale[2],
      cx[2] / scale[0], cy[2] / scale[1], cz[2] / scale[2],
    ],
  };
}

/** Shepperd's method on a ROW-major 3×3 rotation. */
function quaternionFrom(r: ReadonlyArray<number>): [number, number, number, number] {
  const m00 = r[0], m01 = r[1], m02 = r[2];
  const m10 = r[3], m11 = r[4], m12 = r[5];
  const m20 = r[6], m21 = r[7], m22 = r[8];
  const trace = m00 + m11 + m22;
  if (trace > 0) {
    const s = Math.sqrt(trace + 1) * 2;
    return [0.25 * s, (m21 - m12) / s, (m02 - m20) / s, (m10 - m01) / s];
  }
  if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
    return [(m21 - m12) / s, 0.25 * s, (m01 + m10) / s, (m02 + m20) / s];
  }
  if (m11 > m22) {
    const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
    return [(m02 - m20) / s, (m01 + m10) / s, 0.25 * s, (m12 + m21) / s];
  }
  const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
  return [(m10 - m01) / s, (m02 + m20) / s, (m12 + m21) / s, 0.25 * s];
}

function slerp(a: number[], b: number[], t: number): [number, number, number, number] {
  let [w0, x0, y0, z0] = a as [number, number, number, number];
  let [w1, x1, y1, z1] = b as [number, number, number, number];
  let dot = w0 * w1 + x0 * x1 + y0 * y1 + z0 * z1;
  if (dot < 0) {
    w1 = -w1; x1 = -x1; y1 = -y1; z1 = -z1;
    dot = -dot;
  }
  if (dot > 0.9995) {
    const out: [number, number, number, number] = [w0 + (w1 - w0) * t, x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, z0 + (z1 - z0) * t];
    const length = Math.hypot(...out) || 1;
    return [out[0] / length, out[1] / length, out[2] / length, out[3] / length];
  }
  const theta = Math.acos(Math.min(1, dot));
  const sinTheta = Math.sin(theta);
  const s0 = Math.sin((1 - t) * theta) / sinTheta;
  const s1 = Math.sin(t * theta) / sinTheta;
  return [w0 * s0 + w1 * s1, x0 * s0 + x1 * s1, y0 * s0 + y1 * s1, z0 * s0 + z1 * s1];
}

/**
 * Interpolate two rigid/affine transforms: translation and scale
 * linearly, rotation by quaternion slerp. Returned column-major, as the
 * container stores matrices.
 */
export function interpolateTransform(from: ReadonlyArray<number>, to: ReadonlyArray<number>, t: number): number[] {
  if (from.length !== 16 || to.length !== 16) throw new Error("A transform needs 16 column-major values.");
  if (!(t >= 0 && t <= 1)) throw new Error(`Interpolation parameter must be within [0,1], got ${t}.`);
  const a = decompose(from);
  const b = decompose(to);
  const qa = quaternionFrom(a.rotation);
  const qb = quaternionFrom(b.rotation);
  const q = slerp(qa, qb, t);
  const [w, x, y, z] = q;
  const scale = a.scale.map((s, i) => s + (b.scale[i] - s) * t);
  const translation = a.translation.map((s, i) => s + (b.translation[i] - s) * t);
  // Row-major rotation from the quaternion, then transposed into the
  // column-major order the container and glTF use.
  const m = [
    1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w),
    2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w),
    2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y),
  ];
  return [
    m[0] * scale[0], m[3] * scale[0], m[6] * scale[0], 0,
    m[1] * scale[1], m[4] * scale[1], m[7] * scale[1], 0,
    m[2] * scale[2], m[5] * scale[2], m[8] * scale[2], 0,
    translation[0], translation[1], translation[2], 1,
  ];
}

/** Cell centres of a snapshot, for reports that quote world positions. */
export function centreOf(snapshot: NreSnapshot, index: number): [number, number, number] {
  return cellCenter(snapshot.voxels.grid, snapshot.voxels.coords[index * 3], snapshot.voxels.coords[index * 3 + 1], snapshot.voxels.coords[index * 3 + 2]);
}
