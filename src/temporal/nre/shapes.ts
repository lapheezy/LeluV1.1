/**
 * ==========================================================
 * TEMPORAL STUDIO — NRE — PROCEDURAL FIXTURES
 *
 * Deterministic shapes for the reversibility and temporal experiments.
 * These are generated numerically (or as analytic meshes in
 * geometry.ts), never downloaded, so every measurement in the reports
 * can be reproduced offline by anyone who checks out the branch.
 *
 * Each fixture is a plain occupied-cell set; confidence is attached
 * explicitly so the experiments can vary it without touching geometry.
 * ==========================================================
 */

import type { SpatialGrid, SparseVoxels, Vec3 } from "./types.ts";
import { buildSparseVoxels, cellCenter, withConfidence } from "./voxels.ts";

export const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

export function translationMatrix(dx: number, dy: number, dz: number): number[] {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, dx, dy, dz, 1];
}

export function rotationYMatrix(radians: number): number[] {
  const c = Math.cos(radians);
  const s = Math.sin(radians);
  return [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1];
}

export function scaleMatrix(sx: number, sy: number, sz: number): number[] {
  return [sx, 0, 0, 0, 0, sy, 0, 0, 0, 0, sz, 0, 0, 0, 0, 1];
}

/** Hollow box: only the outer shell of the given inclusive index range. */
export function boxShell(
  grid: SpatialGrid,
  range: { min: readonly [number, number, number]; max: readonly [number, number, number] },
): SparseVoxels {
  const cells: Array<[number, number, number]> = [];
  for (let i = range.min[0]; i <= range.max[0]; i++) {
    for (let j = range.min[1]; j <= range.max[1]; j++) {
      for (let k = range.min[2]; k <= range.max[2]; k++) {
        const onShell =
          i === range.min[0] || i === range.max[0] ||
          j === range.min[1] || j === range.max[1] ||
          k === range.min[2] || k === range.max[2];
        if (onShell) cells.push([i, j, k]);
      }
    }
  }
  return buildSparseVoxels(grid, cells, { occupancy: "sparse-surface" });
}

/** Solid box: every cell in the range, interior included. */
export function filledBox(
  grid: SpatialGrid,
  range: { min: readonly [number, number, number]; max: readonly [number, number, number] },
): SparseVoxels {
  const cells: Array<[number, number, number]> = [];
  for (let i = range.min[0]; i <= range.max[0]; i++) {
    for (let j = range.min[1]; j <= range.max[1]; j++) {
      for (let k = range.min[2]; k <= range.max[2]; k++) cells.push([i, j, k]);
    }
  }
  return buildSparseVoxels(grid, cells, { occupancy: "sparse-volume" });
}

/** Cells whose centre lies within [radius − thickness, radius] of a world point. */
export function sphereShell(grid: SpatialGrid, center: Vec3, radius: number, thickness: number): SparseVoxels {
  const cells: Array<[number, number, number]> = [];
  const inner = Math.max(0, radius - thickness);
  for (let i = 0; i < grid.resolution[0]; i++) {
    for (let j = 0; j < grid.resolution[1]; j++) {
      for (let k = 0; k < grid.resolution[2]; k++) {
        const d = distance(cellCenter(grid, i, j, k), center);
        if (d <= radius && d >= inner) cells.push([i, j, k]);
      }
    }
  }
  return buildSparseVoxels(grid, cells);
}

/** Filled sphere: a dense volume, for the interior-loss measurement. */
export function filledSphere(grid: SpatialGrid, center: Vec3, radius: number): SparseVoxels {
  const cells: Array<[number, number, number]> = [];
  for (let i = 0; i < grid.resolution[0]; i++) {
    for (let j = 0; j < grid.resolution[1]; j++) {
      for (let k = 0; k < grid.resolution[2]; k++) {
        if (distance(cellCenter(grid, i, j, k), center) <= radius) cells.push([i, j, k]);
      }
    }
  }
  return buildSparseVoxels(grid, cells, { occupancy: "sparse-volume" });
}

export function torus(grid: SpatialGrid, center: Vec3, major: number, minor: number): SparseVoxels {
  const cells: Array<[number, number, number]> = [];
  for (let i = 0; i < grid.resolution[0]; i++) {
    for (let j = 0; j < grid.resolution[1]; j++) {
      for (let k = 0; k < grid.resolution[2]; k++) {
        const [x, y, z] = cellCenter(grid, i, j, k);
        const dx = x - center[0], dy = y - center[1], dz = z - center[2];
        const radial = Math.hypot(dx, dz);
        const d = Math.hypot(radial - major, dy);
        if (d <= minor) cells.push([i, j, k]);
      }
    }
  }
  return buildSparseVoxels(grid, cells);
}

/** A single-voxel-wide open curve — a degenerate surface for round-trip tests. */
export function lineOfCells(grid: SpatialGrid, from: readonly [number, number, number], to: readonly [number, number, number]): SparseVoxels {
  const steps = Math.max(
    Math.abs(to[0] - from[0]),
    Math.abs(to[1] - from[1]),
    Math.abs(to[2] - from[2]),
  );
  const cells: Array<[number, number, number]> = [];
  for (let s = 0; s <= steps; s++) {
    const t = steps === 0 ? 0 : s / steps;
    cells.push([
      Math.round(from[0] + (to[0] - from[0]) * t),
      Math.round(from[1] + (to[1] - from[1]) * t),
      Math.round(from[2] + (to[2] - from[2]) * t),
    ]);
  }
  return buildSparseVoxels(grid, cells);
}

/** One flat sheet of cells: zero thickness, a surface with no volume. */
export function planeSheet(grid: SpatialGrid, j: number, span: number): SparseVoxels {
  const cells: Array<[number, number, number]> = [];
  const offset = Math.floor((grid.resolution[0] - span) / 2);
  for (let i = 0; i < span; i++) {
    for (let k = 0; k < span; k++) cells.push([offset + i, j, offset + k]);
  }
  return buildSparseVoxels(grid, cells);
}

/** Deterministic pseudo-random sparse cloud (LCG — no Math.random anywhere). */
export function randomSparse(grid: SpatialGrid, count: number, seed = 12345): SparseVoxels {
  const cells: Array<[number, number, number]> = [];
  let state = seed >>> 0;
  const next = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
  const seen = new Set<string>();
  let guard = 0;
  while (cells.length < count && guard < count * 40) {
    guard++;
    const i = Math.floor(next() * grid.resolution[0]);
    const j = Math.floor(next() * grid.resolution[1]);
    const k = Math.floor(next() * grid.resolution[2]);
    const key = `${i},${j},${k}`;
    if (seen.has(key)) continue;
    seen.add(key);
    cells.push([i, j, k]);
  }
  return buildSparseVoxels(grid, cells);
}

/**
 * An irregular blob: a sphere whose radius is modulated by a seeded
 * wave field and thresholded. Non-convex, no analytic inverse — the
 * closest thing to character geometry this environment can produce
 * without a reconstruction model.
 */
export function irregularBlob(grid: SpatialGrid, center: Vec3, radius: number, seed = 7, amp = 0.3): SparseVoxels {
  const cells: Array<[number, number, number]> = [];
  for (let i = 0; i < grid.resolution[0]; i++) {
    for (let j = 0; j < grid.resolution[1]; j++) {
      for (let k = 0; k < grid.resolution[2]; k++) {
        const [x, y, z] = cellCenter(grid, i, j, k);
        const dx = x - center[0], dy = y - center[1], dz = z - center[2];
        const d = Math.hypot(dx, dy, dz);
        const theta = Math.atan2(dz, dx);
        const phi = Math.acos(Math.min(1, Math.max(-1, dy / Math.max(d, 1e-9))));
        const wobble = 1 + amp * (0.5 * Math.sin(3 * theta + seed) * Math.sin(2 * phi) + 0.3 * Math.sin(5 * phi + seed) + 0.2 * Math.cos(4 * theta));
        if (d <= radius * wobble && d >= radius * wobble - grid.cellSize * 1.2) cells.push([i, j, k]);
      }
    }
  }
  return buildSparseVoxels(grid, cells);
}

function distance(a: Vec3, b: Vec3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/** Attach a uniform confidence, returning a new set. */
export function withUniformConfidence(voxels: SparseVoxels, value: number): SparseVoxels {
  return withConfidence(voxels, value);
}
