/**
 * ==========================================================
 * TEMPORAL STUDIO — NRE — SPARSE VOXEL ALGEBRA
 *
 * The operations every other NRE module is built from: make a lattice,
 * put cells into it, read them back, and convert between cell indices
 * and world space. No meshes, no files, no I/O — those live in
 * geometry.ts and vxz.ts.
 *
 * The set is kept in Morton order at all times. Ingestion sorts once;
 * every later reader can therefore trust locality instead of rebuilding
 * it, and `validateVoxels` re-derives the order to prove it.
 * ==========================================================
 */

import { sortByMorton } from "./morton.ts";
import type {
  AttributeChannel,
  BoundingVolume,
  CoordinateSystem,
  SpatialGrid,
  SparseVoxels,
  Vec3,
} from "./types.ts";

/** Right-handed, Y-up, metres: the frame LÉLU's 3D pipeline already uses. */
export const DEFAULT_COORDINATE_SYSTEM: CoordinateSystem = {
  id: "lelu-world-y-up",
  up: "y",
  forward: "z",
  hand: "right",
  units: "metre",
};

export const DEFAULT_CONFIDENCE_CHANNEL: AttributeChannel = {
  name: "confidence",
  kind: "f32",
  components: 1,
  quantisation: null,
  componentsMeaning: ["confidence"],
};

export interface GridInput {
  origin?: Vec3;
  cellSize: number;
  /** Cells per axis. Integers ≥ 1. */
  resolution: Vec3;
  coordinateSystem?: CoordinateSystem;
}

export function createGrid(input: GridInput): SpatialGrid {
  const { cellSize, resolution } = input;
  if (!Number.isFinite(cellSize) || cellSize <= 0) {
    throw new Error(`cellSize must be a finite positive number of world units per cell (got ${cellSize}).`);
  }
  if (resolution.some((r) => !Number.isInteger(r) || r < 1)) {
    throw new Error(`resolution must be integer cells per axis ≥ 1 (got ${resolution.join("×")}).`);
  }
  return {
    origin: input.origin ? ([...input.origin] as Vec3) : [0, 0, 0],
    cellSize,
    resolution: [...resolution] as Vec3,
    coordinateSystem: input.coordinateSystem ?? DEFAULT_COORDINATE_SYSTEM,
  };
}

/** Number of addressable cells. */
export function cellCount(grid: SpatialGrid): number {
  return grid.resolution[0] * grid.resolution[1] * grid.resolution[2];
}

/** World-space position of a cell's centre. */
export function cellCenter(grid: SpatialGrid, i: number, j: number, k: number): Vec3 {
  const [ox, oy, oz] = grid.origin;
  const c = grid.cellSize;
  return [ox + (i + 0.5) * c, oy + (j + 0.5) * c, oz + (k + 0.5) * c];
}

/** World-space box a cell occupies. */
export function cellBounds(grid: SpatialGrid, i: number, j: number, k: number): BoundingVolume {
  const [ox, oy, oz] = grid.origin;
  const c = grid.cellSize;
  return { min: [ox + i * c, oy + j * c, oz + k * c], max: [ox + (i + 1) * c, oy + (j + 1) * c, oz + (k + 1) * c] };
}

/** Dense index of a cell, or -1 when it lies outside the lattice. */
export function denseIndexOf(grid: SpatialGrid, i: number, j: number, k: number): number {
  const [nx, ny, nz] = grid.resolution;
  if (i < 0 || j < 0 || k < 0 || i >= nx || j >= ny || k >= nz) return -1;
  return (i * ny + j) * nz + k;
}

export function isInside(grid: SpatialGrid, i: number, j: number, k: number): boolean {
  return denseIndexOf(grid, i, j, k) >= 0;
}

function boundsOfCoords(grid: SpatialGrid, coords: Int32Array): BoundingVolume {
  if (coords.length === 0) {
    // An empty set has an empty extent at the grid origin, not a pretend box.
    return { min: [...grid.origin] as Vec3, max: [...grid.origin] as Vec3 };
  }
  let minI = Infinity, minJ = Infinity, minK = Infinity;
  let maxI = -Infinity, maxJ = -Infinity, maxK = -Infinity;
  for (let v = 0; v < coords.length; v += 3) {
    const i = coords[v], j = coords[v + 1], k = coords[v + 2];
    if (i < minI) minI = i;
    if (j < minJ) minJ = j;
    if (k < minK) minK = k;
    if (i > maxI) maxI = i;
    if (j > maxJ) maxJ = j;
    if (k > maxK) maxK = k;
  }
  const lo = cellBounds(grid, minI, minJ, minK).min;
  const hi = cellBounds(grid, maxI, maxJ, maxK).max;
  return { min: lo, max: hi };
}

export interface BuildOptions {
  occupancy?: "sparse-surface" | "sparse-volume";
  channels?: AttributeChannel[];
  /** Attributes to carry; keys must match `channels`. Values are per voxel, length = components. */
  attributes?: Record<string, ArrayLike<number>>;
}

/**
 * Build a sparse voxel set from cell indices plus optional per-voxel
 * attributes. Cells outside the lattice are an error: silently clipping
 * them would produce a file that claims to be the whole observation.
 */
export function buildSparseVoxels(
  grid: SpatialGrid,
  cells: ReadonlyArray<readonly [number, number, number]>,
  options: BuildOptions = {},
): SparseVoxels {
  const flat = new Int32Array(cells.length * 3);
  for (let v = 0; v < cells.length; v++) {
    const [i, j, k] = cells[v];
    if (!isInside(grid, i, j, k)) {
      throw new Error(
        `Cell (${i},${j},${k}) is outside the ${grid.resolution.join("×")} lattice; enlarge the grid or clip deliberately before ingestion.`,
      );
    }
    flat[v * 3] = i;
    flat[v * 3 + 1] = j;
    flat[v * 3 + 2] = k;
  }
  return finalizeVoxels(grid, flat, options);
}

/** Build from a flat [x,y,z,…] list (e.g. straight out of a decoder). */
export function voxelsFromCoords(grid: SpatialGrid, coords: Int32Array, options: BuildOptions = {}): SparseVoxels {
  for (let v = 0; v < coords.length; v += 3) {
    if (!isInside(grid, coords[v], coords[v + 1], coords[v + 2])) {
      throw new Error(
        `Cell (${coords[v]},${coords[v + 1]},${coords[v + 2]}) is outside the ${grid.resolution.join("×")} lattice.`,
      );
    }
  }
  return finalizeVoxels(grid, Int32Array.from(coords), options);
}

function finalizeVoxels(grid: SpatialGrid, coords: Int32Array, options: BuildOptions): SparseVoxels {
  const sorted = sortByMorton(coords);
  const channels = options.channels ? [...options.channels] : [];
  const attributes: Record<string, Float64Array> = {};

  for (const channel of channels) {
    const source = options.attributes?.[channel.name];
    if (!source) {
      throw new Error(
        `Channel "${channel.name}" is declared but no values were supplied; an absent channel must not be stored as zeros.`,
      );
    }
    const components = channel.components;
    if (source.length !== sorted.order.length * components) {
      throw new Error(
        `Channel "${channel.name}" needs ${sorted.order.length * components} values (${sorted.order.length} voxels × ${components}) but got ${source.length}.`,
      );
    }
    const flat = new Float64Array(sorted.order.length * components);
    for (let v = 0; v < sorted.order.length; v++) {
      for (let c = 0; c < components; c++) {
        flat[v * components + c] = source[sorted.order[v] * components + c];
      }
    }
    attributes[channel.name] = flat;
  }

  return {
    grid,
    coords: sorted.coords,
    morton: sorted.morton,
    attributes,
    channels,
    bbox: boundsOfCoords(grid, sorted.coords),
    occupancy: options.occupancy ?? "sparse-surface",
  };
}

export function voxelCount(voxels: SparseVoxels): number {
  return voxels.coords.length / 3;
}

/** Read the attribute vector of voxel `index` (0 when the channel is absent). */
export function attributeAt(voxels: SparseVoxels, channel: string, index: number): number[] {
  const values = voxels.attributes[channel];
  const descriptor = voxels.channels.find((c) => c.name === channel);
  if (!values || !descriptor) return [];
  const width = descriptor.components;
  return Array.from(values.subarray(index * width, index * width + width));
}

/** A dense membership mask over the lattice, for neighbour queries. */
export function occupancyMask(voxels: SparseVoxels): Uint8Array {
  const mask = new Uint8Array(cellCount(voxels.grid));
  for (let v = 0; v < voxelCount(voxels); v++) {
    const i = voxels.coords[v * 3], j = voxels.coords[v * 3 + 1], k = voxels.coords[v * 3 + 2];
    mask[denseIndexOf(voxels.grid, i, j, k)] = 1;
  }
  return mask;
}

/** Set of occupied dense indices — the identity used by every comparison. */
export function occupancyKeySet(voxels: SparseVoxels): Set<number> {
  const grid = voxels.grid;
  const set = new Set<number>();
  for (let v = 0; v < voxelCount(voxels); v++) {
    set.add(denseIndexOf(grid, voxels.coords[v * 3], voxels.coords[v * 3 + 1], voxels.coords[v * 3 + 2]));
  }
  return set;
}

export interface VoxelValidation {
  ok: boolean;
  problems: string[];
  warnings: string[];
}

/**
 * Structural self-check. Everything here is a fact the file could be
 * lying about: counts, ordering, ranges, attribute alignment, grid shape.
 */
export function validateVoxels(voxels: SparseVoxels): VoxelValidation {
  const problems: string[] = [];
  const warnings: string[] = [];
  const n = voxelCount(voxels);
  const [nx, ny, nz] = voxels.grid.resolution;

  if (voxels.coords.length % 3 !== 0) problems.push(`coords length ${voxels.coords.length} is not a multiple of 3.`);
  if (voxels.morton.length !== n) problems.push(`morton length ${voxels.morton.length} ≠ voxel count ${n}.`);
  if (!(voxels.grid.cellSize > 0)) problems.push(`cellSize ${voxels.grid.cellSize} is not positive.`);

  for (let v = 0; v < n; v++) {
    const i = voxels.coords[v * 3], j = voxels.coords[v * 3 + 1], k = voxels.coords[v * 3 + 2];
    if (i < 0 || j < 0 || k < 0 || i >= nx || j >= ny || k >= nz) {
      problems.push(`Voxel ${v} at (${i},${j},${k}) is outside the ${nx}×${ny}×${nz} lattice.`);
      break;
    }
  }

  for (let v = 1; v < n; v++) {
    if (voxels.morton[v] <= voxels.morton[v - 1]) {
      problems.push(`Morton order is violated at voxel ${v}; the payload is not spatially sorted.`);
      break;
    }
  }

  for (const channel of voxels.channels) {
    const values = voxels.attributes[channel.name];
    if (!values) {
      problems.push(`Channel "${channel.name}" is declared but absent from the voxel set.`);
      continue;
    }
    const expected = n * channel.components;
    if (values.length !== expected) {
      problems.push(`Channel "${channel.name}" holds ${values.length} values, expected ${expected}.`);
    }
    if (channel.components < 1 || channel.components > 4) {
      problems.push(`Channel "${channel.name}" declares ${channel.components} components (allowed 1..4).`);
    }
    for (let index = 0; index < values.length; index++) {
      if (!Number.isFinite(values[index])) {
        problems.push(`Channel "${channel.name}" value ${index} is ${values[index]} (non-finite).`);
        break;
      }
    }
    if (channel.name === "confidence") {
      for (let index = 0; index < values.length; index++) {
        if (values[index] < 0 || values[index] > 1) {
          problems.push(`Confidence value ${values[index]} at index ${index} is outside [0,1].`);
          break;
        }
      }
    }
  }

  for (const name of Object.keys(voxels.attributes)) {
    if (!voxels.channels.some((c) => c.name === name)) warnings.push(`Attribute "${name}" has no channel descriptor and will not be serialised.`);
  }
  if (n === 0) warnings.push("The voxel set is empty; it describes an absence of observed geometry.");

  return { ok: problems.length === 0, problems, warnings };
}

/** Apply a column-major 4×4 matrix to a point. */
export function transformPoint(m: ReadonlyArray<number>, point: Vec3): Vec3 {
  const [x, y, z] = point;
  return [
    m[0] * x + m[4] * y + m[8] * z + m[12],
    m[1] * x + m[5] * y + m[9] * z + m[13],
    m[2] * x + m[6] * y + m[10] * z + m[14],
  ];
}

export const IDENTITY_MATRIX: number[] = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

/**
 * Move a voxel set through a matrix by resampling cell centres.
 *
 * This is a RESAMPLING, not a rotation of the lattice: a voxel set is
 * axis-aligned, so any rotation that is not a multiple of 90° lands
 * centres between cells and the nearest cell wins. Two things follow:
 * the result is approximate (and reported as such), and confidence is
 * carried by nearest cell, never averaged into neighbouring cells,
 * because averaging would invent evidence.
 */
export function transformVoxels(
  voxels: SparseVoxels,
  matrix: ReadonlyArray<number>,
  options: { keepUnmapped?: boolean } = {},
): { voxels: SparseVoxels; unmapped: number } {
  if (matrix.length !== 16) throw new Error(`A transform needs 16 column-major values, got ${matrix.length}.`);
  const grid = voxels.grid;
  const n = voxelCount(voxels);
  const cells: Array<[number, number, number]> = [];
  const confidence = voxels.attributes.confidence ? new Float64Array(n) : null;
  let unmapped = 0;
  const keep: number[] = [];

  for (let v = 0; v < n; v++) {
    const center = cellCenter(grid, voxels.coords[v * 3], voxels.coords[v * 3 + 1], voxels.coords[v * 3 + 2]);
    const moved = transformPoint(matrix, center);
    const i = Math.floor((moved[0] - grid.origin[0]) / grid.cellSize);
    const j = Math.floor((moved[1] - grid.origin[1]) / grid.cellSize);
    const k = Math.floor((moved[2] - grid.origin[2]) / grid.cellSize);
    if (!isInside(grid, i, j, k)) {
      unmapped++;
      if (options.keepUnmapped === true) keep.push(v);
      continue;
    }
    cells.push([i, j, k]);
    if (confidence) keep.push(v);
  }

  const built = buildSparseVoxels(grid, cells, {
    occupancy: voxels.occupancy,
    channels: voxels.channels.filter((c) => c.name === "confidence"),
    attributes: confidence && voxels.attributes.confidence
      ? { confidence: pickValues(voxels.attributes.confidence, keep) }
      : {},
  });
  return { voxels: built, unmapped };
}

/** Gather a 1-component channel for the given voxel indices. */
function pickValues(values: Float64Array, indices: ReadonlyArray<number>): Float64Array {
  const out = new Float64Array(indices.length);
  for (let v = 0; v < indices.length; v++) out[v] = values[indices[v]];
  return out;
}

/** Convenience: attach a constant or computed confidence channel. */
export function withConfidence(voxels: SparseVoxels, value: number | ((i: number, j: number, k: number) => number)): SparseVoxels {
  const n = voxelCount(voxels);
  const values = new Float64Array(n);
  for (let v = 0; v < n; v++) {
    const i = voxels.coords[v * 3], j = voxels.coords[v * 3 + 1], k = voxels.coords[v * 3 + 2];
    const c = typeof value === "function" ? value(i, j, k) : value;
    if (!(c >= 0 && c <= 1)) throw new Error(`Confidence ${c} at (${i},${j},${k}) is outside [0,1].`);
    values[v] = c;
  }
  const channels = voxels.channels.some((c) => c.name === "confidence")
    ? voxels.channels
    : [...voxels.channels, DEFAULT_CONFIDENCE_CHANNEL];
  return { ...voxels, attributes: { ...voxels.attributes, confidence: values }, channels };
}

/**
 * Noisy-OR evidence fusion: c = 1 − Π(1 − cᵢ).
 *
 * Chosen over an average because repeated independent looks at a cell
 * should increase certainty, and over a sum because it stays in [0,1]
 * without a post-hoc clamp that would hide how much evidence arrived.
 */
export function fuseConfidence(values: ReadonlyArray<number>): number {
  let miss = 1;
  for (const c of values) miss *= 1 - Math.min(1, Math.max(0, c));
  return 1 - miss;
}

/** Union of several voxel sets on one grid, fusing confidence per cell. */
export function unionVoxels(sets: ReadonlyArray<SparseVoxels>, grid: SpatialGrid): SparseVoxels {
  const cells = new Map<number, { i: number; j: number; k: number; evidence: number[] }>();
  for (const set of sets) {
    for (let v = 0; v < voxelCount(set); v++) {
      const i = set.coords[v * 3], j = set.coords[v * 3 + 1], k = set.coords[v * 3 + 2];
      const key = denseIndexOf(grid, i, j, k);
      const entry = cells.get(key);
      const confidence = set.attributes.confidence?.[v];
      if (entry) {
        if (confidence !== undefined) entry.evidence.push(confidence);
      } else {
        cells.set(key, { i, j, k, evidence: confidence === undefined ? [] : [confidence] });
      }
    }
  }
  const ordered = [...cells.values()];
  const fused = new Float64Array(ordered.length);
  let any = false;
  ordered.forEach((entry, index) => {
    if (entry.evidence.length > 0) {
      any = true;
      fused[index] = fuseConfidence(entry.evidence);
    }
  });
  return buildSparseVoxels(grid, ordered.map((e) => [e.i, e.j, e.k] as [number, number, number]), {
    occupancy: sets.some((s) => s.occupancy === "sparse-volume") ? "sparse-volume" : "sparse-surface",
    channels: any ? [DEFAULT_CONFIDENCE_CHANNEL] : [],
    attributes: any ? { confidence: fused } : {},
  });
}
