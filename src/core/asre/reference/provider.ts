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
import { clip, group, softClip, subtract, union } from "../character/shape.ts";
import type { Shape } from "../character/shape.ts";
import type { CharacterSpec } from "../character/CharacterSpec.ts";
import { fieldFromMesh, fieldFromVoxels, fieldSdf, fieldShape } from "./field.ts";
import { CELL } from "../character/lattice.ts";
import { isLelu, LELU_COLOURS as L } from "../character/leluIdentity.ts";
import { conicalCurl, nearestNeighbourStats, selectSphericalEvenSubset } from "../../geometry/golden/index.ts";
import { bundleTubes, setHairRootPoints, hairTubeBuild, resetTubeDiagnostics, TUBE_LOD, tubeDiagnostics, type StrandSpec } from "../hair/tubes.ts";
import { growBabyHair, babyHairState } from "../hair/baby.ts";
import { landmarksFromJoints, recordYouth, youthWarp, YOUTH_PAINT, REFERENCE_231, type YouthLandmarks } from "../character/youth.ts";
import type { Rgb } from "../character/shape.ts";
import type { SdfField } from "./field.ts";
import { cross, skin, sub, unit } from "./skin.ts";
import type { BonePose, Rig } from "./skin.ts";
import { extractSubmesh, loopSubdivide, smoothNormals } from "./surface.ts";
import { mergeMeshes } from "./garment.ts";
import type { Mesh } from "../volume/mesh.ts";
import { buildWardrobe, MAT, type Wardrobe } from "./wardrobe.ts";
import { growCurls, LELU_CURLS, type Curls } from "./hair.ts";
import { growHairArchitecture, hairline, LELU_HAIR_ARCH, type HairArchitecture, type Hairline } from "./hairArch.ts";
import { eyeball, faceColour, HeadRays, lashes, measureEye, skinTone, tattoo, EYE_R, type FaceLandmarks } from "./face.ts";

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

/* ------------------------------- youth pass ------------------------------ */

/**
 * Whether the head being built carries the LÉLU 2.3 youth pass.
 *
 * Every reference region is built through `referenceRegion`, so the flag is set
 * there and read by the head-field helpers and the face paint below. This is the
 * same module-state pattern `current` uses; the head-field cache and the region
 * cache both key on it, so a canonical and a youth build can never be served
 * each other's geometry.
 */
let youthEnabled = false;

/**
 * The mouth line the face paint is drawn against, resolved once per head build.
 *
 * Her rig's mouth joint resolves to the origin, so a lip mask anchored on it is
 * painted at her feet — which is why no lip had ever appeared on a render. The
 * resolved line comes from `landmarksFromJoints`, which falls back to the
 * reference's own eye→mouth→chin ratio.
 */
// Workforce consolidation: the lip/brow paint that read this mouth line
// (jolly-davinci leluFaceColour) is superseded by face.ts faceColour, which
// paints from the measured landmarks; the youth SHAPE warp below still applies.

/**
 * Her own face landmarks, in world metres, from the rig she is built on.
 *
 * `faceZ` is her eye joint's z plus 2 cm — the front of her face — and it is
 * deliberately NOT measured with `skinZ`, which builds the head field and would
 * recurse through the warp it is being asked to place.
 */
function youthLandmarks(): YouthLandmarks {
  const eye = J("joint-l-eye");
  return landmarksFromJoints(J, eye[2] + 0.02);
}

/** The head SDF with the youth pass applied, when this build asks for it. */
function applyYouth(field: Sdf): Sdf {
  if (!youthEnabled) return field;
  const lm = youthLandmarks();
  recordYouth(lm);
  return youthWarp(field, lm);
}

/** The head field with the youth pass applied — every consumer uses this. */
function headFieldWithYouth(field: SdfField): Sdf {
  return applyYouth(fieldSdf(field));
}

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
/**
 * Strand growth, per hairstyle: length in metres, how hard gravity pulls the
 * lock down, how kinked it is, how many locks and how thick.
 *
 * `turns` and `curl` are what make a CORKSCREW: the lock winds `turns` times
 * around its own drooping axis at radius `curl`. Without them a lock is a
 * random walk, which is a loc — and thick locs are exactly what her curls kept
 * looking like.
 */
/**
 * What the last hair build actually did. Measured by the LÉLU 2 experiment
 * harness so a root-distribution claim is read off the builder, not off a copy of
 * its algorithm.
 */
export const hairDiagnostics: {
  golden: boolean;
  roots: number;
  curl: "helix" | "golden-spiral";
  rootCv: number;
  meanSpacing: number;
  minSpacing: number;
  maxSpacing: number;
  /** Lowest root anywhere on the scalp (m). */
  hairlineY: number;
  /** Lowest root at the FRONT of the skull — the forehead hairline (m). */
  hairlineFrontY: number;
} = { golden: false, roots: 0, curl: "helix", rootCv: 0, meanSpacing: 0, minSpacing: 0, maxSpacing: 0, hairlineY: 0, hairlineFrontY: 0 };

const HAIR_STYLE: Record<string, { len: number; droop: number; wave: number; count: number; radius: number; turns?: number; curl?: number }> = {
  buzz: { len: 0.014, droop: 0.15, wave: 0.1, count: 1800, radius: 0.0036 },
  pixie: { len: 0.06, droop: 0.35, wave: 0.2, count: 1700, radius: 0.0042, turns: 1.2, curl: 0.005 },
  bob: { len: 0.15, droop: 0.7, wave: 0.18, count: 1700, radius: 0.0048, turns: 2.2, curl: 0.007 },
  lob: { len: 0.21, droop: 0.7, wave: 0.2, count: 1600, radius: 0.0048, turns: 2.6, curl: 0.008 },
  "long-straight": { len: 0.34, droop: 0.75, wave: 0.12, count: 1000, radius: 0.0046, turns: 0.5, curl: 0.002 },
  // Her documented foundation: dense black corkscrew curls. 5.5 turns over
  // 22 cm is a ~4 cm pitch on a 1 cm spiral — a real corkscrew, not a wave.
  "long-wavy": { len: 0.22, droop: 0.8, wave: 1.0, count: 1350, radius: 0.0074, turns: 5.5, curl: 0.0105 },
  ponytail: { len: 0.3, droop: 0.7, wave: 0.16, count: 1500, radius: 0.0052, turns: 1.6, curl: 0.006 },
  "high-ponytail": { len: 0.3, droop: 0.65, wave: 0.18, count: 1450, radius: 0.0052, turns: 1.6, curl: 0.006 },
  afro: { len: 0.1, droop: 0.05, wave: 1.2, count: 2000, radius: 0.0046, turns: 3.2, curl: 0.010 },
  braids: { len: 0.36, droop: 0.75, wave: 0.35, count: 900, radius: 0.0060, turns: 0.6, curl: 0.003 },
  "top-knot": { len: 0.15, droop: 0.3, wave: 0.25, count: 1400, radius: 0.0050, turns: 2.0, curl: 0.007 },
  "double-buns": { len: 0.13, droop: 0.25, wave: 0.3, count: 1400, radius: 0.0050, turns: 2.0, curl: 0.007 },
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
/**
 * Scalp roots for a hairstyle: every hair-card vertex that lies over the
 * scalp, projected onto her skin along the head's own distance gradient,
 * with the outward normal there. The card floats a centimetre above the
 * skull, so growing from it directly left locks hanging in the air.
 */
let scalpCache: { key: string; roots: Float32Array; normals: Float32Array } | null = null;
export function scalpRoots(spec: CharacterSpec): { roots: Float32Array; normals: Float32Array } | null {
  const mesh = current?.proxies[`hair:${spec.hair.style}`];
  if (!mesh) return null;
  const key = `${current!.digest}|${spec.hair.style}`;
  if (scalpCache?.key === key) return scalpCache;
  const head = J("joint-head");
  const headField = fieldSdf(headSdf());
  const card = mesh.positions;
  const out: number[] = [], nor: number[] = [];
  const eps = 0.002;
  const grad = (x: number, y: number, z: number): V3 => unit([headField(x + eps, y, z) - headField(x - eps, y, z), headField(x, y + eps, z) - headField(x, y - eps, z), headField(x, y, z + eps) - headField(x, y, z - eps)]);
  const step = Math.max(1, Math.floor(card.length / 3 / 2400));
  for (let v = 0; v < card.length / 3; v += step) {
    let x = card[3 * v], y = card[3 * v + 1], z = card[3 * v + 2];
    if (y < head[1] - 0.09) continue;
    if (z > head[2] + 0.015 && y < head[1] + 0.085) continue;
    for (let it = 0; it < 10; it++) {
      const d = headField(x, y, z);
      if (Math.abs(d) < 0.001) break;
      const g = grad(x, y, z);
      const st = Math.max(-0.004, Math.min(0.004, -d));
      x += g[0] * st;
      y += g[1] * st;
      z += g[2] * st;
    }
    out.push(x, y, z);
    nor.push(...grad(x, y, z));
  }
  scalpCache = { key, roots: Float32Array.from(out), normals: Float32Array.from(nor) };
  return scalpCache;
}


let raysCache: { key: string; rays: HeadRays; tris: number[] } | null = null;
function headRays(spec: CharacterSpec): { rays: HeadRays; tris: number[] } {
  const b = bodySurface(spec);
  if (raysCache?.key === b.key) return raysCache;
  const tris: number[] = [];
  for (let t = 0; t < b.labels.length; t++) if (b.labels[t] === BODY_LABEL.head) tris.push(t);
  raysCache = { key: b.key, rays: new HeadRays(b.positions, b.indices, tris), tris };
  return raysCache;
}

/** Her hairline, placed from her own pupil line on her own skull. */
export function leluHairline(spec: CharacterSpec): Hairline {
  const lm = faceLandmarks(spec);
  const eyeY = (lm.eyes[0].center[1] + lm.eyes[1].center[1]) / 2;
  return hairline(eyeY, [0, eyeY, J("joint-head")[2] + 0.005]);
}

let archCache: { key: string; a: HairArchitecture } | null = null;
/** Her layered hair (hairArch.ts): strands as curves, clump tubes as the LOD. */
export function leluHairArch(spec: CharacterSpec): HairArchitecture {
  const b = bodySurface(spec);
  const key = `${b.key}|${spec.hair.style}|${spec.hair.length}|${spec.hair.volume}`;
  if (archCache?.key === key) return archCache.a;
  const { rays, tris } = headRays(spec);
  const st = { ...LELU_HAIR_ARCH, length: LELU_HAIR_ARCH.length * Math.max(0.4, spec.hair.length) };
  const a = growHairArchitecture(
    {
      roots: new Float32Array(0),
      normals: new Float32Array(0),
      head: J("joint-head"),
      body: fieldSdf(bodyField("body", 0, [], null)),
      colors: { base: spec.materials.hair, rose: L.hairRose, berry: [0.4, 0.07, 0.17] },
      hairline: leluHairline(spec),
      surf: { positions: b.positions, normals: b.normals, indices: b.indices, tris },
      rays,
      colorsArch: { black: spec.materials.hair, rose: L.hairRose, berry: [0.4, 0.07, 0.17] },
    },
    st,
  );
  archCache = { key, a };
  return a;
}

let faceCache: { key: string; lm: FaceLandmarks } | null = null;
/** Her face landmarks, measured on her own subdivided head surface. */
export function faceLandmarks(spec: CharacterSpec): FaceLandmarks {
  const b = bodySurface(spec);
  if (faceCache?.key === b.key) return faceCache.lm;
  const { rays } = headRays(spec);
  const eL = measureEye(rays, J("joint-l-eye"), 1), eR = measureEye(rays, J("joint-r-eye"), -1);
  const mj = J("joint-mouth"), hp = J("joint-head");
  let noseTip: V3 = [0, mj[1] + 0.02, 0], nz = -Infinity;
  for (let y = mj[1] - 0.01; y < eL.center[1] - 0.01; y += 0.0005) {
    const z = rays.front(0.0004, y);
    if (z !== null && z > nz) [nz, noseTip] = [z, [0, y, z]];
  }
  // The lips, from her own midline profile: below the nose the profile
  // bulges twice (upper lip, lower lip); the lip line is the hollow between.
  // A "deepest point near the mouth joint" found the nose-lip junction.
  const prof: [number, number][] = [];
  for (let y = noseTip[1] - 0.012; y > noseTip[1] - 0.075; y -= 0.0003) {
    const z = rays.front(0.0004, y);
    if (z !== null) prof.push([y, z]);
  }
  const peaks: number[] = [];
  for (let i = 3; i + 3 < prof.length; i++) if (prof[i][1] >= prof[i - 3][1] && prof[i][1] >= prof[i + 3][1] && prof[i][1] > prof[i - 1][1] - 1e-9 && prof[i][1] >= prof[i + 1][1]) if (!peaks.length || i - peaks[peaks.length - 1] > 8) peaks.push(i);
  let mouth: V3 = [mj[0], mj[1], rays.front(mj[0], mj[1]) ?? mj[2] + 0.05];
  if (peaks.length >= 2) {
    let lo = peaks[0];
    for (let i = peaks[0]; i <= peaks[1]; i++) if (prof[i][1] < prof[lo][1]) lo = i;
    mouth = [0, prof[lo][0], prof[lo][1]];
  }
  const lm: FaceLandmarks = { eyes: [eL, eR], mouth, head: hp, noseTip };
  faceCache = { key: b.key, lm };
  return lm;
}

let curlCache: { key: string; c: Curls } | null = null;
/** Her curls, grown as strands (hair.ts). */
export function leluCurls(spec: CharacterSpec): Curls | null {
  const r = scalpRoots(spec);
  if (!r) return null;
  const key = `${current!.digest}|${spec.hair.style}|${spec.hair.length}|${spec.hair.volume}`;
  if (curlCache?.key === key) return curlCache.c;
  const st = { ...LELU_CURLS, length: LELU_CURLS.length * Math.max(0.4, spec.hair.length), spread: LELU_CURLS.spread * spec.hair.volume };
  const c = growCurls(
    { roots: r.roots, normals: r.normals, head: J("joint-head"), body: fieldSdf(bodyField("body", 0, [], null)), colors: { base: spec.materials.hair, rose: L.hairRose, berry: [0.4, 0.07, 0.17] } },
    st,
    MAT.hair,
  );
  curlCache = { key, c };
  return c;
}

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
  const headBox = { lo: [head[0] - 0.17, head[1] - 0.2, head[2] - 0.2] as V3, hi: [head[0] + 0.17, head[1] + 0.16, head[2] + 0.2] as V3 };
  // The hair grows on the head that is actually built, youth pass included: if
  // the roots were projected onto the un-warped skull they would float off a
  // shortened chin and a fuller cheek.
  const headField = headFieldWithYouth(bodyField("head", 0.003, [], headBox));
  const scalp: number[] = [];
  const eps = 0.002;
  const golden = spec.geometry?.golden === true;
  const tubes = spec.geometry?.hairTubes === true;
  if (tubes) {
    resetTubeDiagnostics();
    hairTubeBuild.mesh = null;
  }
  const tubeStrands: StrandSpec[] = [];
  const strandRoots: number[] = [];
  // Candidate roots. In golden mode the hair card's own triangles are sampled at
  // four interior barycentric points each: the card defines the coverage region,
  // and a few thousand candidates inside it give the even-subset selection real
  // points to choose from (her card has only ~900 vertices, which is coarser than
  // the strand count). Otherwise the card's vertices are stepped as before.
  const candidates: number[] = [];
  const card = current!.proxies[`hair:${spec.hair.style}`];
  if (golden && card) {
    const P = card.positions, I = card.indices;
    const BARY: [number, number][] = [[1 / 3, 1 / 3], [1 / 6, 1 / 6], [1 / 6, 2 / 3], [2 / 3, 1 / 6]];
    for (let t = 0; t + 2 < I.length; t += 3) {
      const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
      for (const [u, v] of BARY) {
        const w = 1 - u - v;
        candidates.push(P[a] * w + P[b] * u + P[c] * v, P[a + 1] * w + P[b + 1] * u + P[c + 1] * v, P[a + 2] * w + P[b + 2] * u + P[c + 2] * v);
      }
    }
  }
  if (!candidates.length) {
    const cardStep = Math.max(1, Math.floor(roots.length / 3 / 1800));
    for (let v = 0; v < roots.length / 3; v += cardStep) candidates.push(roots[3 * v], roots[3 * v + 1], roots[3 * v + 2]);
  }
  for (let v = 0; v < candidates.length / 3; v++) {
    let x = candidates[3 * v], y = candidates[3 * v + 1], z = candidates[3 * v + 2];
    // Only the part of the card that lies on the SCALP can be a root. The rest
    // of the card is the length of the hairstyle hanging in the air, and
    // projecting that onto the skin grew a curtain over the face.
    if (y < head[1] - 0.09) continue;
    // and nothing in front of the brow
    if (z > head[2] + 0.015 && y < head[1] + 0.085) continue;
    for (let it = 0; it < 24; it++) {
      const d = headField(x, y, z);
      if (Math.abs(d) < 0.0006) break;
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

  // GOLDEN GEOMETRY: the scalp is an area, so the roots are distributed over its
  // area. The candidate roots are her asset's own scalp vertices; the engine picks
  // the subset whose directions around the skull are evenly spread *by area*
  // (cos-latitude even, azimuth turned by the golden angle). That is Vogel's law
  // on a sphere, applied to points that actually exist on her head. The gate is
  // `spec.geometry.golden`, so her canonical build keeps the asset's own vertex
  // distribution and stays byte-identical.
  const scalpCount = Math.floor(roots.length / 3);
  if (golden) {
    const chosen = selectSphericalEvenSubset(roots, Math.min(st.count, scalpCount), centre);
    if (chosen.points.length >= 96) roots = chosen.points;
  }

  // 1. the scalp layer: the asset's own coverage, 2 mm thick, so no skin shows
  const step = Math.max(1, Math.floor(roots.length / 3 / 1600));
  for (let v = 0; v < roots.length / 3; v += step) stamp(roots[3 * v], roots[3 * v + 1], roots[3 * v + 2], 0.0035);

  // 2. strands
  const nRoots = Math.floor(roots.length / 3);
  const count = Math.min(st.count, nRoots);
  // Golden roots arrive in Fibonacci-direction order, so taking `count` of them at
  // even index positions keeps the area-even property. The asset's own vertex order
  // carries no such guarantee, so it is strided as before.
  const rootIndexes: number[] = [];
  if (golden) {
    for (let k = 0; k < count; k++) rootIndexes.push(Math.floor((k * nRoots) / count));
  } else {
    const rootStep = Math.max(1, Math.floor(nRoots / count));
    for (let k = 0; k < nRoots; k += rootStep) rootIndexes.push(k);
  }
  // A face is not a place hair grows. The voxel field skipped stamps here, but a
  // swept tube draws its whole PATH — which is why the first tube render had
  // curls lying across her face. One predicate, used by both representations.
  const inFacePoint = (x: number, y: number, z: number) =>
    z > head[2] - 0.02 && Math.abs(x - head[0]) < 0.095 && y < head[1] + 0.105 && y > head[1] - 0.21;

  let strand = 0;
  for (const v of rootIndexes) {
    const r0 = hash3(v, 1), r1 = hash3(v, 2), r2 = hash3(v, 3);
    const px = roots[3 * v], py = roots[3 * v + 1], pz = roots[3 * v + 2];
    // outward from the skull centre, jittered so locks do not comb in rows
    let dx = px - centre[0], dy = py - centre[1], dz = pz - centre[2];
    const l = Math.hypot(dx, dy, dz) || 1;
    dx /= l; dy /= l; dz /= l;
    dx += (r0 - 0.5) * 0.4; dz += (r1 - 0.5) * 0.4;
    // A lock falls along a slowly drooping axis and SPIRALS around it. The
    // axis carries gravity; the spiral is what makes it a corkscrew curl.
    let ax = dx, ay = dy - st.droop * 1.5, az = dz;
    const al = Math.hypot(ax, ay, az) || 1;
    ax /= al; ay /= al; az /= al;
    // two vectors across that axis, so the spiral can be written in its plane
    const ref: V3 = Math.abs(ay) > 0.9 ? [1, 0, 0] : [0, 1, 0];
    let e1x = ref[1] * az - ref[2] * ay, e1y = ref[2] * ax - ref[0] * az, e1z = ref[0] * ay - ref[1] * ax;
    const e1l = Math.hypot(e1x, e1y, e1z) || 1;
    e1x /= e1l; e1y /= e1l; e1z /= e1l;
    const e2x = ay * e1z - az * e1y, e2y = az * e1x - ax * e1z, e2z = ax * e1y - ay * e1x;

    const turns = (st.turns ?? 0.8) * (0.82 + 0.4 * r0) * Math.max(0.6, spec.hair.volume);
    const curlR = (st.curl ?? 0.004) * (0.75 + 0.5 * r1);
    const phase = r2 * Math.PI * 2;
    const radius = st.radius * (0.85 + 0.3 * r2);
    const segs = 32;
    // The lock is built as a PATH first, then rasterised, so the two shape laws
    // differ only in the path:
    //   helix          constant radius around the drooping axis (the M5.8 lock)
    //   golden-spiral  a logarithmic spiral whose radius decays by 1/φ along the
    //                  lock, i.e. a ringlet: tight tip, wide root
    const path: { x: number; y: number; z: number; t: number }[] = [];
    if (golden) {
      const spiral = conicalCurl({
        origin: [px, py, pz],
        axis: [ax, ay, az],
        e1: [e1x, e1y, e1z],
        e2: [e2x, e2y, e2z],
        length: len,
        radius0: curlR * 1.15,
        turns,
        samples: segs,
        taper: 1,
        growth: 1 / 1.6180339887498949,
        phase,
      });
      path.push(...spiral);
    } else {
      for (let s = 0; s <= segs; s++) {
        const t = s / segs;
        const ang = phase + turns * Math.PI * 2 * t;
        const rad = curlR * (0.5 + 0.65 * t);
        path.push({
          x: px + ax * (len * t) + (e1x * Math.cos(ang) + e2x * Math.sin(ang)) * rad,
          y: py + ay * (len * t) + (e1y * Math.cos(ang) + e2y * Math.sin(ang)) * rad,
          z: pz + az * (len * t) + (e1z * Math.cos(ang) + e2z * Math.sin(ang)) * rad,
          t,
        });
      }
    }
      if (tubes) strandRoots.push(px, py, pz);
    // Keep the path when tubes are on: the same strand law, drawn as geometry,
    // cut where it would enter the face so a curl frames her face instead of
    // being drawn over it.
    if (tubes) {
      // Cut where a lock would pass IN FRONT of her face. The voxel test used a
      // plane 2 cm behind the face (a stamp there has volume and would bulge),
      // which for a tube cuts strands that only pass beside her cheeks. The tube
      // test is the actual face plane, so a side lock survives.
      const kept: { x: number; y: number; z: number }[] = [];
      for (const p of path) {
        const inFrontOfFace = p.z > head[2] + 0.03 && Math.abs(p.x - head[0]) < 0.075 && p.y < head[1] + 0.1 && p.y > head[1] - 0.21;
        if (inFrontOfFace) break;
        kept.push({ x: p.x, y: p.y, z: p.z });
      }
      if (kept.length >= 12) tubeStrands.push({ path: kept, radius, seed: r2, droop: st.droop });
    }
    let prevx = path[0].x, prevy = path[0].y, prevz = path[0].z;
    for (let s = 1; s < path.length; s++) {
      const { x: qx, y: qy, z: qz, t } = path[s];
      // stamp along the whole segment, or a curl thins into disconnected beads
      const span = Math.hypot(qx - prevx, qy - prevy, qz - prevz);
      const sub = Math.max(2, Math.ceil(span / (radius * 0.6)));
      for (let u = 1; u <= sub; u++) {
        const sxp = prevx + (qx - prevx) * (u / sub), syp = prevy + (qy - prevy) * (u / sub), szp = prevz + (qz - prevz) * (u / sub);
        // A face is not a place hair grows. Locks that would cross the face are
        // left out, which is what gives a fringe that frames the face instead
        // of a curtain drawn over it.
        const inFace = inFacePoint(sxp, syp, szp);
        if (!inFace) stamp(sxp, syp, szp, radius * (1 - 0.4 * t));
      }
      prevx = qx; prevy = qy; prevz = qz;
    }
    strand++;
  }
  if (!strand) return null;

  if (tubes) {
    // BABY HAIR — its own coordinated system (hair/baby.ts).
    //
    // Every strand is a RECORD first: root and tip coordinates, the control
    // points that are actually swept, measured length and thickness, growth
    // direction, curvature, its distances to the front hairline / brow / nearest
    // eye / temple, and its visibility and skin clearance. The tubes below are
    // swept from those same control points, so the geometry cannot disagree with
    // the record and a strand that disappears is a visible, countable fact.
    let yLo = Infinity, yHi = -Infinity, yFront = Infinity;
    for (let i = 0; i < roots.length / 3; i++) {
      const y = roots[3 * i + 1];
      yLo = Math.min(yLo, y);
      yHi = Math.max(yHi, y);
      if (roots[3 * i + 2] > centre[2] + 0.015) yFront = Math.min(yFront, y);
    }
    const eyeL = J("joint-l-eye"), eyeR = J("joint-r-eye");
    const eyeSpan = Math.abs(eyeL[0] - eyeR[0]) || 0.062;
    const babyReport = growBabyHair({
      roots,
      landmarks: {
        centre: { x: centre[0], y: centre[1], z: centre[2] },
        hairlineFrontY: Number.isFinite(yFront) ? yFront : yHi,
        // WP01: the hairline is not the scalp cloud's lowest front root, it is the
        // line the photographs put on her face — 0.848 eye→chin spans above the
        // eye line. The difference is reported, not smoothed away.
        // `chinY - eyeY` is NEGATIVE — the chin is below the eye line — so the
        // first version's Math.max(0.05, …) collapsed the span to 50 mm and put
        // the "photographic" hairline 42 mm above her eyes. The span is the
        // absolute difference; the hairline is above the eyes, the chin below.
        hairlineReferenceY:
          eyeL[1] + Math.abs(youthLandmarks().chinY - eyeL[1]) * REFERENCE_231.heights.hairline,
        surfaceZ: (x: number, y: number) => skinZ(x, y),
        hairlineY: yLo,
        browY: eyeL[1] + eyeSpan * (youthEnabled ? YOUTH_PAINT.browLiftSpan : 0.2),
        eyes: [
          { x: eyeL[0], y: eyeL[1], z: eyeL[2] },
          { x: eyeR[0], y: eyeR[1], z: eyeR[2] },
        ],
        temples: [
          { x: eyeL[0] - eyeSpan * 0.55, y: eyeL[1] + eyeSpan * 0.16, z: eyeL[2] },
          { x: eyeR[0] + eyeSpan * 0.55, y: eyeR[1] + eyeSpan * 0.16, z: eyeR[2] },
        ],
        faceSpan: eyeSpan,
      },
      probe: {
        distance: (p) => headField(p.x, p.y, p.z),
        gradient: (p) => {
          const g: V3 = [
            headField(p.x + eps, p.y, p.z) - headField(p.x - eps, p.y, p.z),
            headField(p.x, p.y + eps, p.z) - headField(p.x, p.y - eps, p.z),
            headField(p.x, p.y, p.z + eps) - headField(p.x, p.y, p.z - eps),
          ];
          const l = Math.hypot(g[0], g[1], g[2]) || 1;
          return { x: g[0] / l, y: g[1] / l, z: g[2] / l };
        },
      },
      counts: spec.geometry?.babyHairCounts,
    });
    for (const s of babyReport.strands) {
      tubeStrands.push({
        path: s.controlPoints.map((p) => ({ x: p.x, y: p.y, z: p.z })),
        radius: s.rootThicknessMm / 1000,
        seed: 0.5,
        droop: 1,
        // A measured thickness is the drawn thickness: no jitter on these.
        diameterJitter: 0,
        taperJitter: 0,
      });
    }
    babyHairState.report = babyReport;
    const lod = spec.geometry?.hairLod ?? "high";
    const options = TUBE_LOD[lod];
    const built = bundleTubes(tubeStrands, { ...options, diameterVariation: 0.35, taperVariation: 0.4 });
    hairTubeBuild.mesh = { positions: built.positions, indices: built.indices };
    // Roots of the strands that were actually drawn, for clearance measurement
    // against her head MESH (a 3 mm occupancy field cannot resolve 0.5 mm).
    setHairRootPoints(Float32Array.from(strandRoots));
    const radii = built.perStrand.map((s) => s.radius * 2000);
    const tips = built.perStrand.map((s) => s.tipScale);
    const meanR = radii.reduce((s, v) => s + v, 0) / (radii.length || 1);
    const varR = radii.reduce((s, v) => s + (v - meanR) ** 2, 0) / (radii.length || 1);
    // Root clearance measured against the skull field: a negative offset is a
    // root under the skin, a large positive one is a lock hanging in the air.
    let minOff = Infinity, maxOff = -Infinity, penetrations = 0, floating = 0;
    const offsets: number[] = [];
    // The head field is only a valid distance INSIDE its own box; outside it the
    // value is not a clearance, so those roots are counted separately instead of
    // being reported as 59 mm of floating hair.
    let outsideBox = 0;
    for (let i = 0; i < roots.length / 3; i++) {
      const x = roots[3 * i], y = roots[3 * i + 1], z = roots[3 * i + 2];
      const inBox = x > headBox.lo[0] && x < headBox.hi[0] && y > headBox.lo[1] && y < headBox.hi[1] && z > headBox.lo[2] && z < headBox.hi[2];
      if (!inBox) {
        outsideBox++;
        continue;
      }
      const d = headField(x, y, z);
      offsets.push(d);
      minOff = Math.min(minOff, d);
      maxOff = Math.max(maxOff, d);
      if (d < 0) penetrations++;
      if (d > 0.002) floating++;
    }
    offsets.sort((a, b) => a - b);
    tubeDiagnostics.enabled = true;
    tubeDiagnostics.lod = lod;
    tubeDiagnostics.strands = built.perStrand.length;
    tubeDiagnostics.triangles = built.triangles;
    tubeDiagnostics.sides = options.sides;
    tubeDiagnostics.segments = options.segments;
    tubeDiagnostics.rootOffsetMinMm = minOff * 1000;
    tubeDiagnostics.rootOffsetMaxMm = maxOff * 1000;
    tubeDiagnostics.rootPenetrations = penetrations;
    tubeDiagnostics.floatingRoots = floating;
    tubeDiagnostics.diameterMinMm = Math.min(...radii);
    tubeDiagnostics.diameterMaxMm = Math.max(...radii);
    tubeDiagnostics.diameterCv = meanR > 0 ? Math.sqrt(varR) / meanR : 0;
    tubeDiagnostics.tipScaleMin = Math.min(...tips);
    tubeDiagnostics.tipScaleMax = Math.max(...tips);
    tubeDiagnostics.babyStrands = babyHairState.report?.count ?? 0;
    tubeDiagnostics.babyMaxLengthMm = babyHairState.report?.lengthMm.max ?? 0;
    tubeDiagnostics.rootsMeasured = offsets.length;
    tubeDiagnostics.rootsOutsideFieldBox = outsideBox;
    tubeDiagnostics.rootOffsetP50Mm = offsets.length ? offsets[Math.floor(offsets.length / 2)] * 1000 : 0;
    tubeDiagnostics.rootOffsetP99Mm = offsets.length ? offsets[Math.floor(offsets.length * 0.99)] * 1000 : 0;
  }

  const sample: { x: number; y: number; z: number }[] = [];
  const sampleStep = Math.max(1, Math.floor(rootIndexes.length / 500));
  for (let k = 0; k < rootIndexes.length; k += sampleStep) {
    const v = rootIndexes[k];
    sample.push({ x: roots[3 * v], y: roots[3 * v + 1], z: roots[3 * v + 2] });
  }
  const nn = nearestNeighbourStats(sample);
  hairDiagnostics.golden = golden;
  hairDiagnostics.roots = rootIndexes.length;
  hairDiagnostics.curl = golden ? "golden-spiral" : "helix";
  // The hairline is where HAIR GROWS, so it is measured on the roots, not on the
  // hair mesh: the mesh's front edge is a side lock at temple height and reading
  // it as the hairline put her hairline 11 mm below her eyes.
  let hy = Infinity, hyFront = Infinity;
  for (const v of rootIndexes) {
    const y = roots[3 * v + 1], z = roots[3 * v + 2];
    hy = Math.min(hy, y);
    if (z > centre[2] + 0.015) hyFront = Math.min(hyFront, y);
  }
  hairDiagnostics.hairlineY = Number.isFinite(hy) ? hy : 0;
  hairDiagnostics.hairlineFrontY = Number.isFinite(hyFront) ? hyFront : 0;
  hairDiagnostics.rootCv = nn.cv;
  hairDiagnostics.meanSpacing = nn.mean;
  hairDiagnostics.minSpacing = nn.min;
  hairDiagnostics.maxSpacing = nn.max;
  return fieldFromVoxels(inside, dims, origin, h);
}


/* ------------------------------ real surface ----------------------------- */

/**
 * Which component each body triangle belongs to. The rules are the same
 * anatomical cuts the regions' distance fields use, applied to the triangle
 * centroid, so every triangle of her skin lands in exactly one component:
 * the union of the body components is ONE continuous surface, with no caps,
 * no overlaps and no seam where two regions meet.
 */
export const BODY_LABEL: Partial<Record<RegionId, number>> = { head: 1, hands: 2, arms: 3, feet: 4, neck: 5, torso: 6, pelvis: 7, legs: 8 };

function bodyLabel(x: number, y: number, z: number): number {
  const neckY = J("joint-neck")[1], shoulderY = J("joint-l-shoulder")[1];
  const pelvisY = J("joint-pelvis")[1], spine1Y = J("joint-spine-1")[1];
  const ankleY = J("joint-l-ankle")[1];
  if (y > neckY - 0.004) return 1;
  const p: V3 = [x, y, z];
  for (const side of [0, 1] as const) {
    const l = SIDE(side);
    if (!has(`joint-${l}-shoulder`)) continue;
    const sh = J(`joint-${l}-shoulder`), el = J(`joint-${l}-elbow`), w = J(`joint-${l}-hand`);
    if (Math.sign(x) !== Math.sign(sh[0])) continue;
    const dh = unit(sub(w, el));
    const wc: V3 = [w[0] - dh[0] * 0.015, w[1] - dh[1] * 0.015, w[2] - dh[2] * 0.015];
    if ((x - wc[0]) * dh[0] + (y - wc[1]) * dh[1] + (z - wc[2]) * dh[2] > 0 && Math.hypot(x - w[0], y - w[1], z - w[2]) < 0.18) return 2;
    const da = unit(sub(el, sh));
    const sc: V3 = [sh[0] + da[0] * 0.02, sh[1] + da[1] * 0.02, sh[2] + da[2] * 0.02];
    if ((x - sc[0]) * da[0] + (y - sc[1]) * da[1] + (z - sc[2]) * da[2] > 0 && around(sh, w, 0.085)(...p) < 0) return 3;
  }
  if (y < ankleY + 0.02) return 4;
  if (y > shoulderY - 0.01) return 5;
  if (y > spine1Y - 0.02) return 6;
  if (y > pelvisY - 0.10) return 7;
  return 8;
}

/** Subdivision levels of the visible body: 26.7 k CC0 triangles → 428 k. */
export const BODY_SUBDIVISIONS = 2;

interface BodySurface { key: string; positions: Float32Array; normals: Float32Array; indices: Uint32Array; labels: Uint8Array }
let bodySurfaceCache: BodySurface | null = null;

/**
 * Her whole skin as one explicit surface: the CC0 body posed by the same
 * bone rotations the hand and foot fields use, Loop-subdivided, and shaded
 * with normals computed over the WHOLE body before it is split.
 */
export function bodySurface(spec: CharacterSpec): BodySurface {
  const d = current!;
  const poses = [...handPoses(spec, 0), ...handPoses(spec, 1), ...footPoses(spec, 0), ...footPoses(spec, 1)];
  const key = `${d.digest}|${poseKey(poses)}|${BODY_SUBDIVISIONS}`;
  if (bodySurfaceCache?.key === key) return bodySurfaceCache;
  const posed = poses.length ? skin(d.positions, d.rig, poses) : d.positions;
  const sd = loopSubdivide(d.indices, [{ data: Float32Array.from(posed), stride: 3 }], BODY_SUBDIVISIONS);
  const positions = sd.attrs[0].data, indices = sd.indices;
  const normals = smoothNormals(positions, indices);
  const labels = new Uint8Array(indices.length / 3);
  for (let t = 0; t < labels.length; t++) {
    const a = 3 * indices[3 * t], b = 3 * indices[3 * t + 1], c = 3 * indices[3 * t + 2];
    labels[t] = bodyLabel((positions[a] + positions[b] + positions[c]) / 3, (positions[a + 1] + positions[b + 1] + positions[c + 1]) / 3, (positions[a + 2] + positions[b + 2] + positions[c + 2]) / 3);
  }
  bodySurfaceCache = { key, positions, normals, indices, labels };
  return bodySurfaceCache;
}

let wardrobeCache: { key: string; w: Wardrobe } | null = null;

/**
 * Her wardrobe, constructed on her body (see wardrobe.ts). Built once per
 * body + pose + outfit and shared by the three clothing components, because
 * the layers depend on each other: the trousers are fitted over the corset
 * and the boot shafts.
 */
export function leluWardrobe(spec: CharacterSpec): Wardrobe {
  const d = current!;
  const poses = [...handPoses(spec, 0), ...handPoses(spec, 1), ...footPoses(spec, 0), ...footPoses(spec, 1)];
  const key = `${d.digest}|${poseKey(poses)}|${JSON.stringify(spec.clothing)}`;
  if (wardrobeCache?.key === key) return wardrobeCache.w;
  const posed = poses.length ? skin(d.positions, d.rig, poses) : d.positions;
  const sd = loopSubdivide(d.indices, [{ data: Float32Array.from(posed), stride: 3 }], 1);
  const positions = sd.attrs[0].data, indices = sd.indices;
  const normals = smoothNormals(positions, indices);
  const labels = new Uint8Array(indices.length / 3);
  for (let t = 0; t < labels.length; t++) {
    const a = 3 * indices[3 * t], b = 3 * indices[3 * t + 1], c = 3 * indices[3 * t + 2];
    labels[t] = bodyLabel((positions[a] + positions[b] + positions[c]) / 3, (positions[a + 1] + positions[b + 1] + positions[c + 1]) / 3, (positions[a + 2] + positions[b + 2] + positions[c + 2]) / 3);
  }
  const L = BODY_LABEL as Required<Pick<typeof BODY_LABEL, "head" | "hands" | "arms" | "feet" | "neck" | "torso" | "pelvis" | "legs">>;
  const w = buildWardrobe({ joint: J, surf: { positions, normals, indices, labels }, labels: L, body: fieldSdf(bodyField("body", 0, [], null)) });
  wardrobeCache = { key, w };
  return w;
}

/** One region's share of her skin, in the component's frame (world − anchor). */
function bodyRegionMesh(spec: CharacterSpec, label: number, anchor: V3): Mesh {
  const b = bodySurface(spec);
  return extractSubmesh(b.positions, b.normals, b.indices, b.labels, label, anchor);
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

/**
 * The front-most point of her skin near (x, y): where the surface actually is.
 *
 * The reference rig's eye joints sit where the eyes are supposed to be, not
 * where this mesh's surface happens to be, so placing a ball at the joint put
 * two spheres in front of her face. Everything that has to sit ON her face —
 * eyeballs, nose ring, labret — is placed against the surface measured here.
 */
/**
 * Where her skin is in front of (x, y), measured from a point INSIDE her head.
 *
 * Starting outside and marching in is a trap: the first surface met can be the
 * back of her skull, and marching from the eye joint outward in one fixed
 * direction met the same. Starting inside — every face joint is inside the
 * head — and taking the NEAREST outward exit is unambiguous, because the eye
 * sits a few millimetres from the front of the face and centimetres from the
 * back of the head.
 */
function skinZ(x: number, y: number, seeded = 0): number {
  // Her face is at +z, so the front-most skin on a ray is the FIRST solid met
  // marching in from in front of her head — measured on the RAW head field, the
  // one that exists before any eyelid is cut into it.
  const sd = headFieldWithYouth(headSdf());
  const hp = J("joint-head");
  for (let z = hp[2] + 0.14; z > hp[2] - 0.14; z -= 0.0005) if (sd(x, y, z) < 0) return z;
  return seeded;
}

/** Her head's distance field, built once per loaded reference. */
let headFieldCache: { digest: string; youth: boolean; field: SdfField } | null = null;
function headSdf(): SdfField {
  if (headFieldCache && headFieldCache.digest === (current!.digest as string) && headFieldCache.youth === youthEnabled) return headFieldCache.field;
  const hp = J("joint-head"), neckY = J("joint-neck")[1];
  const field = bodyField("head", FIELD_H, [], { lo: [hp[0] - 0.16, neckY - 0.06, hp[2] - 0.20], hi: [hp[0] + 0.16, hp[1] + 0.16, hp[2] + 0.20] });
  headFieldCache = { digest: current!.digest as string, youth: youthEnabled, field };
  return field;
}

/** Semi-axes of her palpebral fissure, in metres, from the interpupillary span. */
const EYE_HALF_W = 0.0165, EYE_HALF_H = 0.0052;
/** Radius of her eyeball: a 24 mm globe, the real thing. */
const EYE_GLOBE_R = 0.012;

/**
 * Hazel-green, not grey.
 *
 * The facial reference sheet reads her iris as olive-hazel behind a dark limbal
 * ring (mean sampled colour ≈ #4a5222 in the lit part of the iris). 2.3 painted
 * the palette's `iris`, which rendered as a pale grey slit in every render — the
 * single most "not her" feature of her face.
 */
const IRIS_HAZEL: Rgb = [0.2, 0.225, 0.1];

/**
 * Her eyeball: a single globe whose pupil, iris, limbal ring and sclera are
 * decided by the direction from its centre, plus the cornea's catchlight.
 *
 * Angular sizes are anatomical: iris 12 mm across on a 24 mm globe (30 degrees
 * from the pole), pupil 4 mm (9.5 degrees), limbal ring just outside the iris.
 */
function leluEyeball(c: V3, skinFront: number): Shape {
  const R = EYE_GLOBE_R;
  const base: Shape = {
    f: (x, y, z) => Math.hypot(x - c[0], y - c[1], z - c[2]) - R,
    lo: [c[0] - R, c[1] - R, c[2] - R],
    hi: [c[0] + R, c[1] + R, c[2] + R],
    color: (_x, y, z) => {
      const vy = (y - c[1]) / R, vz = (z - c[2]) / R;
      const cos = vz; // forward is +z
      if (cos > 0.986) return L.pupil;
      if (cos > 0.868) return IRIS_HAZEL;
      if (cos > 0.851) return L.irisRing;
      // sclera: warm off-white, shaded under the upper lid
      const shade = Math.max(0, Math.min(1, (vy + 0.45) / 1.2));
      const k = 1 - 0.4 * shade;
      return [(L.sclera[0] * k + 0.02 * shade) as number, (L.sclera[1] * k) as number, (L.sclera[2] * k) as number] as Rgb;
    },
  };
  const out: Shape[] = [base];
  // cornea catchlight: the specular that makes an eye look wet and alive
  const hx = c[0] - 0.0045, hy = c[1] + 0.0048;
  const hz = c[2] + Math.sqrt(Math.max(0, R * R - 0.0045 ** 2 - 0.0048 ** 2)) - 0.0004;
  out.push(sphereShape([hx, hy, hz], 0.0014, [0.97, 0.96, 0.94]));
  void skinFront;
  return union(...out);
}

/**
 * Her actual eye opening, as an SDF to subtract from her head.
 *
 * The opening is an almond 33 mm wide and 10 mm tall with an upturned outer
 * corner — the dimensions of a real palpebral fissure. The earlier aperture was
 * span*0.33 across and span*0.15 tall (41 x 19 mm), which is why her sclera
 * read as two big white almonds instead of eyes.
 */
function eyeAperture(c: V3, span: number, side: number): Sdf {
  const w = EYE_HALF_W * (span / 0.062), tall = EYE_HALF_H * (span / 0.062);
  // An almond PRISM centred on the eyeball: the cross-section is the lid
  // opening, extruded far enough either side of the globe that it cannot miss
  // the skin. Anchoring the cut to the globe itself — rather than to a measured
  // "skin front" — is what makes it deterministic: a measured centre put the
  // pocket BEHIND the skin, which left the eyelid closed and the globe buried.
  const half = EYE_GLOBE_R + 0.02;
  return (x, y, z) => {
    const dx = (x - c[0]) / w;
    const dy = (y - (c[1] + side * 0.002 * dx)) / tall;
    const almond = Math.hypot(dx, dy * (1 + 0.55 * dx * dx)) - 1;
    return Math.max(almond * 0.012, Math.abs(z - c[2]) - half);
  };
}

/**
 * Her upper lid line: a dark arc that follows the top rim of the aperture and
 * flicks out at the outer corner. Painted as small spheres on the skin so it
 * survives sampling and reads as liner at any distance.
 */
function lidLiner(e: V3, span: number, side: number, out: Shape[], seedZ: number): void {
  const w = EYE_HALF_W * (span / 0.062), tall = EYE_HALF_H * (span / 0.062);
  const n = 13;
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const dx = -1 + 2.05 * t;
    const lx = e[0] + dx * w * 1.02;
    const ly = e[1] + side * 0.002 * dx + tall * (0.92 + 0.1 * Math.sin(Math.PI * t));
    const lz = skinZ(lx, ly, seedZ);
    if (lz === 0) continue;
    const r = 0.0013 * (0.75 + 0.6 * Math.sin(Math.PI * Math.min(1, t * 1.15)));
    out.push(sphereShape([lx, ly, lz + 0.0004], r, L.ink));
  }
  // the wing: three spheres kicking up and out past the outer corner
  for (let i = 1; i <= 3; i++) {
    const lx = e[0] + side * (w * 1.02 + i * 0.0032);
    const ly = e[1] + tall * 0.95 + i * 0.0026;
    const lz = skinZ(lx, ly, seedZ);
    if (lz === 0) continue;
    out.push(sphereShape([lx, ly, lz + 0.0004], 0.0012 - i * 0.00018, L.ink));
  }
}

/** Deterministic noise in [0,1) from a position — same value everywhere. */
function noise(x: number, y: number, z: number, seed = 0): number {
  const s = Math.sin(x * 1271.3 + y * 3117.7 + z * 743.9 + seed * 91.7) * 43758.5453;
  return s - Math.floor(s);
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

/**
 * Her measured landmarks, in metres above the floor, plus the joint-derived
 * widths the proportion analysis needs. Read from the same rig every component
 * uses, so the numbers are the body that was actually built.
 */
export function bodyLandmarks(): Record<string, number> {
  const head = J("joint-head"), neck = J("joint-neck"), chest = J("joint-spine-1");
  const waist = J("joint-spine-3"), pelvis = J("joint-pelvis");
  const knee = J("joint-l-knee"), ankle = J("joint-l-ankle"), toe = J("joint-l-toe-1-1");
  const shoulder = J("joint-l-shoulder"), elbow = J("joint-l-elbow"), wrist = J("joint-l-wrist");
  const eye = J("joint-l-eye"), chin = J("joint-chin");
  return {
    totalHeight: head[1] + 0.11,
    eyeHeight: eye[1],
    chinHeight: chin[1],
    neckHeight: neck[1],
    chestHeight: chest[1],
    waistHeight: waist[1],
    pelvisHeight: pelvis[1],
    kneeHeight: knee[1],
    ankleHeight: ankle[1],
    toeHeight: toe[1],
    shoulderToWrist: shoulder[1] - wrist[1],
    upperArm: shoulder[1] - elbow[1],
    forearm: elbow[1] - wrist[1],
    thigh: pelvis[1] - knee[1],
    shin: knee[1] - ankle[1],
    shoulderWidth: Math.abs(J("joint-l-shoulder")[0] - J("joint-r-shoulder")[0]),
    hipWidth: Math.abs(J("joint-l-hip")[0] - J("joint-r-hip")[0]),
    headWidth: Math.abs(J("joint-l-eye")[0] - J("joint-r-eye")[0]),
  };
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
  youthEnabled = spec.geometry?.youth === true;
  // Snapped to the OCCUPANCY cell, never to the mesh resolution: the anchor
  // that places this shape is `anchorCells(…, lattice.resolution)`, so
  // snapping with the mesh resolution shifted the head by up to 3 mm between
  // the per-component and whole-object paths.
  const anchor: V3 = frame === "head" ? [Math.round(headCenter[0] / CELL) * CELL, Math.round(headCenter[1] / CELL) * CELL, Math.round(headCenter[2] / CELL) * CELL] : [0, 0, 0];
  const key = `${current.digest}|region:${id}|${h}|${frame}|${anchor.join(",")}|${spec.hands.curl},${spec.hands.spread},${spec.hands.opposition},${spec.feet?.toeCurl ?? 0}|youth:${youthEnabled}`;
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
      // The youth pass deforms the head she HAS — her skull, her marks, her eye
      // joints. No generic face is substituted. The bounds are grown by the
      // displacement so no surface is sampled outside its own box.
      const headShape: Shape = youthEnabled
        ? { ...f, f: applyYouth(f.f), lo: [f.lo[0], f.lo[1], f.lo[2] - 0.002] as V3, hi: [f.hi[0] + 0.004, f.hi[1] + 0.004, f.hi[2] + 0.012] as V3 }
        : f;
      const m = faceMasks();
      const hairC = spec.materials.hair;
      let result = clip(headShape, above(neckY - 0.004));
      if (isLelu(spec)) {
        // Open her eyelids: without an aperture the reference mesh is closed and
        // the eyeballs read as two white slits behind skin.
        const eL = J("joint-l-eye"), eR = J("joint-r-eye");
        const span = Math.abs(eL[0] - eR[0]) || 0.062;
        // A youth pass opens the lid aperture slightly: the reference's eyes are
        // larger than the 2.1 build's, and a larger opening is what makes an eye
        // read young rather than small.
        const ap = (e: V3) => eyeAperture(e, span * (youthEnabled ? YOUTH_PAINT.apertureScale : 1), Math.sign(e[0]) || 1);
        result = subtract(result, (x, y, z) => Math.min(ap(eL)(x, y, z), ap(eR)(x, y, z)));
      }
      // Colour is written in WORLD space: the anchor block below moves the
      // field, the colour and the material into the head's frame together.
      if (isLelu(spec)) {
        const lm = faceLandmarks(spec);
        const pal = { skin: skinC, shade: L.skinShade, lip: L.lip, lipHighlight: L.lipHighlight, ink: L.ink, brow: [0.06, 0.04, 0.035] as Rgb };
        const hl = leluHairline(spec);
        // scalp: her hair colour under the hair, blended across the hairline,
        // with the skin of the centre part showing as a fine line
        const scalp = (x: number, y: number, z: number, c: Rgb): Rgb => {
          const k = hl.mask(x, y, z);
          if (k <= 0) return c;
          const part = Math.abs(x) < 0.0012 && y > hl.eyeY + 0.06 && z > hl.centre[2] - 0.06 ? 0.55 : 0;
          const sc: Rgb = [hairC[0] * 1.15 + 0.012, hairC[1] * 1.1 + 0.008, hairC[2] * 1.1 + 0.006];
          const under: Rgb = [sc[0] + (c[0] - sc[0]) * part, sc[1] + (c[1] - sc[1]) * part, sc[2] + (c[2] - sc[2]) * part];
          return [c[0] + (under[0] - c[0]) * k, c[1] + (under[1] - c[1]) * k, c[2] + (under[2] - c[2]) * k];
        };
        shape = {
          ...result,
          color: (x, y, z) => scalp(x, y, z, faceColour(x, y, z, lm, pal).c),
          material: (x, y, z) => (hl.mask(x, y, z) > 0.5 ? 1 : faceColour(x, y, z, lm, pal).m),
        };
      } else shape = { ...result, color: (x, y, z) => (m.lips(x, y, z) < 0 ? [0.44, 0.19, 0.17] : m.brows(x, y, z) < 0 ? hairC : skinC) };
      break;
    }
    case "face": {
      if (isLelu(spec)) {
        // Her eyes: 29 mm globes on the rig's eye joints with corneal bulge
        // and a fibred iris (explicit, 96 x 64), lashes grown from her measured
        // lid margins. Occupancy: the two globes.
        const lm = faceLandmarks(spec);
        const pal = { iris: L.iris, irisRing: L.irisRing, sclera: L.sclera, pupil: L.pupil };
        const parts: Mesh[] = [];
        for (const e of lm.eyes) {
          parts.push(eyeball(e.center, pal));
          parts.push(lashes(e, L.hair).mesh);
        }
        const mesh = mergeMeshes(parts);
        const P = new Float32Array(mesh.positions.length);
        for (let i = 0; i < P.length; i += 3) for (let a = 0; a < 3; a++) P[i + a] = mesh.positions[i + a] - anchor[a];
        const [a, b] = lm.eyes.map((e) => e.center);
        shape = {
          ...union(sphereShape(a, EYE_R, L.sclera), sphereShape(b, EYE_R, L.sclera)),
          mesh: { ...mesh, positions: P },
        };
        break;
      }
      // Real eyeballs and teeth. The eye proxy holds both eyes and a cornea
      // shell, so each is clipped to its own socket ball; the pupil is painted
      // on the front of the ball rather than left as a flat disc.
      // Eyeballs are placed from the reference's own eye joints and built as
      // spheres: the CC0 eye mesh is an open cornea shell, and an open surface
      // has no honest interior to mesh. Radius and centre come from the fitted
      // body, so the eyeball sits in the real socket behind the real lids.
      const lelu = isLelu(spec);
      const feats: Shape[] = [];
      for (const raw of [J("joint-l-eye"), J("joint-r-eye")]) {
        // ONE sphere per eye, its parts carried by DIRECTION from the ball's
        // centre: pupil, iris, limbal ring, sclera. Building the iris as a
        // second sphere in front of the sclera meant the union's colour rule
        // (nearest surface wins) painted the iris's bulge with the sclera's
        // colour — which is exactly the white ball with a dark dot that the
        // renders showed.
        //
        // Placement is measured, not assumed: the ball's apex sits flush with
        // the skin so no sclera shows through her eyelids, and the almond
        // aperture is what opens the lids over it.
        // The reference rig already puts the eye joint at the eyeball's centre:
        // the CC0 eye proxy sits exactly there, which is the one thing the rig
        // does tell us reliably. So the globe goes on the joint, and the lid
        // opening is cut around the same point.
        const zs = isLelu(spec) ? skinZ(raw[0], raw[1], raw[2]) : raw[2];
        // The globe sits where her SKIN is, not on the rig's joint: the joint is
        // a couple of millimetres behind the surface, which left only the globe's
        // edge visible through the lid opening and made her eyes read as two pale
        // slits with a dot in them. `zs` was already measured here and then
        // ignored; the cornea now sits 1.5 mm proud of the skin.
        const e: V3 = isLelu(spec) ? [raw[0], raw[1], zs - EYE_GLOBE_R + 0.0015] : raw;
        if (lelu) {
          feats.push(leluEyeball(e, zs));
        } else {
          feats.push(sphereShape([e[0], e[1], e[2] - 0.0022], 0.0112, [0.93, 0.91, 0.89]));
          feats.push(sphereShape([e[0], e[1], e[2] + 0.0086], 0.006, spec.materials.eyes));
          feats.push(sphereShape([e[0], e[1], e[2] + 0.0116], 0.0026, [0.02, 0.02, 0.02]));
        }
        if (lelu) {
          const side = Math.sign(e[0]) || 1;
          // winged liner on the upper lid rim, in her ink
          lidLiner(e, Math.abs(J("joint-l-eye")[0] - J("joint-r-eye")[0]) || 0.062, side, feats, raw[2]);
          // long dense lashes, growing from the lid rim and fanning up and out
          for (let i = 0; i < 11; i++) {
            const t = i / 10;
            const dx = -1 + 2.05 * t;
            const lx = e[0] + dx * EYE_HALF_W * 1.01;
            const ly = e[1] + side * 0.002 * dx + EYE_HALF_H * 0.95;
            const lz = skinZ(lx, ly, raw[2]) || e[2];
            if (!lz) continue;
            const len = 0.0068 * (0.6 + 0.55 * Math.sin(Math.PI * Math.min(1, t * 1.1)));
            feats.push(sphereShape([lx, ly, lz + 0.0006], 0.0009, L.hair));
            feats.push(sphereShape([lx + side * len * 0.28, ly + len * 0.62, lz + len * 0.42], 0.0007, L.hair));
            feats.push(sphereShape([lx + side * len * 0.5, ly + len * 0.9, lz + len * 0.6], 0.0005, L.hair));
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
        shape = { ...base, color: (x, y, z) => { const t = skinTone(x, y, z, skinC); return tattoo(x, y, z, t, L.ink, "chest", J) ?? t; } };
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
          if (isLelu(spec)) f.color = (x, y, z) => { const t = skinTone(x, y, z, skinC); return tattoo(x, y, z, t, L.ink, "forearm", J) ?? t; };
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
          if (isLelu(spec)) f.color = (x, y, z) => { const t = skinTone(x, y, z, skinC); return tattoo(x, y, z, t, L.ink, "hand", J) ?? t; };
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
      // Her corset is a dark camo ground printed with coral roses, and her cargo
      // is printed with the same rose. Painting the cloth is what makes these
      // read as her garments rather than as one flat colour.
      const clothPaint: ((x: number, y: number, z: number) => Rgb) | null =
        isLelu(spec) && id !== "clothing.shoes"
          ? (x, y) => {
              // Scattered rose motifs, not a stripe: a deterministic rose centre
              // per 5 cm cell, then a five-petal rosette around it. That is the
              // coral-on-camo print of her corset and cargo.
              const cell = 0.05;
              const gx = Math.floor(x / cell), gy = Math.floor(y / cell);
              const cx = (gx + 0.2 + 0.6 * noise(gx, gy, 0, 5)) * cell;
              const cy = (gy + 0.2 + 0.6 * noise(gx, gy, 0, 9)) * cell;
              const r = Math.hypot(x - cx, y - cy);
              const a = Math.atan2(y - cy, x - cx);
              if (r < 0.013 && Math.abs(Math.sin(2.5 * a + r * 210)) < 0.72) return L.corsetRose;
              return id === "clothing.top" ? L.corset : L.cargo;
            }
          : null;
      if (isLelu(spec)) {
        // HER wardrobe, constructed on her body and layered (wardrobe.ts):
        // the visible mesh is the garment itself, and occupancy is the
        // garment's own solid.
        const w = leluWardrobe(spec);
        const g = id === "clothing.top" ? w.top : id === "clothing.bottom" ? w.bottom : w.shoes;
        shape = { f: g.f, lo: g.lo, hi: g.hi, color: () => color, mesh: g.mesh };
        break;
      }
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
        shape = { f: (x, y, z) => Math.max(shellOfGarment(x, y, z), mask(x, y, z)), lo: g.lo, hi: g.hi, color: clothPaint ?? (() => color) };
      } else {
        shape = { f: shellOfGarment, lo: g.lo, hi: g.hi, color: clothPaint ?? (() => color) };
      }
      break;
    }
    case "hair": {
      // Real strands, not a shell. The CC0 asset supplies the hairstyle's
      // coverage and its hairline; the volume is grown as strands from the
      // scalp and rasterised into a density grid, so the surface has separate
      // locks with gaps between them instead of one helmet.
      if (isLelu(spec)) {
        const c = leluHairArch(spec);
        const m0 = c.lod;
        // the mesh lives in the component's frame; the field is moved below
        const m = m0, P = new Float32Array(m.positions.length);
        for (let i = 0; i < P.length; i += 3) for (let a = 0; a < 3; a++) P[i + a] = m.positions[i + a] - anchor[a];
        shape = { f: c.f, lo: c.lo, hi: c.hi, color: () => spec.materials.hair, mesh: { ...m, positions: P } };
        break;
      }
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
                // Highlights live in CLUMPS, not per voxel: her rose is woven
                // through whole curls, so the noise is sampled at 3 cm and every
                // curl in a clump takes the same hue.
                const s = noise(Math.round(x * 33), Math.round(y * 33), Math.round(z * 33), 11);
                const fine = noise(Math.round(x * 220), Math.round(y * 220), Math.round(z * 220), 5);
                if (s > 0.72) return fine > 0.5 ? L.hairRose : [0.42, 0.13, 0.24];
                return fine > 0.86 ? [0.2, 0.1, 0.14] : spec.materials.hair;
              },
            }
          : fieldShape(f, spec.materials.hair)
        : null;
      break;
    }
  }
  if (!shape) return null;
  // The visible skin is the asset's real surface; the field above stays the
  // region's occupancy.
  const label = BODY_LABEL[id];
  if (label) {
    // every region of her skin gets the same living tone, so seams match
    if (isLelu(spec) && (id === "neck" || id === "pelvis" || id === "legs" || id === "feet")) {
      const base = shape;
      shape = { ...base, color: (x, y, z) => skinTone(x, y, z, base.color(x, y, z)) };
    }
    shape = { ...shape, mesh: bodyRegionMesh(spec, label, anchor) };
  }
  if (anchor[0] || anchor[1] || anchor[2]) {
    const base = shape;
    // field, colour and material all move into the component's frame: moving
    // only the field left every head-frame colour evaluated ~1.5 m from its
    // landmarks (her iris came out as sclera)
    shape = {
      ...base,
      f: (x, y, z) => base.f(x + anchor[0], y + anchor[1], z + anchor[2]),
      color: (x, y, z) => base.color(x + anchor[0], y + anchor[1], z + anchor[2]),
      ...(base.material ? { material: (x: number, y: number, z: number) => base.material!(x + anchor[0], y + anchor[1], z + anchor[2]) } : {}),
      lo: [base.lo[0] - anchor[0], base.lo[1] - anchor[1], base.lo[2] - anchor[2]],
      hi: [base.hi[0] - anchor[0], base.hi[1] - anchor[1], base.hi[2] - anchor[2]],
    };
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
