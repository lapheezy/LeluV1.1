/**
 * ==========================================================
 * LÉLU ASRE — LAYERED HAIR ARCHITECTURE
 *
 * Her references (ref10, ref17, ref18-20, ref15, ref09) show: a sleek centre
 * part over the crown, then a hip-length mass of fine black curls organised
 * into ringlet clumps of varied size, large curl masses, flyaways, laid baby
 * hairs and swirls along the front hairline, and rose-magenta sections.
 *
 * The previous hair was ~1,260 identical tubes: every lock the same coil,
 * no strands, no clumping, no hairline. Here the hair is built in layers:
 *
 *   1 scalp      an analytic hairline on HER head surface, placed from her
 *                eye landmarks; a smooth-edged scalp tone and a visible part
 *   2 masses     neighbouring clumps share a low-frequency S-wave
 *   3 ringlets   each clump is a corkscrew of its own diameter, pitch and
 *                length; sleek over the crown, curling below it
 *   4 strands    ~10 curves per clump twisting with the ringlet, each with
 *                its own offset, phase and frizz; a few escape the clump
 *   5 flyaways   thin noisy strands drifting off the mass
 *   6 baby hairs short curves on the front hairline, ray-projected onto her
 *                forehead surface (0.3 mm lift) and swept into swirls
 *
 * Representation: full-resolution strands are CURVES (polyline + radius +
 * colour), exported as a compact quantized sidecar for offline rendering as
 * native hair curves; the GLB keeps one tube per clump as the realtime LOD,
 * and occupancy comes from the clump envelopes. Deterministic throughout.
 * ==========================================================
 */
import type { Sdf, V3 } from "../character/sdf.ts";
import type { Rgb } from "../character/shape.ts";
import type { Mesh } from "../volume/mesh.ts";
import { fieldFromVoxels, fieldSdf } from "./field.ts";
import type { HeadRays } from "./face.ts";
import { mergeMeshes, v3 } from "./garment.ts";
import { frames, growAxis, type CurlContext } from "./hair.ts";
import { smoothNormals } from "./surface.ts";
import { sweep } from "./sweep.ts";

function hash(i: number, j: number): number {
  let x = Math.imul(i, 374761393) ^ Math.imul(j, 668265263);
  x = Math.imul(x ^ (x >>> 13), 1274126177);
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}
const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const srgb2lin = (u: number) => (u <= 0.04045 ? u / 12.92 : ((u + 0.055) / 1.055) ** 2.4);

/* ------------------------------- hairline -------------------------------- */
/**
 * Her hairline as a height on the head for each azimuth around the skull
 * (0 = front centre, π = nape), relative to her pupil line. Front: 5.5 cm
 * above the pupils (her references put the hairline ~0.85 IOD above them);
 * temples recede and drop; sideburns come down in front of the ear; over and
 * behind the ear the line rises, then falls to the nape.
 */
const HAIRLINE: [number, number][] = [
  [0.0, 0.055], [0.45, 0.052], [0.8, 0.04], [1.02, 0.026], [1.22, 0.004], [1.36, 0.0],
  [1.5, 0.03], [1.85, 0.032], [2.15, -0.035], [2.6, -0.075], [Math.PI, -0.09],
];
export interface Hairline {
  /** Skull centre the azimuth is measured around. */
  centre: V3;
  eyeY: number;
  /** Hairline height (world y) at azimuth |phi|. */
  yAt: (phi: number) => number;
  /** 0 outside, 1 on the scalp, smooth across a few millimetres. */
  mask: (x: number, y: number, z: number) => number;
}
export function hairline(eyeY: number, centre: V3): Hairline {
  const yAt = (phi: number) => {
    const a = Math.min(Math.PI, Math.abs(phi));
    for (let i = 0; i + 1 < HAIRLINE.length; i++) {
      const [p0, y0] = HAIRLINE[i], [p1, y1] = HAIRLINE[i + 1];
      if (a <= p1) return eyeY + y0 + ((a - p0) / (p1 - p0)) * (y1 - y0);
    }
    return eyeY + HAIRLINE[HAIRLINE.length - 1][1];
  };
  return {
    centre,
    eyeY,
    yAt,
    mask: (x, y, z) => smoothstep(-0.0015, 0.0035, y - yAt(Math.atan2(x - centre[0], z - centre[2]))),
  };
}

/* ------------------------------- strands --------------------------------- */
export interface Strands {
  /** Points per strand. */
  counts: Uint32Array;
  positions: Float32Array;
  /** Root and tip radius per strand (m). */
  radius: Float32Array;
  /** sRGB colour per strand. */
  color: Float32Array;
  /** 0 clump strand, 1 flyaway, 2 baby hair. */
  kind: Uint8Array;
}

export interface HairArchitecture {
  strands: Strands;
  lod: Mesh;
  f: Sdf;
  lo: V3;
  hi: V3;
  stats: Record<string, number>;
}

export interface HairArchContext extends CurlContext {
  hairline: Hairline;
  /** Head surface: positions, normals and the head triangles, for roots and baby hairs. */
  head: V3;
  surf: { positions: Float32Array; normals: Float32Array; indices: Uint32Array; tris: number[] };
  rays: HeadRays;
  /** Her forehead: where baby hairs lie (front-ray projection is valid there). */
  colorsArch: { black: Rgb; rose: Rgb; berry: Rgb };
}

export interface ArchStyle {
  clumps: number;
  strandsPerClump: number;
  flyaways: number;
  babyHairs: number;
  /** Back length (m); front and sides are shorter. */
  length: number;
}
export const LELU_HAIR_ARCH: ArchStyle = { clumps: 1150, strandsPerClump: 14, flyaways: 420, babyHairs: 170, length: 0.86 };

/** Evenly spread roots on the scalp: one per occupied 4.6 mm cell of her head surface. */
function scalpRoots(ctx: HairArchContext): { p: V3; n: V3; phi: number }[] {
  const { positions: P, normals: N, indices: I, tris } = ctx.surf;
  const cells = new Map<string, { p: V3; n: V3; phi: number }>();
  const H = 0.0046;
  for (const t of tris) {
    const a = I[3 * t], b = I[3 * t + 1], c = I[3 * t + 2];
    for (let k = 0; k < 2; k++) {
      const u = hash(t, k * 2 + 1), w = hash(t, k * 2 + 2);
      const [s1, s2] = u + w > 1 ? [1 - u, 1 - w] : [u, w];
      const s0 = 1 - s1 - s2;
      const p: V3 = [0, 1, 2].map((q) => s0 * P[3 * a + q] + s1 * P[3 * b + q] + s2 * P[3 * c + q]) as V3;
      if (ctx.hairline.mask(p[0], p[1], p[2]) < 0.5) continue;
      const key = `${Math.floor(p[0] / H)},${Math.floor(p[1] / H)},${Math.floor(p[2] / H)}`;
      if (cells.has(key)) continue;
      const n = v3.unit([0, 1, 2].map((q) => s0 * N[3 * a + q] + s1 * N[3 * b + q] + s2 * N[3 * c + q]) as V3);
      cells.set(key, { p, n, phi: Math.atan2(p[0] - ctx.hairline.centre[0], p[2] - ctx.hairline.centre[2]) });
    }
  }
  // deterministic order
  return [...cells.entries()].sort((x, y) => (x[0] < y[0] ? -1 : 1)).map((e) => e[1]);
}

/** Resample a polyline to arc-length parameter, return point at s (clamped). */
function arc(axis: V3[]) {
  const L: number[] = [0];
  for (let i = 1; i < axis.length; i++) L.push(L[i - 1] + v3.len(v3.sub(axis[i], axis[i - 1])));
  const total = L[L.length - 1];
  const F = frames(axis);
  let k = 0;
  return {
    total,
    at(s: number): { p: V3; u: V3; w: V3; t: V3 } {
      if (s < L[k]) k = 0;
      while (k + 1 < L.length - 1 && L[k + 1] < s) k++;
      const f = Math.max(0, Math.min(1, (s - L[k]) / Math.max(1e-9, L[k + 1] - L[k])));
      const p = v3.add(axis[k], v3.sub(axis[k + 1], axis[k]), f);
      return { p, u: F[k][0], w: F[k][1], t: v3.unit(v3.sub(axis[k + 1], axis[k])) };
    },
  };
}

export function growHairArchitecture(ctx: HairArchContext, st: ArchStyle): HairArchitecture {
  const roots = scalpRoots(ctx);
  // Her face stays clear on the FINAL geometry (ringlets, masses and
  // flyaways are added after the axis is grown): inside the face prism hair
  // is pushed to its side. (Clamping hair to a plane beside the face was
  // tried and rejected: it flattens the mass into a wall. Her profile is kept
  // clear by how the hair grows instead: see the volume direction below and
  // growAxis' side sweep.)
  const hh = ctx.head;
  const clearFace = (p: V3): V3 => {
    const fy = p[1] - hh[1], fx = Math.abs(p[0] - hh[0]);
    if (fy > 0.088 || fy < -0.2) return p;
    let q = p;
    if (q[2] > hh[2] + 0.02 && fx < 0.082 && fy < 0.088) q = [hh[0] + Math.sign(q[0] - hh[0] || 1) * 0.082, q[1], q[2]];
    return q;
  };
  const nClumps = Math.min(st.clumps, roots.length);
  const head = ctx.head;
  const counts: number[] = [], pos: number[] = [], rad: number[] = [], col: number[] = [], kind: number[] = [];
  const lodParts: Mesh[] = [];
  const envelopes: { pts: V3[]; r: number }[] = [];
  const black = ctx.colorsArch.black, rose = ctx.colorsArch.rose, berry = ctx.colorsArch.berry;
  const pushStrand = (pts: V3[], r0: number, r1: number, c: Rgb, k: number) => {
    counts.push(pts.length);
    for (const p of pts) pos.push(p[0], p[1], p[2]);
    rad.push(r0, r1);
    col.push(c[0], c[1], c[2]);
    kind.push(k);
  };
  const lodColor = (c: Rgb): [number, number, number, number] => [srgb2lin(c[0]), srgb2lin(c[1]), srgb2lin(c[2]), 0.25];

  // sections: rose-magenta and berry live in whole SECTIONS (as in her
  // references), chosen on a coarse 3 cm grid of the scalp, not per lock
  const sectionColor = (p: V3): Rgb | null => {
    const h = hash(Math.floor(p[0] / 0.03) + 97, Math.floor(p[1] / 0.03) * 31 + Math.floor(p[2] / 0.03));
    return h < 0.06 ? rose : h < 0.11 ? berry : null;
  };

  const clumpAxes: V3[][] = [];
  for (let c = 0; c < nClumps; c++) {
    const r = roots[Math.floor((c * roots.length) / nClumps)];
    const phi = Math.abs(r.phi);
    // length: hip length at the back, shorter toward the face
    // her front and side lengths frame her body almost as long as the back (ref01)
    const len = st.length * (0.84 + 0.16 * smoothstep(0.6, 2.0, phi)) * (0.82 + 0.3 * hash(c, 1));
    // clumps hug the skull over the crown (small clearance), then fall free
    const axis = growAxis(ctx, r.p, r.n, len, 0.009 + 0.009 * hash(c, 2), c * 7 + 3);
    // volume: below the crown the mass widens outward (her references are
    // much wider than her shoulders), more at the back and sides
    for (let k = 0; k < axis.length; k++) {
      const t = k / (axis.length - 1);
      const dy = Math.max(0, r.p[1] - axis[k][1]);
      // outward and slightly BACK: a forward bias pushed the side mass in
      // front of her face plane
      const out = v3.unit([axis[k][0] - head[0], 0, axis[k][2] - head[2] - 0.03]);
      axis[k] = v3.add(axis[k], out, (0.016 + 0.012 * hash(c, 24)) * smoothstep(0.0, 0.06, dy) + (0.02 + 0.02 * hash(c, 24)) * smoothstep(0.06, 0.3, dy) * Math.pow(t, 0.6));
    }
    // primary masses: a shared low-frequency S-wave per 3.5 cm scalp patch
    const mass = Math.floor(r.p[0] / 0.035) * 131 + Math.floor(r.p[1] / 0.035) * 17 + Math.floor(r.p[2] / 0.035);
    const mAmp = 0.012 + 0.014 * hash(mass, 3), mLen = 0.11 + 0.05 * hash(mass, 4), mPh = hash(mass, 5) * 6.283;
    const A = arc(axis);
    const sleek = 0.075 + 0.05 * hash(c, 6) + (phi < 1.2 ? 0.02 : 0);
    // ringlet: diameter, pitch and the clump's own cross-section, varied
    const ringR = 0.0045 + 0.0065 * hash(c, 7);
    const pitch = 0.016 + 0.012 * hash(c, 8);
    const clumpR = 0.0022 + 0.0016 * hash(c, 9);
    const ph0 = hash(c, 10) * 6.283;
    const tint = sectionColor(r.p);
    const center = (s: number): V3 => {
      const f = A.at(s);
      const curl = smoothstep(sleek, sleek + 0.05, s);
      const ang = ph0 + (6.283 * s) / pitch;
      const m = mAmp * curl * Math.sin((6.283 * s) / mLen + mPh);
      const rr = ringR * curl * (0.85 + 0.4 * (s / A.total));
      return v3.add(v3.add(f.p, f.u, rr * Math.cos(ang) + m), f.w, rr * Math.sin(ang));
    };
    const perTurn = 8;
    const n = Math.max(12, Math.round((A.total / pitch) * perTurn));
    const cpts: V3[] = [];
    for (let j = 0; j <= n; j++) cpts.push(clearFace(center((j / n) * A.total)));
    clumpAxes.push(cpts);
    envelopes.push({ pts: axis, r: ringR + clumpR + mAmp });
    // LOD: one tube per clump, thick enough to stand for its strands
    // the LOD follows the same ringlet at 5 samples a turn (strands keep 6-8)
    const nl = Math.max(8, Math.round((A.total / pitch) * 5));
    const lpts: V3[] = [];
    for (let j = 0; j <= nl; j++) lpts.push(clearFace(center((j / nl) * A.total)));
    const m = sweep(lpts, { profile: "round", width: clumpR * 0.95, height: clumpR * 0.95, sides: 4, scale: (t) => 1 - 0.5 * t * t });
    const colors = new Float32Array((m.positions.length / 3) * 4);
    for (let v = 0; v < m.positions.length / 3; v++) {
      const t = m.t[v];
      const cc: Rgb = tint ? [black[0] + (tint[0] - black[0]) * smoothstep(0.2, 0.6, t), black[1] + (tint[1] - black[1]) * smoothstep(0.2, 0.6, t), black[2] + (tint[2] - black[2]) * smoothstep(0.2, 0.6, t)] : black;
      colors.set(lodColor(cc), 4 * v);
    }
    lodParts.push({ positions: m.positions, indices: m.indices, normals: smoothNormals(m.positions, m.indices), colors });
    // strands of the clump: each offset in the clump's cross-section, turning
    // with the ringlet (so the clump twists), with its own frizz
    for (let k = 0; k < st.strandsPerClump; k++) {
      const off = clumpR * Math.sqrt(hash(c * 31 + k, 11));
      const oa = hash(c * 31 + k, 12) * 6.283;
      const escape = hash(c * 31 + k, 13) < 0.08 ? 0.3 + 0.5 * hash(c * 31 + k, 14) : 2;
      const strandLen = A.total * (0.88 + 0.12 * hash(c * 31 + k, 15));
      const pts: V3[] = [];
      const ns = Math.max(10, Math.round((strandLen / pitch) * 6));
      for (let j = 0; j <= ns; j++) {
        const s = (j / ns) * strandLen;
        const f = A.at(s);
        const ccen = center(s);
        const twist = oa + (6.283 * s) / pitch;
        const frizz = 0.0008 * Math.sin(s * 310 + k * 1.7) * smoothstep(sleek, sleek + 0.1, s);
        let o = off * (s < 0.01 ? s / 0.01 : 1) + frizz;
        if (s / A.total > escape) o += 0.03 * (s / A.total - escape) * (0.5 + hash(c * 31 + k, 16));
        pts.push(clearFace(v3.add(v3.add(ccen, f.u, o * Math.cos(twist)), f.w, o * Math.sin(twist))));
      }
      // even inside an accent section, a third of the strands stay black
      const cc: Rgb = tint && hash(c * 31 + k, 17) < 0.65 ? tint : black;
      pushStrand(pts, 0.00014, 0.00005, cc, 0);
    }
  }

  // the part: strands rooted on both edges of the centre part, from the
  // front hairline to the crown, lying flat and combed away from it, so the
  // part reads as a fine line of scalp, not a bald wedge
  {
    const P = ctx.surf.positions;
    let i = 0;
    const yTop = ctx.hairline.eyeY + 0.13;
    for (let y = ctx.hairline.yAt(0) + 0.001; y < yTop; y += 0.0011) {
      for (const side of [1, -1]) {
        const x0 = side * (0.0012 + 0.0016 * hash(i, 41));
        const zf = ctx.rays.front(x0, y);
        // the front of the skull faces the camera ray; over the top use the
        // closest skin point along the part's own plane
        let root: V3 | null = zf !== null ? [x0, y, zf] : null;
        if (!root) {
          let best = Infinity;
          for (const t of ctx.surf.tris) {
            const a = ctx.surf.indices[3 * t];
            const d = Math.abs(P[3 * a] - x0) + Math.abs(P[3 * a + 1] - y);
            if (P[3 * a + 2] > ctx.hairline.centre[2] - 0.02 && d < best) [best, root] = [d, [P[3 * a], P[3 * a + 1], P[3 * a + 2]]];
          }
          if (best > 0.004) root = null;
        }
        if (!root) continue;
        const n = v3.unit(v3.sub(root, [0, ctx.hairline.eyeY - 0.01, ctx.hairline.centre[2]]));
        const dir = v3.unit(v3.cross(n, [0, 0, side > 0 ? -1 : 1]));
        const L = 0.05 + 0.03 * hash(i, 42);
        const pts: V3[] = [];
        for (let j = 0; j <= 14; j++) {
          const t = j / 14;
          // flat over the skull: lifted 0.6 mm, bending down with its curvature
          const p = v3.add(v3.add(root, dir, L * t), n, 0.0006 - 0.012 * t * t);
          const g = ctx.body(p[0], p[1], p[2]);
          pts.push(g < 0.0006 ? v3.add(p, n, 0.0006 - g) : p);
        }
        pushStrand(pts, 0.00012, 0.00006, black, 0);
        i++;
      }
    }
  }

  // flyaways: thin strands that leave the mass and drift outward
  for (let i = 0; i < st.flyaways; i++) {
    const axis = clumpAxes[Math.floor(hash(i, 21) * clumpAxes.length)];
    const start = Math.floor(axis.length * (0.15 + 0.5 * hash(i, 22)));
    const pts: V3[] = [];
    const out = v3.unit([axis[start][0] - head[0], 0.15, axis[start][2] - head[2]]);
    for (let j = 0; j < 40; j++) {
      const a = axis[Math.min(axis.length - 1, start + j * 2)];
      const t = j / 39;
      const wob: V3 = [Math.sin(j * 0.9 + i) * 0.004, Math.cos(j * 0.7 + i * 2) * 0.003, Math.sin(j * 1.3 + i * 3) * 0.004];
      pts.push(clearFace(v3.add(v3.add(a, out, 0.035 * t * (0.5 + hash(i, 23))), wob, t)));
    }
    pushStrand(pts, 0.00007, 0.00003, black, 1);
  }

  // baby hairs: rooted on the front hairline, lying ON her forehead surface
  // (front-ray projection onto the exact mesh, 0.3 mm proud of it), swept
  // down and out from the part into swirls at the forehead and temples
  let baby = 0;
  for (let i = 0; i < st.babyHairs; i++) {
    const side = i % 2 ? 1 : -1;
    const phi = side * (0.08 + 0.95 * hash(i, 31));
    const yRoot = ctx.hairline.yAt(phi) + 0.0008;
    // the root's x on the forehead at that azimuth: march along x until the azimuth matches
    let x = 0;
    for (let k = 0; k < 60; k++) {
      const zf = ctx.rays.front(x, yRoot);
      if (zf === null) break;
      if (Math.abs(Math.atan2(x - ctx.hairline.centre[0], zf - ctx.hairline.centre[2])) >= Math.abs(phi)) break;
      x += side * 0.0012;
    }
    const swirl = hash(i, 32) < 0.35;
    const L = 0.007 + 0.012 * hash(i, 33);
    const pts: V3[] = [];
    let ok = true;
    for (let j = 0; j <= 18; j++) {
      const t = j / 18;
      // an S-sweep down and away from the centre, curling at the end on swirls
      let dx = side * L * (0.55 * t + 0.25 * Math.sin(t * Math.PI));
      let dy = -L * (0.75 * t);
      if (swirl && t > 0.55) {
        const a = (t - 0.55) * 9;
        dx += side * 0.0025 * Math.sin(a);
        dy += 0.0025 * (1 - Math.cos(a));
      }
      const px = x + dx, py = yRoot + dy;
      const zf = ctx.rays.front(px, py);
      if (zf === null) {
        ok = false;
        break;
      }
      pts.push([px, py, zf + 0.0003]);
    }
    if (!ok || pts.length < 6) continue;
    pushStrand(pts, 0.00008, 0.00003, black, 2);
    baby++;
  }

  const lod = mergeMeshes(lodParts);
  // occupancy from the clump envelopes at 4 mm (as before)
  const Hh = 0.004;
  const lo: V3 = [Infinity, Infinity, Infinity], hi: V3 = [-Infinity, -Infinity, -Infinity];
  for (const e of envelopes) for (const p of e.pts) for (let a = 0; a < 3; a++) [lo[a], hi[a]] = [Math.min(lo[a], p[a] - 0.03), Math.max(hi[a], p[a] + 0.03)];
  const dims = [0, 1, 2].map((a) => Math.ceil((hi[a] - lo[a]) / Hh) + 1) as [number, number, number];
  const inside = new Uint8Array(dims[0] * dims[1] * dims[2]);
  const origin: V3 = [lo[0] + Hh / 2, lo[1] + Hh / 2, lo[2] + Hh / 2];
  for (const e of envelopes)
    for (let k = 0; k + 1 < e.pts.length; k++) {
      const a = e.pts[k], b = e.pts[k + 1];
      const sub = Math.max(1, Math.ceil(v3.len(v3.sub(b, a)) / (Hh * 0.7)));
      for (let s = 0; s <= sub; s++) {
        const p = v3.add(a, v3.sub(b, a), s / sub);
        const r = e.r, r2 = r * r;
        const i0 = Math.max(0, Math.floor((p[0] - r - origin[0]) / Hh)), i1 = Math.min(dims[0] - 1, Math.ceil((p[0] + r - origin[0]) / Hh));
        const j0 = Math.max(0, Math.floor((p[1] - r - origin[1]) / Hh)), j1 = Math.min(dims[1] - 1, Math.ceil((p[1] + r - origin[1]) / Hh));
        const k0 = Math.max(0, Math.floor((p[2] - r - origin[2]) / Hh)), k1 = Math.min(dims[2] - 1, Math.ceil((p[2] + r - origin[2]) / Hh));
        for (let z = k0; z <= k1; z++)
          for (let y = j0; y <= j1; y++)
            for (let xx = i0; xx <= i1; xx++) {
              const dx = origin[0] + xx * Hh - p[0], dy = origin[1] + y * Hh - p[1], dz = origin[2] + z * Hh - p[2];
              if (dx * dx + dy * dy + dz * dz <= r2) inside[(z * dims[1] + y) * dims[0] + xx] = 1;
            }
      }
    }
  const field = fieldFromVoxels(inside, dims, origin, Hh);
  const strands: Strands = { counts: Uint32Array.from(counts), positions: Float32Array.from(pos), radius: Float32Array.from(rad), color: Float32Array.from(col), kind: Uint8Array.from(kind) };
  return {
    strands,
    lod,
    f: fieldSdf(field),
    lo: field.lo,
    hi: field.hi,
    stats: { scalpRoots: roots.length, clumps: nClumps, strands: counts.length, points: pos.length / 3, babyHairs: baby, flyaways: st.flyaways, lodTriangles: lod.indices.length / 3 },
  };
}

