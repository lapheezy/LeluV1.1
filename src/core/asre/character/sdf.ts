/**
 * Signed distance primitives (metres; negative inside). Exact where the
 * formula is exact (sphere, capsule, box, torus); the ellipsoid and tapered
 * capsule are the usual conservative approximations — the surface is where
 * they are zero, which is all meshing and occupancy need.
 */
export type V3 = [number, number, number];
export type Sdf = (x: number, y: number, z: number) => number;

export const sphere = (c: V3, r: number): Sdf => (x, y, z) => Math.hypot(x - c[0], y - c[1], z - c[2]) - r;

export const ellipsoid = (c: V3, r: V3): Sdf => (x, y, z) => {
  const k0 = Math.hypot((x - c[0]) / r[0], (y - c[1]) / r[1], (z - c[2]) / r[2]);
  const k1 = Math.hypot((x - c[0]) / (r[0] * r[0]), (y - c[1]) / (r[1] * r[1]), (z - c[2]) / (r[2] * r[2]));
  return k1 === 0 ? -Math.min(...r) : (k0 * (k0 - 1)) / k1;
};

/** Capsule from a to b with radius ra at a and rb at b (linear taper). */
export const capsule = (a: V3, b: V3, ra: number, rb = ra): Sdf => {
  const bx = b[0] - a[0], by = b[1] - a[1], bz = b[2] - a[2];
  const bb = bx * bx + by * by + bz * bz || 1e-12;
  return (x, y, z) => {
    const px = x - a[0], py = y - a[1], pz = z - a[2];
    const t = Math.max(0, Math.min(1, (px * bx + py * by + pz * bz) / bb));
    return Math.hypot(px - bx * t, py - by * t, pz - bz * t) - (ra + (rb - ra) * t);
  };
};

export const roundBox = (c: V3, half: V3, r = 0): Sdf => (x, y, z) => {
  const qx = Math.abs(x - c[0]) - half[0] + r, qy = Math.abs(y - c[1]) - half[1] + r, qz = Math.abs(z - c[2]) - half[2] + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qy, qz), 0) - r;
};

/** Torus in the plane perpendicular to `axis` (0=x,1=y,2=z). */
export const torus = (c: V3, R: number, r: number, axis: 0 | 1 | 2 = 1): Sdf => (x, y, z) => {
  const p = [x - c[0], y - c[1], z - c[2]];
  const a = p[axis];
  const [u, v] = [0, 1, 2].filter((i) => i !== axis).map((i) => p[i]);
  return Math.hypot(Math.hypot(u, v) - R, a) - r;
};

/** Half-space: inside where (p − point)·n < 0. */
export const plane = (point: V3, n: V3): Sdf => {
  const l = Math.hypot(...n);
  return (x, y, z) => ((x - point[0]) * n[0] + (y - point[1]) * n[1] + (z - point[2]) * n[2]) / l;
};

export const union = (...s: Sdf[]): Sdf => (x, y, z) => {
  let d = Infinity;
  for (const f of s) d = Math.min(d, f(x, y, z));
  return d;
};

/** Polynomial smooth union with blend radius k. */
export const smooth = (k: number, ...s: Sdf[]): Sdf => (x, y, z) => {
  let d = s[0](x, y, z);
  for (let i = 1; i < s.length; i++) {
    const b = s[i](x, y, z);
    const h = Math.max(k - Math.abs(d - b), 0) / k;
    d = Math.min(d, b) - (h * h * k) / 4;
  }
  return d;
};

export const intersect = (...s: Sdf[]): Sdf => (x, y, z) => {
  let d = -Infinity;
  for (const f of s) d = Math.max(d, f(x, y, z));
  return d;
};

export const subtract = (a: Sdf, b: Sdf): Sdf => (x, y, z) => Math.max(a(x, y, z), -b(x, y, z));

/** Hollow shell of thickness t around the zero set of s, pushed outward by `offset`. */
export const shell = (s: Sdf, offset: number, t: number): Sdf => (x, y, z) => Math.abs(s(x, y, z) - offset - t / 2) - t / 2;

export const offset = (s: Sdf, d: number): Sdf => (x, y, z) => s(x, y, z) - d;

export const translate = (s: Sdf, d: V3): Sdf => (x, y, z) => s(x - d[0], y - d[1], z - d[2]);
