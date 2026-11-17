/**
 * Deterministic voxel shapes on an integer lattice. Used by experiments and
 * tests; every count they produce is measured, not asserted from memory.
 */
import type { Vec3 } from "../nre/types.ts";

/**
 * Cells whose centre lies inside a sphere. `center` is in cell units; cell
 * (i,j,k) has its centre at (i+0.5, j+0.5, k+0.5).
 */
export function ballCells(center: Vec3, radius: number): Vec3[] {
  const out: Vec3[] = [];
  const r2 = radius * radius;
  const lo = center.map((c) => Math.floor(c - radius - 1));
  const hi = center.map((c) => Math.ceil(c + radius + 1));
  for (let x = Math.max(0, lo[0]); x <= hi[0]; x++)
    for (let y = Math.max(0, lo[1]); y <= hi[1]; y++)
      for (let z = Math.max(0, lo[2]); z <= hi[2]; z++) {
        const dx = x + 0.5 - center[0], dy = y + 0.5 - center[1], dz = z + 0.5 - center[2];
        if (dx * dx + dy * dy + dz * dz <= r2) out.push([x, y, z]);
      }
  return out;
}

export function boxCells(min: Vec3, size: Vec3): Vec3[] {
  const out: Vec3[] = [];
  for (let x = 0; x < size[0]; x++) for (let y = 0; y < size[1]; y++) for (let z = 0; z < size[2]; z++) out.push([min[0] + x, min[1] + y, min[2] + z]);
  return out;
}

export function translateCells(cells: Vec3[], d: Vec3): Vec3[] {
  return cells.map(([x, y, z]) => [x + d[0], y + d[1], z + d[2]]);
}
