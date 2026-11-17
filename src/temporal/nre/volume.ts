/**
 * ==========================================================
 * TEMPORAL STUDIO — NRE — VOLUMETRIC PRESERVATION
 *
 * Mission 3 proved the container preserves whatever cells it is given
 * (a 1728-cell solid stored and restored exactly). What failed was the
 * EXPORT: a boundary mesh has no place to put interior cells, so a solid
 * came back as its 728-cell shell.
 *
 * This module makes the distinction explicit and gives the engine both
 * directions:
 *
 *   surface → volume   solidify a closed shell by flooding the outside
 *                      of the lattice and inverting: every empty cell the
 *                      flood could not reach is interior
 *   volume → surface   the boundary subset (a lossy projection, measured)
 *
 * Inferred interior cells are marked, not dressed up: they are given
 * confidence 0 and an `inferred` flag, because closure is reasoning about
 * geometry, not an observation.
 * ==========================================================
 */

import type { AttributeChannel, SparseVoxels } from "./types.ts";
import { buildSparseVoxels, cellCount, denseIndexOf, occupancyMask, voxelCount, withConfidence } from "./voxels.ts";
import { boundaryOf } from "./geometry.ts";
import { compareVoxelSets } from "./compare.ts";

export interface VolumeMetrics {
  cells: number;
  /** Cells in the bounding box at this resolution. */
  bboxCells: number;
  /** cells / bboxCells — how much of the box the shape occupies. */
  fillRatio: number;
  boundaryCells: number;
  interiorCells: number;
  /** interiorCells / cells — the share a boundary mesh cannot hold. */
  interiorFraction: number;
  /** 6-connected components. */
  components: number;
  /** Cells with no occupied face neighbour at all. */
  isolatedCells: number;
  isolatedFraction: number;
  /** Surface area in cells (exposed faces / 6). */
  surfaceAreaCells: number;
  /** surfaceArea / cells — high means thin shell, low means solid. */
  surfaceToVolumeRatio: number;
}

export function measureVolume(voxels: SparseVoxels): VolumeMetrics {
  const cells = voxelCount(voxels);
  const grid = voxels.grid;
  const [nx, ny, nz] = grid.resolution;
  const sizeI = Math.max(1, Math.round((voxels.bbox.max[0] - voxels.bbox.min[0]) / grid.cellSize));
  const sizeJ = Math.max(1, Math.round((voxels.bbox.max[1] - voxels.bbox.min[1]) / grid.cellSize));
  const sizeK = Math.max(1, Math.round((voxels.bbox.max[2] - voxels.bbox.min[2]) / grid.cellSize));
  const bboxCells = sizeI * sizeJ * sizeK;

  const mask = occupancyMask(voxels);
  let boundaryCells = 0;
  let exposedFaces = 0;
  let isolated = 0;
  const neighbours: Array<[number, number, number]> = [
    [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
  ];
  for (let v = 0; v < cells; v++) {
    const i = voxels.coords[v * 3], j = voxels.coords[v * 3 + 1], k = voxels.coords[v * 3 + 2];
    let exposed = 0;
    for (const [di, dj, dk] of neighbours) {
      const ni = i + di, nj = j + dj, nk = k + dk;
      const key = ni < 0 || nj < 0 || nk < 0 || ni >= nx || nj >= ny || nk >= nz ? -1 : denseIndexOf(grid, ni, nj, nk);
      if (key === -1 || mask[key] === 0) exposed++;
    }
    if (exposed > 0) boundaryCells++;
    if (exposed === 6) isolated++;
    exposedFaces += exposed;
  }

  const components = countComponents(voxels, mask);

  return {
    cells,
    bboxCells,
    fillRatio: bboxCells === 0 ? 0 : cells / bboxCells,
    boundaryCells,
    interiorCells: cells - boundaryCells,
    interiorFraction: cells === 0 ? 0 : (cells - boundaryCells) / cells,
    components,
    isolatedCells: isolated,
    isolatedFraction: cells === 0 ? 0 : isolated / cells,
    surfaceAreaCells: exposedFaces / 6,
    surfaceToVolumeRatio: cells === 0 ? 0 : exposedFaces / 6 / cells,
  };
}

/**
 * 6-connected components, as cell lists. Used by the representation
 * selector to ask whether separate parts move separately.
 */
export function connectedComponents(voxels: SparseVoxels): Array<Array<[number, number, number]>> {
  const grid = voxels.grid;
  const [nx, ny, nz] = grid.resolution;
  const mask = occupancyMask(voxels);
  const seen = new Uint8Array(cellCount(grid));
  const out: Array<Array<[number, number, number]>> = [];
  const stack: number[] = [];

  for (let v = 0; v < voxelCount(voxels); v++) {
    const start = denseIndexOf(grid, voxels.coords[v * 3], voxels.coords[v * 3 + 1], voxels.coords[v * 3 + 2]);
    if (seen[start]) continue;
    const component: Array<[number, number, number]> = [];
    seen[start] = 1;
    stack.push(start);
    while (stack.length > 0) {
      const key = stack.pop() as number;
      const i = Math.floor(key / (ny * nz));
      const j = Math.floor((key % (ny * nz)) / nz);
      const k = key % nz;
      component.push([i, j, k]);
      const candidates: Array<[number, number, number]> = [
        [i + 1, j, k], [i - 1, j, k], [i, j + 1, k], [i, j - 1, k], [i, j, k + 1], [i, j, k - 1],
      ];
      for (const [ni, nj, nk] of candidates) {
        if (ni < 0 || nj < 0 || nk < 0 || ni >= nx || nj >= ny || nk >= nz) continue;
        const nkey = denseIndexOf(grid, ni, nj, nk);
        if (seen[nkey] || mask[nkey] === 0) continue;
        seen[nkey] = 1;
        stack.push(nkey);
      }
    }
    out.push(component);
  }
  return out;
}

function countComponents(voxels: SparseVoxels, mask: Uint8Array): number {
  const grid = voxels.grid;
  const [nx, ny, nz] = grid.resolution;
  const seen = new Uint8Array(cellCount(grid));
  let components = 0;
  const stack: number[] = [];
  for (let v = 0; v < voxelCount(voxels); v++) {
    const start = denseIndexOf(grid, voxels.coords[v * 3], voxels.coords[v * 3 + 1], voxels.coords[v * 3 + 2]);
    if (seen[start]) continue;
    components++;
    stack.push(start);
    seen[start] = 1;
    while (stack.length > 0) {
      const key = stack.pop() as number;
      const i = Math.floor(key / (ny * nz));
      const j = Math.floor((key % (ny * nz)) / nz);
      const k = key % nz;
      const candidates: Array<[number, number, number]> = [
        [i + 1, j, k], [i - 1, j, k], [i, j + 1, k], [i, j - 1, k], [i, j, k + 1], [i, j, k - 1],
      ];
      for (const [ni, nj, nk] of candidates) {
        if (ni < 0 || nj < 0 || nk < 0 || ni >= nx || nj >= ny || nk >= nz) continue;
        const nkey = denseIndexOf(grid, ni, nj, nk);
        if (seen[nkey] || mask[nkey] === 0) continue;
        seen[nkey] = 1;
        stack.push(nkey);
      }
    }
  }
  return components;
}

export interface SolidificationResult {
  volume: SparseVoxels;
  /** Empty cells the outside flood could not reach: the enclosed interior. */
  enclosedCells: number;
  /** True when a cavity was found (or the input was already solid). */
  closed: boolean;
  /** True when occupied cells sit on the lattice boundary, which can fake closure. */
  touchesLatticeBoundary: boolean;
  notes: string[];
}

/**
 * Solidify a closed shell.
 *
 * Flood from every empty boundary cell through empty cells; whatever the
 * flood cannot reach is enclosed. A shell with a hole leaks, the flood
 * gets in, and `closed` is false — the engine then returns the input
 * unchanged rather than inventing a filled body around an open surface.
 */
export function solidFromSurface(surface: SparseVoxels): SolidificationResult {
  const grid = surface.grid;
  const [nx, ny, nz] = grid.resolution;
  const mask = occupancyMask(surface);
  const total = cellCount(grid);
  const outside = new Uint8Array(total);
  const queue: number[] = [];

  const push = (i: number, j: number, k: number) => {
    if (i < 0 || j < 0 || k < 0 || i >= nx || j >= ny || k >= nz) return;
    const key = denseIndexOf(grid, i, j, k);
    if (outside[key] || mask[key] === 1) return;
    outside[key] = 1;
    queue.push(key);
  };

  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < ny; j++) {
      for (let k = 0; k < nz; k++) {
        const onEdge = i === 0 || j === 0 || k === 0 || i === nx - 1 || j === ny - 1 || k === nz - 1;
        if (onEdge) push(i, j, k);
      }
    }
  }

  while (queue.length > 0) {
    const key = queue.pop() as number;
    const i = Math.floor(key / (ny * nz));
    const j = Math.floor((key % (ny * nz)) / nz);
    const k = key % nz;
    push(i + 1, j, k);
    push(i - 1, j, k);
    push(i, j + 1, k);
    push(i, j - 1, k);
    push(i, j, k + 1);
    push(i, j, k - 1);
  }

  const enclosed: Array<[number, number, number]> = [];
  for (let key = 0; key < total; key++) {
    if (mask[key] === 1 || outside[key] === 1) continue;
    const i = Math.floor(key / (ny * nz));
    const j = Math.floor((key % (ny * nz)) / nz);
    const k = key % nz;
    enclosed.push([i, j, k]);
  }

  const observed: Array<[number, number, number]> = [];
  const observedConfidence: number[] = [];
  for (let v = 0; v < voxelCount(surface); v++) {
    observed.push([surface.coords[v * 3], surface.coords[v * 3 + 1], surface.coords[v * 3 + 2]]);
    observedConfidence.push(surface.attributes.confidence?.[v] ?? 0);
  }

  const cells = [...observed, ...enclosed];
  const confidence = [...observedConfidence, ...new Array<number>(enclosed.length).fill(0)];
  const inferred = [...new Array<number>(observed.length).fill(0), ...new Array<number>(enclosed.length).fill(1)];

  const channels: AttributeChannel[] = [
    ...(surface.channels.some((c) => c.name === "confidence")
      ? surface.channels
      : [{ name: "confidence", kind: "f32" as const, components: 1, quantisation: null, componentsMeaning: ["confidence"] }]),
    { name: "inferred", kind: "f32", components: 1, quantisation: null, componentsMeaning: ["inferred-by-closure"] },
  ];

  const volume = buildSparseVoxels(grid, cells, {
    occupancy: "sparse-volume",
    channels,
    attributes: { confidence, inferred },
  });

  const touchesLatticeBoundary = observed.some(([i, j, k]) => i === 0 || j === 0 || k === 0 || i === nx - 1 || j === ny - 1 || k === nz - 1);
  const notes: string[] = [];
  if (enclosed.length > 0) {
    notes.push(`${enclosed.length} interior cells were inferred by closure; they carry confidence 0 and inferred=1 because nothing observed them.`);
  } else {
    notes.push("No enclosed interior was found: the surface is open (or the input was already solid), so nothing was filled.");
  }
  if (touchesLatticeBoundary) {
    notes.push("Occupied cells touch the lattice boundary, so closure cannot be guaranteed from this grid alone.");
  }

  return {
    volume,
    enclosedCells: enclosed.length,
    closed: enclosed.length > 0,
    touchesLatticeBoundary,
    notes,
  };
}

/** The boundary subset of a volume: what a surface mesh can actually carry. */
export function surfaceFromSolid(volume: SparseVoxels): SparseVoxels {
  return boundaryOf(volume);
}

export interface ConversionReport {
  direction: "surface→volume→surface" | "volume→surface→volume";
  inputCells: number;
  outputCells: number;
  shared: number;
  lost: number;
  gained: number;
  iou: number;
  containment: number;
  /** Share of the input that did not survive, the headline loss figure. */
  lossFraction: number;
  closed: boolean;
  enclosedCells: number;
  wallClockMs: number;
  notes: string[];
}

/** interface→solid→interface, measured against the original. */
export function measureSurfaceRoundTrip(surface: SparseVoxels): ConversionReport {
  const started = performance.now();
  const solid = solidFromSurface(surface);
  const back = surfaceFromSolid(solid.volume);
  const metrics = compareVoxelSets(surface, back);
  const inputCells = voxelCount(surface);
  return {
    direction: "surface→volume→surface",
    inputCells,
    outputCells: voxelCount(back),
    shared: metrics.shared,
    lost: metrics.onlyA,
    gained: metrics.onlyB,
    iou: metrics.iou,
    containment: metrics.containment,
    lossFraction: inputCells === 0 ? 0 : metrics.onlyA / inputCells,
    closed: solid.closed,
    enclosedCells: solid.enclosedCells,
    wallClockMs: performance.now() - started,
    notes: [
      ...solid.notes,
      metrics.onlyB > 0
        ? `${metrics.onlyB} cells appeared that the original surface did not contain: solidify-then-hollow added surface where the lattice edge was treated as a wall.`
        : "No cells were invented on the return trip.",
    ],
  };
}

/** volume→boundary→solid, measured against the original volume. */
export function measureVolumeRoundTrip(volume: SparseVoxels): ConversionReport {
  const started = performance.now();
  const surface = surfaceFromSolid(volume);
  const rebuilt = solidFromSurface(surface);
  const metrics = compareVoxelSets(volume, rebuilt.volume);
  const inputCells = voxelCount(volume);
  return {
    direction: "volume→surface→volume",
    inputCells,
    outputCells: voxelCount(rebuilt.volume),
    shared: metrics.shared,
    lost: metrics.onlyA,
    gained: metrics.onlyB,
    iou: metrics.iou,
    containment: metrics.containment,
    lossFraction: inputCells === 0 ? 0 : metrics.onlyA / inputCells,
    closed: rebuilt.closed,
    enclosedCells: rebuilt.enclosedCells,
    wallClockMs: performance.now() - started,
    notes: [
      `The boundary alone holds ${voxelCount(surface)} of ${inputCells} cells (${((voxelCount(surface) / Math.max(1, inputCells)) * 100).toFixed(2)}%).`,
      ...rebuilt.notes,
    ],
  };
}

/** Attach a fixed confidence to every observed cell without touching geometry. */
export function withVolumeConfidence(volume: SparseVoxels, value: number): SparseVoxels {
  return withConfidence(volume, value);
}
