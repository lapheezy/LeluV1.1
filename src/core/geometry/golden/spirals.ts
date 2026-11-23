/**
 * ==========================================================
 * LÉLU 2 — GOLDEN GEOMETRY — SPIRAL FAMILIES
 *
 * Five families, all returning plain 3D points so they can be rasterised by
 * LÉLU's existing strand/cloth pipelines:
 *
 *   logarithmic   r = a·e^{bθ}        (b = ln φ for the golden spiral)
 *   archimedean   r = a + bθ          (equal spacing per turn)
 *   fermat        r = a·√θ            (equal area per turn)
 *   hyperbolic    r = a/θ             (asymptotic to a line)
 *   lituus        r = a/√θ            (asymptotic to a line, tighter)
 *
 * The golden spiral is the logarithmic spiral whose radius grows by φ every
 * quarter turn, r(θ) = a·φ^{2θ/π}. sacred-sandbox's `goldenSpiral` writes this
 * exactly; the normalisation by φ^{4·turns} that makes it end at `radius` is
 * taken from there, because without it a three-turn spiral overshoots by 322×.
 *
 * `conicalCurl` is the LÉLU-specific one: it turns a *path* into a corkscrew
 * whose radius follows a geometric law along its length — the difference between
 * a telephone cord (constant radius) and an actual ringlet whose tip is tighter
 * than its root.
 * ==========================================================
 */
import { PHI } from "./constants.ts";

export interface SpiralPoint {
  x: number;
  y: number;
  z: number;
  /** Turn parameter, radians. */
  theta: number;
  /** 0..1 along the curve. */
  t: number;
}

/**
 * Logarithmic spiral r = a·e^{bθ}.
 *
 * `growthPerTurn` is how much the radius multiplies over one full turn, so
 * b = ln(growth) / 2π. The golden spiral needs φ per *quarter* turn, i.e. φ⁴ per
 * turn — using ln φ directly here (per radian) is the classic off-by-2π that
 * makes the spiral explode.
 */
export function logarithmicSpiral(opts: { radius: number; turns: number; samples: number; growthPerTurn?: number; phase?: number; rise?: number; b?: number }): SpiralPoint[] {
  const { radius, turns, samples } = opts;
  const growth = opts.growthPerTurn ?? PHI * PHI * PHI * PHI;
  const b = opts.b ?? Math.log(growth) / (Math.PI * 2);
  const phase = opts.phase ?? 0;
  const rise = opts.rise ?? 0;
  const total = turns * Math.PI * 2;
  const norm = b * total;
  const out: SpiralPoint[] = [];
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const theta = t * total + phase;
    // Normalised so the *end* of the spiral is exactly `radius` long.
    const r = radius * Math.exp(b * (theta - phase) - norm);
    out.push({ x: Math.cos(theta) * r, y: Math.sin(theta) * r, z: rise * (t - 0.5) * radius * 2, theta, t });
  }
  return out;
}

/** The golden spiral: r grows by φ every quarter turn (φ⁴ per turn). */
export function goldenSpiral(radius: number, turns: number, samples: number, phase = 0): SpiralPoint[] {
  return logarithmicSpiral({ radius, turns, samples, growthPerTurn: PHI * PHI * PHI * PHI, phase });
}

/** Archimedean spiral r = radius·θ/θmax — equal radial spacing per turn. */
export function archimedeanSpiral(radius: number, turns: number, samples: number, phase = 0): SpiralPoint[] {
  const total = turns * Math.PI * 2;
  const out: SpiralPoint[] = [];
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const theta = t * total + phase;
    const r = (radius * t);
    out.push({ x: Math.cos(theta) * r, y: Math.sin(theta) * r, z: 0, theta, t });
  }
  return out;
}

/** Fermat spiral r = radius·√(θ/θmax) — equal area per turn; the sunflower law. */
export function fermatSpiral(radius: number, turns: number, samples: number, phase = 0): SpiralPoint[] {
  const total = turns * Math.PI * 2;
  const out: SpiralPoint[] = [];
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const theta = t * total + phase;
    const r = radius * Math.sqrt(t);
    out.push({ x: Math.cos(theta) * r, y: Math.sin(theta) * r, z: 0, theta, t });
  }
  return out;
}

/** Hyperbolic spiral r = radius/θ, normalised so the first sample is `radius`. */
export function hyperbolicSpiral(radius: number, turns: number, samples: number, phase = 0): SpiralPoint[] {
  const total = turns * Math.PI * 2;
  const out: SpiralPoint[] = [];
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const theta = 0.25 + t * total + phase;
    const r = (radius * 0.25) / theta;
    out.push({ x: Math.cos(theta) * r, y: Math.sin(theta) * r, z: 0, theta, t });
  }
  return out;
}

/** Lituus r = radius/√θ. */
export function lituusSpiral(radius: number, turns: number, samples: number, phase = 0): SpiralPoint[] {
  const total = turns * Math.PI * 2;
  const out: SpiralPoint[] = [];
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const theta = 0.25 + t * total + phase;
    const r = (radius * Math.sqrt(0.25)) / Math.sqrt(theta);
    out.push({ x: Math.cos(theta) * r, y: Math.sin(theta) * r, z: 0, theta, t });
  }
  return out;
}

export type SpiralFamily = "logarithmic" | "golden" | "archimedean" | "fermat" | "hyperbolic" | "lituus";

export function spiral(family: SpiralFamily, radius: number, turns: number, samples: number): SpiralPoint[] {
  switch (family) {
    case "golden":
      return goldenSpiral(radius, turns, samples);
    case "logarithmic":
      return logarithmicSpiral({ radius, turns, samples, growthPerTurn: PHI * PHI * PHI });
    case "archimedean":
      return archimedeanSpiral(radius, turns, samples);
    case "fermat":
      return fermatSpiral(radius, turns, samples);
    case "hyperbolic":
      return hyperbolicSpiral(radius, turns, samples);
    case "lituus":
      return lituusSpiral(radius, turns, samples);
  }
}

/**
 * A ringlet: a path that advances along `axis` while circling it, with a radius
 * that follows `r(t) = r0·growth^{t^taper}`.
 *
 * `taper` = 0 → constant-radius helix (a telephone cord; what LÉLU's M5.8 hair
 * used). taper = 1 → the radius shrinks geometrically along the lock, which is
 * what a real corkscrew curl does: the tip is a tight ring and the root is wide.
 * The default decay is 1/φ over the whole length.
 */
export function conicalCurl(opts: {
  origin: [number, number, number];
  axis: [number, number, number];
  e1: [number, number, number];
  e2: [number, number, number];
  length: number;
  radius0: number;
  turns: number;
  samples: number;
  taper?: number;
  growth?: number;
  phase?: number;
}): { x: number; y: number; z: number; t: number }[] {
  const { origin, axis, e1, e2, length, radius0, turns, samples } = opts;
  const taper = opts.taper ?? 1;
  const growth = opts.growth ?? 1 / PHI;
  const phase = opts.phase ?? 0;
  const out: { x: number; y: number; z: number; t: number }[] = [];
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const ang = phase + turns * Math.PI * 2 * t;
    const rad = radius0 * Math.pow(growth, Math.pow(t, taper));
    const cx = origin[0] + axis[0] * length * t;
    const cy = origin[1] + axis[1] * length * t;
    const cz = origin[2] + axis[2] * length * t;
    out.push({
      x: cx + (e1[0] * Math.cos(ang) + e2[0] * Math.sin(ang)) * rad,
      y: cy + (e1[1] * Math.cos(ang) + e2[1] * Math.sin(ang)) * rad,
      z: cz + (e1[2] * Math.cos(ang) + e2[2] * Math.sin(ang)) * rad,
      t,
    });
  }
  return out;
}

/**
 * Pitch of a spiral in metres per turn at a given arc position — the quantity
 * that separates a curl (centimetres of pitch over a centimetre of radius) from
 * a wave (metres of pitch).
 */
export function pitchPerTurn(points: readonly { x: number; y: number; z: number; theta?: number }[], turns: number): number {
  if (points.length < 2 || turns <= 0) return 0;
  let len = 0;
  for (let i = 1; i < points.length; i++) len += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y, points[i].z - points[i - 1].z);
  return len / turns;
}

/** Arc length of a polyline. */
export function arcLength(points: readonly { x: number; y: number; z: number }[]): number {
  let len = 0;
  for (let i = 1; i < points.length; i++) len += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y, points[i].z - points[i - 1].z);
  return len;
}

/**
 * The log-radius fit R² of a spiral point set around its own centre: 1.0 is a
 * perfect logarithmic (or archimedean, etc.) spiral, near 0 is a cloud.
 * ln r is regressed on θ; a clean spiral gives a straight line.
 */
export function spiralFit(points: readonly { x: number; y: number; z?: number }[], theta?: readonly number[]): { slope: number; r2: number; growthPerTurn: number } {
  const pts = points.filter((p) => Math.hypot(p.x, p.y) > 1e-9);
  if (pts.length < 3) return { slope: 0, r2: 0, growthPerTurn: 1 };
  let xs: number[];
  let ys: number[];
  if (theta) {
    xs = theta.slice(0, pts.length) as number[];
    ys = pts.map((p) => Math.log(Math.hypot(p.x, p.y)));
  } else {
    // atan2 wraps at ±π, so a spiral with more than one turn looks like noise to
    // a straight regression. Order by radius (a spiral grows outward) and unwrap
    // the angle into a monotone sequence: that reconstructs θ without needing the
    // caller to have kept the generation order.
    const order = pts.map((p) => p).sort((a, b) => Math.hypot(a.x, a.y) - Math.hypot(b.x, b.y));
    xs = [];
    ys = [];
    let unwrapped = Math.atan2(order[0].y, order[0].x);
    xs.push(unwrapped);
    ys.push(Math.log(Math.hypot(order[0].x, order[0].y)));
    for (let k = 1; k < order.length; k++) {
      const a = Math.atan2(order[k].y, order[k].x);
      let d = a - unwrapped;
      while (d <= -Math.PI) d += Math.PI * 2;
      while (d > Math.PI) d -= Math.PI * 2;
      unwrapped += d;
      xs.push(unwrapped);
      ys.push(Math.log(Math.hypot(order[k].x, order[k].y)));
    }
  }
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
    syy += (ys[i] - my) ** 2;
  }
  const slope = sxx ? sxy / sxx : 0;
  const r2 = sxx && syy ? (sxy * sxy) / (sxx * syy) : 0;
  // ln r grows slope per radian ⇒ per turn it multiplies r by e^{2π·slope}.
  // A golden spiral therefore measures φ⁴ ≈ 6.854, not φ.
  return { slope, r2, growthPerTurn: Math.exp(slope * Math.PI * 2) };
}
