/**
 * ==========================================================
 * TEMPORAL STUDIO — NRE — MORTON (Z-ORDER) ADDRESSING
 *
 * O-Voxel stores its voxels in Morton order so that neighbouring cells
 * are neighbouring bytes: compression and cache locality both come from
 * the ordering, not from extra structure. NRE keeps that property and
 * verifies it on read, because a payload written in a different order
 * would still decode — into a differently compressed but equally valid
 * file — and nothing downstream could tell.
 *
 * 21 bits per axis (63 bits total) covers 2,097,152 cells per axis.
 * Beyond that a code no longer fits in 63 bits, so the encoder refuses
 * instead of truncating. BigInt is used deliberately: a 63-bit key
 * cannot be represented exactly by a JS number (53-bit mantissa), and
 * silently losing the low bits would reorder voxels.
 * ==========================================================
 */

import { MORTON_BITS_PER_AXIS, MORTON_MAX_AXIS } from "./types.ts";

/** Spread the low 21 bits of `value` so bit i lands at bit 3i. */
function spread3(value: bigint): bigint {
  let out = 0n;
  for (let bit = 0n; bit < BigInt(MORTON_BITS_PER_AXIS); bit += 1n) {
    if ((value >> bit) & 1n) out |= 1n << (bit * 3n);
  }
  return out;
}

/**
 * Inverse of spread3 for ONE axis: gather bits 0,3,6,… back into
 * contiguous bits. Callers shift the code down by the axis index first,
 * so this must not loop over axes itself — doing so would fold all three
 * coordinates together and decode (1,2,3) as (6,5,4).
 */
function gather3(code: bigint): number {
  let out = 0;
  for (let bit = 0; bit < MORTON_BITS_PER_AXIS; bit++) {
    if ((code >> BigInt(bit * 3)) & 1n) out += 2 ** bit;
  }
  return out;
}

export class MortonRangeError extends Error {
  constructor(axis: string, value: number) {
    super(
      `Cell coordinate ${axis}=${value} is outside the Morton domain [0, ${MORTON_MAX_AXIS}). ` +
        `NRE packs ${MORTON_BITS_PER_AXIS} bits per axis; a larger lattice needs a different addressing scheme, not a truncated key.`,
    );
    this.name = "MortonRangeError";
  }
}

function assertInDomain(axis: string, value: number): void {
  if (!Number.isInteger(value) || value < 0 || value >= MORTON_MAX_AXIS) {
    throw new MortonRangeError(axis, value);
  }
}

/**
 * Interleave x,y,z into one Z-order code. Axis x takes the least
 * significant of each three-bit group (x=bit0, y=bit1, z=bit2), matching
 * the convention that the first coordinate varies fastest.
 */
export function morton3(x: number, y: number, z: number): bigint {
  assertInDomain("x", x);
  assertInDomain("y", y);
  assertInDomain("z", z);
  return spread3(BigInt(x)) | (spread3(BigInt(y)) << 1n) | (spread3(BigInt(z)) << 2n);
}

/** Inverse of morton3. */
export function decodeMorton(code: bigint): [number, number, number] {
  if (code < 0n || code >= 1n << BigInt(MORTON_BITS_PER_AXIS * 3)) {
    throw new RangeError(`Morton code ${code.toString()} is outside the 63-bit domain.`);
  }
  return [gather3(code), gather3(code >> 1n), gather3(code >> 2n)];
}

export interface MortonSortResult {
  /** Coordinates in Morton order, length 3n. */
  coords: Int32Array;
  /** Ascending Morton codes, length n. */
  morton: BigUint64Array;
  /** Index of each output voxel in the input array (n). */
  order: Uint32Array;
  /** Voxels removed because a cell was listed twice (duplicates are merged, not added). */
  duplicates: number;
}

/**
 * Sort an xyz triple list into Morton order and merge duplicate cells.
 *
 * Duplicates are merged rather than summed: two observations of the same
 * cell in one snapshot are one occupied cell whose attributes were
 * already fused by the caller. Quietly counting it twice would inflate
 * voxelCount and every difference computed from it.
 *
 * Attribute merging is the caller's job — this operates on coordinates.
 */
export function sortByMorton(coords: ArrayLike<number>): MortonSortResult {
  if (coords.length % 3 !== 0) {
    throw new Error(`Coordinate array length ${coords.length} is not a multiple of 3.`);
  }
  const n = coords.length / 3;
  const keys = new Array<bigint>(n);
  const order = new Uint32Array(n);
  for (let v = 0; v < n; v++) {
    keys[v] = morton3(coords[v * 3], coords[v * 3 + 1], coords[v * 3 + 2]);
    order[v] = v;
  }
  // Sort indices by key, ties by original index — a stable, deterministic order.
  const indices = Array.from({ length: n }, (_, i) => i).sort((a, b) => {
    const ka = keys[a];
    const kb = keys[b];
    if (ka < kb) return -1;
    if (ka > kb) return 1;
    return a - b;
  });

  const outCoords = new Int32Array(n * 3);
  const outMorton = new BigUint64Array(n);
  const outOrder = new Uint32Array(n);
  let written = 0;
  let previous: bigint | null = null;
  for (const source of indices) {
    const key = keys[source];
    if (previous !== null && key === previous) continue; // duplicate cell
    const base = written * 3;
    outCoords[base] = coords[source * 3];
    outCoords[base + 1] = coords[source * 3 + 1];
    outCoords[base + 2] = coords[source * 3 + 2];
    outMorton[written] = key;
    outOrder[written] = source;
    written++;
    previous = key;
  }
  return {
    coords: outCoords.slice(0, written * 3),
    morton: outMorton.slice(0, written),
    order: outOrder.slice(0, written),
    duplicates: n - written,
  };
}

/** Whether a Morton array is strictly ascending (duplicates included as a failure). */
export function isStrictlyAscending(morton: BigUint64Array): boolean {
  for (let i = 1; i < morton.length; i++) if (morton[i] <= morton[i - 1]) return false;
  return true;
}
