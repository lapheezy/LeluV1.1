/**
 * ==========================================================
 * LÉLU 2 — GOLDEN GEOMETRY — PHYLLOTAXIS
 *
 * Vogel's model, the geometor growth frame, and the general divergence-sweep
 * family. Two implementations were read to write this:
 *
 *   geometor/phyllotaxis — `planar.get_node_points` (radius N − i, angle i·sweep)
 *                          and `angles.sweep_phi_short` (2π/φ²)
 *   HollandRisley/sacred-sandbox — `geometry/fibonacci.js` `phyllotaxis(n, radius)`
 *                          (θ = i·GOLDEN_ANGLE, r = R·√((i+0.5)/n))
 *
 * They are the same law with different radial normalisation. Both are kept
 * because they are useful for different jobs: Vogel for filling a *disc* of
 * fixed area (beads, studs, seed heads), geometor's frame for a *growing*
 * meristem where the newest primordium is at the rim.
 *
 * Neither repository is vendored: this is a reimplementation of the published
 * mathematics in LÉLU's own units and types, with the MIT notices recorded in
 * `research/LICENSES.md`.
 * ==========================================================
 */
import { GOLDEN_ANGLE, GOLDEN_ANGLE_DEG } from "./constants.ts";

export interface PhylloPoint {
  /** Position in the plane (metres or unitless, whatever `radius` is). */
  x: number;
  y: number;
  /** Polar coordinates. */
  r: number;
  theta: number;
  /** Index in the growth order, 0 = oldest. */
  index: number;
  /** Index normalised to [0,1). */
  t: number;
  /** 0..1 edge weight: 0 at the centre, 1 at the rim. */
  edge: number;
}

export interface VogelOptions {
  /** Disc radius. */
  radius: number;
  /** Divergence sweep in radians (default: golden angle). */
  sweep?: number;
  /** Rotation applied to the whole pattern, radians. */
  phase?: number;
  /** Centre of the disc. */
  cx?: number;
  cy?: number;
  /**
   * Radial exponent. 0.5 is Vogel's equal-area packing. Values below 0.5 push
   * points outward, above pull them in — the lever for "is this pattern really
   * equal-area" experiments.
   */
  exponent?: number;
}

/**
 * Vogel's phyllotaxis: `n` points on a disc, each turned by the divergence
 * sweep, at radius ∝ √i so every point owns the same area.
 */
export function vogel(n: number, opts: VogelOptions): PhylloPoint[] {
  const sweep = opts.sweep ?? GOLDEN_ANGLE;
  const phase = opts.phase ?? 0;
  const cx = opts.cx ?? 0;
  const cy = opts.cy ?? 0;
  const exponent = opts.exponent ?? 0.5;
  const out: PhylloPoint[] = [];
  for (let i = 0; i < n; i++) {
    const theta = i * sweep + phase;
    const t = (i + 0.5) / n;
    const r = opts.radius * Math.pow(t, exponent);
    out.push({ x: cx + Math.cos(theta) * r, y: cy + Math.sin(theta) * r, r, theta, index: i, t: i / n, edge: Math.min(1, Math.sqrt(t)) });
  }
  return out;
}

/**
 * geometor's growth frame: node `i` of `numNodes` sits at radius `numNodes − i`
 * and angle `i·sweep`, so the newest primordium is at the rim and the oldest
 * recedes to the centre. Returns radii in *nodes*, not metres.
 */
export function growthFrame(numNodes: number, sweep = GOLDEN_ANGLE): PhylloPoint[] {
  const out: PhylloPoint[] = [];
  for (let i = 0; i < numNodes; i++) {
    const theta = i * sweep;
    const r = numNodes - i;
    out.push({ x: Math.cos(theta) * r, y: Math.sin(theta) * r, r, theta, index: i, t: i / Math.max(1, numNodes - 1), edge: i / Math.max(1, numNodes - 1) });
  }
  return out;
}

/** The divergence sequence in degrees, for analysis of a real point set. */
export function divergenceDegrees(n: number, sweepDeg = GOLDEN_ANGLE_DEG): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push((i * sweepDeg) % 360);
  return out;
}

/**
 * Fibonacci parastichy counts: the number of visible spiral arms in a
 * phyllotactic pattern is a pair of consecutive Fibonacci numbers whose sum is
 * the next. `arms(n)` returns the pair bracketing `n` — used to choose strand
 * and bead counts that read as Fibonacci arms instead of an arbitrary integer.
 */
export function parastichyPair(n: number): [number, number] {
  let a = 1, b = 1;
  // Stop on the pair whose sum is the *largest* ≤ n: for n = 21 that is 8 and 13.
  while (a + b < n) {
    const t = a + b;
    a = b;
    b = t;
  }
  return [a, b];
}

/**
 * Points on a *cylinder* (a lock, a hoop, a bracelet): the 2D pattern wrapped
 * around a tube of radius `radius`, advancing along `height`. This is how
 * phyllotaxis becomes three-dimensional ornament rather than a flat rosette.
 */
export function cylindricalPhyllotaxis(n: number, radius: number, height: number, opts: { sweep?: number; phase?: number } = {}): { x: number; y: number; z: number; theta: number; u: number }[] {
  const sweep = opts.sweep ?? GOLDEN_ANGLE;
  const phase = opts.phase ?? 0;
  const out: { x: number; y: number; z: number; theta: number; u: number }[] = [];
  for (let i = 0; i < n; i++) {
    const theta = i * sweep + phase;
    const u = (i + 0.5) / n;
    out.push({ x: Math.cos(theta) * radius, y: Math.sin(theta) * radius, z: (u - 0.5) * height, theta, u });
  }
  return out;
}
