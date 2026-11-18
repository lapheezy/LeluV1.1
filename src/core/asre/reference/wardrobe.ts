/**
 * ==========================================================
 * LÉLU ASRE — HER WARDROBE, CONSTRUCTED
 *
 * Her canonical look (ref01, clothing-corset-top, clothing-cargo-pants-boots,
 * clothing-platform-boots): a camo corset printed with roses, baggy cargo
 * trousers in the same rose camo gathered over the boots, a wide leather belt
 * with a copper buckle and hanging straps, and laced platform combat boots on
 * a chunky lugged sole.
 *
 * Every garment is cut from her own skin surface along a hem curve, lifted
 * and relaxed as cloth, and LAYERED: each piece collides with the union of
 * her body and every garment under it, in dressing order
 *
 *     corset  →  boots  →  trousers (over the corset's tucked hem and the
 *                          boot shafts)  →  belt, straps, pockets
 *
 * so no layer can pass through another, and the pelvis, crotch, seat and
 * waist are one continuous sheet of cloth — there is no seam for skin to show
 * through. Hardware (buckle, rings, eyelets, snaps) is real geometry.
 *
 * Every vertex colour carries a material class in its alpha channel
 * (see MAT) so a renderer can give leather, metal, rubber and cloth their own
 * response; glTF viewers ignore alpha on opaque materials.
 * ==========================================================
 */
import type { Sdf, V3 } from "../character/sdf.ts";
import type { Rgb } from "../character/shape.ts";
import { surfaceNets, type Mesh } from "../volume/mesh.ts";
import { fieldFromMesh, fieldSdf } from "./field.ts";
import { adjacency, clipSurface, largestPieces, mergeMeshes, relaxOutside, thicken, v3, type Sheet } from "./garment.ts";
import { edgeStats, loopSubdivide, smoothNormals } from "./surface.ts";
import { polylineDistance, sweep } from "./sweep.ts";

/** Material classes, stored in the vertex-colour alpha. */
export const MAT = { skin: 1.0, cloth: 0.5, satin: 0.45, leather: 0.8, rubber: 0.7, metal: 0.9, gem: 0.35, hair: 0.25, gloss: 0.6 } as const;

export interface WardrobeContext {
  joint: (name: string) => V3;
  /** Her skin, posed, one subdivision level: positions, normals, indices, per-triangle region labels. */
  surf: { positions: Float32Array; normals: Float32Array; indices: Uint32Array; labels: Uint8Array };
  labels: { head: number; hands: number; arms: number; feet: number; neck: number; torso: number; pelvis: number; legs: number };
  /** Her body's signed distance. */
  body: Sdf;
}

export interface Garment {
  mesh: Mesh;
  /** Occupancy solid (negative inside), world frame. */
  f: Sdf;
  lo: V3;
  hi: V3;
}

export interface Wardrobe {
  top: Garment;
  bottom: Garment;
  shoes: Garment;
  landmarks: Record<string, number | V3>;
  stats: Record<string, number>;
}

/* --------------------------------- noise --------------------------------- */
function hash(i: number, j: number, k: number, s: number): number {
  let x = Math.imul(i, 374761393) ^ Math.imul(j, 668265263) ^ Math.imul(k, 2246822519) ^ Math.imul(s, 3266489917);
  x = Math.imul(x ^ (x >>> 13), 1274126177);
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}
const fade = (t: number) => t * t * (3 - 2 * t);
function vnoise(x: number, y: number, z: number, s: number): number {
  const i = Math.floor(x), j = Math.floor(y), k = Math.floor(z);
  const fx = fade(x - i), fy = fade(y - j), fz = fade(z - k);
  const L = (a: number, b: number, t: number) => a + (b - a) * t;
  return L(
    L(L(hash(i, j, k, s), hash(i + 1, j, k, s), fx), L(hash(i, j + 1, k, s), hash(i + 1, j + 1, k, s), fx), fy),
    L(L(hash(i, j, k + 1, s), hash(i + 1, j, k + 1, s), fx), L(hash(i, j + 1, k + 1, s), hash(i + 1, j + 1, k + 1, s), fx), fy),
    fz,
  );
}
export function fbm(x: number, y: number, z: number, s: number, oct = 3): number {
  let a = 0, w = 0.5, f = 1, n = 0;
  for (let o = 0; o < oct; o++) {
    a += w * vnoise(x * f, y * f, z * f, s + o * 17);
    n += w;
    w *= 0.5;
    f *= 2.03;
  }
  return a / n;
}
const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const mix = (a: Rgb, b: Rgb, t: number): Rgb => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const scale = (a: Rgb, k: number): Rgb => [a[0] * k, a[1] * k, a[2] * k];

/** Her camo, from the corset and cargo boards: olive ground, black, dusty rose and sand. */
const CAMO = { ground: [0.2, 0.21, 0.14] as Rgb, black: [0.05, 0.045, 0.05] as Rgb, rose: [0.5, 0.3, 0.32] as Rgb, sand: [0.56, 0.47, 0.38] as Rgb };
const ROSE = { deep: [0.3, 0.08, 0.14] as Rgb, petal: [0.62, 0.3, 0.36] as Rgb, light: [0.78, 0.5, 0.52] as Rgb, mauve: [0.36, 0.18, 0.3] as Rgb };

function camo(x: number, y: number, z: number, freq: number, seed: number): Rgb {
  const a = fbm(x * freq, y * freq * 0.8, z * freq, seed);
  const b = fbm(x * freq + 31, y * freq * 0.8 - 7, z * freq + 3, seed + 5);
  // soft-edged patches: a printed camo has crisp but not aliased edges
  let c = CAMO.ground;
  c = mix(c, CAMO.sand, smoothstep(0.38, 0.34, b));
  c = mix(c, CAMO.rose, smoothstep(0.58, 0.62, b));
  c = mix(c, CAMO.black, smoothstep(0.56, 0.6, a));
  return c;
}

/**
 * Printed roses: a jittered lattice of blooms, each a spiral of petals in
 * the plane of the cloth (the vertex normal), so a bloom stays round on a
 * curved panel instead of smearing into stripes along the side of a leg.
 */
function rose(x: number, y: number, z: number, n: V3, cell: number, seed: number): { c: Rgb; a: number } | null {
  const gi = Math.floor(x / cell), gj = Math.floor(y / cell), gk = Math.floor(z / cell);
  let best: { c: Rgb; a: number } | null = null;
  for (let di = -1; di <= 1; di++)
    for (let dj = -1; dj <= 1; dj++)
      for (let dk = -1; dk <= 1; dk++) {
        const i = gi + di, j = gj + dj, k = gk + dk;
        if (hash(i, j, k, seed) > 0.55) continue;
        const c: V3 = [(i + 0.2 + 0.6 * hash(i, j, k, seed + 1)) * cell, (j + 0.2 + 0.6 * hash(i, j, k, seed + 2)) * cell, (k + 0.2 + 0.6 * hash(i, j, k, seed + 3)) * cell];
        const R = cell * (0.28 + 0.16 * hash(i, j, k, seed + 4));
        const d: V3 = [x - c[0], y - c[1], z - c[2]];
        const dn = v3.dot(d, n);
        const q: V3 = [d[0] - n[0] * dn, d[1] - n[1] * dn, d[2] - n[2] * dn];
        const r = v3.len(q);
        if (r > R || Math.abs(dn) > R * 0.8) continue;
        const u = v3.unit(v3.cross(n, Math.abs(n[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]));
        const w = v3.cross(n, u);
        const ang = Math.atan2(v3.dot(q, w), v3.dot(q, u));
        const rr = r / R;
        // petals: five around, spiralling inward, darker in their folds
        const petal = 0.5 + 0.5 * Math.cos(5 * ang + 9 * Math.log(rr + 0.06) + hash(i, j, k, seed + 5) * 6);
        const fold = smoothstep(0.15, 0.95, petal);
        let col = mix(ROSE.deep, ROSE.petal, fold);
        col = mix(col, ROSE.light, smoothstep(0.75, 1, petal) * (1 - rr) * 0.6);
        if (rr > 0.86) col = mix(col, ROSE.deep, 0.5);
        const a = 1 - smoothstep(0.88, 1, rr);
        if (!best || a > best.a) best = { c: col, a };
      }
  return best;
}

/* -------------------------------- helpers -------------------------------- */
/** Per-part topology, recorded as parts are made (diagnostics read it). */
export const PART_TOPOLOGY: { garment: string; part: string; triangles: number; boundary: number; nonManifold: number }[] = [];
function audit(garment: string, parts: Mesh[], names: string[]): void {
  parts.forEach((m, i) => {
    const e = edgeStats(m.indices);
    PART_TOPOLOGY.push({ garment, part: names[i] ?? `part${i}`, triangles: m.indices.length / 3, boundary: e.boundary, nonManifold: e.nonManifold });
  });
}
const srgb2lin = (u: number) => (u <= 0.04045 ? u / 12.92 : ((u + 0.055) / 1.055) ** 2.4);

/** Colour every vertex: `fn` returns sRGB and a material class. */
function paint(m: Mesh, fn: (p: V3, n: V3, v: number) => [Rgb, number]): Mesh {
  const nv = m.positions.length / 3;
  const N = m.normals ?? smoothNormals(m.positions, m.indices);
  const colors = new Float32Array(nv * 4);
  for (let v = 0; v < nv; v++) {
    const [c, cls] = fn([m.positions[3 * v], m.positions[3 * v + 1], m.positions[3 * v + 2]], [N[3 * v], N[3 * v + 1], N[3 * v + 2]], v);
    colors[4 * v] = srgb2lin(c[0]);
    colors[4 * v + 1] = srgb2lin(c[1]);
    colors[4 * v + 2] = srgb2lin(c[2]);
    colors[4 * v + 3] = cls;
  }
  return { ...m, normals: N, colors };
}

/** Mesh a small SDF part with surface nets on its own fine grid. */
function meshSdf(f: Sdf, lo: V3, hi: V3, h: number): Mesh {
  const o: V3 = [lo[0] - 2 * h, lo[1] - 2 * h, lo[2] - 2 * h];
  const dims: [number, number, number] = [0, 1, 2].map((a) => Math.ceil((hi[a] - lo[a]) / h) + 5) as [number, number, number];
  const values = new Float32Array(dims[0] * dims[1] * dims[2]);
  let i = 0;
  for (let x = 0; x < dims[0]; x++) for (let y = 0; y < dims[1]; y++) for (let z = 0; z < dims[2]; z++) values[i++] = f(o[0] + x * h, o[1] + y * h, o[2] + z * h);
  const m = surfaceNets({ values, dims, origin: o, spacing: h });
  m.normals = smoothNormals(m.positions, m.indices);
  return m;
}

/** Torus of major radius R and tube r around axis n through c. */
const torusAt = (c: V3, n: V3, R: number, r: number): Sdf => (x, y, z) => {
  const q: V3 = [x - c[0], y - c[1], z - c[2]];
  const h = v3.dot(q, n);
  const rad = Math.hypot(q[0] - n[0] * h, q[1] - n[1] * h, q[2] - n[2] * h);
  return Math.hypot(rad - R, h) - r;
};
/** Rounded box in the frame (t, u, n) centred at c with half-extents e. */
const boxAt = (c: V3, t: V3, u: V3, n: V3, e: V3, r: number): Sdf => (x, y, z) => {
  const q: V3 = [x - c[0], y - c[1], z - c[2]];
  const a = Math.abs(v3.dot(q, t)) - e[0] + r, b = Math.abs(v3.dot(q, u)) - e[1] + r, d = Math.abs(v3.dot(q, n)) - e[2] + r;
  return Math.hypot(Math.max(a, 0), Math.max(b, 0), Math.max(d, 0)) + Math.min(Math.max(a, b, d), 0) - r;
};
const unionSdf = (...fs: Sdf[]): Sdf => (x, y, z) => {
  let d = Infinity;
  for (const f of fs) d = Math.min(d, f(x, y, z));
  return d;
};
const gradient = (f: Sdf, p: V3, e = 0.002): V3 => v3.unit([f(p[0] + e, p[1], p[2]) - f(p[0] - e, p[1], p[2]), f(p[0], p[1] + e, p[2]) - f(p[0], p[1] - e, p[2]), f(p[0], p[1], p[2] + e) - f(p[0], p[1], p[2] - e)]);

/** March a point to the iso-surface f = level along f's gradient. */
function project(f: Sdf, p: V3, level: number): { p: V3; n: V3 } {
  let q: V3 = [...p];
  for (let it = 0; it < 40; it++) {
    const d = f(q[0], q[1], q[2]) - level;
    if (Math.abs(d) < 2e-4) break;
    const g = gradient(f, q);
    const s = Math.max(-0.01, Math.min(0.01, d));
    q = v3.add(q, g, -s);
  }
  return { p: q, n: gradient(f, q) };
}

/**
 * Where a ray from inside a garment leaves its OUTER face: march out from
 * `o` along `d`, remember the last point inside the solid, stop at the
 * first outside point after it. The normal is the outward ray direction
 * blended with the field's gradient, so it is never degenerate.
 */
function rayExit(f: Sdf, o: V3, d: V3, maxLen = 0.4): { p: V3; n: V3 } | null {
  let seen = false, last: V3 | null = null;
  for (let t = 0; t < maxLen; t += 0.0008) {
    const p = v3.add(o, d, t);
    const inside = f(p[0], p[1], p[2]) < 0;
    if (inside) [seen, last] = [true, p];
    else if (seen && last) {
      const g = gradient(f, p);
      const n = v3.unit(v3.add(g, d, v3.len(g) > 0.5 ? 0.3 : 1));
      return { p, n };
    }
  }
  return null;
}

function boundsOf(m: Mesh, pad = 0.004): { lo: V3; hi: V3 } {
  const lo: V3 = [Infinity, Infinity, Infinity], hi: V3 = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < m.positions.length; i += 3)
    for (let a = 0; a < 3; a++) {
      lo[a] = Math.min(lo[a], m.positions[i + a] - pad);
      hi[a] = Math.max(hi[a], m.positions[i + a] + pad);
    }
  return { lo, hi };
}

/** Subdivide a relaxed sheet once, carrying its rest positions and normals. */
function refine(s: Sheet): Sheet {
  const r = loopSubdivide(s.indices, [{ data: s.positions, stride: 3 }, { data: s.rest, stride: 3 }, { data: s.restNormal, stride: 3 }], 1);
  const rn = r.attrs[2].data;
  for (let i = 0; i < rn.length; i += 3) {
    const l = Math.hypot(rn[i], rn[i + 1], rn[i + 2]) || 1;
    rn[i] /= l;
    rn[i + 1] /= l;
    rn[i + 2] /= l;
  }
  return { positions: r.attrs[0].data, rest: r.attrs[1].data, restNormal: rn, indices: r.indices };
}

/** Displace a sheet along its own normals by `d(v)` metres. */
function displace(s: Sheet, d: (v: number, p: V3, rest: V3) => number): void {
  const n = smoothNormals(s.positions, s.indices);
  const nv = s.positions.length / 3;
  for (let v = 0; v < nv; v++) {
    const k = d(v, [s.positions[3 * v], s.positions[3 * v + 1], s.positions[3 * v + 2]], [s.rest[3 * v], s.rest[3 * v + 1], s.rest[3 * v + 2]]);
    if (!k) continue;
    for (let c = 0; c < 3; c++) s.positions[3 * v + c] += n[3 * v + c] * k;
  }
}

/** The piece of her skin a pattern covers. */
function cut(ctx: WardrobeContext, g: (x: number, y: number, z: number) => number, labels: number[]): Sheet {
  const { positions, normals, indices, labels: L } = ctx.surf;
  const ok = new Set(labels);
  return largestPieces(clipSurface(positions, normals, indices, g, (t) => ok.has(L[t])), labels.includes(ctx.labels.feet) ? 2 : 1);
}

/** Front-most (dir = +1) or back-most (−1) vertex of a mesh near (x, y). */
function surfaceAt(m: Mesh, x: number, y: number, dir: 1 | -1, tol = 0.006): { p: V3; n: V3 } | null {
  let best = -1, bz = -Infinity;
  const N = m.normals!;
  for (let v = 0; v < m.positions.length / 3; v++) {
    const px = m.positions[3 * v], py = m.positions[3 * v + 1], pz = m.positions[3 * v + 2];
    if (Math.abs(px - x) > tol || Math.abs(py - y) > tol) continue;
    if (dir * pz > bz && dir * N[3 * v + 2] > 0) [bz, best] = [dir * pz, v];
  }
  if (best < 0) return null;
  return { p: [m.positions[3 * best], m.positions[3 * best + 1], m.positions[3 * best + 2]], n: [N[3 * best], N[3 * best + 1], N[3 * best + 2]] };
}

/** A strap lying on a surface: the path is projected onto the iso-level `level` of `f`. */
function strapOn(f: Sdf, path: V3[], level: number, halfWidth: number, halfThick: number, samples = 40): { mesh: Mesh; pts: V3[]; sd: Sdf } {
  // resample the control path (Catmull-Rom) then project every sample
  const pts: V3[] = [], ups: V3[] = [];
  const P = (i: number) => path[Math.max(0, Math.min(path.length - 1, i))];
  for (let s = 0; s <= samples; s++) {
    const u = (s / samples) * (path.length - 1);
    const i = Math.min(path.length - 2, Math.floor(u)), t = u - i;
    const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2);
    const q: V3 = [0, 1, 2].map((a) => 0.5 * (2 * p1[a] + (-p0[a] + p2[a]) * t + (2 * p0[a] - 5 * p1[a] + 4 * p2[a] - p3[a]) * t * t + (-p0[a] + 3 * p1[a] - 3 * p2[a] + p3[a]) * t * t * t)) as V3;
    const pr = project(f, q, level);
    pts.push(pr.p);
    ups.push(pr.n);
  }
  const mesh = sweep(pts, { profile: "rect", width: halfWidth, height: halfThick, up: (i) => ups[i] });
  mesh.normals = smoothNormals(mesh.positions, mesh.indices);
  const dist = polylineDistance(pts);
  return { mesh, pts, sd: (x, y, z) => dist(x, y, z) - halfThick * 1.2 };
}

function cord(pts: V3[], r: number): { mesh: Mesh; sd: Sdf } {
  const mesh = sweep(pts, { profile: "round", width: r, height: r, sides: 6 });
  mesh.normals = smoothNormals(mesh.positions, mesh.indices);
  const dist = polylineDistance(pts);
  return { mesh, sd: (x, y, z) => dist(x, y, z) - r };
}

/**
 * A garment's solid from its shell's distance field, by UNSIGNED distance.
 * Ray-parity sign is exact only for a perfectly closed, non-self-touching
 * mesh; one bad column floods a whole box (it did: the trousers claimed
 * their entire bounding box). |d| − half needs no sign at all.
 */
const solidOf = (f: Sdf, half: number): Sdf => (x, y, z) => Math.abs(f(x, y, z)) - half;

/** A ring as a swept closed tube: exact topology, a few hundred triangles. */
function ring(c: V3, n: V3, R: number, r: number, segs = 28): { mesh: Mesh; sd: Sdf } {
  const u = v3.unit(v3.cross(n, Math.abs(n[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]));
  const w = v3.cross(n, u);
  const pts: V3[] = [];
  for (let k = 0; k <= segs; k++) {
    const a = (2 * Math.PI * k) / segs;
    pts.push(v3.add(v3.add(c, u, R * Math.cos(a)), w, R * Math.sin(a)));
  }
  const mesh = sweep(pts, { profile: "round", width: r, height: r, sides: 8 });
  mesh.normals = smoothNormals(mesh.positions, mesh.indices);
  return { mesh, sd: torusAt(c, n, R, r) };
}

/**
 * A band (belt, strap) cut from a garment's own outer sheet between two
 * heights, lifted off it and thickened: it follows the garment exactly,
 * has one outer face only, and is closed by construction.
 */
function bandFrom(s: Sheet, yLo: number, yHi: number, lift: number, thick: number, keep: (p: V3) => boolean = () => true): { mesh: Mesh; sd: Sdf } {
  const n = smoothNormals(s.positions, s.indices);
  const piece = clipSurface(s.positions, n, s.indices, (_x, y, _z) => Math.max(yLo - y, y - yHi), (t) => {
    const a = 3 * s.indices[3 * t];
    return keep([s.positions[a], s.positions[a + 1], s.positions[a + 2]]);
  });
  for (let v = 0; v < piece.positions.length / 3; v++) for (let c = 0; c < 3; c++) piece.positions[3 * v + c] += piece.restNormal[3 * v + c] * (lift + thick);
  const mesh = thicken(piece.positions, piece.indices, thick, 0.5);
  const f = fieldSdf(fieldFromMesh(mesh.positions, mesh.indices, 0.002, 3, 3));
  return { mesh, sd: solidOf(f, thick / 2) };
}

/**
 * The vertices her skin triangles actually use. The CC0 base mesh also holds
 * helper geometry (tights, skirt and hair helpers) that no body triangle
 * references; measuring "every vertex" measured those too.
 */
const skinCache = new WeakMap<Uint32Array, number[]>();
function skinVertices(ctx: WardrobeContext): number[] {
  let r = skinCache.get(ctx.surf.indices);
  if (!r) {
    const used = new Uint8Array(ctx.surf.positions.length / 3);
    for (const i of ctx.surf.indices) used[i] = 1;
    r = [];
    for (let v = 0; v < used.length; v++) if (used[v]) r.push(v);
    skinCache.set(ctx.surf.indices, r);
  }
  return r;
}

/* ------------------------------- landmarks ------------------------------- */
function landmarks(ctx: WardrobeContext) {
  const P = ctx.surf.positions;
  let bust: V3 = [0.09, 1.24, 0.12], bz = -Infinity, crotchY = Infinity;
  for (const v of skinVertices(ctx)) {
    const x = P[3 * v], y = P[3 * v + 1], z = P[3 * v + 2];
    if (x > 0.04 && x < 0.14 && y > 1.1 && y < 1.36 && z > bz) [bz, bust] = [z, [x, y, z]];
    if (Math.abs(x) < 0.012 && y > 0.6 && y < 1.0 && y < crotchY) crotchY = y;
  }
  const J = ctx.joint;
  return {
    bust,
    crotchY,
    pelvisY: J("joint-pelvis")[1],
    kneeY: J("joint-l-knee")[1],
    ankleY: J("joint-l-ankle")[1],
    shoulderY: J("joint-l-shoulder")[1],
    neckY: J("joint-neck")[1],
  };
}

/* --------------------------------- corset -------------------------------- */
function buildCorset(ctx: WardrobeContext, lm: ReturnType<typeof landmarks>) {
  const { bust, pelvisY } = lm;
  const bx = bust[0], by = bust[1];
  // pattern: sweetheart neckline over cupped bust, straight back, hem tucked
  // into the trousers' high waist
  const front = (z: number) => smoothstep(-0.03, 0.06, z);
  const top = (x: number, z: number) => {
    const cup = Math.exp(-(((Math.abs(x) - bx) / 0.056) ** 2));
    const frontTop = by - 0.012 + 0.056 * cup;
    return frontTop * front(z) + (by - 0.035) * (1 - front(z));
  };
  const bottom = pelvisY + 0.05;
  const g = (x: number, y: number, z: number) => Math.max(bottom - y, y - top(x, z));
  const sheet = cut(ctx, g, [ctx.labels.torso, ctx.labels.pelvis, ctx.labels.neck]);
  relaxOutside(sheet, ctx.body, () => 0.0045, 30, 0.5);
  const fine = refine(sheet);
  // boning channels: raised ridges around her, the structure of a corset
  const BONES = [0.22, 0.62, 1.05, 1.5, 2.05, 2.6];
  const zc = ctx.joint("joint-spine-3")[2];
  const boneAt = (p: V3) => {
    const th = Math.atan2(p[0], p[2] - zc), r = Math.hypot(p[0], p[2] - zc);
    let d = Infinity;
    for (const b of BONES) d = Math.min(d, Math.abs(Math.abs(th) - b) * r);
    return d;
  };
  displace(fine, (_v, p, rest) => {
    const d = boneAt(p);
    const hem = Math.min(rest[1] - bottom, top(rest[0], rest[2]) - rest[1]);
    return (d < 0.004 ? 0.0011 * Math.cos((d / 0.004) * Math.PI * 0.5) : 0) + (hem < 0.007 ? 0.0009 : 0);
  });
  relaxOutside(fine, ctx.body, () => 0.0042, 0);
  const shell = thicken(fine.positions, fine.indices, 0.003, 0.7);
  const nvOuter = fine.positions.length / 3;
  const corset = paint(shell, (p, n, v) => {
    const rv = v < nvOuter ? v : v < 2 * nvOuter ? v - nvOuter : -1;
    const rest: V3 = rv >= 0 ? [fine.rest[3 * rv], fine.rest[3 * rv + 1], fine.rest[3 * rv + 2]] : p;
    const hem = Math.min(rest[1] - bottom, top(rest[0], rest[2]) - rest[1]);
    if (rv < 0 || hem < 0.0065) return [[0.66, 0.42, 0.4], MAT.satin]; // blush satin piping
    if (rv >= nvOuter) return [CAMO.black, MAT.cloth]; // lining
    if (boneAt(p) < 0.0032) return [[0.08, 0.07, 0.07], MAT.leather];
    if (Math.abs(p[0]) < 0.006 && p[2] > 0) return [[0.08, 0.07, 0.07], MAT.leather]; // centre-front busk
    let c = camo(p[0], p[1], p[2], 9, 3);
    const r = rose(p[0], p[1], p[2], n, 0.085, 11);
    if (r) c = mix(c, r.c, r.a);
    // a little weave so flat camo still reads as cloth
    c = scale(c, 0.92 + 0.08 * fbm(p[0] * 400, p[1] * 400, p[2] * 400, 2, 1));
    return [c, MAT.cloth];
  });

  const parts: Mesh[] = [corset];
  const occ: Sdf[] = [];
  const cf = solidOf(fieldSdf(fieldFromMesh(shell.positions, shell.indices, 0.0025, 3, 4)), 0.0016);
  occ.push(cf);
  const onCorset = unionSdf(ctx.body, cf);
  const metal: Rgb = [0.72, 0.42, 0.3];

  // centre-front O-ring and strap under the bust (ref: clothing-corset-top)
  const ringAt = surfaceAt(shell, 0, by - 0.05, 1);
  if (ringAt) {
    const c = v3.add(ringAt.p, ringAt.n, 0.004);
    const o = ring(c, ringAt.n, 0.012, 0.0028);
    parts.push(paint(o.mesh, () => [metal, MAT.metal]));
    occ.push(o.sd);
    const s = strapOn(onCorset, [[0, by - 0.064, c[2]], [0, (by - 0.064 + bottom) / 2, c[2]], [0, bottom + 0.02, c[2]]], 0.0015, 0.008, 0.0016, 24);
    parts.push(paint(s.mesh, () => [[0.08, 0.07, 0.07], MAT.leather]));
    occ.push(s.sd);
  }
  // shoulder straps, front cup to back, over the top of each shoulder
  for (const sx of [1, -1]) {
    const f0 = surfaceAt(shell, sx * bx, top(bx, 0.1) - 0.008, 1, 0.01);
    const b0 = surfaceAt(shell, sx * (bx - 0.005), by - 0.04, -1, 0.012);
    if (!f0 || !b0) continue;
    const path: V3[] = [f0.p, [sx * 0.098, lm.shoulderY + 0.005, 0.07], [sx * 0.102, lm.shoulderY + 0.045, 0.0], [sx * 0.098, lm.shoulderY + 0.0, -0.075], b0.p];
    const s = strapOn(onCorset, path, 0.0015, 0.0065, 0.0016, 48);
    parts.push(paint(s.mesh, () => [[0.08, 0.07, 0.07], MAT.leather]));
    occ.push(s.sd);
    for (const end of [s.pts[2], s.pts[s.pts.length - 3]]) {
      const n = gradient(onCorset, end);
      const c = v3.add(end, n, 0.0035);
      const st = (x: number, y: number, z: number) => Math.hypot(x - c[0], y - c[1], z - c[2]) - 0.0035;
      parts.push(paint(meshSdf(st, v3.add(c, [-0.005, -0.005, -0.005]), v3.add(c, [0.005, 0.005, 0.005]), 0.0006), () => [metal, MAT.metal]));
      occ.push(st);
    }
  }
  // back lacing: two columns of grommets and criss-crossed laces
  const grom: [V3[], V3[]] = [[], []];
  for (let y = bottom + 0.035; y < by - 0.05; y += 0.024)
    for (const [k, sx] of [[0, 1], [1, -1]] as const) {
      const a = surfaceAt(shell, sx * 0.02, y, -1, 0.006);
      if (!a) continue;
      const c = v3.add(a.p, a.n, 0.0012);
      grom[k].push(c);
      const o = ring(c, a.n, 0.0034, 0.0013, 16);
      parts.push(paint(o.mesh, () => [metal, MAT.metal]));
      occ.push(o.sd);
    }
  const n = Math.min(grom[0].length, grom[1].length);
  for (let i = 0; i + 1 < n; i++)
    for (const [a, b] of [[grom[0][i], grom[1][i + 1]], [grom[1][i], grom[0][i + 1]]]) {
      const mid = v3.add(v3.add(a, b), [0, 0, -0.004 * 2], 0.5);
      const c = cord([a, [mid[0] * 0.5, mid[1] * 0.5, (a[2] + b[2]) / 2 - 0.003], b], 0.0012);
      parts.push(paint(c.mesh, () => [[0.1, 0.06, 0.07], MAT.satin]));
      occ.push(c.sd);
    }
  audit("corset", parts, ["shell"]);
  const mesh = mergeMeshes(parts);
  const b = boundsOf(mesh, 0.01);
  return { garment: { mesh, f: unionSdf(...occ), lo: b.lo, hi: b.hi }, field: cf, outerCount: nvOuter };
}

/* --------------------------------- boots --------------------------------- */
function convexHull(pts: [number, number][]): [number, number][] {
  const p = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const crossz = (o: [number, number], a: [number, number], b: [number, number]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: [number, number][] = [], upper: [number, number][] = [];
  for (const q of p) {
    while (lower.length >= 2 && crossz(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop();
    lower.push(q);
  }
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i];
    while (upper.length >= 2 && crossz(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop();
    upper.push(q);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}
/** Signed distance to a convex polygon (counter-clockwise) in the plane. */
function polySd(poly: [number, number][]): (x: number, z: number) => number {
  return (x, z) => {
    let inside = true, best = Infinity;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      const ex = b[0] - a[0], ez = b[1] - a[1];
      const t = Math.max(0, Math.min(1, ((x - a[0]) * ex + (z - a[1]) * ez) / (ex * ex + ez * ez)));
      best = Math.min(best, Math.hypot(x - a[0] - ex * t, z - a[1] - ez * t));
      if (ex * (z - a[1]) - ez * (x - a[0]) < 0) inside = false;
    }
    return inside ? -best : best;
  };
}

export const BOOT_TOP = 0.3;
export const SOLE_BOTTOM = -0.045;

function buildBoots(ctx: WardrobeContext, lm: ReturnType<typeof landmarks>) {
  // The toes are separate surfaces joined only at their base, so no amount of
  // relaxing turns them into a boot (each toe just becomes its own tube, and
  // the tubes intersect). The upper is cut at the toe base and the forefoot
  // is closed by a rigid toe cap below, as a real boot is built.
  const toeZ = Math.min(ctx.joint("joint-l-toe-1-1")[2], ctx.joint("joint-l-toe-5-1")[2]) - 0.012;
  const sheet = cut(ctx, (_x, y, z) => Math.max(y - BOOT_TOP, z - toeZ), [ctx.labels.feet, ctx.labels.legs]);
  relaxOutside(sheet, ctx.body, (v) => (sheet.rest[3 * v + 1] > lm.ankleY + 0.03 ? 0.0065 : 0.006), 45, 0.5);
  const fine = refine(sheet);
  // padded collar at the top of the shaft
  displace(fine, (_v, _p, rest) => (rest[1] > BOOT_TOP - 0.018 ? 0.0018 : 0));
  relaxOutside(fine, ctx.body, () => 0.005, 0);
  const shell = thicken(fine.positions, fine.indices, 0.0035, 0.8);
  const nvOuter = fine.positions.length / 3;
  const upper = paint(shell, (p, _n, v) => {
    const rv = v < nvOuter ? v : v < 2 * nvOuter ? v - nvOuter : -1;
    const ry = rv >= 0 ? fine.rest[3 * rv + 1] : BOOT_TOP;
    if (rv < 0 || ry > BOOT_TOP - 0.016) return [[0.05, 0.045, 0.045], MAT.leather];
    // her boots are camo-printed leather, much darker than the cloth
    const c = scale(camo(p[0], p[1], p[2], 14, 21), 0.42);
    return [c, MAT.leather];
  });
  const parts: Mesh[] = [upper];
  const bf = solidOf(fieldSdf(fieldFromMesh(shell.positions, shell.indices, 0.0025, 3, 4)), 0.0018);
  const occ: Sdf[] = [bf];
  const metal: Rgb = [0.72, 0.42, 0.3];
  const P = ctx.surf.positions;
  for (const sx of [1, -1]) {
    const a = ctx.joint(sx > 0 ? "joint-l-ankle" : "joint-r-ankle");
    // platform sole: the footprint's hull, extruded, lugged and split into heel and forefoot
    const fp: [number, number][] = [];
    for (const v of skinVertices(ctx)) if (P[3 * v + 1] < 0.035 && Math.sign(P[3 * v]) === sx && Math.abs(P[3 * v] - a[0]) < 0.12) fp.push([P[3 * v], P[3 * v + 2]]);
    const hull = convexHull(fp);
    const ps = polySd(hull);
    let zmin = Infinity, zmax = -Infinity;
    for (const [, z] of hull) [zmin, zmax] = [Math.min(zmin, z), Math.max(zmax, z)];
    const yb = SOLE_BOTTOM, yt = 0.022, yc = (yb + yt) / 2, hy = (yt - yb) / 2;
    const grow = (z: number) => 0.011 + 0.006 * smoothstep(zmax - 0.08, zmax, z);
    const heelEnd = zmin + 0.085, ballStart = zmax - 0.1;
    const sole: Sdf = (x, y, z) => {
      const r = 0.005;
      const dx = ps(x, z) - grow(z) + r, dy = Math.abs(y - yc) - hy + r;
      let d = Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) + Math.min(Math.max(dx, dy), 0) - r;
      // lugs: deep transverse grooves in the tread
      const groove = Math.max(y - (yb + 0.008), Math.abs(((z / 0.022) % 1 + 1) % 1 - 0.5) * 0.022 - 0.0045);
      d = Math.max(d, -groove);
      // arch: the heel block and the forefoot are separate on the ground
      const arch = Math.max(y - (yb + 0.013), Math.max(heelEnd - z, z - ballStart));
      return Math.max(d, -arch);
    };
    const lo: V3 = [a[0] - 0.09, yb - 0.004, zmin - 0.03], hi: V3 = [a[0] + 0.09, yt + 0.004, zmax + 0.03];
    parts.push(
      paint(meshSdf(sole, lo, hi, 0.0021), (p) => {
        // copper plates on the side wall at toe and heel (ref03 / clothing-platform-boots)
        const plate = p[1] > -0.016 && p[1] < 0.002 && ps(p[0], p[2]) > grow(p[2]) - 0.004 && (p[2] > zmax - 0.05 || p[2] < zmin + 0.04);
        if (plate) return [metal, MAT.metal];
        if (p[1] > yt - 0.005) return [[0.11, 0.1, 0.1], MAT.rubber];
        return [[0.035, 0.032, 0.032], MAT.rubber];
      }),
    );
    occ.push(sole);
    // toe cap: a domed leather cap over the forefoot, its back edge an overlay
    // on the upper; sized from this foot's own toe vertices
    let x0 = Infinity, x1 = -Infinity, tip = -Infinity;
    const zb = toeZ - 0.035;
    // the foot's own height along its length, in 5 mm bins: the cap follows
    // the forefoot down to the toes instead of standing at instep height
    const BIN = 0.005, bins = new Float64Array(40).fill(0);
    for (const v of skinVertices(ctx)) {
      const x = P[3 * v], y = P[3 * v + 1], z = P[3 * v + 2];
      if (Math.sign(x) !== sx || Math.abs(x - a[0]) > 0.12 || y > 0.12 || z < zb) continue;
      [x0, x1, tip] = [Math.min(x0, x), Math.max(x1, x), Math.max(tip, z)];
      const k = Math.min(39, Math.floor((z - zb) / BIN));
      bins[k] = Math.max(bins[k], y);
    }
    for (let k = 1; k < 40; k++) if (!bins[k]) bins[k] = bins[k - 1];
    const sm = bins.map((_, k) => (bins[Math.max(0, k - 1)] + 2 * bins[k] + bins[Math.min(39, k + 1)]) / 4);
    const height = (z: number) => {
      const u = Math.max(0, Math.min(38.999, (z - zb) / BIN));
      const k = Math.floor(u);
      return sm[k] + (sm[k + 1] - sm[k]) * (u - k);
    };
    const cx = (x0 + x1) / 2, rx = (x1 - x0) / 2 + 0.011;
    const zc = toeZ + 0.02, rz = tip + 0.018 - zc;
    const cap: Sdf = (x, y, z) => {
      const ry = height(Math.min(z, tip)) + 0.015;
      const u = Math.max(0, z - zc) / rz;
      const k = Math.cbrt(Math.abs((x - cx) / rx) ** 3 + Math.abs(y / ry) ** 3 + u ** 3);
      const e = (k - 1) * Math.min(rx, ry, rz) * 0.8;
      return Math.max(e, zb - 0.002 - z, -y - 0.01);
    };
    const ryBack = height(zb) + 0.012;
    parts.push(
      paint(meshSdf(cap, [cx - rx - 0.01, -0.02, zb - 0.01], [cx + rx + 0.01, ryBack + 0.01, tip + 0.03], 0.0016), (p) => {
        const stitch = Math.abs(p[2] - (zb + 0.006)) < 0.0007;
        return [stitch ? [0.4, 0.3, 0.26] : scale(camo(p[0], p[1], p[2], 14, 23), 0.38), MAT.leather];
      }),
    );
    occ.push(cap);
    // laces up the front: eyelet pairs, criss-crossed cord
    const pairs: [V3, V3][] = [];
    for (let y = 0.075; y < BOOT_TOP - 0.03; y += 0.026) {
      const f = surfaceAt(shell, a[0], y, 1, 0.01);
      if (!f) continue;
      const lat = v3.unit(v3.cross([0, 1, 0], f.n));
      const L = v3.add(v3.add(f.p, lat, 0.0115), f.n, 0.0008), R = v3.add(v3.add(f.p, lat, -0.0115), f.n, 0.0008);
      pairs.push([L, R]);
      for (const c of [L, R]) {
        const o = ring(c, f.n, 0.0032, 0.0012, 16);
        parts.push(paint(o.mesh, () => [metal, MAT.metal]));
        occ.push(o.sd);
      }
    }
    for (let i = 0; i + 1 < pairs.length; i++)
      for (const [p, q] of [[pairs[i][0], pairs[i + 1][1]], [pairs[i][1], pairs[i + 1][0]]]) {
        const lift = v3.unit(v3.sub(v3.add(p, q, 1), [a[0] * 2, (p[1] + q[1]), a[2] * 2]));
        const mid = v3.add(v3.add(p, q, 1), lift, 0.004);
        const c = cord([p, [mid[0] / 2, mid[1] / 2, mid[2] / 2], q], 0.0013);
        parts.push(paint(c.mesh, () => [[0.03, 0.03, 0.03], MAT.satin]));
        occ.push(c.sd);
      }
    // two buckled straps around the ankle and the shaft
    for (const ys of [0.13, 0.205]) {
      const band = bandFrom(fine, ys - 0.0085, ys + 0.0085, 0.0008, 0.0026, (p) => Math.sign(p[0]) === sx);
      parts.push(paint(band.mesh, () => [[0.07, 0.06, 0.06], MAT.leather]));
      occ.push(band.sd);
      // buckle on the outer side
      const outer = rayExit(bf, [a[0], ys, a[2] + 0.01], v3.unit([sx, 0, 0.15]));
      if (!outer) continue;
      const t = v3.unit(v3.cross([0, 1, 0], outer.n));
      const frame: Sdf = (x, y, z) => {
        const o = boxAt(outer.p, t, [0, 1, 0], outer.n, [0.011, 0.012, 0.0022], 0.0012)(x, y, z);
        const i = boxAt(outer.p, t, [0, 1, 0], outer.n, [0.0065, 0.0075, 0.006], 0.0008)(x, y, z);
        return Math.max(o, -i);
      };
      parts.push(paint(meshSdf(frame, v3.add(outer.p, [-0.016, -0.016, -0.016]), v3.add(outer.p, [0.016, 0.016, 0.016]), 0.0005), () => [metal, MAT.metal]));
      occ.push(frame);
    }
  }
  audit("boots", parts, ["shell"]);
  const mesh = mergeMeshes(parts);
  const b = boundsOf(mesh, 0.01);
  return { garment: { mesh, f: unionSdf(...occ), lo: b.lo, hi: b.hi }, field: bf };
}

/* -------------------------------- trousers ------------------------------- */
function buildCargo(ctx: WardrobeContext, lm: ReturnType<typeof landmarks>, under: Sdf) {
  const { pelvisY, crotchY, kneeY } = lm;
  const waistTop = pelvisY + 0.115;
  const cuffY = 0.215;
  const sheet = cut(ctx, (_x, y) => Math.max(y - waistTop, cuffY - y), [ctx.labels.pelvis, ctx.labels.legs, ctx.labels.torso]);
  const J = ctx.joint;
  const axis = (s: number): V3[] => (s > 0 ? [J("joint-l-upper-leg"), J("joint-l-knee"), J("joint-l-ankle")] : [J("joint-r-upper-leg"), J("joint-r-knee"), J("joint-r-ankle")]);
  const axes = { 1: axis(1), [-1]: axis(-1) } as Record<number, V3[]>;
  /** Closest point on the leg axis and the radial frame around it. */
  const onAxis = (p: V3) => {
    const s = p[0] >= 0 ? 1 : -1;
    const A = axes[s];
    let best = { c: A[0], d: Infinity, along: A[1] };
    for (let i = 0; i + 1 < A.length; i++) {
      const ab = v3.sub(A[i + 1], A[i]);
      const t = Math.max(0, Math.min(1, v3.dot(v3.sub(p, A[i]), ab) / v3.dot(ab, ab)));
      const c = v3.add(A[i], ab, t);
      const d = v3.len(v3.sub(p, c));
      if (d < best.d) best = { c, d, along: v3.unit(ab) };
    }
    return { s, ...best };
  };
  // the silhouette of her cargo: full through the thigh and knee, gathered at the ankle
  const profile: [number, number][] = [[crotchY + 0.02, 0.135], [crotchY - 0.12, 0.142], [kneeY, 0.136], [0.4, 0.128], [0.33, 0.12], [cuffY + 0.05, 0.1], [cuffY, 0.078]];
  const Rt = (y: number) => {
    if (y >= profile[0][0]) return profile[0][1];
    for (let i = 0; i + 1 < profile.length; i++) {
      const [y0, r0] = profile[i], [y1, r1] = profile[i + 1];
      if (y <= y0 && y >= y1) return r0 + ((y - y0) / (y1 - y0)) * (r1 - r0);
    }
    return profile[profile.length - 1][1];
  };
  const legW = (y: number) => smoothstep(crotchY + 0.06, crotchY - 0.05, y);
  const nv = sheet.positions.length / 3;
  for (let v = 0; v < nv; v++) {
    const p: V3 = [sheet.rest[3 * v], sheet.rest[3 * v + 1], sheet.rest[3 * v + 2]];
    const n: V3 = [sheet.restNormal[3 * v], sheet.restNormal[3 * v + 1], sheet.restNormal[3 * v + 2]];
    let q = v3.add(p, n, 0.007);
    const w = legW(p[1]);
    if (w > 0) {
      const a = onAxis(p);
      const dir = v3.unit(v3.sub(p, a.c));
      const r = a.d + 0.007;
      const rNew = Math.max(r, r + (Rt(p[1]) - r) * w);
      q = v3.add(a.c, dir, rNew);
      q = [q[0], p[1] + (q[1] - p[1]) * 0.3, q[2]];
    }
    sheet.positions.set(q, 3 * v);
  }
  // the two legs meet at the crotch seam; neither crosses her midline
  const midline = (v: number, P: Float32Array) => {
    const s = sheet.rest[3 * v] >= 0 ? 1 : -1;
    if (sheet.rest[3 * v + 1] < crotchY + 0.01 && s * P[3 * v] < 0.004) P[3 * v] = s * 0.004;
  };
  const standoff = (v: number) => (sheet.rest[3 * v + 1] > pelvisY + 0.02 ? 0.0075 : 0.0065);
  relaxOutside(sheet, under, standoff, 35, 0.5, midline);
  const fine = refine(sheet);
  // folds: stacked bunching above the cuff, creases across the knee, drape down the thigh
  displace(fine, (_v, _p, rest) => {
    const y = rest[1];
    const w = legW(y);
    if (w <= 0) return y > waistTop - 0.035 ? 0.0012 : 0;
    const a = onAxis(rest);
    const dir = v3.unit(v3.sub(rest, a.c));
    const th = Math.atan2(dir[0] * a.s, dir[2]);
    let d = 0;
    d += 0.0032 * Math.exp(-(((y - kneeY) / 0.05) ** 2)) * Math.sin((2 * Math.PI * y) / 0.034 + 1.7 * Math.sin(th));
    const stack = smoothstep(cuffY + 0.14, cuffY + 0.01, y);
    d += 0.0095 * stack * Math.abs(Math.sin((2 * Math.PI * (y + 0.008 * Math.sin(3 * th + 1))) / 0.032));
    d += 0.0022 * w * Math.sin(5 * th + 9 * y) * (1 - stack);
    return d;
  });
  relaxOutside(fine, under, () => 0.006, 0);
  const shell = thicken(fine.positions, fine.indices, 0.0035, 0.8);
  const nvOuter = fine.positions.length / 3;
  const cargo = paint(shell, (p, n, v) => {
    const rv = v < nvOuter ? v : v < 2 * nvOuter ? v - nvOuter : -1;
    const rest: V3 = rv >= 0 ? [fine.rest[3 * rv], fine.rest[3 * rv + 1], fine.rest[3 * rv + 2]] : p;
    if (rv >= nvOuter) return [CAMO.black, MAT.cloth];
    if (rv < 0 || rest[1] > waistTop - 0.035) return [scale(camo(p[0], p[1], p[2], 10, 41), 0.6), MAT.cloth]; // waistband
    // dark rose cargo: black-plum ground under big blooms (clothing-cargo-pants-boots)
    let c = mix(camo(p[0], p[1], p[2], 7, 37), [0.1, 0.07, 0.09], 0.45);
    const r = rose(p[0], p[1], p[2], n, 0.12, 29);
    if (r) c = mix(c, mix(r.c, ROSE.mauve, 0.25), r.a * 0.9);
    // side seam
    const a = onAxis(rest);
    const dir = v3.unit(v3.sub(rest, a.c));
    if (legW(rest[1]) > 0.5 && Math.abs(dir[2]) < 0.06 && dir[0] * a.s > 0) c = scale(c, 0.55);
    c = scale(c, 0.93 + 0.07 * fbm(p[0] * 380, p[1] * 380, p[2] * 380, 9, 1));
    return [c, MAT.cloth];
  });
  const parts: Mesh[] = [cargo];
  const tf = solidOf(fieldSdf(fieldFromMesh(shell.positions, shell.indices, 0.0025, 3, 4)), 0.0018);
  const occ: Sdf[] = [tf];
  const metal: Rgb = [0.72, 0.42, 0.3];
  const leather: Rgb = [0.06, 0.05, 0.05];

  // wide leather belt on the waistband, copper buckle at the front
  const beltY = pelvisY + 0.07;
  const belt = bandFrom(fine, beltY - 0.021, beltY + 0.021, 0.001, 0.0045);
  parts.push(
    paint(belt.mesh, (p) => {
      const edge = Math.abs(Math.abs(p[1] - beltY) - 0.016) < 0.0008;
      return [edge ? [0.36, 0.24, 0.2] : leather, MAT.leather];
    }),
  );
  occ.push(belt.sd);
  const bAt = surfaceAt(cargo, 0, beltY, 1, 0.006);
  if (bAt) {
    const c = v3.add(bAt.p, bAt.n, 0.0085);
    const t: V3 = [1, 0, 0];
    const up = v3.unit(v3.cross(bAt.n, t));
    const frame: Sdf = (x, y, z) => {
      const o = boxAt(c, t, up, bAt.n, [0.03, 0.026, 0.003], 0.002)(x, y, z);
      const i = boxAt(c, t, up, bAt.n, [0.021, 0.017, 0.008], 0.0015)(x, y, z);
      const bar = boxAt(v3.add(c, t, -0.004), t, up, bAt.n, [0.0025, 0.018, 0.0024], 0.0008)(x, y, z);
      return Math.min(Math.max(o, -i), bar);
    };
    parts.push(paint(meshSdf(frame, v3.add(c, [-0.036, -0.036, -0.036]), v3.add(c, [0.036, 0.036, 0.036]), 0.0006), () => [metal, MAT.metal]));
    occ.push(frame);
  }
  // hanging straps from the belt, with copper rings: blush, olive and black panels
  const outerLayer = unionSdf(tf, under);
  const straps: [number, number, Rgb][] = [[0.065, 0.24, [0.7, 0.52, 0.48]], [0.115, 0.3, [0.3, 0.3, 0.2]], [0.155, 0.2, [0.07, 0.06, 0.06]]];
  for (const sx of [1, -1])
    for (const [x0, len, col] of straps) {
      const start = surfaceAt(cargo, sx * x0, beltY - 0.022, 1, 0.01);
      if (!start) continue;
      const path: V3[] = [];
      for (let k = 0; k <= 4; k++) path.push([start.p[0] + sx * 0.012 * k, beltY - 0.022 - (len * k) / 4, start.p[2] + 0.05]);
      const s = strapOn(outerLayer, path, 0.0025, 0.014, 0.0016, 30);
      parts.push(paint(s.mesh, (p) => [scale(col, 0.9 + 0.1 * fbm(p[0] * 200, p[1] * 200, p[2] * 200, 4, 1)), MAT.leather]));
      occ.push(s.sd);
      const end = s.pts[s.pts.length - 1];
      const n = gradient(outerLayer, end);
      const c = v3.add(v3.add(end, [0, -0.012, 0]), n, 0.004);
      const o = ring(c, v3.unit(v3.cross([0, 1, 0], n)), 0.009, 0.0022);
      parts.push(paint(o.mesh, () => [metal, MAT.metal]));
      occ.push(o.sd);
    }
  // cargo pockets: big bellows pockets on the outer thighs, smaller ones on the shins
  for (const sx of [1, -1])
    for (const [py, hw, hh, hd] of [[0.62, 0.064, 0.08, 0.011], [0.37, 0.05, 0.056, 0.009]] as const) {
      const a = onAxis([sx * 0.15, py, 0]);
      const hit = rayExit(tf, a.c, v3.unit([sx, 0, 0.35]));
      if (!hit) continue;
      const surf = hit;
      const n = hit.n;
      const t = v3.unit(v3.cross([0, 1, 0], n));
      const up = v3.cross(n, t);
      const c = v3.add(surf.p, n, hd * 0.25);
      const body: Sdf = boxAt(c, t, up, n, [hw, hh, hd], 0.008);
      const flapC = v3.add(v3.add(c, up, hh - 0.012), n, hd * 0.9);
      const flap: Sdf = boxAt(flapC, t, up, n, [hw + 0.004, 0.02, 0.0035], 0.003);
      const snapC = v3.add(v3.add(flapC, up, -0.01), n, 0.004);
      const snap: Sdf = (x, y, z) => Math.hypot(x - snapC[0], y - snapC[1], z - snapC[2]) - 0.0042;
      const R = Math.max(hw, hh) + 0.02;
      parts.push(
        paint(meshSdf(unionSdf(body, flap), v3.add(c, [-R, -R, -R]), v3.add(c, [R, R, R]), 0.002), (p, nn) => {
          let col = mix(camo(p[0], p[1], p[2], 9, 53), CAMO.black, 0.35);
          if (flap(p[0], p[1], p[2]) < 0.0015) col = scale(col, 0.75);
          const r = rose(p[0], p[1], p[2], nn, 0.07, 61);
          if (r) col = mix(col, r.c, r.a * 0.7);
          return [col, MAT.cloth];
        }),
      );
      parts.push(paint(meshSdf(snap, v3.add(snapC, [-0.006, -0.006, -0.006]), v3.add(snapC, [0.006, 0.006, 0.006]), 0.0005), () => [metal, MAT.metal]));
      occ.push(body, flap, snap);
    }
  if (process.env.LELU_WARDROBE_DEBUG) {
    const b0 = boundsOf(mergeMeshes(parts), 0.01);
    const fp: V3 = [b0.lo[0] + 0.02, (b0.lo[1] + b0.hi[1]) / 2, b0.lo[2] + 0.02];
    occ.forEach((f, i) => { const v = f(...fp); if (v < 0) console.log("cargo occ", i, "negative far away:", v.toFixed(4)); });
  }
  audit("cargo", parts, ["shell"]);
  const mesh = mergeMeshes(parts);
  const b = boundsOf(mesh, 0.01);
  return { garment: { mesh, f: unionSdf(...occ), lo: b.lo, hi: b.hi }, field: tf, waistTop, cuffY };
}

/** Dress her: corset, then boots, then trousers over both. */
export function buildWardrobe(ctx: WardrobeContext): Wardrobe {
  const t0 = performance.now();
  const lm = landmarks(ctx);
  const corset = buildCorset(ctx, lm);
  const t1 = performance.now();
  const boots = buildBoots(ctx, lm);
  const t2 = performance.now();
  const under = unionSdf(ctx.body, corset.field, boots.field);
  const cargo = buildCargo(ctx, lm, under);
  const t3 = performance.now();
  void adjacency;
  return {
    top: corset.garment,
    bottom: cargo.garment,
    shoes: boots.garment,
    landmarks: { bust: lm.bust, crotchY: lm.crotchY, waistTop: cargo.waistTop, cuffY: cargo.cuffY, bootTop: BOOT_TOP, soleBottom: SOLE_BOTTOM },
    stats: { corsetMs: Math.round(t1 - t0), bootsMs: Math.round(t2 - t1), cargoMs: Math.round(t3 - t2) },
  };
}
