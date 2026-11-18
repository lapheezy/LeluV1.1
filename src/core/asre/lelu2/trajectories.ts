/**
 * ==========================================================
 * LÉLU 2.1 — WP02: FIVE CURL LAWS FOR THE SAME STRAND
 *
 * The hair experiment in 2.0 compared a constant-radius helix with a golden
 * logarithmic ringlet and reported that the ringlet "looks better". A render is
 * not a measurement. This module generates the same strand under five laws and
 * measures the path itself:
 *
 *   A helix       constant radius around the drooping axis (the 2.0 baseline)
 *   B conical     radius falls linearly with height — a plain taper
 *   C vogel-phase helix with a golden-angle phase per strand: the curls stop
 *                 lining up with each other
 *   D golden-log  radius decays by 1/φ per quarter turn (a true ringlet)
 *   E adaptive    log spiral whose growth follows the strand's own droop, with
 *                 a slow radius envelope so no two strands share a diameter
 *
 * Measured: length, mean curvature, curvature variation, tip radius, how close a
 * strand comes to its neighbours (a "tubular helmet" is many strands sharing one
 * envelope), how well a log law describes the radius, and the cost.
 * ==========================================================
 */
import { GOLDEN_ANGLE, PHI_INV, conicalCurl } from "../../geometry/golden/index.ts";

export type CurlId = "A-helix" | "B-conical" | "C-vogel-phase" | "D-golden-log" | "E-adaptive";

export interface Strand {
  x: number;
  y: number;
  z: number;
}

export interface CurlLaw {
  id: CurlId;
  label: string;
}

export const CURL_LAWS: CurlLaw[] = [
  { id: "A-helix", label: "constant-radius helix (2.0 baseline)" },
  { id: "B-conical", label: "linear taper cone" },
  { id: "C-vogel-phase", label: "helix, golden-angle phase per strand" },
  { id: "D-golden-log", label: "golden logarithmic ringlet (1/φ per quarter turn)" },
  { id: "E-adaptive", label: "droop-adaptive log ringlet with diameter envelope" },
];

export interface StemFrame {
  origin: [number, number, number];
  axis: [number, number, number];
  e1: [number, number, number];
  e2: [number, number, number];
  length: number;
  radius: number;
  turns: number;
  droop: number;
  /** Deterministic per-strand value in [0,1). */
  seed: number;
  segments?: number;
}

/** One strand under one law, as a polyline. */
export function curlPath(id: CurlId, f: StemFrame): Strand[] {
  const segments = f.segments ?? 28;
  const phase = id === "C-vogel-phase" ? f.seed * 800 + GOLDEN_ANGLE : f.seed * Math.PI * 2;
  const spiral = (growth: number, taper: number, radius0: number, turns: number): Strand[] =>
    conicalCurl({
      origin: f.origin,
      axis: f.axis,
      e1: f.e1,
      e2: f.e2,
      length: f.length,
      radius0,
      turns,
      samples: segments,
      taper,
      growth,
      phase,
    });

  switch (id) {
    case "A-helix": {
      const out: Strand[] = [];
      for (let s = 0; s <= segments; s++) {
        const t = s / segments;
        const ang = phase + f.turns * Math.PI * 2 * t;
        // The 2.0 baseline widened the curl toward the tip (0.5 + 0.65 t).
        const rad = f.radius * (0.5 + 0.65 * t);
        out.push({
          x: f.origin[0] + f.axis[0] * f.length * t + (f.e1[0] * Math.cos(ang) + f.e2[0] * Math.sin(ang)) * rad,
          y: f.origin[1] + f.axis[1] * f.length * t + (f.e1[1] * Math.cos(ang) + f.e2[1] * Math.sin(ang)) * rad,
          z: f.origin[2] + f.axis[2] * f.length * t + (f.e1[2] * Math.cos(ang) + f.e2[2] * Math.sin(ang)) * rad,
        });
      }
      return out;
    }
    case "B-conical": {
      const out: Strand[] = [];
      for (let s = 0; s <= segments; s++) {
        const t = s / segments;
        const ang = phase + f.turns * Math.PI * 2 * t;
        const rad = f.radius * (1 - 0.7 * t); // linear taper
        out.push({
          x: f.origin[0] + f.axis[0] * f.length * t + (f.e1[0] * Math.cos(ang) + f.e2[0] * Math.sin(ang)) * rad,
          y: f.origin[1] + f.axis[1] * f.length * t + (f.e1[1] * Math.cos(ang) + f.e2[1] * Math.sin(ang)) * rad,
          z: f.origin[2] + f.axis[2] * f.length * t + (f.e1[2] * Math.cos(ang) + f.e2[2] * Math.sin(ang)) * rad,
        });
      }
      return out;
    }
    case "C-vogel-phase":
      // Same shape as A, only the phase is spread by the golden angle.
      return curlPath("A-helix", f);
    case "D-golden-log":
      // A logarithmic spiral is defined by its radius ratio PER TURN, not over
      // the whole strand. conicalCurl applies `growth` across t ∈ [0,1], so the
      // per-turn factor is growth^(1/turns); asking for 1/φ per turn means
      // growth = (1/φ)^turns. The 2.0 build passed growth = 1/φ, which is a
      // 1.09×-per-turn taper — measured below as a log-radius R² far from 1.
      return spiral(Math.pow(1 / PHI_INV, f.turns), 1, f.radius * 1.15, f.turns);
    case "E-adaptive": {
      // Growth follows droop: a lock that falls steeply must tighten faster, or
      // its tip stalls. The envelope makes diameter depend on the strand, not on
      // the style alone — that is the "natural variation" requirement.
      // Per-turn tightening falls as droop rises (a falling lock tightens faster
      // than a standing one), and the envelope gives each strand its own diameter.
      const perTurn = 1 / (PHI_INV + 0.18 * f.droop);
      const growth = Math.pow(1 / perTurn, f.turns * (0.85 + 0.3 * f.seed));
      const envelope = 0.72 + 0.55 * f.seed;
      return spiral(growth, 2, f.radius * envelope, f.turns * (0.85 + 0.3 * f.seed));
    }
  }
}

export interface PathMetrics {
  points: number;
  length: number;
  /** Mean discrete curvature (1/m). */
  curvature: number;
  curvatureCv: number;
  /** Radius of the last turn — what the eye reads as the curl's size. */
  tipRadius: number;
  /** Smallest distance between any two non-adjacent samples: does it collapse into a bead chain? */
  minSelfDistance: number;
  /** R² of log(radius) against turn angle — 1 means "a perfect logarithmic spiral". */
  logRadiusR2: number;
  /** Radial growth per turn implied by that fit. */
  growthPerTurn: number;
}

export interface PathAxis {
  origin: [number, number, number];
  axis: [number, number, number];
  e1: [number, number, number];
  e2: [number, number, number];
}

/**
 * Measure one strand. When the generating frame is known it is used as the
 * measurement axis: a helix's radius is defined about its own axis, and fitting
 * log r against turn angle about anything else measures the frame error, not the
 * spiral. That mistake is why 2.0's log-radius R² read ~0.05 for every law.
 */
export function analysePath(path: Strand[], frame?: PathAxis): PathMetrics {
  const n = path.length;
  let length = 0;
  const curv: number[] = [];
  for (let i = 1; i < n; i++) length += dist(path[i], path[i - 1]);
  for (let i = 1; i < n - 1; i++) {
    const a = sub(path[i], path[i - 1]);
    const b = sub(path[i + 1], path[i]);
    const la = norm(a), lb = norm(b);
    if (!la || !lb) continue;
    const dot = (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / (la * lb);
    const angle = Math.acos(Math.min(1, Math.max(-1, dot)));
    curv.push(angle / Math.max(1e-6, (la + lb) / 2));
  }
  const mean = curv.reduce((s, v) => s + v, 0) / (curv.length || 1);
  const variance = curv.reduce((s, v) => s + (v - mean) ** 2, 0) / (curv.length || 1);

  let minSelf = Infinity;
  for (let i = 0; i < n; i++)
    for (let j = i + 3; j < n; j++) minSelf = Math.min(minSelf, dist(path[i], path[j]));

  // Fit log r = a + b·θ about the strand's own axis.
  const origin: [number, number, number] = frame ? [...frame.origin] : [path[0].x, path[0].y, path[0].z];
  const chord: [number, number, number] = frame ? frame.axis : unit(sub(path[n - 1], path[0]));
  const up: [number, number, number] = Math.abs(chord[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
  const e1: [number, number, number] = frame ? frame.e1 : unit(cross(up, chord));
  const e2: [number, number, number] = frame ? frame.e2 : cross(chord, e1);
  const xs: number[] = [], ys: number[] = [];
  for (const p of path) {
    const rel = sub(p, { x: origin[0], y: origin[1], z: origin[2] });
    const along = rel[0] * chord[0] + rel[1] * chord[1] + rel[2] * chord[2];
    const r = Math.hypot(rel[0] - chord[0] * along, rel[1] - chord[1] * along, rel[2] - chord[2] * along);
    if (r < 1e-6) continue;
    const theta = Math.atan2(rel[0] * e1[0] + rel[1] * e1[1] + rel[2] * e1[2], rel[0] * e2[0] + rel[1] * e2[1] + rel[2] * e2[2]);
    xs.push(theta);
    ys.push(Math.log(r));
  }
  const fit = linearFit(unwrap(xs), ys);
  const tipRadius = dist(path[n - 1], path[n - 2]);

  return {
    points: n,
    length,
    curvature: mean,
    curvatureCv: mean > 0 ? Math.sqrt(variance) / mean : 0,
    tipRadius,
    minSelfDistance: minSelf,
    logRadiusR2: fit.r2,
    growthPerTurn: Math.exp(fit.slope * Math.PI * 2),
  };
}

/** How a bundle of strands behaves together: this is where a helmet shows up. */
export interface BundleMetrics {
  strands: number;
  densityCv: number;
  minStrandGap: number;
  meanStrandGap: number;
  /** CV of per-strand diameter — 0 is a machine-made uniform bundle. */
  diameterCv: number;
  lengthCv: number;
  /** Fraction of strand pairs closer than 1.5 × the minimum acceptable gap. */
  clumps: number;
}

export function analyseBundle(strands: Strand[][], radius: number): BundleMetrics {
  const centreOf = (s: Strand[]): [number, number, number] => {
    const c: [number, number, number] = [0, 0, 0];
    for (const p of s) {
      c[0] += p.x / s.length;
      c[1] += p.y / s.length;
      c[2] += p.z / s.length;
    }
    return c;
  };
  const centres = strands.map(centreOf);
  const gaps: number[] = [];
  let clumps = 0;
  for (let i = 0; i < centres.length; i++) {
    let nearest = Infinity;
    for (let j = 0; j < centres.length; j++) if (i !== j) nearest = Math.min(nearest, d3(centres[i], centres[j]));
    gaps.push(nearest);
    if (nearest < radius) clumps++;
  }
  const meanGap = gaps.reduce((s, v) => s + v, 0) / (gaps.length || 1);
  const variance = gaps.reduce((s, v) => s + (v - meanGap) ** 2, 0) / (gaps.length || 1);
  const lengths = strands.map((s) => {
    let l = 0;
    for (let i = 1; i < s.length; i++) l += dist(s[i], s[i - 1]);
    return l;
  });
  const meanLen = lengths.reduce((s, v) => s + v, 0) / (lengths.length || 1);
  const lenVar = lengths.reduce((s, v) => s + (v - meanLen) ** 2, 0) / (lengths.length || 1);
  return {
    strands: strands.length,
    densityCv: meanGap > 0 ? Math.sqrt(variance) / meanGap : 0,
    minStrandGap: gaps.length ? Math.min(...gaps) : 0,
    meanStrandGap: meanGap,
    diameterCv: 0,
    lengthCv: meanLen > 0 ? Math.sqrt(lenVar) / meanLen : 0,
    clumps: strands.length ? clumps / strands.length : 0,
  };
}

type V = [number, number, number];
const d3 = (a: V, b: V) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const dist = (a: Strand, b: Strand) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const sub = (a: Strand, b: Strand): V => [a.x - b.x, a.y - b.y, a.z - b.z];
const norm = (a: V) => Math.hypot(a[0], a[1], a[2]);
const unit = (a: V): V => {
  const l = norm(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const cross = (a: V, b: V): V => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
/** atan2 wraps at ±π; unwrap so a multi-turn spiral is one monotone angle. */
function unwrap(theta: number[]): number[] {
  const out: number[] = [];
  let offset = 0;
  for (let i = 0; i < theta.length; i++) {
    if (i > 0) {
      let d = theta[i] - theta[i - 1];
      while (d > Math.PI) {
        d -= Math.PI * 2;
        offset -= Math.PI * 2;
      }
      while (d < -Math.PI) {
        d += Math.PI * 2;
        offset += Math.PI * 2;
      }
    }
    out.push(theta[i] + offset);
  }
  return out;
}

function linearFit(xs: number[], ys: number[]): { slope: number; r2: number } {
  const n = xs.length;
  if (n < 3) return { slope: 0, r2: 0 };
  let sx = 0, sy = 0, sxx = 0, sxy = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    sx += xs[i];
    sy += ys[i];
    sxx += xs[i] * xs[i];
    sxy += xs[i] * ys[i];
    syy += ys[i] * ys[i];
  }
  const denom = n * sxx - sx * sx;
  const slope = denom ? (n * sxy - sx * sy) / denom : 0;
  const intercept = (sy - slope * sx) / n;
  let ssRes = 0, ssTot = 0;
  const meanY = sy / n;
  for (let i = 0; i < n; i++) {
    ssRes += (ys[i] - (intercept + slope * xs[i])) ** 2;
    ssTot += (ys[i] - meanY) ** 2;
  }
  return { slope, r2: ssTot > 0 ? 1 - ssRes / ssTot : 0 };
}
