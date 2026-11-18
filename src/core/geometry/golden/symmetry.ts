/**
 * ==========================================================
 * LÉLU 2 — GOLDEN GEOMETRY — SYMMETRY AND RECURSION
 *
 * Radial symmetry (n-fold rotation about an axis), bilateral mirroring, and
 * self-similar recursive construction. The recursive builder is deliberately
 * angle-and-scale driven rather than "a tree": it is the same primitive used for
 * branching ornament, fractal scrollwork and recursive architectural detail.
 *
 * Scale decay defaults to 1/φ per level, which is the only choice that makes the
 * levels *self-similar* in the strict sense — each level is the previous one
 * rotated and divided by the same factor, so the silhouette is scale-invariant.
 * ==========================================================
 */
import { PHI_INV } from "./constants.ts";
import type { Vec3 } from "./analysis.ts";

// Vec3 is owned by analysis.ts and re-exported once from index.ts; symmetry only
// consumes it, so the engine has one point type rather than two identical ones.
export type { Vec3 };

/** Rotate a point around the Y axis by `angle`, about `centre`. */
export function rotateY(p: Vec3, angle: number, centre: Vec3 = { x: 0, y: 0, z: 0 }): Vec3 {
  const c = Math.cos(angle), s = Math.sin(angle);
  const dx = p.x - centre.x, dz = p.z - centre.z;
  return { x: centre.x + dx * c + dz * s, y: p.y, z: centre.z - dx * s + dz * c };
}

/** n points from one by n-fold rotation about the Y axis. */
export function radialSymmetry(p: Vec3, n: number, centre: Vec3 = { x: 0, y: 0, z: 0 }, phase = 0): Vec3[] {
  const out: Vec3[] = [];
  for (let i = 0; i < n; i++) out.push(rotateY(p, phase + (i * Math.PI * 2) / n, centre));
  return out;
}

/** Mirror across the character's sagittal plane (x = 0). */
export function mirrorX(p: Vec3): Vec3 {
  return { x: -p.x, y: p.y, z: p.z };
}

/** Bilateral closure: the given points plus their mirror images. */
export function bilateralSymmetry(points: readonly Vec3[]): Vec3[] {
  return [...points, ...points.map(mirrorX)];
}

export interface BranchSegment {
  from: Vec3;
  to: Vec3;
  depth: number;
  /** Length of this segment. */
  length: number;
}

export interface RecursiveOptions {
  origin: Vec3;
  direction: Vec3;
  length: number;
  depth: number;
  /** Scale factor per level; 1/φ by default (self-similar). */
  decay?: number;
  /** Halving of the branch angle between children, radians. */
  spread?: number;
  /** Children per node. */
  children?: number;
  /** Twist of the child fan around the parent axis, radians. */
  twist?: number;
}

/**
 * Recursive branching: each segment spawns `children` shorter segments rotated
 * by `spread` from it (and fanned by `twist` around it). Returns every segment
 * with its depth, so a caller can weight geometry or colour per level.
 */
export function recursiveBranches(opts: RecursiveOptions): BranchSegment[] {
  const decay = opts.decay ?? PHI_INV;
  const spread = opts.spread ?? Math.PI / 5;
  const children = opts.children ?? 2;
  const twist = opts.twist ?? Math.PI * 2 * PHI_INV;
  const out: BranchSegment[] = [];
  const norm = (v: Vec3): Vec3 => {
    const l = Math.hypot(v.x, v.y, v.z) || 1;
    return { x: v.x / l, y: v.y / l, z: v.z / l };
  };
  const cross = (a: Vec3, b: Vec3): Vec3 => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
  const step = (origin: Vec3, dir: Vec3, length: number, depth: number) => {
    const d = norm(dir);
    const to = { x: origin.x + d.x * length, y: origin.y + d.y * length, z: origin.z + d.z * length };
    out.push({ from: origin, to, depth, length });
    if (depth + 1 >= opts.depth) return;
    const ref = Math.abs(d.y) > 0.9 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 1, z: 0 };
    const side = norm(cross(d, ref));
    for (let c = 0; c < children; c++) {
      const fan = twist * (c / Math.max(1, children)) + depth * 0.3;
      const a = spread * (c % 2 === 0 ? 1 : -1);
      const child = norm({
        x: d.x * Math.cos(a) + side.x * Math.sin(a) + Math.cos(fan) * 0.12 * side.x,
        y: d.y * Math.cos(a) + side.y * Math.sin(a) + Math.cos(fan) * 0.12 * side.y,
        z: d.z * Math.cos(a) + side.z * Math.sin(a) + Math.cos(fan) * 0.12 * side.z,
      });
      step(to, child, length * decay, depth + 1);
    }
  };
  step(opts.origin, opts.direction, opts.length, 0);
  return out;
}

/** The φ^{-k} scale ladder, for ornaments that step down in golden proportion. */
export function goldenScaleLadder(levels: number, base = 1): number[] {
  const out: number[] = [];
  for (let k = 0; k < levels; k++) out.push(base * Math.pow(PHI_INV, k));
  return out;
}

/** Radial error of a point set about an axis: how evenly the angles are spread. */
export function angularSpread(points: readonly { x: number; z: number }[]): { meanGap: number; gapCv: number } {
  if (points.length < 2) return { meanGap: 0, gapCv: 0 };
  const angles = points.map((p) => Math.atan2(p.z, p.x)).sort((a, b) => a - b);
  const gaps: number[] = [];
  for (let i = 1; i < angles.length; i++) gaps.push(angles[i] - angles[i - 1]);
  gaps.push(angles[0] + Math.PI * 2 - angles[angles.length - 1]);
  const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
  const variance = gaps.reduce((a, b) => a + (b - mean) ** 2, 0) / gaps.length;
  return { meanGap: mean, gapCv: mean > 0 ? Math.sqrt(variance) / mean : 0 };
}
