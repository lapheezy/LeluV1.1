/**
 * Shapes = SDF + conservative bounds + colour. Bounds let each component be
 * sampled only inside its own box; colour is taken from the nearest
 * sub-shape so one component mesh can carry several materials as vertex
 * colours (eyes vs skin, brim vs crown…).
 */
import * as S from "./sdf.ts";
import type { Sdf, V3 } from "./sdf.ts";
import type { Mesh } from "../volume/mesh.ts";

export type Rgb = [number, number, number];

export interface Shape {
  f: Sdf;
  lo: V3;
  hi: V3;
  color: (x: number, y: number, z: number) => Rgb;
  /**
   * Sub-shapes whose bounding boxes do not overlap (e.g. the two hands, the
   * two feet). Purely a sampling hint: the builder may mesh each of them in
   * its own box instead of the union box, which is the same geometry for a
   * fraction of the samples. Never set it on parts that can touch.
   */
  parts?: Shape[];
  /**
   * An explicit render mesh in the shape's own frame. When present the
   * builder uses these triangles as the component's mesh instead of
   * re-meshing `f`, while occupancy is still `f` sampled on the shared
   * lattice — so every cell-indexed invariant is unchanged and the visible
   * surface keeps a real asset's topology. Vertex colours are taken from
   * `color` unless the mesh already carries them.
   */
  mesh?: Mesh;
}

const flat = (c: Rgb) => () => c;
const box = (lo: V3, hi: V3, pad = 0): [V3, V3] => [
  [lo[0] - pad, lo[1] - pad, lo[2] - pad],
  [hi[0] + pad, hi[1] + pad, hi[2] + pad],
];

export const sphere = (c: V3, r: number, color: Rgb): Shape => ({ f: S.sphere(c, r), ...bb(box(c, c, r)), color: flat(color) });
export const ellipsoid = (c: V3, r: V3, color: Rgb): Shape => ({ f: S.ellipsoid(c, r), ...bb(box([c[0] - r[0], c[1] - r[1], c[2] - r[2]], [c[0] + r[0], c[1] + r[1], c[2] + r[2]])), color: flat(color) });
export const capsule = (a: V3, b: V3, ra: number, rb: number, color: Rgb): Shape => {
  const r = Math.max(ra, rb);
  return { f: S.capsule(a, b, ra, rb), ...bb(box([Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.min(a[2], b[2])], [Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.max(a[2], b[2])], r)), color: flat(color) };
};
export const roundBox = (c: V3, half: V3, r: number, color: Rgb): Shape => ({ f: S.roundBox(c, half, r), ...bb(box([c[0] - half[0], c[1] - half[1], c[2] - half[2]], [c[0] + half[0], c[1] + half[1], c[2] + half[2]])), color: flat(color) });
export const torus = (c: V3, R: number, r: number, axis: 0 | 1 | 2, color: Rgb): Shape => {
  const e: V3 = [R + r, R + r, R + r];
  e[axis] = r;
  return { f: S.torus(c, R, r, axis), ...bb(box([c[0] - e[0], c[1] - e[1], c[2] - e[2]], [c[0] + e[0], c[1] + e[1], c[2] + e[2]])), color: flat(color) };
};

function bb([lo, hi]: [V3, V3]) {
  return { lo, hi };
}

function mergeBounds(shapes: Shape[]): { lo: V3; hi: V3 } {
  const lo: V3 = [Infinity, Infinity, Infinity], hi: V3 = [-Infinity, -Infinity, -Infinity];
  for (const s of shapes)
    for (let a = 0; a < 3; a++) {
      lo[a] = Math.min(lo[a], s.lo[a]);
      hi[a] = Math.max(hi[a], s.hi[a]);
    }
  return { lo, hi };
}

function nearestColor(shapes: Shape[]) {
  return (x: number, y: number, z: number): Rgb => {
    let best = shapes[0], d = Infinity;
    for (const s of shapes) {
      const v = s.f(x, y, z);
      if (v < d) [d, best] = [v, s];
    }
    return best.color(x, y, z);
  };
}

export function union(...shapes: Shape[]): Shape {
  return { f: S.union(...shapes.map((s) => s.f)), ...mergeBounds(shapes), color: nearestColor(shapes) };
}

/**
 * A union that declares its members as separate parts. Only for members that
 * cannot touch: the builder is then allowed to sample each in its own box.
 */
export function group(...shapes: Shape[]): Shape {
  return { ...union(...shapes), parts: shapes };
}

export function smooth(k: number, ...shapes: Shape[]): Shape {
  const m = mergeBounds(shapes);
  return { f: S.smooth(k, ...shapes.map((s) => s.f)), lo: m.lo.map((v) => v - k) as V3, hi: m.hi.map((v) => v + k) as V3, color: nearestColor(shapes) };
}

/** Keep `a` where every mask SDF is negative (bounds stay a's: conservative). */
export function clip(a: Shape, ...masks: Sdf[]): Shape {
  return { f: S.intersect(a.f, ...masks), lo: a.lo, hi: a.hi, color: a.color };
}

/**
 * Clip with a crease rounded over k metres. Use it where a cut surface meets
 * the body at a grazing angle (wrists, ankles): a sharp crease there is not a
 * distance field and meshes into non-manifold pinches.
 */
export function softClip(a: Shape, k: number, ...masks: Sdf[]): Shape {
  return { f: S.smoothIntersect(k, a.f, ...masks), lo: a.lo, hi: a.hi, color: a.color };
}

export function subtract(a: Shape, b: Sdf): Shape {
  return { f: S.subtract(a.f, b), lo: a.lo, hi: a.hi, color: a.color };
}

/** Garment/hair shell around a body shape: from `gap` to `gap + t` outside its surface. */
export function shellOf(base: Shape, gap: number, t: number, color: Rgb): Shape {
  const pad = gap + t;
  return { f: S.shell(base.f, gap, t), lo: base.lo.map((v) => v - pad) as V3, hi: base.hi.map((v) => v + pad) as V3, color: flat(color) };
}

export function inflate(base: Shape, d: number, color?: Rgb): Shape {
  return { f: S.offset(base.f, d), lo: base.lo.map((v) => v - d) as V3, hi: base.hi.map((v) => v + d) as V3, color: color ? flat(color) : base.color };
}
