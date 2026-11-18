/**
 * ==========================================================
 * LÉLU ASRE — REFERENCE ANATOMY PROVIDER
 *
 * The seam between real CC0 anatomy and LÉLU's own generators. A loader
 * (Node) hands over a body mesh, its rig and its placed proxies; each
 * component builder asks for a Shape and gets reference geometry expressed as
 * an SDF with bounds — the exact contract the existing mesher, shared
 * lattice, occupancy cells and content keys already work with.
 *
 * Nothing here is required. With no reference installed every component
 * builds procedurally and produces byte-identical output to before.
 *
 * Each region is clipped by anatomical planes computed from the mesh's own
 * joints, so every region is a closed solid: capped, not torn. Fields are
 * built once per (digest, region, resolution, pose) and memoised.
 * ==========================================================
 */
import { plane } from "../character/sdf.ts";
import type { Sdf, V3 } from "../character/sdf.ts";
import { clip, group, softClip, union } from "../character/shape.ts";
import type { Shape } from "../character/shape.ts";
import type { CharacterSpec } from "../character/CharacterSpec.ts";
import { fieldFromMesh, fieldFromVoxels, fieldSdf, fieldShape } from "./field.ts";
import { CELL } from "../character/lattice.ts";
import { isLelu, LELU_COLOURS as L } from "../character/leluIdentity.ts";
import type { Rgb } from "../character/shape.ts";
import type { SdfField } from "./field.ts";
import { cross, skin, sub, unit } from "./skin.ts";
import type { BonePose, Rig } from "./skin.ts";

export interface RefProxy {
  /** Mesh in metres, placed on the body by its `.mhclo` mapping. */
  positions: Float32Array;
  indices: Uint32Array;
}

export interface ReferenceData {
  /** Digest of the asset selection and proportions: part of every component key. */
  digest: string;
  height: number;
  /** Body surface only (helpers and joint markers excluded), metres. */
  positions: Float32Array;
  indices: Uint32Array;
  rig: Rig;
  /** Joint markers by name, metres. */
  joints: Map<string, V3>;
  /** Placed proxies: eyes, teeth, hair, garments. */
  proxies: Record<string, RefProxy>;
  /** Which morph targets produced this body. */
  targets: string[];
}

/**
 * Canonical sampling resolution of every reference field, in metres.
 *
 * This is deliberately NOT the component's mesh resolution. A mesh→SDF field
 * is a sampled approximation: its zero set, its bounds and its stand-off
 * outside the grid all depend on the cell size. Building the same region at
 * two mesh resolutions therefore produced two slightly different solids, and
 * the whole-object baseline (which samples at the occupancy resolution) then
 * disagreed with the per-component build on ~1 % of cells — the 0.975
 * regression. One canonical field resolution for every path restores the
 * exact invariant: identical shape in, identical cells out.
 *
 * It must stay well below the thinnest shell the pipeline makes (the hair
 * shell, 8 mm ⇒ 2.7 cells here) so a shell never self-cancels.
 */
export const FIELD_H = 0.003;

/**
 * Articulated parts need a finer field than the body.
 *
 * A finger is ~16 mm across and the gaps between neighbouring fingers are
 * 3–5 mm. At 3 mm sampling the gap is often thinner than one cell, which is
 * exactly where surface nets produces non-manifold pinches — and blurring the
 * field enough to remove them merges the fingers into a mitten. Sampling the
 * hand and foot fields at 1.8 mm resolves the gaps instead of erasing them.
 * Still canonical, so both build paths see the same solid.
 */
export const ARTICULATED_FIELD_H = 0.0018;

let current: ReferenceData | null = null;
const fieldCache = new Map<string, SdfField>();
const shapeCache = new Map<string, Shape | null>();

export function installReference(data: ReferenceData | null): void {
  current = data;
  fieldCache.clear();
  shapeCache.clear();
}

export function referenceData(): ReferenceData | null {
  return current;
}

/** True when this spec asks for reference anatomy and one is installed. */
export function usesReference(spec: CharacterSpec): boolean {
  return current !== null && spec.anatomy?.source === "reference";
}

const J = (name: string): V3 => current?.joints.get(name) ?? [0, 0, 0];
const has = (name: string): boolean => !!current?.joints.get(name);

const SIDE = (side: 0 | 1) => (side === 0 ? "l" : "r");
const SIDEB = (side: 0 | 1) => (side === 0 ? "L" : "R");

/* -------------------------------- fields -------------------------------- */

const poseKey = (poses: BonePose[]) => (poses.length ? poses.map((p) => `${p.bone}:${p.angle.toFixed(4)}`).join(",") : "rest");

function bodyField(id: string, _h: number, poses: BonePose[], window: { lo: V3; hi: V3 } | null, blur = 0, fieldRes = FIELD_H): SdfField {
  const d = current!;
  const pk = poseKey(poses);
  const key = `${d.digest}|${id}|${fieldRes}|${pk}|${blur}|${window ? window.lo.join(",") + ":" + window.hi.join(",") : ""}`;
  const hit = fieldCache.get(key);
  if (hit) return hit;
  const positions = poses.length ? skin(d.positions, d.rig, poses) : d.positions;
  return remember(key, fieldFromMesh(positions, d.indices, fieldRes, 3, 4, window ?? undefined, blur));
}

/**
 * Cloth and shoes are sampled a little coarser than the body.
 *
 * A garment proxy covers the whole body, so its field is the biggest grid in
 * the pipeline; at 3 mm it exhausted the heap once the cloth became a shell.
 * 4 mm is still canonical (both build paths use it), still finer than the
 * 10 mm cloth thickness, and a quarter of the memory.
 */
export const GARMENT_FIELD_H = 0.004;

/** Fields are large; keep the cache bounded rather than growing into swap. */
const FIELD_CACHE_MAX = 20;
function remember(key: string, f: SdfField): SdfField {
  if (fieldCache.size >= FIELD_CACHE_MAX) {
    const oldest = fieldCache.keys().next().value;
    if (oldest !== undefined) fieldCache.delete(oldest);
  }
  fieldCache.set(key, f);
  return f;
}

function proxyField(name: string, _h: number): SdfField | null {
  const d = current!;
  const p = d.proxies[name];
  if (!p || !p.indices.length) return null;
  const res = name.includes("outfit") || name.includes("shoes") ? GARMENT_FIELD_H : FIELD_H;
  const key = `${d.digest}|proxy:${name}|${res}`;
  const hit = fieldCache.get(key);
  if (hit) return hit;
  return remember(key, fieldFromMesh(p.positions, p.indices, res, 3, 4));
}

/* ----------------------- articulation from the spec ---------------------- */

/**
 * Finger curl, spread and thumb opposition as real bone rotations, with axes
 * taken from the mesh's own joints: a digit bends about the axis
 * perpendicular to its length and the palm normal, and the palm normal is
 * read off the four finger bases. Angles are negative so the tips travel
 * toward the palm, not away from it.
 */
export function handPoses(spec: CharacterSpec, side: 0 | 1): BonePose[] {
  if (!current) return [];
  const s = SIDEB(side), l = SIDE(side);
  const poses: BonePose[] = [];
  const b2 = J(`joint-${l}-finger-2-1`), b5 = J(`joint-${l}-finger-5-1`), wrist = J(`joint-${l}-hand`);
  if (!has(`joint-${l}-finger-2-1`)) return poses;
  const palmN = unit(cross(sub(b2, b5), sub(wrist, b2)));
  const { curl, spread, opposition } = spec.hands;
  for (const f of [1, 2, 3, 4]) {
    if (!has(`joint-${l}-finger-${f}-1`) || !has(`joint-${l}-finger-${f}-4`)) continue;
    const dir = unit(sub(J(`joint-${l}-finger-${f}-4`), J(`joint-${l}-finger-${f}-1`)));
    const axis = unit(cross(dir, palmN));
    const amounts = [-1.35, -1.15, -0.85].map((k) => curl * k);
    for (let seg = 0; seg < 3; seg++) poses.push({ bone: `finger${f}-${seg + 1}.${s}`, axis, angle: amounts[seg] });
    if (spread) poses.push({ bone: `finger${f}-1.${s}`, axis: palmN, angle: (f < 3 ? 1 : -1) * spread * 0.16 });
  }
  const m1 = `metacarpal1.${s}`;
  if (has(`joint-${l}-finger-1-1`)) {
    const axis = unit(sub(J(`joint-${l}-finger-2-1`), J(`joint-${l}-finger-5-1`)));
    poses.push({ bone: m1, axis, angle: -opposition * 0.42 });
    poses.push({ bone: `finger1-1.${s}`, axis, angle: -curl * 0.35 });
  }
  return poses;
}

/** Toe curl: phalanges bend toward the sole; metatarsals hold the arch. */
export function footPoses(spec: CharacterSpec, side: 0 | 1): BonePose[] {
  if (!current) return [];
  const s = SIDEB(side), l = SIDE(side);
  const curl = spec.feet?.toeCurl ?? 0;
  if (!curl) return [];
  const ankle = J(`joint-${l}-ankle`), toe = J(`joint-${l}-toe-1-3`);
  const axis = unit(cross(unit(sub(toe, ankle)), [0, 1, 0]));
  const poses: BonePose[] = [];
  for (const t of [1, 2, 3, 4, 5])
    for (let seg = 1; seg <= 3; seg++) if (has(`joint-${l}-toe-${t}-${seg}`)) poses.push({ bone: `toe${t}-${seg}.${s}`, axis, angle: -curl * (seg === 1 ? 0.7 : 0.9) });
  return poses;
}

/**
 * Strand growth, per hairstyle: length in metres, how hard gravity pulls the
 * lock down, how kinked it is, how many locks, and how thick each is.
 */
const HAIR_STYLE: Record<string, { len: number; droop: number; wave: number; count: number; radius: number }> = {
  buzz: { len: 0.014, droop: 0.15, wave: 0.1, count: 1800, radius: 0.0036 },
  pixie: { len: 0.06, droop: 0.35, wave: 0.2, count: 1700, radius: 0.0042 },
  bob: { len: 0.15, droop: 0.7, wave: 0.18, count: 1700, radius: 0.0048 },
  lob: { len: 0.21, droop: 0.7, wave: 0.2, count: 1600, radius: 0.0048 },
  "long-straight": { len: 0.34, droop: 0.75, wave: 0.12, count: 1000, radius: 0.0046 },
  "long-wavy": { len: 0.34, droop: 0.62, wave: 1.15, count: 780, radius: 0.0046 },
  ponytail: { len: 0.3, droop: 0.7, wave: 0.16, count: 1500, radius: 0.0052 },
  "high-ponytail": { len: 0.3, droop: 0.65, wave: 0.18, count: 1450, radius: 0.0052 },
  afro: { len: 0.1, droop: 0.05, wave: 1.2, count: 2000, radius: 0.0046 },
  braids: { len: 0.36, droop: 0.75, wave: 0.35, count: 900, radius: 0.0060 },
  "top-knot": { len: 0.15, droop: 0.3, wave: 0.25, count: 1400, radius: 0.0050 },
  "double-buns": { len: 0.13, droop: 0.25, wave: 0.3, count: 1400, radius: 0.0050 },
};

/** Voxel size of the hair density grid: fine enough to keep locks apart. */
const HAIR_VOXEL_H = 0.0025;

/** Deterministic pseudo-random in [0,1) from three integers. */
function hash3(i: number, j: number, k = 0): number {
  let x = Math.imul(i, 374761393) ^ Math.imul(j, 668265263) ^ Math.imul(k, 2246822519);
  x = Math.imul(x ^ (x >>> 13), 1274126177);
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}

/**
 * Grow strands from the hairstyle's own coverage and rasterise them.
 *
 * Every strand starts at a point of the CC0 hair surface (so the hairline is
 * the asset's), leaves the scalp along its outward direction, and is pulled
 * down and sideways by the style's droop and wave. Locks are stamped as
 * tapering capsules into an occupancy grid; the SDF is the distance transform
 * of that grid, which is what makes separate locks possible at all.
 */
function strandHairField(spec: CharacterSpec, cap: SdfField, roots: Float32Array): SdfField | null {
  void roots;
  const st = HAIR_STYLE[spec.hair.style] ?? HAIR_STYLE.bob;
  const len = st.len * Math.max(0.35, spec.hair.length) * Math.max(0.6, spec.hair.volume);
  const centre = J("joint-head");
  const h = HAIR_VOXEL_H;

  const lo: V3 = [cap.lo[0] - 0.02, cap.lo[1] - len * 1.05 - 0.02, cap.lo[2] - 0.02];
  const hi: V3 = [cap.hi[0] + 0.02, cap.hi[1] + 0.03, cap.hi[2] + 0.02];
  const dims: [number, number, number] = [0, 1, 2].map((a) => Math.max(2, Math.ceil((hi[a] - lo[a]) / h) + 1)) as [number, number, number];
  const [nx, ny, nz] = dims;
  const origin: V3 = [lo[0] + h / 2, lo[1] + h / 2, lo[2] + h / 2];
  const inside = new Uint8Array(nx * ny * nz);
  const stamp = (x: number, y: number, z: number, r: number) => {
    const r2 = r * r;
    const i0 = Math.max(0, Math.floor((x - r - origin[0]) / h)), i1 = Math.min(nx - 1, Math.ceil((x + r - origin[0]) / h));
    const j0 = Math.max(0, Math.floor((y - r - origin[1]) / h)), j1 = Math.min(ny - 1, Math.ceil((y + r - origin[1]) / h));
    const k0 = Math.max(0, Math.floor((z - r - origin[2]) / h)), k1 = Math.min(nz - 1, Math.ceil((z + r - origin[2]) / h));
    for (let k = k0; k <= k1; k++) {
      const dz = origin[2] + k * h - z;
      for (let j = j0; j <= j1; j++) {
        const dy = origin[1] + j * h - y;
        const base = (k * ny + j) * nx;
        for (let i = i0; i <= i1; i++) {
          const dx = origin[0] + i * h - x;
          if (dx * dx + dy * dy + dz * dz <= r2) inside[base + i] = 1;
        }
      }
    }
  };

  // Roots live on the SCALP, not on the hair card: the card floats a centimetre
  // above the skull, and growing from it left locks hanging in the air. Every
  // body vertex under the hairstyle's coverage is a root, so the hairline and
  // the parting follow the asset while the hair starts on skin.
  // Every hair-card vertex is a root, projected back onto the skin along the
  // head's own distance gradient. Using body vertices that merely sit near the
  // card picked up ears and cheeks, which is why an earlier attempt grew hair
  // over the face.
  const head = J("joint-head");
  const headField = fieldSdf(bodyField("head", 0.003, [], { lo: [head[0] - 0.17, head[1] - 0.20, head[2] - 0.20], hi: [head[0] + 0.17, head[1] + 0.16, head[2] + 0.20] }));
  const scalp: number[] = [];
  const eps = 0.002;
  const cardStep = Math.max(1, Math.floor(roots.length / 3 / 1800));
  for (let v = 0; v < roots.length / 3; v += cardStep) {
    let x = roots[3 * v], y = roots[3 * v + 1], z = roots[3 * v + 2];
    // Only the part of the card that lies on the SCALP can be a root. The rest
    // of the card is the length of the hairstyle hanging in the air, and
    // projecting that onto the skin grew a curtain over the face.
    if (y < head[1] - 0.09) continue;
    // and nothing in front of the brow
    if (z > head[2] + 0.015 && y < head[1] + 0.085) continue;
    for (let it = 0; it < 8; it++) {
      const d = headField(x, y, z);
      if (Math.abs(d) < 0.0012) break;
      const g: V3 = [
        headField(x + eps, y, z) - headField(x - eps, y, z),
        headField(x, y + eps, z) - headField(x, y - eps, z),
        headField(x, y, z + eps) - headField(x, y, z - eps),
      ];
      const l = Math.hypot(g[0], g[1], g[2]) || 1;
      const s = Math.max(-0.004, Math.min(0.004, -d));
      x += (g[0] / l) * s;
      y += (g[1] / l) * s;
      z += (g[2] / l) * s;
    }
    scalp.push(x, y, z);
  }
  if (!scalp.length) return null;
  roots = Float32Array.from(scalp);

  // 1. the scalp layer: the asset's own coverage, 2 mm thick, so no skin shows
  const step = Math.max(1, Math.floor(roots.length / 3 / 1600));
  for (let v = 0; v < roots.length / 3; v += step) stamp(roots[3 * v], roots[3 * v + 1], roots[3 * v + 2], 0.0028);

  // 2. strands
  const count = Math.min(st.count, Math.floor(roots.length / 3));
  const rootStep = Math.max(1, Math.floor(roots.length / 3 / count));
  let strand = 0;
  for (let v = 0; v < roots.length / 3; v += rootStep) {
    const r0 = hash3(v, 1), r1 = hash3(v, 2), r2 = hash3(v, 3);
    let px = roots[3 * v], py = roots[3 * v + 1], pz = roots[3 * v + 2];
    // outward from the skull centre, jittered so locks do not comb in rows
    let dx = px - centre[0], dy = py - centre[1], dz = pz - centre[2];
    const l = Math.hypot(dx, dy, dz) || 1;
    dx /= l; dy /= l; dz /= l;
    dx += (r0 - 0.5) * 0.4; dz += (r1 - 0.5) * 0.4;
    const segs = 22;
    const radius = st.radius * (0.85 + 0.3 * r2);
    for (let s = 0; s < segs; s++) {
      const t = s / segs;
      // gravity, then the style's kink
      dy -= st.droop * 0.55;
      const wave = st.wave * 0.5;
      dx += (hash3(v, s + 11) - 0.5) * wave;
      dy += (hash3(v, s + 23) - 0.5) * wave * 0.5;
      dz += (hash3(v, s + 37) - 0.5) * wave;
      const n = Math.hypot(dx, dy, dz) || 1;
      const sx = px, sy = py, sz = pz;
      px += (dx / n) * (len / segs);
      py += (dy / n) * (len / segs);
      pz += (dz / n) * (len / segs);
      // stamp along the whole segment, or a lock thins into disconnected dots
      for (let u = 0; u <= 1.001; u += 0.25) {
        const qx = sx + (px - sx) * u, qy = sy + (py - sy) * u, qz = sz + (pz - sz) * u;
        // A face is not a place hair grows. Locks that would cross the face are
        // left out, which is what gives a fringe that frames the face instead
        // of a curtain drawn over it.
        const inFace = qz > head[2] - 0.005 && Math.abs(qx - head[0]) < 0.075 && qy < head[1] + 0.095 && qy > head[1] - 0.2;
        if (!inFace) stamp(qx, qy, qz, radius * (1 - 0.45 * t));
      }
    }
    strand++;
  }
  if (!strand) return null;
  return fieldFromVoxels(inside, dims, origin, h);
}

/* -------------------------------- regions ------------------------------- */

/** Sphere as a Shape, without pulling the whole shape vocabulary in. */
const sphereShape = (c: V3, r: number, color: [number, number, number]): Shape => ({
  f: (x, y, z) => Math.hypot(x - c[0], y - c[1], z - c[2]) - r,
  lo: [c[0] - r, c[1] - r, c[2] - r],
  hi: [c[0] + r, c[1] + r, c[2] + r],
  color: () => color,
});

const above = (y: number): Sdf => plane([0, y, 0], [0, -1, 0]);
const below = (y: number): Sdf => plane([0, y, 0], [0, 1, 0]);
/** Keep the half-space in front of `point` along `dir`: (p − point)·dir > 0. */
const beyond = (point: V3, dir: V3): Sdf => plane(point, [-dir[0], -dir[1], -dir[2]]);
const ball = (c: V3, r: number): Sdf => (x, y, z) => Math.hypot(x - c[0], y - c[1], z - c[2]) - r;

/** Distance to the segment a→b, as a capsule of radius r: keeps a limb, not a slab. */
const around = (a: V3, b: V3, r: number): Sdf => {
  const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
  const bb = dx * dx + dy * dy + dz * dz || 1e-9;
  return (x, y, z) => {
    const px = x - a[0], py = y - a[1], pz = z - a[2];
    const t = Math.max(0, Math.min(1, (px * dx + py * dy + pz * dz) / bb));
    return Math.hypot(px - dx * t, py - dy * t, pz - dz * t) - r;
  };
};

/** Deterministic noise in [0,1) from a position — same value everywhere. */
function noise(x: number, y: number, z: number, seed = 0): number {
  const s = Math.sin(x * 1271.3 + y * 3117.7 + z * 743.9 + seed * 91.7) * 43758.5453;
  return s - Math.floor(s);
}

/**
 * LÉLU's face, painted from her locked identity:
 * full dark brows with a clean tail, deep berry-brown glossy lips, star marks
 * high on the cheekbones, dark swirls at the forehead, freckles across the nose
 * and cheeks.
 *
 * These are colour fields on her own head geometry — the marks are surface
 * detail at the scale of a millimetre, and painting them keeps the head one
 * closed solid instead of hundreds of decals. Everything geometric about her
 * face (oval shape, high cheekbones, tapered jaw) comes from the reference
 * morph, not from here.
 */
function leluFaceColour(x: number, y: number, z: number, skin: Rgb, hairC: Rgb): Rgb {
  const mouth = J("joint-mouth"), eL = J("joint-l-eye"), eR = J("joint-r-eye");
  const span = Math.abs(eL[0] - eR[0]) || 0.062;
  const eyeY = (eL[1] + eR[1]) / 2;
  const front = z > mouth[2] - span * 0.5;

  // lips: fuller lower lip, defined cupid's bow
  if (front) {
    const lip = Math.hypot((x - mouth[0]) / (span * 0.46), (y - mouth[1]) / (span * 0.2), (z - mouth[2]) / (span * 0.36));
    if (lip < 1) return y < mouth[1] - span * 0.01 ? L.lipHighlight : L.lip;
  }

  // brows: full, softly arched, clean tail
  for (const e of [eL, eR]) {
    const dx = (x - e[0]) / (span * 0.46);
    const dy = (y - (e[1] + span * 0.2)) / (span * 0.085);
    if (dx * dx + dy * dy < 1) return hairC;
  }

  // star marks, high on the cheekbones
  for (const s of [-1, 1] as const) {
    const cx = mouth[0] + s * span * 0.74, cy = eyeY - span * 0.11;
    const r = Math.hypot(x - cx, (y - cy) * 0.85);
    if (r < span * 0.11) {
      const a = Math.atan2(y - cy, x - cx);
      if (r < span * (0.032 + 0.03 * Math.abs(Math.cos(2.5 * a)))) return L.star;
    }
  }

  // dark swirls across the forehead and temples
  const fy = eyeY + span * 0.28;
  if (Math.abs(y - fy) < span * 0.2) {
    const rr = Math.hypot(x - mouth[0], (y - fy) * 1.15);
    const a = Math.atan2(y - fy, x - mouth[0]);
    const ring = span * (0.14 + 0.075 * Math.sin(a * 3 + rr * 90));
    if (Math.abs(rr - ring) < span * 0.02) return L.ink;
  }

  // freckles across nose and cheeks
  if (y < eyeY - span * 0.05 && y > mouth[1] + span * 0.16 && front)
    if (noise(Math.round(x * 1400), Math.round(y * 1400), 3) > 0.975) return L.skinShade;

  return skin;
}

/**
 * Her tattoos: ornamental filigree across the collarbones and chest, and a
 * filigree band on the forearms. Painted as fine arcs on her skin, in her
 * documented ink. Approximate as a pattern — the reference boards are the
 * authority for placement and style, not for an exact vector tracing.
 */
function leluTattoo(x: number, y: number, z: number, skin: Rgb, where: "chest" | "forearm"): Rgb {
  if (where === "chest") {
    const collar = J("joint-l-shoulder")[1] - 0.055;
    if (y > collar - 0.14 && y < collar + 0.02 && z > 0) {
      const arc = Math.abs(Math.sin(x * 62 + y * 24));
      const vine = Math.abs(Math.sin(x * 21 - y * 40));
      if (arc < 0.1 || (vine < 0.05 && Math.abs(x) > 0.045)) return L.ink;
    }
  } else {
    const band = Math.abs(Math.sin(y * 150 + z * 40));
    if (band < 0.09 && Math.abs(x) > 0.12) return L.ink;
  }
  return skin;
}

/** Lip and brow masks in metres, from the mesh's own face joints. */
export function faceMasks(): { lips: Sdf; brows: Sdf; eyes: [V3, V3] } {
  const mouth = J("joint-mouth"), eyeL = J("joint-l-eye"), eyeR = J("joint-r-eye");
  const span = Math.abs(eyeL[0] - eyeR[0]) || 0.06;
  const lips: Sdf = (x, y, z) =>
    (Math.hypot((x - mouth[0]) / (span * 0.46), (y - mouth[1]) / (span * 0.19), (z - mouth[2]) / (span * 0.34)) - 1) * span * 0.2;
  const browAt = (e: V3): Sdf => (x, y, z) =>
    (Math.hypot((x - e[0]) / (span * 0.28), (y - (e[1] + span * 0.24)) / (span * 0.055), (z - e[2]) / (span * 0.26)) - 1) * span * 0.2;
  const brows: Sdf = (x, y, z) => Math.min(browAt(eyeL)(x, y, z), browAt(eyeR)(x, y, z));
  return { lips, brows, eyes: [eyeL, eyeR] };
}

export type RegionId =
  | "head" | "face" | "torso" | "pelvis" | "neck" | "arms" | "hands" | "legs" | "feet" | "hair"
  | "clothing.top" | "clothing.bottom" | "clothing.shoes";

/**
 * One anatomical region as a Shape, at mesh resolution `h`.
 *
 * `frame` matters: LÉLU builds the head in a local frame and places it by a
 * lattice-snapped anchor, so a head-frame region is translated by −anchor and
 * rides along with the body for free.
 */
export function referenceRegion(id: RegionId, spec: CharacterSpec, h: number, frame: "world" | "head" = "world", headCenter: V3 = [0, 0, 0]): Shape | null {
  if (!current) return null;
  // Snapped to the OCCUPANCY cell, never to the mesh resolution: the anchor
  // that places this shape is `anchorCells(…, lattice.resolution)`, so
  // snapping with the mesh resolution shifted the head by up to 3 mm between
  // the per-component and whole-object paths.
  const anchor: V3 = frame === "head" ? [Math.round(headCenter[0] / CELL) * CELL, Math.round(headCenter[1] / CELL) * CELL, Math.round(headCenter[2] / CELL) * CELL] : [0, 0, 0];
  const key = `${current.digest}|region:${id}|${h}|${frame}|${anchor.join(",")}|${spec.hands.curl},${spec.hands.spread},${spec.hands.opposition},${spec.feet?.toeCurl ?? 0}`;
  const hit = shapeCache.get(key);
  if (hit !== undefined) return hit;
  const s = buildRegion(id, spec, h, anchor);
  shapeCache.set(key, s);
  return s;
}

function buildRegion(id: RegionId, spec: CharacterSpec, h: number, anchor: V3): Shape | null {
  const skinC = spec.materials.skin;
  const neckY = J("joint-neck")[1], shoulderY = J("joint-l-shoulder")[1];
  const pelvisY = J("joint-pelvis")[1], spine1Y = J("joint-spine-1")[1];
  const ankleY = J("joint-l-ankle")[1];

  /**
   * Articulated parts are blurred once: a skinned knuckle folds the surface
   * into itself, and the field's sub-cell double crossings are what produced
   * the non-manifold edges there. Rest-pose regions are not blurred.
   */
  const body = (tag: string, poses: BonePose[], window: { lo: V3; hi: V3 }, fieldRes = FIELD_H) => fieldShape(bodyField(tag, h, poses, window, poses.length ? 1 : 0, fieldRes), skinC);

  let shape: Shape | null = null;
  switch (id) {
    case "head": {
      const hp = J("joint-head");
      const f = body("head", [], { lo: [hp[0] - 0.16, neckY - 0.06, hp[2] - 0.20], hi: [hp[0] + 0.16, hp[1] + 0.16, hp[2] + 0.20] });
      const m = faceMasks();
      const hairC = spec.materials.hair;
      const result = clip(f, above(neckY - 0.004));
      shape = {
        ...result,
        color: isLelu(spec)
          ? (x, y, z) => leluFaceColour(x, y, z, skinC, hairC)
          : (x, y, z) => (m.lips(x, y, z) < 0 ? [0.44, 0.19, 0.17] : m.brows(x, y, z) < 0 ? hairC : skinC),
      };
      break;
    }
    case "face": {
      // Real eyeballs and teeth. The eye proxy holds both eyes and a cornea
      // shell, so each is clipped to its own socket ball; the pupil is painted
      // on the front of the ball rather than left as a flat disc.
      // Eyeballs are placed from the reference's own eye joints and built as
      // spheres: the CC0 eye mesh is an open cornea shell, and an open surface
      // has no honest interior to mesh. Radius and centre come from the fitted
      // body, so the eyeball sits in the real socket behind the real lids.
      const lelu = isLelu(spec);
      const feats: Shape[] = [];
      for (const e of [J("joint-l-eye"), J("joint-r-eye")]) {
        // Iris and pupil are proud of the sclera by a fraction of a cell, so
        // they survive sampling as geometry instead of being averaged away
        // into the ball's vertex colours.
        // Her eyes are almond with a warm brown iris and a dark limbal ring, so
        // the iris is larger and sits inside a ring rather than a flat disc.
        const sclera: V3 = [e[0], e[1], e[2] - (lelu ? 0.0056 : 0.0022)];
        const r = lelu ? 0.0112 : 0.0112;
        feats.push(sphereShape(sclera, r, lelu ? L.sclera : [0.93, 0.91, 0.89]));
        // lid shadow across the top of the eye, so the sclera is not a white ball
        if (lelu) feats.push(sphereShape([e[0], e[1] + 0.0058, e[2] - 0.0042], 0.0092, L.lidShadow));
        // her iris is large — almond eyes, warm brown, dark limbal ring
        feats.push(sphereShape([e[0], e[1], e[2] + 0.0024], lelu ? 0.0086 : 0.006, lelu ? L.irisRing : spec.materials.eyes));
        feats.push(sphereShape([e[0], e[1], e[2] + 0.0042], lelu ? 0.0074 : 0.006, lelu ? L.iris : spec.materials.eyes));
        feats.push(sphereShape([e[0], e[1], e[2] + 0.0066], lelu ? 0.0034 : 0.0026, lelu ? L.pupil : [0.02, 0.02, 0.02]));
        if (lelu) {
          // long dense lashes: a row of thin fanned strands on the upper lid
          for (let i = 0; i < 9; i++) {
            const t = i / 8;
            const lx = e[0] + (t - 0.5) * 0.021;
            const ly = e[1] + 0.0088 - Math.abs(t - 0.5) * 0.0035;
            const lz = e[2] + 0.0062 - Math.abs(t - 0.5) * 0.0025;
            feats.push(sphereShape([lx, ly, lz], 0.0011, L.hair));
            feats.push(sphereShape([lx, ly + 0.0022, lz + 0.0022], 0.0008, L.hair));
          }
        }
      }
      shape = union(...feats);
      break;
    }
    case "neck": {
      const shoulder = J("joint-l-shoulder");
      const f = body("neck", [], { lo: [-0.12, neckY - 0.10, shoulder[2] - 0.15], hi: [0.12, neckY + 0.04, shoulder[2] + 0.12] });
      shape = clip(f, above(shoulderY - 0.01), below(neckY + 0.03));
      break;
    }
    case "torso": {
      const sh = J("joint-l-shoulder");
      const f = body("torso", [], { lo: [-sh[0] - 0.10, spine1Y - 0.10, -0.24], hi: [sh[0] + 0.10, shoulderY + 0.10, 0.24] });
      shape = clip(f, above(spine1Y - 0.02), below(shoulderY + 0.05));
      if (isLelu(spec)) {
        const base = shape;
        shape = { ...base, color: (x, y, z) => leluTattoo(x, y, z, skinC, "chest") };
      }
      break;
    }
    case "pelvis": {
      const hip = J("joint-l-upper-leg");
      const f = body("pelvis", [], { lo: [-Math.abs(hip[0]) - 0.10, pelvisY - 0.12, -0.20], hi: [Math.abs(hip[0]) + 0.10, spine1Y + 0.06, 0.20] });
      shape = clip(f, above(pelvisY - 0.10), below(spine1Y + 0.04));
      break;
    }
    case "legs": {
      const hip = J("joint-l-upper-leg"), hipR = J("joint-r-upper-leg");
      const f = body("legs", [], { lo: [Math.min(hip[0], hipR[0]) - 0.12, ankleY - 0.08, -0.20], hi: [Math.max(hip[0], hipR[0]) + 0.12, spine1Y + 0.04, 0.20] });
      shape = clip(f, below(spine1Y + 0.02), above(ankleY - 0.005));
      break;
    }
    case "arms":
    case "hands": {
      const parts: Shape[] = [];
      for (const side of [0, 1] as const) {
        const l = SIDE(side);
        const sh = J(`joint-${l}-shoulder`), el = J(`joint-${l}-elbow`), w = J(`joint-${l}-hand`);
        if (!has(`joint-${l}-shoulder`)) continue;
        if (id === "arms") {
          const dir = unit(sub(el, sh));
          // generous box: an axis-aligned window that clips a diagonal limb
          // closes the surface with a flat wall, which reads as a sharp fin
          const pad = 0.16;
          const lo: V3 = [Math.min(sh[0], el[0], w[0]) - pad, Math.min(sh[1], el[1], w[1]) - pad, Math.min(sh[2], el[2], w[2]) - pad];
          const hi: V3 = [Math.max(sh[0], el[0], w[0]) + pad, Math.max(sh[1], el[1], w[1]) + pad, Math.max(sh[2], el[2], w[2]) + pad];
          const f = body(`arm-${l}`, [], { lo, hi });
          if (isLelu(spec)) f.color = (x, y, z) => leluTattoo(x, y, z, skinC, "forearm");
          // A half-space in front of the shoulder also keeps a wedge of the
          // chest, which the window then caps into a flat fin. Keeping the
          // limb's own capsule as well removes that wedge.
          parts.push(
            clip(
              f,
              beyond([sh[0] + dir[0] * 0.02, sh[1] + dir[1] * 0.02, sh[2] + dir[2] * 0.02], dir),
              plane(w, unit(sub(w, el))),
              around(sh, w, 0.085),
            ),
          );
        } else {
          const dir = unit(sub(w, el));
          const poses = handPoses(spec, side);
          // the window must clear the clipping ball, or the box edge caps the
          // hand with a flat sliver
          const f = body(`hand-${l}`, poses, { lo: [w[0] - 0.21, w[1] - 0.22, w[2] - 0.22], hi: [w[0] + 0.21, w[1] + 0.22, w[2] + 0.22] }, ARTICULATED_FIELD_H);
          // rounded crease: the wrist cut meets the arm at a grazing angle and
          // a sharp crease there pinches the surface into non-manifold cells
          parts.push(softClip(f, 0.005, beyond([w[0] - dir[0] * 0.015, w[1] - dir[1] * 0.015, w[2] - dir[2] * 0.015], dir), ball(w, 0.18)));
        }
      }
      shape = parts.length ? group(...parts) : null;
      break;
    }
    case "feet": {
      const parts: Shape[] = [];
      for (const side of [0, 1] as const) {
        const l = SIDE(side);
        if (!has(`joint-${l}-ankle`)) continue;
        const a = J(`joint-${l}-ankle`);
        const poses = footPoses(spec, side);
        const sx = a[0] > 0 ? 1 : -1;
        const f = body(`foot-${l}`, poses, { lo: [a[0] - 0.14, -0.02, a[2] - 0.16], hi: [a[0] + 0.14, a[1] + 0.10, a[2] + 0.24] }, ARTICULATED_FIELD_H);
        // below the ankle, on its own side of the midline, and within a ball
        // around the ankle so a wide stance cannot pull in the other foot
        parts.push(softClip(f, 0.005, below(a[1] + 0.02), (x) => -x * sx + 0.02, ball(a, 0.26)));
      }
      shape = parts.length ? group(...parts) : null;
      break;
    }
    case "clothing.top":
    case "clothing.bottom":
    case "clothing.shoes": {
      const name = garmentFor(id, spec);
      if (!name) { shape = null; break; }
      const color = id === "clothing.top" ? spec.materials.top : id === "clothing.bottom" ? spec.materials.bottom : spec.materials.shoes;
      const garmentMesh = current!.proxies[name];
      if (!garmentMesh) { shape = null; break; }
      // A thin shell self-cancels on the sampling lattice (two surfaces inside
      // one cell), which punches holes in the cloth. These garments are fitted
      // to the body by construction, so the solid garment is the body's own
      // surface pushed out by the cloth's stand-off, kept only within the
      // region the garment actually covers: closed by construction, no holes,
      // and the coverage — neckline, hem, sleeves, leg openings — is the real
      // asset's.
      const g = proxyField(name, h)!;
      const gsd = fieldSdf(g);
      const bodySd = fieldSdf(bodyField("body", h, [], null));
      // Independent garment geometry: a closed shell around the GARMENT's own
      // surface, so the cloth keeps its own shape, folds and hem edges instead
      // of being the body painted over. Thickness 10 mm of cloth, 12 mm of
      // shoe, i.e. 3-4 field cells, so the shell cannot self-cancel. The body
      // is carved out of it, so cloth sits ON skin rather than inside it.
      const t = id === "clothing.shoes" ? 0.012 : 0.010;
      // The suit is mapped onto the skin by its own .mhclo offsets (1-3 mm), so
      // its inner surface must be allowed to touch the skin: carving the body
      // with a 2 mm stand-off deleted whole chest and knee patches and left
      // skin showing through. Carving at half a millimetre keeps the inner
      // cloth surface on the skin and the outer one 10 mm out.
      // The stand-off the loader already gave the cloth (shrink-wrapped onto
      // this body) is the inner surface; the shell adds real thickness outward.
      const shellOfGarment = (x: number, y: number, z: number) => Math.max(Math.abs(gsd(x, y, z)) - t / 2, -(bodySd(x, y, z) - 0.0005));
      // The CC0 suits are one piece, so the two slots are the same garment cut
      // at the waist with a 4 cm overlap: each slot is now its own geometry,
      // not the same solid twice (that duplication was 56 % of every triangle).
      if (id === "clothing.top" || id === "clothing.bottom") {
        const waist = J("joint-pelvis")[1] + 0.08;
        const mask = id === "clothing.top" ? above(waist - 0.04) : below(waist + 0.04);
        shape = { f: (x, y, z) => Math.max(shellOfGarment(x, y, z), mask(x, y, z)), lo: g.lo, hi: g.hi, color: () => color };
      } else {
        shape = { f: shellOfGarment, lo: g.lo, hi: g.hi, color: () => color };
      }
      break;
    }
    case "hair": {
      // Real strands, not a shell. The CC0 asset supplies the hairstyle's
      // coverage and its hairline; the volume is grown as strands from the
      // scalp and rasterised into a density grid, so the surface has separate
      // locks with gaps between them instead of one helmet.
      const mesh = current!.proxies[`hair:${spec.hair.style}`];
      const cap = proxyField(`hair:${spec.hair.style}`, h);
      if (!mesh || !cap) { shape = null; break; }
      const f = strandHairField(spec, cap, mesh.positions);
      // Her curls are black with rose-magenta highlights, so the colour varies
      // along the locks instead of being one flat black.
      shape = f
        ? isLelu(spec)
          ? {
              f: fieldShape(f, spec.materials.hair).f,
              lo: f.lo,
              hi: f.hi,
              color: (x, y, z) => {
                const s = noise(Math.round(x * 300), Math.round(y * 300), Math.round(z * 300), 11);
                return s > 0.9 ? L.hairRose : s > 0.7 ? [0.42, 0.13, 0.24] : s > 0.42 ? [0.14, 0.08, 0.11] : spec.materials.hair;
              },
            }
          : fieldShape(f, spec.materials.hair)
        : null;
      break;
    }
  }
  if (!shape) return null;
  if (anchor[0] || anchor[1] || anchor[2]) {
    const base = shape;
    shape = { ...base, f: (x, y, z) => base.f(x + anchor[0], y + anchor[1], z + anchor[2]), lo: [base.lo[0] - anchor[0], base.lo[1] - anchor[1], base.lo[2] - anchor[2]], hi: [base.hi[0] - anchor[0], base.hi[1] - anchor[1], base.hi[2] - anchor[2]] };
  }
  return shape;
}

/**
 * Which CC0 garment asset stands in for a clothing slot. The MakeHuman
 * system clothes are whole outfits, so the top slot selects the outfit and
 * the bottom slot is satisfied by the same garment — reported, not hidden.
 */
export function garmentFor(id: "clothing.top" | "clothing.bottom" | "clothing.shoes", spec: CharacterSpec): string | null {
  if (!current) return null;
  if (id === "clothing.shoes") {
    if (!spec.clothing.shoes) return null;
    for (const n of ["shoes:shoes01", "shoes:shoes02", "shoes:shoes03"]) if (current.proxies[n]) return n;
    return null;
  }
  if (spec.clothing.top === "none" && spec.clothing.bottom === "none") return null;
  const want =
    spec.clothing.top === "jacket" ? "outfit:elegantsuit01"
    : spec.clothing.top === "longsleeve" ? "outfit:casualsuit02"
    : spec.clothing.top === "tank" ? "outfit:sportsuit01"
    : "outfit:casualsuit01";
  if (current.proxies[want]) return want;
  for (const n of Object.keys(current.proxies)) if (n.startsWith("outfit:")) return n;
  return null;
}

/** Names the loaded proxies make available, for diagnostics and the manifest. */
export function referenceProxies(): string[] {
  return current ? Object.keys(current.proxies).sort() : [];
}
