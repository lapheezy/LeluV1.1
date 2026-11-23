/**
 * ==========================================================
 * LÉLU ASRE — TEMPORAL COMPARISON
 *
 * What changed between two states of the same lattice, measured:
 * overlap, cells gained and lost, centroid motion, and the best
 * integer rigid translation. From those numbers the change is
 * classified — never guessed from labels.
 *
 *   unchanged          identical occupancy
 *   rigid-translation  a shifted copy explains ≥ rigidIou of the result
 *   expansion          (almost) nothing lost, cells gained
 *   contraction        (almost) nothing gained, cells lost
 *   deformation        anything else
 * ==========================================================
 */

import { mortonDecode, mortonEncode } from "../nre/morton.ts";
import type { SparseVoxelGrid } from "../nre/SparseVoxelGrid.ts";
import type { Vec3 } from "../nre/types.ts";

export type ChangeClass = "unchanged" | "rigid-translation" | "expansion" | "contraction" | "deformation";

export interface GridComparison {
  iou: number;
  added: number;
  removed: number;
  common: number;
  volumeRatio: number;
  centroidShift: Vec3;
  bestTranslation: { delta: Vec3; iou: number };
  classification: ChangeClass;
}

export function shiftedIou(a: SparseVoxelGrid, bCodes: Set<number>, delta: Vec3, bSize: number): number {
  let inter = 0;
  for (const code of a.codes()) {
    const [x, y, z] = mortonDecode(code);
    const nx = x + delta[0], ny = y + delta[1], nz = z + delta[2];
    if (nx < 0 || ny < 0 || nz < 0 || nx > 0xffff || ny > 0xffff || nz > 0xffff) continue;
    if (bCodes.has(mortonEncode(nx, ny, nz))) inter++;
  }
  const union = a.size + bSize - inter;
  return union === 0 ? 1 : inter / union;
}

export function compareGrids(a: SparseVoxelGrid, b: SparseVoxelGrid, options: { searchRadius?: number; rigidIou?: number; tolerance?: number } = {}): GridComparison {
  const bCodes = new Set(b.codes());
  let common = 0;
  for (const code of a.codes()) if (bCodes.has(code)) common++;
  const added = b.size - common;
  const removed = a.size - common;
  const union = a.size + b.size - common;
  const overlap = union === 0 ? 1 : common / union;
  const ca = a.centroid() ?? [0, 0, 0];
  const cb = b.centroid() ?? [0, 0, 0];
  const centroidShift: Vec3 = [cb[0] - ca[0], cb[1] - ca[1], cb[2] - ca[2]];

  const r = options.searchRadius ?? 2;
  const guess = centroidShift.map(Math.round) as Vec3;
  let best = { delta: [0, 0, 0] as Vec3, iou: overlap };
  for (let dx = -r; dx <= r; dx++)
    for (let dy = -r; dy <= r; dy++)
      for (let dz = -r; dz <= r; dz++) {
        const delta: Vec3 = [guess[0] + dx, guess[1] + dy, guess[2] + dz];
        if (delta[0] === 0 && delta[1] === 0 && delta[2] === 0) continue;
        const v = shiftedIou(a, bCodes, delta, b.size);
        if (v > best.iou) best = { delta, iou: v };
      }

  const tol = options.tolerance ?? 0.01;
  let classification: ChangeClass;
  if (added === 0 && removed === 0) classification = "unchanged";
  else if ((best.delta[0] || best.delta[1] || best.delta[2]) && best.iou >= (options.rigidIou ?? 0.98)) classification = "rigid-translation";
  else if (removed <= tol * a.size && added > 0) classification = "expansion";
  else if (added <= tol * b.size && removed > 0) classification = "contraction";
  else classification = "deformation";

  return { iou: overlap, added, removed, common, volumeRatio: a.size === 0 ? Infinity : b.size / a.size, centroidShift, bestTranslation: best, classification };
}
