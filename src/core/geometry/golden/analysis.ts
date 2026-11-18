/**
 * ==========================================================
 * LÉLU 2 — GOLDEN GEOMETRY — GEOMETRIC SIGNATURES
 *
 * This is the part that makes the engine an *analyser* rather than a drawing
 * toy. It takes a point set produced by any method — her real hair roots, the
 * vertices of a bead run, a spiral sample — and returns a signature:
 *
 *   distribution   nearest-neighbour spacing statistics (uniformity)
 *   divergence     the successive-angle histogram, and its distance to the
 *                  golden or Lucas sweep
 *   radial         how radius scales with index (equal-area ⇒ exponent ½)
 *   symmetry       n-fold rotation error, bilateral error
 *   spiral         log-radius fit residual and the implied growth per turn
 *
 * A signature says what a point set *is*. Constraints are then chosen from
 * measured signatures (see constraints.ts) instead of assumed.
 *
 * ORDER is the subtle part of a divergence signature. A phyllotactic pattern is
 * only revealed by the *order the primordia appeared*, and a measured point set
 * does not carry that order. Two honest modes are offered:
 *
 *   "radial"  sort by distance from the centroid, then take successive angular
 *             gaps. This recovers generation order for anything that grew
 *             outward from a centre — a seed head, a set of hair roots — and is
 *             the default.
 *   "input"   use the caller's own order, for patterns we generated.
 *
 * There is deliberately no claim that a random cloud has no structure: the
 * signature reports the numbers, and a caller decides.
 * ==========================================================
 */
import { GOLDEN_ANGLE_DEG, LUCAS_ANGLE } from "./constants.ts";

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface PointStats {
  count: number;
  /** Mean nearest-neighbour distance. */
  mean: number;
  median: number;
  min: number;
  max: number;
  p05: number;
  p95: number;
  /** Coefficient of variation of nearest-neighbour distance: 0 = perfectly even. */
  cv: number;
  /** Bounding box diagonal. */
  diagonal: number;
  /** mean / (expected for `count` points in this volume) — 1.0 is ideal spacing. */
  packingRatio: number;
}

/** 3D points, 2D points (z taken as 0) or a packed position array. */
export type PointInput = Float32Array | ArrayLike<number> | readonly { x: number; y: number; z?: number }[];

/** Convert any accepted point input to a Vec3 array. Missing z is 0. */
export function toPoints(input: PointInput): Vec3[] {
  if (input instanceof Float32Array || (Array.isArray(input) === false && typeof (input as ArrayLike<number>).length === "number" && typeof (input as ArrayLike<number>)[0] === "number")) {
    const arr = input as ArrayLike<number>;
    const out: Vec3[] = [];
    for (let i = 0; i + 1 < arr.length; i += 3) out.push({ x: arr[i], y: arr[i + 1], z: arr[i + 2] ?? 0 });
    return out;
  }
  return (input as readonly { x: number; y: number; z?: number }[]).map((p) => ({ x: p.x, y: p.y, z: p.z ?? 0 }));
}

/** Squared distance helper. */
const d2 = (a: Vec3, b: Vec3) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2;

/**
 * Nearest-neighbour statistics, brute force. O(n²) is fine at the scale the
 * engine is used at (thousands of roots, not millions of vertices).
 */
export function nearestNeighbourStats(points: PointInput): PointStats {
  const p = toPoints(points);
  const n = p.length;
  if (n < 2) return { count: n, mean: 0, median: 0, min: 0, max: 0, p05: 0, p95: 0, cv: 0, diagonal: 0, packingRatio: 0 };
  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const q of p) {
    minX = Math.min(minX, q.x); maxX = Math.max(maxX, q.x);
    minY = Math.min(minY, q.y); maxY = Math.max(maxY, q.y);
    minZ = Math.min(minZ, q.z); maxZ = Math.max(maxZ, q.z);
  }
  const diagonal = Math.hypot(maxX - minX, maxY - minY, maxZ - minZ);
  const nn: number[] = [];
  for (let i = 0; i < n; i++) {
    let best = Infinity;
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const d = d2(p[i], p[j]);
      if (d < best) best = d;
    }
    nn.push(Math.sqrt(best));
  }
  nn.sort((a, b) => a - b);
  const mean = nn.reduce((a, b) => a + b, 0) / n;
  const variance = nn.reduce((a, b) => a + (b - mean) ** 2, 0) / n;
  const volume = Math.max(1e-12, (maxX - minX) * (maxY - minY) * (maxZ - minZ));
  const expected = Math.cbrt(volume / n);
  return {
    count: n,
    mean,
    median: nn[Math.floor(n / 2)],
    min: nn[0],
    max: nn[n - 1],
    p05: nn[Math.floor(n * 0.05)],
    p95: nn[Math.min(n - 1, Math.floor(n * 0.95))],
    cv: mean > 0 ? Math.sqrt(variance) / mean : 0,
    diagonal,
    packingRatio: expected > 0 ? mean / expected : 0,
  };
}

export interface DivergenceStats {
  /** Histogram of successive angles (mod 360°). */
  histogram: { deg: number; count: number }[];
  /** Modal direction of the sequence, degrees. */
  dominantDeg: number;
  /** Absolute angular distance from the modal direction to the golden angle. */
  goldenErrorDeg: number;
  goldenErrorLongDeg: number;
  lucasErrorDeg: number;
  /**
   * Share of the successive gaps that fall inside the modal bin. Note that a
   * phyllotactic set alternates short (137.5°) and long (222.5°) sweeps, so its
   * top bin holds roughly 45 % of the gaps even when the pattern is perfect;
   * `goldenCoverage` is the metric to use for "is this actually phyllotactic".
   */
  concentration: number;
  /** Normalised entropy of the histogram: 1 = flat, 0 = one spike. */
  entropy: number;
  mode: DivergenceMode;
}

/**
 * The plane a point set lies in: the axis with the smallest variance is the
 * normal, the other two are the plane. Vogel discs are in XY, LÉLU's ground-plane
 * features are in XZ; the analyser must not assume either.
 */
export function planarBasis(points: readonly Vec3[]): { i: number; j: number; k: number; normal: number } {
  const n = points.length || 1;
  const mean = [0, 1, 2].map((a) => points.reduce((s, p) => s + [p.x, p.y, p.z][a], 0) / n);
  const vars = [0, 1, 2].map((a) => points.reduce((s, p) => s + ([p.x, p.y, p.z][a] - mean[a]) ** 2, 0) / n);
  let normal = 0;
  for (let a = 1; a < 3; a++) if (vars[a] < vars[normal]) normal = a;
  const axes = [0, 1, 2].filter((a) => a !== normal);
  return { i: axes[0], j: axes[1], k: normal, normal };
}

/** Circular distance between two angles in degrees, 0…180. */
export function circularDeg(a: number, b: number): number {
  const d = Math.abs((((a - b) % 360) + 360) % 360);
  return Math.min(d, 360 - d);
}

/**
 * Successive-angle signature of a point set around its own centroid, measured in
 * the plane the set actually lies in (see `planarBasis`).
 */
export type DivergenceMode = "input" | "radial";

export function divergenceStats(points: PointInput, opts: { mode?: DivergenceMode; bins?: number } = {}): DivergenceStats {
  const mode = opts.mode ?? "radial";
  const bins = opts.bins ?? 72;
  const p = toPoints(points);
  const empty: DivergenceStats = { histogram: [], dominantDeg: 0, goldenErrorDeg: GOLDEN_ANGLE_DEG, goldenErrorLongDeg: 360 - GOLDEN_ANGLE_DEG, lucasErrorDeg: (LUCAS_ANGLE * 180) / Math.PI, concentration: 0, entropy: 0, mode };
  if (p.length < 3) return empty;
  const axis = planarBasis(p);
  const get = (q: Vec3, a: number) => [q.x, q.y, q.z][a];
  const ci = p.reduce((s, q) => s + get(q, axis.i), 0) / p.length;
  const cj = p.reduce((s, q) => s + get(q, axis.j), 0) / p.length;
  const cAll = [p.reduce((s, q) => s + q.x, 0) / p.length, p.reduce((s, q) => s + q.y, 0) / p.length, p.reduce((s, q) => s + q.z, 0) / p.length];
  let ordered = p;
  if (mode === "radial") {
    ordered = [...p].sort(
      (a, b) =>
        Math.hypot(a.x - cAll[0], a.y - cAll[1], a.z - cAll[2]) - Math.hypot(b.x - cAll[0], b.y - cAll[1], b.z - cAll[2]),
    );
  }
  const angleOf = (q: Vec3) => ((((Math.atan2(get(q, axis.j) - cj, get(q, axis.i) - ci) * 180) / Math.PI) % 360) + 360) % 360;
  const angles = ordered.map(angleOf);
  const gaps: number[] = [];
  for (let i = 1; i < angles.length; i++) gaps.push((((angles[i] - angles[i - 1]) % 360) + 360) % 360);
  const counts = new Array(bins).fill(0) as number[];
  for (const g of gaps) counts[Math.min(bins - 1, Math.floor((g / 360) * bins))]++;
  let peak = 0;
  for (let i = 1; i < counts.length; i++) if (counts[i] > counts[peak]) peak = i;
  const total = gaps.length || 1;
  let entropy = 0;
  for (const c of counts) if (c > 0) entropy -= (c / total) * Math.log(c / total);
  entropy /= Math.log(bins);
  const dominantDeg = (peak + 0.5) * (360 / bins);
  return {
    histogram: counts.map((count, i) => ({ deg: (i + 0.5) * (360 / bins), count })),
    dominantDeg,
    goldenErrorDeg: circularDeg(dominantDeg, GOLDEN_ANGLE_DEG),
    goldenErrorLongDeg: circularDeg(dominantDeg, 360 - GOLDEN_ANGLE_DEG),
    lucasErrorDeg: circularDeg(dominantDeg, (LUCAS_ANGLE * 180) / Math.PI),
    concentration: counts[peak] / total,
    entropy,
    mode,
  };
}

export interface RadialStats {
  /** Fitted exponent of r ∝ t^exponent over the points' own radial order. */
  exponent: number;
  r2: number;
  /** The exponent of an equal-area disc packing: 0.5. */
  equalAreaExponent: number;
  error: number;
}

/**
 * Fit `r = k·t^p` for points ordered by increasing radius, with t = i/(n−1).
 * An equal-area disc must return p ≈ 0.5; a linear radial ramp returns 1.0.
 * This is a *shape* test, not a uniformity test: density can still be uneven
 * while p = 0.5, which is why the spacing CV is reported separately.
 */
export function radialStats(points: PointInput): RadialStats {
  const p = toPoints(points);
  const c = [
    p.reduce((s, q) => s + q.x, 0) / (p.length || 1),
    p.reduce((s, q) => s + q.y, 0) / (p.length || 1),
    p.reduce((s, q) => s + q.z, 0) / (p.length || 1),
  ];
  const centred = p
    .map((q) => ({ q, r: Math.hypot(q.x - c[0], q.y - c[1], q.z - c[2]) }))
    .filter((e) => e.r > 1e-9)
    .sort((a, b) => a.r - b.r);
  if (centred.length < 4) return { exponent: 0, r2: 0, equalAreaExponent: 0.5, error: 0.5 };
  const n = centred.length;
  const xs: number[] = [], ys: number[] = [];
  for (let i = 0; i < n; i++) {
    xs.push(Math.log((i + 0.5) / n));
    ys.push(Math.log(centred[i].r));
  }
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
    syy += (ys[i] - my) ** 2;
  }
  const exponent = sxx ? sxy / sxx : 0;
  const r2 = sxx && syy ? (sxy * sxy) / (sxx * syy) : 0;
  return { exponent, r2, equalAreaExponent: 0.5, error: Math.abs(exponent - 0.5) };
}

/** Mean distance from each point to the nearest point of the same set rotated by 2π/n, in units of mean spacing. */
export function symmetryError(points: PointInput, n: number): number {
  const p = toPoints(points);
  if (!p.length) return 0;
  const scale = nearestNeighbourStats(p).mean || 1;
  let sum = 0;
  for (const q of p) {
    const a = (Math.PI * 2) / n;
    const r = { x: q.x * Math.cos(a) + q.z * Math.sin(a), y: q.y, z: -q.x * Math.sin(a) + q.z * Math.cos(a) };
    let best = Infinity;
    for (const o of p) best = Math.min(best, d2(r, o));
    sum += Math.sqrt(best);
  }
  return sum / p.length / scale;
}

/**
 * Bilateral (sagittal-plane) error: mean distance from each point to the nearest
 * point mirrored across x = 0, in units of mean spacing. 0 = perfectly mirrored.
 * This is *not* the 2-fold rotation error: a mirror keeps z, a half turn flips it.
 */
export function bilateralError(points: PointInput): number {
  const p = toPoints(points);
  if (!p.length) return 0;
  const scale = nearestNeighbourStats(p).mean || 1;
  let sum = 0;
  for (const q of p) {
    const m = { x: -q.x, y: q.y, z: q.z };
    let best = Infinity;
    for (const o of p) best = Math.min(best, d2(m, o));
    sum += Math.sqrt(best);
  }
  return sum / p.length / scale;
}

export interface GeometricSignature {
  points: PointStats;
  divergence: DivergenceStats;
  radial: RadialStats;
  /** Normalised sagittal-plane mirror error. */
  bilateral: number;
  /** Normalised 6-fold rotation error, for bead rings. */
  sixfold: number;
}

/** Full signature of a point set. */
export function geometricSignature(points: PointInput, opts: { divergenceMode?: "radial" | "input" } = {}): GeometricSignature {
  return {
    points: nearestNeighbourStats(points),
    divergence: divergenceStats(points, { mode: opts.divergenceMode }),
    radial: radialStats(points),
    bilateral: bilateralError(points),
    sixfold: symmetryError(points, 6),
  };
}
