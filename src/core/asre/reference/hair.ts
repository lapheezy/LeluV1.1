/**
 * ==========================================================
 * LÉLU ASRE — CORKSCREW CURLS AS STRANDS
 *
 * The old hair stamped every lock as capsules into a 2.5 mm voxel grid and
 * re-meshed the grid with surface nets. At that resolution a 1 cm corkscrew
 * is four voxels across, so every curl became a lumpy blob fused to its
 * neighbours: the "chunky" hair. It was also 22 cm long, where her
 * references (ref01, ref10, hair-back) show waist-length hair.
 *
 * Here every lock is real geometry:
 *
 *   axis    grows from a scalp root along the scalp normal, droops under
 *           gravity with a stiffness that fades away from the root, is kept
 *           outside her head, shoulders and back by her distance field,
 *           parts at the centre, and is kept off her face
 *   coil    a corkscrew around that axis (radius, pitch and phase per lock),
 *           ramping in from a straight root, springing slightly toward the tip
 *   tube    a tapered round profile swept along the coil
 *
 * plus a denser, darker under-layer so no light passes through the mass.
 * Occupancy is the locks' envelopes rasterised into a voxel grid, so the
 * occupancy lattice and its invariants are unchanged in kind.
 * ==========================================================
 */
import type { Sdf, V3 } from "../character/sdf.ts";
import type { Mesh } from "../volume/mesh.ts";
import { fieldFromVoxels, fieldSdf } from "./field.ts";
import { mergeMeshes, v3 } from "./garment.ts";
import { smoothNormals } from "./surface.ts";
import { sweep } from "./sweep.ts";

export interface CurlStyle {
  /** Mean lock length (m). */
  length: number;
  /** Main locks and under-layer locks. */
  locks: number;
  underLocks: number;
  /** Coil radius and pitch of a corkscrew (m). */
  coil: number;
  pitch: number;
  /** Tube radius of one lock (m). */
  tube: number;
  /** How far the mass spreads outward toward the tips (m). */
  spread: number;
}

/** Her documented foundation: long, dense, black corkscrew curls with a centre part. */
export const LELU_CURLS: CurlStyle = { length: 0.52, locks: 980, underLocks: 280, coil: 0.0048, pitch: 0.018, tube: 0.0016, spread: 0.065 };

export interface CurlContext {
  /** Scalp roots (world, metres) and their outward normals. */
  roots: Float32Array;
  normals: Float32Array;
  /** Centre of the skull. */
  head: V3;
  /** Her body's signed distance (head, shoulders, back, arms). */
  body: Sdf;
  /** Black, rose and burgundy, sRGB. */
  colors: { base: [number, number, number]; rose: [number, number, number]; berry: [number, number, number] };
}

function hash(i: number, j: number): number {
  let x = Math.imul(i, 374761393) ^ Math.imul(j, 668265263);
  x = Math.imul(x ^ (x >>> 13), 1274126177);
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}
const srgb2lin = (u: number) => (u <= 0.04045 ? u / 12.92 : ((u + 0.055) / 1.055) ** 2.4);

/** Grow one lock's axis from a root: gravity, stiffness, collision, part and face clearance. */
export function growAxis(ctx: CurlContext, root: V3, n: V3, len: number, clear: number, seed: number): V3[] {
  const h = ctx.head;
  const seg = 0.008;
  const steps = Math.max(4, Math.round(len / seg));
  // leave the scalp along its normal, parted at the centre: a root near the
  // midline is combed toward its own side
  const side = root[0] >= h[0] ? 1 : -1;
  // Hair lies ALONG the scalp at the root: leave in the tangent plane,
  // combed down and away from the centre part, lifted only a little by the
  // normal. Leaving along the normal stood the crown locks straight up.
  const down: V3 = [0, -1, 0];
  let tdir = v3.sub(down, [n[0] * v3.dot(down, n), n[1] * v3.dot(down, n), n[2] * v3.dot(down, n)]);
  if (v3.len(tdir) < 0.35) {
    // the crown, where "down" is into the scalp: comb away from the part and back
    const away: V3 = [side * 0.55, 0, -0.8];
    tdir = v3.sub(away, [n[0] * v3.dot(away, n), n[1] * v3.dot(away, n), n[2] * v3.dot(away, n)]);
  }
  // a low lift keeps the part a LINE: lifted roots open a bald wedge
  let d = v3.unit(v3.add(v3.unit(tdir), n, 0.18));
  // front hairline locks sweep back and to the side so they frame the face
  // Front-hairline roots sweep away from the part, to the side and a little
  // back, lying on the scalp. (Sending them UP and back left the front of the
  // part bald; letting them fall gave her a fringe her references do not have.)
  const front = root[2] > h[2] + 0.04;
  if (front) {
    const sweepDir: V3 = [side * 0.85, -0.12, -0.7];
    const tang = v3.sub(sweepDir, [n[0] * v3.dot(sweepDir, n), n[1] * v3.dot(sweepDir, n), n[2] * v3.dot(sweepDir, n)]);
    d = v3.unit(v3.add(v3.unit(tang), n, 0.12));
  }
  // temple and side roots (in front of the ear) sweep back over the ear, as
  // in her profile references, instead of hanging down beside her cheek
  const phiAbs = Math.abs(Math.atan2(root[0] - h[0], root[2] - h[2]));
  if (phiAbs > 0.75 && phiAbs < 1.9) {
    const back: V3 = [side * 0.35, -0.4, -1.0];
    const tb = v3.sub(back, [n[0] * v3.dot(back, n), n[1] * v3.dot(back, n), n[2] * v3.dot(back, n)]);
    d = v3.unit(v3.add(v3.unit(tb), n, 0.15));
  }
  let p = v3.add(root, n, 0.002);
  const pts: V3[] = [p];
  const e = 0.003;
  for (let s = 1; s <= steps; s++) {
    const t = s / steps;
    // stiff at the root, heavy at the tip
    const g = 0.04 + 0.32 * Math.min(1, t * 2.2);
    const wob = (hash(seed, s) - 0.5) * 0.18;
    d = v3.unit(v3.add(d, [wob * 0.6, -g, wob * 0.4]));
    p = v3.add(p, d, seg);
    // framing locks lie along the SIDES of her face (ref17), not in front of
    // her cheekbones: beside the face a lock is steered out and back until it
    // is behind the face's side plane, so her profile stays clear (ref18)
    {
      const fyF = p[1] - h[1], fxF = Math.abs(p[0] - h[0]);
      if (fyF < 0.088 && fyF > -0.2 && fxF < 0.15 && p[2] > h[2] + 0.035) d = v3.unit(v3.add(d, [side * 0.35, 0.05, -0.75]));
    }
    // tucked behind the ear (ref18): a temple or side lock passing the ear in
    // front of it is steered back along its path until it is behind the ear
    if (phiAbs > 0.75 && phiAbs < 1.9) {
      const fyE = p[1] - h[1], fxE = Math.abs(p[0] - h[0]);
      if (fyE < 0.07 && fyE > -0.09 && fxE < 0.16 && p[2] > h[2] - 0.01) d = v3.unit(v3.add(d, [0, 0.05, -0.9]));
    }
    // keep clear of her: head, neck, shoulders, back, arms
    const want = clear * Math.min(1, 0.35 + t * 3);
    for (let it = 0; it < 4; it++) {
      const b = ctx.body(p[0], p[1], p[2]);
      if (b >= want) break;
      const gr = v3.unit([ctx.body(p[0] + e, p[1], p[2]) - ctx.body(p[0] - e, p[1], p[2]), ctx.body(p[0], p[1] + e, p[2]) - ctx.body(p[0], p[1] - e, p[2]), ctx.body(p[0], p[1], p[2] + e) - ctx.body(p[0], p[1], p[2] - e)]);
      p = v3.add(p, gr, Math.min(0.01, want - b));
      // a lock that met her body slides along it instead of pushing into it
      const dn = v3.dot(d, gr);
      if (dn < 0) d = v3.unit(v3.add(d, gr, -dn));
    }
    // never in front of her face
    const fx = Math.abs(p[0] - h[0]), fy = p[1] - h[1];
    // her face, from the chin up to the hairline, is never covered
    if (p[2] > h[2] + 0.02 && fy < 0.088 && fy > -0.2 && fx < 0.082) p = [h[0] + side * 0.082, p[1], p[2]];
    pts.push(p);
  }
  return pts;
}

/** Parallel-transport frame of a polyline. */
export function frames(pts: V3[]): [V3, V3][] {
  const out: [V3, V3][] = [];
  let t = v3.unit(v3.sub(pts[1], pts[0]));
  let u = v3.unit(v3.cross(t, Math.abs(t[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]));
  for (let i = 0; i < pts.length; i++) {
    const tn = v3.unit(v3.sub(pts[Math.min(pts.length - 1, i + 1)], pts[Math.max(0, i - 1)]));
    // rotate u by the change of tangent
    u = v3.unit(v3.sub(u, [tn[0] * v3.dot(u, tn), tn[1] * v3.dot(u, tn), tn[2] * v3.dot(u, tn)]));
    t = tn;
    out.push([u, v3.cross(t, u)]);
  }
  return out;
}

/** A corkscrew around an axis: coil radius ramps in from the root and springs toward the tip. */
function coilAround(axis: V3[], coil: number, pitch: number, phase: number, perTurn: number): V3[] {
  // arc length of the axis
  const L: number[] = [0];
  for (let i = 1; i < axis.length; i++) L.push(L[i - 1] + v3.len(v3.sub(axis[i], axis[i - 1])));
  const total = L[L.length - 1];
  const F = frames(axis);
  const n = Math.max(8, Math.round((total / pitch) * perTurn));
  const out: V3[] = [];
  let k = 0;
  for (let j = 0; j <= n; j++) {
    const s = (j / n) * total;
    while (k + 1 < L.length - 1 && L[k + 1] < s) k++;
    const f = (s - L[k]) / Math.max(1e-9, L[k + 1] - L[k]);
    const c = v3.add(axis[k], v3.sub(axis[k + 1], axis[k]), f);
    const [u, w] = F[k];
    const ramp = Math.min(1, s / 0.03);
    const r = coil * ramp * (0.85 + 0.35 * (s / total));
    const a = phase + (2 * Math.PI * s) / pitch;
    out.push(v3.add(v3.add(c, u, r * Math.cos(a)), w, r * Math.sin(a)));
  }
  return out;
}

export interface Curls {
  mesh: Mesh;
  f: Sdf;
  lo: V3;
  hi: V3;
  stats: { locks: number; underLocks: number; triangles: number; meanLength: number };
}

export function growCurls(ctx: CurlContext, st: CurlStyle, materialClass = 0.25): Curls {
  const nr = ctx.roots.length / 3;
  const meshes: Mesh[] = [];
  const envelopes: { pts: V3[]; r: number }[] = [];
  const lin = (c: [number, number, number]) => c.map(srgb2lin) as [number, number, number];
  const base = lin(ctx.colors.base), rose = lin(ctx.colors.rose), berry = lin(ctx.colors.berry);
  let total = 0;
  const layer = (count: number, under: boolean) => {
    for (let i = 0; i < count; i++) {
      // roots spread evenly through the scalp list, jittered within 4 mm
      const ri = Math.floor(((i + hash(i, under ? 91 : 7)) / count) * nr) % nr;
      const n: V3 = [ctx.normals[3 * ri], ctx.normals[3 * ri + 1], ctx.normals[3 * ri + 2]];
      const j = v3.unit(v3.cross(n, [hash(i, 3) - 0.5, hash(i, 4) - 0.5, hash(i, 5) - 0.5]));
      const root = v3.add([ctx.roots[3 * ri], ctx.roots[3 * ri + 1], ctx.roots[3 * ri + 2]], j, 0.004 * hash(i, 6));
      const front = root[2] > ctx.head[2] + 0.04;
      const len = st.length * (0.78 + 0.44 * hash(i, 8)) * (front ? 0.72 : 1) * (under ? 0.86 : 1);
      const axis = growAxis(ctx, root, n, len, under ? 0.008 : 0.013 + 0.012 * hash(i, 9), i * 2 + (under ? 1 : 0));
      // the mass widens toward the tips, as curly hair does
      for (let k = 0; k < axis.length; k++) {
        const t = k / (axis.length - 1);
        const out = v3.unit([axis[k][0] - ctx.head[0], 0, axis[k][2] - ctx.head[2] + 0.02]);
        axis[k] = v3.add(axis[k], out, st.spread * (under ? 0.4 : 1) * Math.pow(t, 0.8) * (0.6 + 0.8 * hash(i, 10)));
      }
      const coil = st.coil * (under ? 0.8 : 0.8 + 0.45 * hash(i, 11));
      const pitch = st.pitch * (under ? 1.4 : 0.85 + 0.3 * hash(i, 12));
      const pts = coilAround(axis, coil, pitch, hash(i, 13) * Math.PI * 2, under ? 5 : 6);
      const tube = st.tube * (under ? 1.6 : 0.85 + 0.35 * hash(i, 14));
      const m = sweep(pts, { profile: "round", width: tube, height: tube, sides: 4, scale: (t) => 1 - 0.55 * t * t });
      // colour: black, a fifth of the locks woven with her rose or berry,
      // strongest toward the ends (the highlight is in the lengths, not at the roots)
      const tint = under ? null : hash(i, 15) < 0.14 ? rose : hash(i, 15) < 0.24 ? berry : null;
      const nv = m.positions.length / 3;
      const colors = new Float32Array(nv * 4);
      for (let v = 0; v < nv; v++) {
        const t = m.t[v];
        let c = base;
        if (tint) {
          const k = Math.min(1, Math.max(0, (t - 0.15) / 0.5));
          c = [base[0] + (tint[0] - base[0]) * k, base[1] + (tint[1] - base[1]) * k, base[2] + (tint[2] - base[2]) * k];
        }
        const dark = under ? 0.6 : 0.9 + 0.2 * hash(i, 16);
        colors.set([c[0] * dark, c[1] * dark, c[2] * dark, materialClass], 4 * v);
      }
      meshes.push({ positions: m.positions, indices: m.indices, normals: smoothNormals(m.positions, m.indices), colors });
      envelopes.push({ pts: axis, r: coil + tube });
      total += len;
    }
  };
  layer(st.underLocks, true);
  layer(st.locks, false);
  const mesh = mergeMeshes(meshes);

  // occupancy: every lock's envelope (coil + tube) rasterised at 4 mm
  const H = 0.004;
  const lo: V3 = [Infinity, Infinity, Infinity], hi: V3 = [-Infinity, -Infinity, -Infinity];
  for (const e of envelopes) for (const p of e.pts) for (let a = 0; a < 3; a++) [lo[a], hi[a]] = [Math.min(lo[a], p[a] - 0.02), Math.max(hi[a], p[a] + 0.02)];
  const dims = [0, 1, 2].map((a) => Math.ceil((hi[a] - lo[a]) / H) + 1) as [number, number, number];
  const inside = new Uint8Array(dims[0] * dims[1] * dims[2]);
  const origin: V3 = [lo[0] + H / 2, lo[1] + H / 2, lo[2] + H / 2];
  for (const e of envelopes)
    for (let k = 0; k + 1 < e.pts.length; k++) {
      const a = e.pts[k], b = e.pts[k + 1];
      const sub = Math.max(1, Math.ceil(v3.len(v3.sub(b, a)) / (H * 0.7)));
      for (let s = 0; s <= sub; s++) {
        const p = v3.add(a, v3.sub(b, a), s / sub);
        const r = e.r, r2 = r * r;
        const i0 = Math.max(0, Math.floor((p[0] - r - origin[0]) / H)), i1 = Math.min(dims[0] - 1, Math.ceil((p[0] + r - origin[0]) / H));
        const j0 = Math.max(0, Math.floor((p[1] - r - origin[1]) / H)), j1 = Math.min(dims[1] - 1, Math.ceil((p[1] + r - origin[1]) / H));
        const k0 = Math.max(0, Math.floor((p[2] - r - origin[2]) / H)), k1 = Math.min(dims[2] - 1, Math.ceil((p[2] + r - origin[2]) / H));
        for (let z = k0; z <= k1; z++)
          for (let y = j0; y <= j1; y++)
            for (let x = i0; x <= i1; x++) {
              const dx = origin[0] + x * H - p[0], dy = origin[1] + y * H - p[1], dz = origin[2] + z * H - p[2];
              if (dx * dx + dy * dy + dz * dz <= r2) inside[(z * dims[1] + y) * dims[0] + x] = 1;
            }
      }
    }
  const field = fieldFromVoxels(inside, dims, origin, H);
  return {
    mesh,
    f: fieldSdf(field),
    lo: field.lo,
    hi: field.hi,
    stats: { locks: st.locks, underLocks: st.underLocks, triangles: mesh.indices.length / 3, meanLength: +(total / (st.locks + st.underLocks)).toFixed(3) },
  };
}
