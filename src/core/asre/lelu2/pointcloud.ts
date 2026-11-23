/**
 * ==========================================================
 * LÉLU 2.1 — POINT CLOUDS FOR DISTRIBUTION EXPERIMENTS
 *
 * A sampling method has to choose points that *already exist* on a surface:
 * hair may only grow from her scalp, a stud may only sit on a garment. So every
 * method in this experiment selects a subset of a real vertex cloud instead of
 * inventing coordinates that then have to be projected (and moved) onto the
 * surface.
 *
 * Selecting `n` points out of 200 000 needs a spatial index, otherwise every
 * nearest-point search is a linear scan and the resource budget stops being
 * identical across methods. `PointIndex` is a uniform grid with an exact
 * expanding-ring search.
 * ==========================================================
 */

export type V3 = [number, number, number];

export interface Cloud {
  /** Flat xyz. */
  points: Float32Array;
  /** Flat xyz unit normals, when the surface has them. */
  normals?: Float32Array;
  /** Centroid — the frame origin for the spherical methods. */
  centre: V3;
  /** Name of the surface this cloud came from, for the report. */
  source: string;
}

export function cloudFrom(
  positions: ArrayLike<number>,
  source: string,
  normals?: ArrayLike<number>,
  filter?: (x: number, y: number, z: number) => boolean,
): Cloud {
  const out: number[] = [];
  const nrm: number[] = [];
  for (let i = 0; i + 2 < positions.length; i += 3) {
    const x = positions[i], y = positions[i + 1], z = positions[i + 2];
    if (filter && !filter(x, y, z)) continue;
    out.push(x, y, z);
    if (normals) nrm.push(normals[i], normals[i + 1], normals[i + 2]);
  }
  const centre: V3 = [0, 0, 0];
  for (let i = 0; i < out.length; i += 3) {
    centre[0] += out[i];
    centre[1] += out[i + 1];
    centre[2] += out[i + 2];
  }
  const count = out.length / 3 || 1;
  centre[0] /= count;
  centre[1] /= count;
  centre[2] /= count;
  return { points: Float32Array.from(out), ...(nrm.length ? { normals: Float32Array.from(nrm) } : {}), centre, source };
}

export function cloudSize(cloud: Cloud): number {
  return cloud.points.length / 3;
}

/** Uniform grid over a cloud, with an exact expanding-ring nearest-point search. */
export class PointIndex {
  readonly cell: number;
  private readonly cloud: Cloud;
  private readonly grid = new Map<number, number[]>();
  private readonly lo: V3;
  private readonly nx = 1024;

  constructor(cloud: Cloud, cell?: number) {
    this.cloud = cloud;
    const n = cloudSize(cloud);
    let extent = 0;
    for (let i = 0; i < n; i++) {
      const d = Math.hypot(cloud.points[3 * i] - cloud.centre[0], cloud.points[3 * i + 1] - cloud.centre[1], cloud.points[3 * i + 2] - cloud.centre[2]);
      if (d > extent) extent = d;
    }
    const volume = (2 * extent) ** 3 || 1;
    // ~8 points per cell: buckets stay small without making the ring search long.
    this.cell = cell ?? Math.max(1e-4, Math.cbrt(volume / Math.max(1, n / 8)));
    const lo: V3 = [Infinity, Infinity, Infinity];
    for (let i = 0; i < n; i++) for (let a = 0; a < 3; a++) lo[a] = Math.min(lo[a], cloud.points[3 * i + a]);
    this.lo = lo;
    for (let i = 0; i < n; i++) {
      const key = this.key(cloud.points[3 * i], cloud.points[3 * i + 1], cloud.points[3 * i + 2]);
      const bucket = this.grid.get(key);
      if (bucket) bucket.push(i);
      else this.grid.set(key, [i]);
    }
  }

  private idx(v: number, axis: number): number {
    return Math.floor((v - this.lo[axis]) / this.cell);
  }

  private key(x: number, y: number, z: number): number {
    return (this.idx(x, 0) * this.nx + this.idx(y, 1)) * this.nx + this.idx(z, 2);
  }

  nearest(x: number, y: number, z: number): { index: number; distance: number } {
    if (!this.grid.size) return { index: -1, distance: Infinity };
    const cx = this.idx(x, 0), cy = this.idx(y, 1), cz = this.idx(z, 2);
    let best = -1;
    let bestD = Infinity;
    // A surface PATCH leaves most directions with nothing nearby; an unbounded
    // ring search would walk thousands of empty buckets per query. Bounded at
    // six rings, then an exact linear fallback — one scan beats 6·32² buckets.
    for (let ring = 0; ring <= 6; ring++) {
      // A point in ring r is at least (r − 1)·cell away, so a farther ring cannot beat the best.
      if (best >= 0 && (ring - 1) * this.cell > Math.sqrt(bestD)) break;
      for (let dx = -ring; dx <= ring; dx++)
        for (let dy = -ring; dy <= ring; dy++)
          for (let dz = -ring; dz <= ring; dz++) {
            if (Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz)) !== ring) continue;
            const bucket = this.grid.get(((cx + dx) * this.nx + (cy + dy)) * this.nx + (cz + dz));
            if (!bucket) continue;
            for (const i of bucket) {
              const p = this.cloud.points;
              const d = (p[3 * i] - x) ** 2 + (p[3 * i + 1] - y) ** 2 + (p[3 * i + 2] - z) ** 2;
              if (d < bestD) {
                bestD = d;
                best = i;
              }
            }
          }
    }
    if (best < 0) {
      const p = this.cloud.points;
      for (let i = 0; i < p.length / 3; i++) {
        const d = (p[3 * i] - x) ** 2 + (p[3 * i + 1] - y) ** 2 + (p[3 * i + 2] - z) ** 2;
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
    }
    return { index: best, distance: Math.sqrt(bestD) };
  }

  /**
   * Nearest point that is not already used. Rejecting a duplicate direction and
   * asking again starves a law on a small surface patch (every direction maps
   * back to the same taken vertices); walking the local neighbourhood and taking
   * the nearest free point keeps the delivered count equal across laws.
   */
  nearestUnused(x: number, y: number, z: number, used: ReadonlySet<number>): { index: number; distance: number } {
    if (!this.grid.size) return { index: -1, distance: Infinity };
    const cx = this.idx(x, 0), cy = this.idx(y, 1), cz = this.idx(z, 2);
    let best = -1;
    let bestD = Infinity;
    for (let ring = 0; ring <= 6; ring++) {
      if (best >= 0 && (ring - 1) * this.cell > Math.sqrt(bestD)) break;
      for (let dx = -ring; dx <= ring; dx++)
        for (let dy = -ring; dy <= ring; dy++)
          for (let dz = -ring; dz <= ring; dz++) {
            if (Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz)) !== ring) continue;
            const bucket = this.grid.get(((cx + dx) * this.nx + (cy + dy)) * this.nx + (cz + dz));
            if (!bucket) continue;
            for (const i of bucket) {
              if (used.has(i)) continue;
              const p = this.cloud.points;
              const d = (p[3 * i] - x) ** 2 + (p[3 * i + 1] - y) ** 2 + (p[3 * i + 2] - z) ** 2;
              if (d < bestD) {
                bestD = d;
                best = i;
              }
            }
          }
    }
    if (best >= 0) return { index: best, distance: Math.sqrt(bestD) };
    // Everything nearby is taken: the law has genuinely run out of surface.
    return { index: -1, distance: Infinity };
  }

  /** True when any stored point lies within `radius`. */
  anyWithin(x: number, y: number, z: number, radius: number): boolean {
    const r = Math.ceil(radius / this.cell);
    const cx = this.idx(x, 0), cy = this.idx(y, 1), cz = this.idx(z, 2);
    for (let dx = -r; dx <= r; dx++)
      for (let dy = -r; dy <= r; dy++)
        for (let dz = -r; dz <= r; dz++) {
          const bucket = this.grid.get(((cx + dx) * this.nx + (cy + dy)) * this.nx + (cz + dz));
          if (!bucket) continue;
          for (const i of bucket) {
            const p = this.cloud.points;
            if ((p[3 * i] - x) ** 2 + (p[3 * i + 1] - y) ** 2 + (p[3 * i + 2] - z) ** 2 <= radius * radius) return true;
          }
        }
    return false;
  }
}

export interface SpacingStats {
  n: number;
  mean: number;
  min: number;
  max: number;
  /** Coefficient of variation of nearest-neighbour spacing: 0 is perfectly even. */
  cv: number;
  /** Coincident points — two details competing for the same millimetre. */
  duplicates: number;
}

export function spacingStats(points: Float32Array): SpacingStats {
  const n = points.length / 3;
  if (n < 2) return { n, mean: 0, min: 0, max: 0, cv: 0, duplicates: 0 };
  const nn = new Float64Array(n).fill(Infinity);
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++) {
      const d = Math.hypot(points[3 * i] - points[3 * j], points[3 * i + 1] - points[3 * j + 1], points[3 * i + 2] - points[3 * j + 2]);
      if (d < nn[i]) nn[i] = d;
      if (d < nn[j]) nn[j] = d;
    }
  let sum = 0, min = Infinity, max = 0, duplicates = 0;
  for (const d of nn) {
    sum += d;
    if (d < min) min = d;
    if (d > max) max = d;
    if (d < 1e-4) duplicates++;
  }
  const mean = sum / n;
  let variance = 0;
  for (const d of nn) variance += (d - mean) ** 2;
  return { n, mean, min, max, cv: mean > 0 ? Math.sqrt(variance / n) / mean : 0, duplicates };
}

/**
 * Fraction of the surface (probed on a stride of `probes` vertices) that has a
 * chosen point within `radius`. A pattern can be very even and still leave a
 * bare patch, so no method is called a win on CV alone.
 */
export function coverage(cloud: Cloud, chosen: Float32Array, radius: number, probes = 3000): number {
  const chosenIndex = new PointIndex({ points: chosen, centre: cloud.centre, source: "chosen" }, radius / 2);
  const stride = Math.max(1, Math.floor(cloudSize(cloud) / probes));
  let covered = 0, total = 0;
  for (let i = 0; i < cloudSize(cloud); i += stride) {
    if (chosenIndex.anyWithin(cloud.points[3 * i], cloud.points[3 * i + 1], cloud.points[3 * i + 2], radius)) covered++;
    total++;
  }
  return total ? covered / total : 0;
}

/** Write a selected subset back out as flat xyz. */
export function collect(cloud: Cloud, indices: readonly number[]): Float32Array {
  const out = new Float32Array(indices.length * 3);
  for (let k = 0; k < indices.length; k++) {
    const i = indices[k];
    out[3 * k] = cloud.points[3 * i];
    out[3 * k + 1] = cloud.points[3 * i + 1];
    out[3 * k + 2] = cloud.points[3 * i + 2];
  }
  return out;
}
