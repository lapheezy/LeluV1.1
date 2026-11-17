/**
 * 3D Morton (Z-order) codes, 16 bits per axis → 48-bit codes held exactly
 * in a JS number (< 2^53). Sorting cells by code keeps spatial neighbours
 * close in memory and on disk, which is what makes delta encoding small.
 */

export const MORTON_AXIS_MAX = 0xffff;

function spread10(v: number): number {
  let x = v & 0x3ff;
  x = (x | (x << 16)) & 0x030000ff;
  x = (x | (x << 8)) & 0x0300f00f;
  x = (x | (x << 4)) & 0x030c30c3;
  x = (x | (x << 2)) & 0x09249249;
  return x >>> 0;
}

function compact10(v: number): number {
  let x = v & 0x09249249;
  x = (x | (x >>> 2)) & 0x030c30c3;
  x = (x | (x >>> 4)) & 0x0300f00f;
  x = (x | (x >>> 8)) & 0x030000ff;
  x = (x | (x >>> 16)) & 0x000003ff;
  return x >>> 0;
}

const LOW = 2 ** 30;

export function mortonEncode(x: number, y: number, z: number): number {
  if (x < 0 || y < 0 || z < 0 || x > MORTON_AXIS_MAX || y > MORTON_AXIS_MAX || z > MORTON_AXIS_MAX || !Number.isInteger(x + y + z)) {
    throw new RangeError(`morton: cell (${x},${y},${z}) outside 0..${MORTON_AXIS_MAX}`);
  }
  const lo = (spread10(x) | (spread10(y) << 1) | (spread10(z) << 2)) >>> 0;
  const hi = (spread10(x >>> 10) | (spread10(y >>> 10) << 1) | (spread10(z >>> 10) << 2)) >>> 0;
  return hi * LOW + lo;
}

export function mortonDecode(code: number): [number, number, number] {
  const lo = code % LOW;
  const hi = Math.floor(code / LOW);
  return [
    compact10(lo) | (compact10(hi) << 10),
    compact10(lo >>> 1) | (compact10(hi >>> 1) << 10),
    compact10(lo >>> 2) | (compact10(hi >>> 2) << 10),
  ];
}
