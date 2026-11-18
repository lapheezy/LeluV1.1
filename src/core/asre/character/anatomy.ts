/**
 * ==========================================================
 * LÉLU ASRE — ANATOMICAL SHAPE VOCABULARY (Mission 5.8 / WP02)
 *
 * The 5.8 audit found the character's SHAPES, not its meshing, were the
 * defect: hands were one capsule each. This module holds reusable,
 * PARAMETRIC anatomy, authored in a local frame that `placeLocal()` puts into
 * the body:
 *
 *   basisFrom(origin, along, dorsalHint)  an orthonormal frame
 *   placeLocal(shape, basis)              evaluate a local shape in world space
 *   mirrorX(shape)                        the other side of the body
 *   tube(points, radii)                   a continuous profile-driven limb
 *   handSkeleton(spec)                    the joints: digits, knuckles, tips
 *   handLocal(spec)                       the surface built around them
 *
 * Separating the skeleton from the surface means articulation is measured at
 * real joint positions (`handSkeleton().tips`) instead of guessed from pixels,
 * and the same numbers can drive rigging later.
 *
 * Everything stays a signed distance function, so it drops into the existing
 * component/key/cache/NRE machinery unchanged: a component is still one SDF
 * sampled on its own lattice and meshed with surface nets.
 * ==========================================================
 */

import type { CharacterSpec } from "./CharacterSpec.ts";
import type { V3 } from "./sdf.ts";
import { capsule, ellipsoid, inflate, roundBox, smooth, sphere, union, type Rgb, type Shape } from "./shape.ts";

/* --------------------------------- vectors --------------------------------- */

export const vadd = (a: V3, b: V3, s = 1): V3 => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];
export const vsub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const vmul = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
export const vdot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const vcross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const vlen = (a: V3): number => Math.hypot(a[0], a[1], a[2]);
export const vnorm = (a: V3): V3 => {
  const l = vlen(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
export const rad = (deg: number): number => (deg * Math.PI) / 180;

/* --------------------------------- frames --------------------------------- */

/** An orthonormal frame: origin + three orthonormal axes. */
export interface Basis {
  o: V3;
  ex: V3;
  ey: V3;
  ez: V3;
}

/**
 * Frame whose +Y is `along` and whose +Z is `dorsalHint` made perpendicular to
 * it. The hint is rejected (not silently used) if it is parallel to `along`,
 * so an arm raised sideways cannot produce a degenerate frame.
 */
export function basisFrom(origin: V3, along: V3, dorsalHint: V3): Basis {
  const ey = vnorm(along);
  const candidates: V3[] = [dorsalHint, [0, 1, 0], [1, 0, 0], [0, 0, 1]];
  let perp: V3 | null = null;
  for (const c of candidates) {
    const p = vsub(c, vmul(ey, vdot(c, ey)));
    if (vlen(p) > 0.25) {
      perp = p;
      break;
    }
  }
  const ez = vnorm(perp ?? [0, 1, 0]);
  return { o: origin, ex: vnorm(vcross(ey, ez)), ey, ez };
}

/** Conservative world bounds of a local box placed in a basis (the 8 corners). */
function placedBounds(lo: V3, hi: V3, b: Basis): { lo: V3; hi: V3 } {
  const outLo: V3 = [Infinity, Infinity, Infinity];
  const outHi: V3 = [-Infinity, -Infinity, -Infinity];
  for (const x of [lo[0], hi[0]])
    for (const y of [lo[1], hi[1]])
      for (const z of [lo[2], hi[2]]) {
        const w = vadd(b.o, vadd(vmul(b.ex, x), vadd(vmul(b.ey, y), vmul(b.ez, z))));
        for (let a = 0; a < 3; a++) {
          if (w[a] < outLo[a]) outLo[a] = w[a];
          if (w[a] > outHi[a]) outHi[a] = w[a];
        }
      }
  return { lo: outLo, hi: outHi };
}

/** Evaluate a shape authored in a local frame in world space. */
export function placeLocal(s: Shape, b: Basis): Shape {
  const toLocal = (x: number, y: number, z: number): V3 => {
    const p: V3 = [x - b.o[0], y - b.o[1], z - b.o[2]];
    return [vdot(p, b.ex), vdot(p, b.ey), vdot(p, b.ez)];
  };
  const { lo, hi } = placedBounds(s.lo, s.hi, b);
  return {
    f: (x, y, z) => {
      const p = toLocal(x, y, z);
      return s.f(p[0], p[1], p[2]);
    },
    lo,
    hi,
    color: (x, y, z) => {
      const p = toLocal(x, y, z);
      return s.color(p[0], p[1], p[2]);
    },
  };
}

/** The same shape on the other side of the body (a reflection, not a rotation). */
export function mirrorX(s: Shape): Shape {
  return {
    f: (x, y, z) => s.f(-x, y, z),
    lo: [-s.hi[0], s.lo[1], s.lo[2]],
    hi: [-s.lo[0], s.hi[1], s.hi[2]],
    color: (x, y, z) => s.color(-x, y, z),
  };
}

/**
 * A continuous, profile-driven limb: one smooth surface through every point,
 * instead of separate capsules that meet in a visible seam. `blend` is the
 * smooth-union radius, so the surface stays tangent across each joint.
 */
export function tube(points: V3[], radii: number[], color: Rgb, blend = 0.012): Shape {
  const parts: Shape[] = [];
  for (let i = 0; i + 1 < points.length; i++) parts.push(capsule(points[i], points[i + 1], radii[i], radii[i + 1] ?? radii[i], color));
  if (parts.length === 1) return parts[0];
  return smooth(blend, ...parts);
}

/* ---------------------------------- hands ---------------------------------- */

/** Closest distance between two 3D segments (the standard clamped solve). */
export function segSegDistance(p1: V3, q1: V3, p2: V3, q2: V3): number {
  const d1 = vsub(q1, p1), d2 = vsub(q2, p2), r = vsub(p1, p2);
  const a = vdot(d1, d1), e = vdot(d2, d2), f = vdot(d2, r);
  const EPS = 1e-12;
  let s = 0, t = 0;
  if (a <= EPS && e <= EPS) return vlen(vsub(p1, p2));
  if (a <= EPS) t = Math.max(0, Math.min(1, f / e));
  else {
    const c = vdot(d1, r);
    if (e <= EPS) s = Math.max(0, Math.min(1, -c / a));
    else {
      const b = vdot(d1, d2), denom = a * e - b * b;
      s = denom !== 0 ? Math.max(0, Math.min(1, (b * f - c * e) / denom)) : 0;
      t = (b * s + f) / e;
      if (t < 0) { t = 0; s = Math.max(0, Math.min(1, -c / a)); }
      else if (t > 1) { t = 1; s = Math.max(0, Math.min(1, (b - c) / a)); }
    }
  }
  return vlen(vsub(vadd(p1, vmul(d1, s)), vadd(p2, vmul(d2, t))));
}

/** One digit: its joint chain and the radius at each joint. */
export interface DigitChain {
  points: V3[];
  radii: number[];
}

export interface HandSkeleton {
  /** Height/build scale applied to every dimension. */
  scale: number;
  wrist: [V3, V3];
  palm: { center: V3; half: V3 };
  thenar: { center: V3; radii: V3 };
  hypothenar: { center: V3; radii: V3 };
  knuckleRidge: { center: V3; radii: V3 };
  /** Index, middle, ring, little — three phalanges each, base joint first. */
  digits: DigitChain[];
  thumb: DigitChain;
  /** Fingertip of each digit (+X side thumb), in the hand's own frame. */
  tips: V3[];
  thumbTip: V3;
  /** Metacarpophalangeal joints, base of each digit. */
  knuckles: V3[];
}

/**
 * The joints of the hand. `curl` bends each interphalangeal joint (0 = flat,
 * 2 = clenched), `spread` fans the digits, `opposition` carries the thumb
 * across the palm. Every dimension scales with body height and build.
 */
export function handSkeleton(spec: CharacterSpec): HandSkeleton {
  const k = spec.body.height / 1.7;
  const kb = Math.pow(spec.body.build, 0.5);
  const s = (v: number) => v * k;
  const r = (v: number) => v * k * kb;
  const curlF = Math.max(0, Math.min(2, spec.hands.curl));
  const spread = Math.max(0, Math.min(1, spec.hands.spread));
  const opp = Math.max(0, Math.min(1, spec.hands.opposition));

  // curl grows monotonically with the flexion parameter; the proximal joint
  // leads, as a real finger does
  const flexion: V3 = [10 + 22 * curlF, 12 + 30 * curlF, 6 + 18 * curlF];

  const fingerDefs: Array<{ base: V3; lengths: V3; radii: [number, number, number, number]; fan: number }> = [
    // Metacarpal spacing is 18 mm and the digits fan outward: every
    // interdigital gap must stay at least two cells wide at the hand's mesh
    // resolution, because a lattice sampling a 1-cell gap is what produces
    // non-manifold edges (measured, see m58-diag-edges.ts).
    { base: [s(0.0285), s(0.086), s(0.002)], lengths: [s(0.038), s(0.023), s(0.019)] as V3, radii: [r(0.008), r(0.0073), r(0.0064), r(0.0053)], fan: 0.22 * spread },
    { base: [s(0.0095), s(0.089), s(0.002)], lengths: [s(0.042), s(0.027), s(0.020)] as V3, radii: [r(0.0083), r(0.0075), r(0.0065), r(0.0055)], fan: 0.07 * spread },
    { base: [s(-0.0095), s(0.087), s(0.002)], lengths: [s(0.039), s(0.025), s(0.019)] as V3, radii: [r(0.0078), r(0.0071), r(0.0062), r(0.0052)], fan: -0.07 * spread },
    { base: [s(-0.0285), s(0.082), s(0.002)], lengths: [s(0.03), s(0.019), s(0.017)] as V3, radii: [r(0.0068), r(0.0062), r(0.0055), r(0.0047)], fan: -0.24 * spread },
  ];

  const digits: DigitChain[] = fingerDefs.map((f) => {
    const points: V3[] = [f.base];
    const radii: number[] = [f.radii[0]];
    let angle = 0;
    for (let i = 0; i < 3; i++) {
      angle += flexion[i];
      const dir: V3 = [f.fan, Math.cos(rad(angle)), -Math.sin(rad(angle))];
      points.push(vadd(points[i], vmul(dir, f.lengths[i])));
      radii.push(f.radii[i + 1]);
    }
    return { points, radii };
  });

  // The thumb rides the radial border, clear of the index base: a thumb that
  // grazes the index leaves a sub-cell sliver between two surfaces.
  const cmc: V3 = [s(0.034), s(0.026), s(-0.006)];
  const tdir = vnorm([0.66 - 0.34 * opp, 0.58, -0.28 - 0.42 * opp]);
  const mcp = vadd(cmc, vmul(tdir, s(0.03)));
  const flex = rad(16 + 22 * curlF);
  const fdir = vnorm([tdir[0] * Math.cos(flex) - tdir[2] * Math.sin(flex), tdir[1], tdir[0] * Math.sin(flex) + tdir[2] * Math.cos(flex)]);
  const ip = vadd(mcp, vmul(fdir, s(0.026)));
  const tip = vadd(ip, vmul(fdir, s(0.022)));
  const thumbPoints: V3[] = [cmc, mcp, ip, tip];
  const thumbRadii = [r(0.0135), r(0.0112), r(0.0096), r(0.0082)];

  // Minimum clearance. Two surfaces closer than one lattice cell are what a
  // surface-nets mesh cannot resolve: it joins them with a 1-cell neck, which
  // is a non-manifold edge (measured at 14 edges before this rule). So the
  // thumb, whose reach depends on opposition and curl, is pushed out along the
  // radial axis until it clears every digit by `minGap`. Deterministic, and it
  // only ever changes how far the thumb travels — never its own shape.
  const minGap = 0.006 * k;
  const clearance = () => {
    let worst = Infinity;
    for (const d of digits)
      for (let i = 0; i + 1 < thumbPoints.length; i++)
        for (let j = 0; j + 1 < d.points.length; j++) {
          const dist = segSegDistance(thumbPoints[i], thumbPoints[i + 1], d.points[j], d.points[j + 1]) - thumbRadii[i] - d.radii[j];
          if (dist < worst) worst = dist;
        }
    return worst;
  };
  for (let iter = 0; iter < 6; iter++) {
    const worst = clearance();
    if (worst >= minGap) break;
    const push = minGap - worst + 0.0005 * k;
    for (const p of thumbPoints) p[0] += push;
  }

  return {
    scale: k,
    wrist: [[0, s(-0.022), 0], [0, s(0.024), 0]],
    palm: { center: [0, s(0.052), 0], half: [s(0.034), s(0.04), r(0.0128)] },
    thenar: { center: [s(0.021), s(0.036), s(-0.002)], radii: [s(0.019), s(0.03), r(0.0145)] },
    hypothenar: { center: [s(-0.024), s(0.042), s(-0.001)], radii: [s(0.014), s(0.031), r(0.0125)] },
    knuckleRidge: { center: [0, s(0.079), s(0.002)], radii: [s(0.032), s(0.013), r(0.012)] },
    digits,
    thumb: { points: thumbPoints, radii: thumbRadii },
    tips: digits.map((d) => d.points[d.points.length - 1]),
    thumbTip: thumbPoints[3],
    knuckles: digits.map((d) => d.points[0]),
  };
}

/**
 * The hand surface in its own frame: +Y along the digits, +Z out of the back
 * of the hand, +X on the thumb side. Canonical (left) hand — `mirrorX` gives
 * the other one, which is why both hands come from one description.
 */
export function handLocal(spec: CharacterSpec): Shape {
  const skin = spec.materials.skin;
  const sk = handSkeleton(spec);
  const k = sk.scale;
  // Gap closing. Two surfaces closer than one lattice cell are the one thing
  // surface nets cannot mesh (it joins them with a 1-cell neck: a
  // non-manifold edge, measured). Shrinking every digit's radius by half a
  // cell and re-inflating the finished hand by the same amount leaves an
  // isolated digit exactly where it was, and makes a sub-cell gap between two
  // digits merge — which is also what fingers do when they touch.
  // The close-out distance is a FIXED property of the shape, never of the
  // lattice: the occupancy build and the whole-object build must agree on the
  // shape, or "components add up to the whole" (IoU 1) stops being true.
  const gap = 0.0015;
  const rd = (r: number) => Math.max(0.0012, r - gap);
  const palmBody = smooth(
    0.012 * k,
    capsule(sk.wrist[0], sk.wrist[1], 0.025 * k * Math.pow(spec.body.build, 0.5), 0.03 * k * Math.pow(spec.body.build, 0.5), skin),
    roundBox(sk.palm.center, sk.palm.half, 0.012 * k, skin),
    ellipsoid(sk.thenar.center, sk.thenar.radii, skin),
    ellipsoid(sk.hypothenar.center, sk.hypothenar.radii, skin),
    ellipsoid(sk.knuckleRidge.center, sk.knuckleRidge.radii, skin),
  );
  const digits: Shape[] = [];
  for (const d of sk.digits) {
    digits.push(tube(d.points, d.radii.map(rd), skin, 0.0035 * k));
    // interphalangeal joints read as real joints, not as a bent tube
    for (let i = 1; i < d.points.length - 1; i++) digits.push(sphere(d.points[i], rd(d.radii[i]) * 1.06, skin));
  }
  digits.push(tube(sk.thumb.points, sk.thumb.radii.map(rd), skin, 0.0035 * k));
  digits.push(sphere(sk.thumb.points[1], rd(sk.thumb.radii[1]) * 1.1, skin), sphere(sk.thumb.points[2], rd(sk.thumb.radii[2]) * 1.06, skin));

  // A HARD union, not a smooth blend, where a digit meets the palm or another
  // digit. A smooth blend there creates a thin wedge of surface between the two
  // parts, and a wedge thinner than one cell is what surface nets meshes as a
  // 1-cell neck — the non-manifold edge the 5.8 benchmark kept catching. A hard
  // union makes a clean concave crease instead, which is also where a real
  // finger joint creases. (Smooth blending is still used *inside* each digit and
  // across the palm's own masses, where it is what makes them one form.)
  return inflate(union(palmBody, union(...digits)), gap);
}
