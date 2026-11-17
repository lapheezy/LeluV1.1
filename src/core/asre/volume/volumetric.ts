/**
 * ==========================================================
 * LÉLU ASRE — VOLUMETRIC INTELLIGENCE
 *
 * Surface vs volume, measured on the lattice:
 *
 *   boundary cell   occupied, with at least one empty (or out-of-grid)
 *                   6-neighbour
 *   interior cell   occupied, all six neighbours occupied
 *
 * surfaceOf()  keeps the boundary only (what a mesh/shell stores)
 * fillInterior() rebuilds a solid from a closed boundary by flooding
 *              the outside; the cells it adds are INFERRED
 *
 * Boundary + fill is lossless only for solid, attribute-uniform
 * shapes. Internal cavities and per-cell interior evidence are lost —
 * measureBoundaryLoss() quantifies exactly what is lost, and the
 * representation selector uses those numbers.
 * ==========================================================
 */

import { mortonDecode, mortonEncode } from "../nre/morton.ts";
import { SparseVoxelGrid } from "../nre/SparseVoxelGrid.ts";
import type { Observation, Vec3 } from "../nre/types.ts";
import { compareGrids } from "../temporal/compare.ts";

const N6: Vec3[] = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
];

export function isBoundary(grid: SparseVoxelGrid, x: number, y: number, z: number): boolean {
  for (const [dx, dy, dz] of N6) if (!grid.has(x + dx, y + dy, z + dz)) return true;
  return false;
}

export interface VolumeStats {
  total: number;
  boundary: number;
  interior: number;
  interiorFraction: number;
}

export function volumeStats(grid: SparseVoxelGrid): VolumeStats {
  let boundary = 0;
  for (const [x, y, z] of grid.coords()) if (isBoundary(grid, x, y, z)) boundary++;
  const total = grid.size;
  return { total, boundary, interior: total - boundary, interiorFraction: total === 0 ? 0 : (total - boundary) / total };
}

/** Boundary-only (surface) representation. Evidence of kept cells is preserved. */
export function surfaceOf(grid: SparseVoxelGrid): SparseVoxelGrid {
  const out = new SparseVoxelGrid(grid.spec);
  for (const o of grid.getObservations()) out.addObservation(o);
  for (const [code, cell] of grid.entries()) {
    const [x, y, z] = mortonDecode(code);
    if (isBoundary(grid, x, y, z)) out.setCellByCode(code, cell);
  }
  return out;
}

/**
 * Rebuild a solid from a closed boundary: flood the outside from the padded
 * bounding box; every cell neither outside nor already occupied is interior.
 * Added cells carry `inference` (provenance should be INFERRED).
 */
export function fillInterior(surface: SparseVoxelGrid, inference: Observation): { grid: SparseVoxelGrid; filled: number } {
  const grid = surface.clone();
  const b = surface.cellBounds();
  if (!b) return { grid, filled: 0 };
  const lo: Vec3 = [b.min[0] - 1, b.min[1] - 1, b.min[2] - 1];
  const dim: Vec3 = [b.max[0] - b.min[0] + 3, b.max[1] - b.min[1] + 3, b.max[2] - b.min[2] + 3];
  const idx = (x: number, y: number, z: number) => (x * dim[1] + y) * dim[2] + z;
  const outside = new Uint8Array(dim[0] * dim[1] * dim[2]);
  const solid = (x: number, y: number, z: number) => surface.has(x + lo[0], y + lo[1], z + lo[2]);
  const stack: number[] = [0, 0, 0];
  outside[0] = 1;
  while (stack.length) {
    const z = stack.pop()!, y = stack.pop()!, x = stack.pop()!;
    for (const [dx, dy, dz] of N6) {
      const nx = x + dx, ny = y + dy, nz = z + dz;
      if (nx < 0 || ny < 0 || nz < 0 || nx >= dim[0] || ny >= dim[1] || nz >= dim[2]) continue;
      const i = idx(nx, ny, nz);
      if (outside[i] || solid(nx, ny, nz)) continue;
      outside[i] = 1;
      stack.push(nx, ny, nz);
    }
  }
  const { index } = grid.addObservation(inference);
  let filled = 0;
  for (let x = 1; x < dim[0] - 1; x++)
    for (let y = 1; y < dim[1] - 1; y++)
      for (let z = 1; z < dim[2] - 1; z++) {
        if (outside[idx(x, y, z)] || solid(x, y, z)) continue;
        const wx = x + lo[0], wy = y + lo[1], wz = z + lo[2];
        if (grid.addEvidence(wx, wy, wz, index)) filled++;
      }
  return { grid, filled };
}

export interface BoundaryLoss {
  originalCells: number;
  boundaryCells: number;
  /** Cells dropped by keeping the boundary only. */
  droppedByBoundaryOnly: number;
  /** Cells the fill rebuilt. */
  refilled: number;
  /** Occupancy IoU of boundary+fill vs the original. */
  refillIou: number;
  /** Original empty cells (cavities) that the fill wrongly made solid. */
  falseFill: number;
  /** Interior cells whose evidence differs from the one uniform interior pattern a surface store can carry. */
  interiorEvidenceLost: number;
  /** All-cell volumetric storage: lossless by construction (checked). */
  volumetricExact: boolean;
}

function signature(grid: SparseVoxelGrid, code: number): string {
  const c = grid.getByCode(code);
  if (!c) return "";
  const obs = grid.getObservations();
  return `${c.provenance}|` + c.evidence.map((e) => `${obs[e.obs].id}:${e.p}`).join("|");
}

/**
 * Boundary-only storage + one stored interior signature (the most common
 * evidence pattern of the interior) is what a surface representation can
 * carry. Everything else in the interior is lost; this measures it.
 */
export function measureBoundaryLoss(original: SparseVoxelGrid, inference: Observation): BoundaryLoss {
  const surface = surfaceOf(original);
  const { grid: refilled, filled } = fillInterior(surface, inference);
  let inter = 0;
  let falseFill = 0;
  for (const code of refilled.codes()) {
    if (original.getByCode(code)) inter++;
    else falseFill++;
  }
  const counts = new Map<string, number>();
  const interior: number[] = [];
  for (const code of original.codes()) {
    if (surface.getByCode(code)) continue;
    interior.push(code);
    const sig = signature(original, code);
    counts.set(sig, (counts.get(sig) ?? 0) + 1);
  }
  let mode = "";
  let best = -1;
  for (const [sig, n] of counts) if (n > best) [mode, best] = [sig, n];
  let evidenceLost = 0;
  for (const code of interior) if (!refilled.getByCode(code) || signature(original, code) !== mode) evidenceLost++;
  const union = original.size + refilled.size - inter;
  const copy = original.clone();
  let exact = copy.size === original.size;
  for (const code of original.codes()) if (signature(original, code) !== signature(copy, code)) exact = false;
  return {
    originalCells: original.size,
    boundaryCells: surface.size,
    droppedByBoundaryOnly: original.size - surface.size,
    refilled: filled,
    refillIou: union === 0 ? 1 : inter / union,
    falseFill,
    interiorEvidenceLost: evidenceLost,
    volumetricExact: exact,
  };
}

/* ------------------------- signed distance & interpolation ------------------------- */

/** 1D squared-distance transform (Felzenszwalb & Huttenlocher). */
function edt1d(f: Float64Array, n: number, out: Float64Array, v: Int32Array, z: Float64Array): void {
  let k = 0;
  v[0] = 0;
  z[0] = -Infinity;
  z[1] = Infinity;
  const inter = (q: number, p: number) => (f[q] + q * q - (f[p] + p * p)) / (2 * q - 2 * p);
  for (let q = 1; q < n; q++) {
    let s = inter(q, v[k]);
    while (s <= z[k]) {
      k--;
      s = inter(q, v[k]);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    const d = q - v[k];
    out[q] = d * d + f[v[k]];
  }
}

const BIG = 1e20;

/** Exact Euclidean distance (cell units) from every cell of a dense box to the nearest cell where `mask` is set. */
function distanceTo(mask: Uint8Array, dim: Vec3): Float64Array {
  const [nx, ny, nz] = dim;
  const d = new Float64Array(nx * ny * nz);
  for (let i = 0; i < d.length; i++) d[i] = mask[i] ? 0 : BIG;
  const n = Math.max(nx, ny, nz);
  const f = new Float64Array(n), out = new Float64Array(n), z = new Float64Array(n + 1);
  const v = new Int32Array(n);
  const idx = (x: number, y: number, k: number) => (x * ny + y) * nz + k;
  for (let x = 0; x < nx; x++)
    for (let y = 0; y < ny; y++) {
      for (let k = 0; k < nz; k++) f[k] = d[idx(x, y, k)];
      edt1d(f, nz, out, v, z);
      for (let k = 0; k < nz; k++) d[idx(x, y, k)] = out[k];
    }
  for (let x = 0; x < nx; x++)
    for (let k = 0; k < nz; k++) {
      for (let y = 0; y < ny; y++) f[y] = d[idx(x, y, k)];
      edt1d(f, ny, out, v, z);
      for (let y = 0; y < ny; y++) d[idx(x, y, k)] = out[y];
    }
  for (let y = 0; y < ny; y++)
    for (let k = 0; k < nz; k++) {
      for (let x = 0; x < nx; x++) f[x] = d[idx(x, y, k)];
      edt1d(f, nx, out, v, z);
      for (let x = 0; x < nx; x++) d[idx(x, y, k)] = out[x];
    }
  for (let i = 0; i < d.length; i++) d[i] = Math.sqrt(d[i]);
  return d;
}

export interface DenseBox {
  lo: Vec3;
  dim: Vec3;
}

export function unionBox(grids: SparseVoxelGrid[], pad = 2): DenseBox | null {
  let lo: Vec3 | null = null, hi: Vec3 | null = null;
  for (const g of grids) {
    const b = g.cellBounds();
    if (!b) continue;
    lo = lo ? [Math.min(lo[0], b.min[0]), Math.min(lo[1], b.min[1]), Math.min(lo[2], b.min[2])] : [...b.min];
    hi = hi ? [Math.max(hi[0], b.max[0]), Math.max(hi[1], b.max[1]), Math.max(hi[2], b.max[2])] : [...b.max];
  }
  if (!lo || !hi) return null;
  const l: Vec3 = [Math.max(0, lo[0] - pad), Math.max(0, lo[1] - pad), Math.max(0, lo[2] - pad)];
  return { lo: l, dim: [hi[0] + pad - l[0] + 1, hi[1] + pad - l[1] + 1, hi[2] + pad - l[2] + 1] };
}

/** Signed distance in cell units over `box`: negative inside, positive outside (cell-centre convention, ±0.5 at the boundary). */
export function signedDistance(grid: SparseVoxelGrid, box: DenseBox): Float64Array {
  const [nx, ny, nz] = box.dim;
  const inside = new Uint8Array(nx * ny * nz);
  const outside = new Uint8Array(nx * ny * nz);
  for (let x = 0; x < nx; x++)
    for (let y = 0; y < ny; y++)
      for (let z = 0; z < nz; z++) {
        const i = (x * ny + y) * nz + z;
        if (grid.has(x + box.lo[0], y + box.lo[1], z + box.lo[2])) inside[i] = 1;
        else outside[i] = 1;
      }
  const dOut = distanceTo(inside, box.dim);
  const dIn = distanceTo(outside, box.dim);
  const sdf = new Float64Array(nx * ny * nz);
  for (let i = 0; i < sdf.length; i++) sdf[i] = inside[i] ? -(dIn[i] - 0.5) : dOut[i] - 0.5;
  return sdf;
}

export interface InterpolationResult {
  grid: SparseVoxelGrid;
  t: number;
  meanConfidence: number;
  /** Mean of 1 − confidence over interpolated cells. */
  meanUncertainty: number;
}

/**
 * Temporal interpolation between two states by blending signed distance
 * fields: occupied where (1−t)·dA + t·dB ≤ 0. Every produced cell is
 * INTERPOLATED evidence. Its confidence is the time-weighted confidence of
 * the two states at that cell (a state contributes 0 where it is empty),
 * damped by a midpoint penalty 1 − λ·4t(1−t): the further from any real
 * observation in time, the less certain.
 *
 * Plain SDF blending is not motion-aware: two copies of a moving ball blend
 * into a smaller lens (measured: 2,176 → 1,008 cells at t = 0.5). So the
 * rigid translation between the states is estimated first (compareGrids)
 * and both states are moved to the time-t position before blending; the
 * blend then only carries the non-rigid part of the change.
 */
export function interpolate(
  a0: SparseVoxelGrid,
  b0: SparseVoxelGrid,
  t: number,
  meta: { id: string; capturedAt: number; lambda?: number; motionCompensate?: boolean },
): InterpolationResult & { motion: Vec3 } {
  if (t < 0 || t > 1) throw new RangeError("t must be within [0, 1]");
  let motion: Vec3 = [0, 0, 0];
  if (meta.motionCompensate !== false && a0.size && b0.size) {
    const cmp = compareGrids(a0, b0, { searchRadius: 2 });
    if (cmp.bestTranslation.iou > cmp.iou) motion = cmp.bestTranslation.delta;
  }
  const shiftA = motion.map((d) => Math.round(t * d)) as Vec3;
  const shiftB = [shiftA[0] - motion[0], shiftA[1] - motion[1], shiftA[2] - motion[2]] as Vec3;
  const a = shiftGrid(a0, shiftA);
  const b = shiftGrid(b0, shiftB);
  const grid = new SparseVoxelGrid(a.spec);
  const box = unionBox([a, b]);
  const lambda = meta.lambda ?? 0.5;
  const damp = 1 - lambda * 4 * t * (1 - t);
  const obsTemplate: Observation = {
    id: meta.id,
    capturedAt: meta.capturedAt,
    source: "asre.interpolate:sdf-blend",
    modality: "interpolation",
    provenance: "INTERPOLATED",
    confidence: damp,
    parameters: { t, lambda, motionX: motion[0], motionY: motion[1], motionZ: motion[2] },
    fingerprint: `interp:${meta.id}:${t}`,
    lineage: [],
  };
  const { index } = grid.addObservation(obsTemplate);
  if (!box) return { grid, t, meanConfidence: 0, meanUncertainty: 1, motion };
  const sa = signedDistance(a, box);
  const sb = signedDistance(b, box);
  const [nx, ny, nz] = box.dim;
  let sumC = 0;
  for (let x = 0; x < nx; x++)
    for (let y = 0; y < ny; y++)
      for (let z = 0; z < nz; z++) {
        const i = (x * ny + y) * nz + z;
        if ((1 - t) * sa[i] + t * sb[i] > 0) continue;
        const wx = x + box.lo[0], wy = y + box.lo[1], wz = z + box.lo[2];
        const ca = a.get(wx, wy, wz)?.confidence ?? 0;
        const cb = b.get(wx, wy, wz)?.confidence ?? 0;
        // A cell that neither state occupied still lies inside the blended shape:
        // fall back to the weaker of the two states' mean confidence.
        const base = ca || cb ? (1 - t) * ca + t * cb : Math.min(meanConfidence(a), meanConfidence(b));
        const c = Math.max(1e-6, base * damp);
        grid.addEvidence(wx, wy, wz, index, c);
        sumC += c;
      }
  const mean = grid.size ? sumC / grid.size : 0;
  return { grid, t, meanConfidence: mean, meanUncertainty: 1 - mean, motion };
}

/** Copy of a grid moved by an integer cell offset (cells leaving the lattice are dropped). */
export function shiftGrid(grid: SparseVoxelGrid, d: Vec3): SparseVoxelGrid {
  if (!d[0] && !d[1] && !d[2]) return grid;
  const out = new SparseVoxelGrid(grid.spec);
  for (const o of grid.getObservations()) out.addObservation(o);
  for (const [code, cell] of grid.entries()) {
    const [x, y, z] = mortonDecode(code);
    const nx = x + d[0], ny = y + d[1], nz = z + d[2];
    if (out.inBounds(nx, ny, nz)) out.setCellByCode(mortonEncode(nx, ny, nz), cell);
  }
  return out;
}

const meanCache = new WeakMap<SparseVoxelGrid, number>();
export function meanConfidence(g: SparseVoxelGrid): number {
  const hit = meanCache.get(g);
  if (hit !== undefined) return hit;
  let s = 0;
  for (const [, c] of g.entries()) s += c.confidence;
  const v = g.size ? s / g.size : 0;
  meanCache.set(g, v);
  return v;
}

/** Summary of uncertainty (1 − confidence) per provenance class. */
export function uncertaintyReport(grid: SparseVoxelGrid): Record<string, { cells: number; meanUncertainty: number }> {
  const acc: Record<string, { cells: number; sum: number }> = {};
  for (const [, cell] of grid.entries()) {
    for (const [name, flag] of [["OBSERVED", 1], ["INFERRED", 2], ["SYNTHESIZED", 4], ["INTERPOLATED", 8]] as const) {
      if (!(cell.provenance & flag)) continue;
      acc[name] ??= { cells: 0, sum: 0 };
      acc[name].cells++;
      acc[name].sum += 1 - cell.confidence;
    }
  }
  const out: Record<string, { cells: number; meanUncertainty: number }> = {};
  for (const [k, v] of Object.entries(acc)) out[k] = { cells: v.cells, meanUncertainty: v.sum / v.cells };
  return out;
}

/* ----------------------------- representation choice ----------------------------- */

export type Representation = "surface-mesh" | "boundary-voxels" | "volumetric-voxels";
export type IntendedUse = "render" | "store" | "simulate" | "measure-volume" | "section-cut" | "edit-interior";

export interface RepresentationDecision {
  choice: Representation;
  reasons: string[];
  measurements: {
    cells: number;
    boundary: number;
    interiorFraction: number;
    boundaryLossless: boolean;
    falseFill: number;
    interiorEvidenceLost: number;
    estimatedBytes: Record<Representation, number>;
  };
}

/**
 * Pick the cheapest representation that does not lose what the use needs.
 * Costs are estimates per stored element (documented constants), the loss
 * figures are measured on the actual grid.
 */
export function selectRepresentation(grid: SparseVoxelGrid, use: IntendedUse): RepresentationDecision {
  const stats = volumeStats(grid);
  const loss = measureBoundaryLoss(grid, {
    id: "selector-probe",
    capturedAt: 0,
    source: "asre.selector",
    modality: "voxel-grid",
    provenance: "INFERRED",
    confidence: 1,
    parameters: {},
    fingerprint: "selector-probe",
    lineage: [],
  });
  const boundaryLossless = loss.falseFill === 0 && loss.refillIou === 1 && loss.interiorEvidenceLost === 0;
  // ~2 exposed faces per boundary cell → 2 quads = 4 tris; 12 B/vertex + 12 B/tri, shared vertices ≈ 1/face.
  const estimatedBytes: Record<Representation, number> = {
    "surface-mesh": stats.boundary * 2 * (12 + 2 * 12),
    "boundary-voxels": stats.boundary * 6,
    "volumetric-voxels": stats.total * 6,
  };
  const reasons: string[] = [];
  let choice: Representation;
  const needsInterior = use === "simulate" || use === "measure-volume" || use === "section-cut" || use === "edit-interior";
  if (needsInterior && !boundaryLossless) {
    choice = "volumetric-voxels";
    reasons.push(`use "${use}" needs the interior, and boundary-only storage would lose it (${loss.falseFill} false-fill cells, ${loss.interiorEvidenceLost} interior cells' evidence)`);
  } else if (needsInterior) {
    choice = "boundary-voxels";
    reasons.push(`use "${use}" needs the interior, but this shape is solid and attribute-uniform: boundary + fill rebuilds it exactly, at ${(stats.boundary / Math.max(1, stats.total) * 100).toFixed(1)}% of the cells`);
  } else if (use === "render") {
    choice = "surface-mesh";
    reasons.push("rendering only sees the surface; the interior is never shaded");
  } else {
    choice = boundaryLossless ? "boundary-voxels" : "volumetric-voxels";
    reasons.push(boundaryLossless ? "storage: boundary + fill is lossless here and smaller" : "storage: boundary-only would lose interior information, keep all cells");
  }
  return {
    choice,
    reasons,
    measurements: {
      cells: stats.total,
      boundary: stats.boundary,
      interiorFraction: stats.interiorFraction,
      boundaryLossless,
      falseFill: loss.falseFill,
      interiorEvidenceLost: loss.interiorEvidenceLost,
      estimatedBytes,
    },
  };
}

