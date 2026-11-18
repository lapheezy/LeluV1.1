/**
 * ==========================================================
 * LÉLU ASRE — CHARACTER COMPONENTS AND THEIR DEPENDENCIES (WP3)
 *
 * Each component declares:
 *   deps     components whose geometry it is built around
 *   params   the ONLY slice of the spec it reads
 *   frame    "world", or "head"/"neck" (local frame: built around the
 *            origin and placed by a lattice-snapped anchor, so a pure
 *            move — e.g. a taller body lifting the head — reuses it)
 *   build    the shape (SDF + bounds + colour)
 *
 * Content key = hash(component id, params slice, dependency keys).
 * Equal key ⇒ identical geometry ⇒ reuse. The anchor is NOT in the key.
 * ==========================================================
 */

import { sha256Hex } from "../nre/hash.ts";
import { canonicalJson } from "../nre/serialize.ts";
import { basisFrom, handLocal, mirrorX, placeLocal, vsub } from "./anatomy.ts";
import { group } from "./shape.ts";
import type { CharacterSpec, HairParams, PoseId } from "./CharacterSpec.ts";
import type { Sdf, V3 } from "./sdf.ts";
import * as P from "./sdf.ts";
import { capsule, clip, ellipsoid, inflate, roundBox, smooth, sphere, torus, union, type Rgb, type Shape } from "./shape.ts";

export type ComponentId =
  | "torso" | "pelvis" | "neck" | "head" | "face" | "hair" | "arms" | "hands" | "legs" | "feet"
  | "clothing.top" | "clothing.bottom" | "clothing.shoes" | "accessories.head" | "accessories.body";

export const COMPONENT_ORDER: ComponentId[] = [
  "torso", "pelvis", "neck", "head", "face", "hair", "arms", "hands", "legs", "feet",
  "clothing.top", "clothing.bottom", "clothing.shoes", "accessories.head", "accessories.body",
];

/* -------------------------------- skeleton -------------------------------- */

export interface Skeleton {
  headR: number;
  headCenter: V3;
  neckTop: V3;
  shoulderY: number;
  chestY: number;
  waistY: number;
  pelvisY: number;
  shoulder: [V3, V3];
  elbow: [V3, V3];
  wrist: [V3, V3];
  handTip: [V3, V3];
  hip: [V3, V3];
  knee: [V3, V3];
  ankle: [V3, V3];
}

const POSES: Record<PoseId, { abd: [number, number]; elbow: [number, number]; spread: [number, number]; stride: [number, number] }> = {
  relaxed: { abd: [10, 10], elbow: [12, 12], spread: [3, 3], stride: [0, 0] },
  "a-pose": { abd: [40, 40], elbow: [5, 5], spread: [6, 6], stride: [0, 0] },
  "t-pose": { abd: [88, 88], elbow: [0, 0], spread: [4, 4], stride: [0, 0] },
  wave: { abd: [12, 150], elbow: [12, 70], spread: [4, 4], stride: [0, 0] },
  stride: { abd: [14, 14], elbow: [25, 25], spread: [5, 5], stride: [18, -14] },
};

const rad = (d: number) => (d * Math.PI) / 180;
const add = (a: V3, b: V3, s = 1): V3 => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];
const norm = (v: V3): V3 => {
  const l = Math.hypot(...v) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};

export function skeleton(spec: CharacterSpec, lattice: number): Skeleton {
  const b = spec.body;
  const H = b.height;
  const headR = 0.105 * spec.face.headScale;
  const snap = (v: number) => Math.round(v / lattice) * lattice;
  const headCenter: V3 = [0, snap(H - headR * 1.1), snap(0.01)];
  const shoulderY = H * 0.815;
  const pose = POSES[spec.pose];
  const upper = 0.186 * H * b.armRatio, fore = 0.15 * H * b.armRatio, hand = 0.105 * H;
  const arm = (side: 0 | 1) => {
    const sx = side === 0 ? 1 : -1;
    const a = rad(pose.abd[side]);
    const shoulder: V3 = [sx * b.shoulderWidth / 2, shoulderY - 0.025, 0];
    const dir: V3 = [sx * Math.sin(a), -Math.cos(a), 0];
    const elbow = add(shoulder, dir, upper);
    const e = rad(pose.elbow[side]);
    const fdir = norm([dir[0] * Math.cos(e), dir[1] * Math.cos(e) + (pose.abd[side] > 100 ? Math.sin(e) * 0.6 : 0), Math.sin(e)]);
    const wrist = add(elbow, fdir, fore);
    return { shoulder, elbow, wrist, tip: add(wrist, fdir, hand) };
  };
  const L = arm(0), R = arm(1);
  const hipY = H * b.legRatio;
  const leg = (side: 0 | 1) => {
    const sx = side === 0 ? 1 : -1;
    const s = rad(pose.spread[side]), st = rad(pose.stride[side]);
    const hip: V3 = [sx * b.hipWidth * 0.28, hipY, 0];
    const dir = norm([sx * Math.sin(s), -Math.cos(s), Math.sin(st)]);
    const thigh = hipY * 0.5, shin = hipY * 0.45;
    const knee = add(hip, dir, thigh);
    return { hip, knee, ankle: add(knee, dir, shin) };
  };
  const LL = leg(0), RL = leg(1);
  return {
    headR,
    headCenter,
    neckTop: [0, headCenter[1] - headR * 0.75, -0.01],
    shoulderY,
    chestY: H * 0.72,
    waistY: H * 0.615,
    pelvisY: H * 0.54,
    shoulder: [L.shoulder, R.shoulder],
    elbow: [L.elbow, R.elbow],
    wrist: [L.wrist, R.wrist],
    handTip: [L.tip, R.tip],
    hip: [LL.hip, RL.hip],
    knee: [LL.knee, RL.knee],
    ankle: [LL.ankle, RL.ankle],
  };
}

/* ------------------------------ shape builders ------------------------------ */

export const restKneeY = (s: CharacterSpec) => +(s.body.height * s.body.legRatio * 0.5).toFixed(5);

type Ctx = { spec: CharacterSpec; sk: Skeleton; /** mesh resolution, for sub-cell gap handling */ h?: number };
const m = (ctx: Ctx) => ctx.spec.materials;

function torsoShape({ spec, sk }: Ctx): Shape {
  const b = spec.body, k = b.build, skin = spec.materials.skin;
  return smooth(
    0.06,
    ellipsoid([0, sk.chestY, 0], [b.shoulderWidth * 0.42, 0.15, 0.115 * k], skin),
    ellipsoid([0, sk.waistY, 0], [b.shoulderWidth * 0.34 * k, 0.12, 0.1 * k], skin),
    capsule([b.shoulderWidth * 0.42, sk.shoulderY - 0.03, 0], [-b.shoulderWidth * 0.42, sk.shoulderY - 0.03, 0], 0.055 * k, 0.055 * k, skin),
  );
}

function pelvisShape({ spec, sk }: Ctx): Shape {
  const b = spec.body, skin = spec.materials.skin;
  return smooth(0.05, ellipsoid([0, sk.pelvisY, 0], [b.hipWidth * 0.5, 0.11, 0.115 * b.build], skin), sphere(sk.hip[0], 0.075 * b.build, skin), sphere(sk.hip[1], 0.075 * b.build, skin));
}

const neckShape = ({ spec, sk }: Ctx): Shape => capsule(sk.neckTop, [0, sk.shoulderY - 0.02, -0.01], 0.052 * spec.body.build, 0.06 * spec.body.build, spec.materials.skin);

/** Head in its LOCAL frame (origin = head centre). */
function headLocal({ spec, sk }: Ctx): Shape {
  const R = sk.headR, skin = spec.materials.skin;
  return smooth(0.02, ellipsoid([0, 0, 0], [0.86 * R, 1.08 * R, 0.98 * R], skin), ellipsoid([0, -0.55 * R, 0.25 * R], [0.62 * R, 0.5 * R, 0.62 * R], skin), ellipsoid([0.86 * R, -0.05 * R, -0.05 * R], [0.1 * R, 0.24 * R, 0.14 * R], skin), ellipsoid([-0.86 * R, -0.05 * R, -0.05 * R], [0.1 * R, 0.24 * R, 0.14 * R], skin));
}

function faceLocal({ spec, sk }: Ctx): Shape {
  const R = sk.headR, f = spec.face, eye = spec.materials.eyes, skin = spec.materials.skin;
  const ex = 0.36 * R * f.eyeSpacing, er = 0.13 * R * f.eyeSize;
  return union(
    sphere([ex, 0.05 * R, 0.86 * R], er, eye),
    sphere([-ex, 0.05 * R, 0.86 * R], er, eye),
    ellipsoid([0, -0.22 * R, 0.98 * R], [0.12 * R * f.noseSize, 0.22 * R * f.noseSize, 0.16 * R * f.noseSize], skin),
    capsule([0.17 * R, -0.55 * R, 0.9 * R], [-0.17 * R, -0.55 * R, 0.9 * R], 0.05 * R, 0.05 * R, [0.5, 0.25, 0.25]),
    capsule([ex + 0.15 * R, 0.3 * R, 0.9 * R], [ex - 0.15 * R, 0.33 * R, 0.93 * R], 0.035 * R, 0.035 * R, spec.materials.hair),
    capsule([-ex - 0.15 * R, 0.3 * R, 0.9 * R], [-ex + 0.15 * R, 0.33 * R, 0.93 * R], 0.035 * R, 0.035 * R, spec.materials.hair),
  );
}

/** Hair in the head's local frame. */
export function hairLocal(R: number, hair: HairParams, color: Rgb): Shape | null {
  if (hair.style === "none") return null;
  const L = hair.length, V = hair.volume;
  const scalp = ellipsoid([0, 0, 0], [0.86 * R, 1.08 * R, 0.98 * R], color);
  // allowed region: not the face (front, below the hairline)
  const notFace = (hairline: number): Sdf => (_x, y, z) => -Math.max(0.15 * R - z, y - hairline * R);
  const above = (yr: number): Sdf => P.plane([0, yr * R, 0], [0, -1, 0]);
  const cap = (t: number, hairline = 0.5, bottom = -0.3) => clip(inflate(scalp, Math.max(0.012, t * R * V), color), notFace(hairline), above(bottom));
  const curtain = (len: number, wave = 0) => {
    const base = clip(
      smooth(0.04,
        roundBox([0, -0.2 * R - len / 2, -0.45 * R], [0.95 * R * V, len / 2 + 0.25 * R, 0.55 * R * V], 0.25 * R, color),
        ellipsoid([0, 0.05 * R, -0.05 * R], [1.02 * R * V, 1.18 * R, 1.08 * R], color)),
      notFace(0.45));
    return wave ? { ...base, f: (x: number, y: number, z: number) => base.f(x, y, z) + 0.006 * Math.sin(y * 45 + x * 10) } : base;
  };
  const strands = (n: number, len: number, r: number) =>
    Array.from({ length: n }, (_, i) => {
      const a = Math.PI * (0.15 + (0.7 * i) / Math.max(1, n - 1));
      const x = Math.cos(a) * 0.95 * R, z = -Math.sin(a) * 0.9 * R;
      return capsule([x, 0.2 * R, z], [x * 1.1, -len, z * 1.1], r, r * 0.8, color);
    });
  switch (hair.style) {
    case "buzz": return cap(0.04, 0.55, -0.15);
    case "pixie": return union(cap(0.09), ellipsoid([0.2 * R, 0.62 * R, 0.62 * R], [0.55 * R, 0.16 * R, 0.3 * R], color));
    case "bob": return clip(union(cap(0.12), inflate(scalp, 0.12 * R * V, color)), notFace(0.45), above(-0.65 - 0.2 * (L - 1)));
    case "lob": return clip(union(cap(0.12), inflate(scalp, 0.13 * R * V, color), roundBox([0, -0.75 * R, -0.35 * R], [0.95 * R, 0.4 * R * L, 0.55 * R], 0.2 * R, color)), notFace(0.45), above(-1.25 * L));
    case "long-straight": return union(cap(0.1), curtain(0.45 * L));
    case "long-wavy": return union(cap(0.11), curtain(0.42 * L, 1));
    case "ponytail": return union(cap(0.08), capsule([0, 0.25 * R, -1.0 * R], [0, -0.3 * L, -1.35 * R], 0.24 * R * V, 0.12 * R * V, color), torus([0, 0.2 * R, -1.02 * R], 0.18 * R, 0.05 * R, 2, color));
    case "high-ponytail": return union(cap(0.08), capsule([0, 0.95 * R, -0.75 * R], [0, -0.15 * L, -1.45 * R], 0.24 * R * V, 0.1 * R * V, color));
    case "bun": return union(cap(0.08), sphere([0, 0.75 * R, -0.85 * R], 0.38 * R * V, color));
    case "top-knot": return union(cap(0.07), sphere([0, 1.25 * R, -0.1 * R], 0.33 * R * V, color));
    case "double-buns": return union(cap(0.08), sphere([0.62 * R, 0.85 * R, -0.25 * R], 0.3 * R * V, color), sphere([-0.62 * R, 0.85 * R, -0.25 * R], 0.3 * R * V, color));
    case "pigtails": return union(cap(0.08), capsule([0.95 * R, -0.05 * R, -0.35 * R], [1.2 * R, -0.3 * L, -0.25 * R], 0.2 * R * V, 0.1 * R, color), capsule([-0.95 * R, -0.05 * R, -0.35 * R], [-1.2 * R, -0.3 * L, -0.25 * R], 0.2 * R * V, 0.1 * R, color));
    case "afro": return clip(sphere([0, 0.25 * R, -0.15 * R], 1.4 * R * V * (0.8 + 0.2 * L), color), notFace(0.45), above(-0.55));
    case "mohawk": return union(cap(0.03, 0.55, 0.1), clip(roundBox([0, 0.9 * R, -0.2 * R], [0.11 * R * V, 0.45 * R * L, 0.95 * R], 0.08 * R, color), (x, y, z) => Math.hypot(x / (1.05 * R), y / (1.5 * R * L), z / (1.15 * R)) - 1));
    case "curtain-bangs": return union(cap(0.1), curtain(0.3 * L), capsule([0.15 * R, 0.75 * R, 0.85 * R], [0.75 * R, 0.1 * R, 0.85 * R], 0.12 * R, 0.08 * R, color), capsule([-0.15 * R, 0.75 * R, 0.85 * R], [-0.75 * R, 0.1 * R, 0.85 * R], 0.12 * R, 0.08 * R, color));
    case "side-swept": return union(cap(0.11), ellipsoid([0.3 * R, 0.62 * R, 0.68 * R], [0.75 * R * V, 0.2 * R, 0.35 * R], color), roundBox([0, -0.3 * R, -0.45 * R], [0.9 * R, 0.4 * R * L, 0.5 * R], 0.2 * R, color));
    case "braids": return union(cap(0.08), ...[1, -1].flatMap((s) => Array.from({ length: Math.round(7 * L) }, (_, i) => sphere([s * 0.7 * R, -0.3 * R - i * 0.055, -0.55 * R], (0.1 - 0.004 * i) * R * V * 1.2, color))));
    case "spiky": return union(cap(0.08), ...Array.from({ length: 9 }, (_, i) => {
      const a = (i / 9) * Math.PI * 2;
      const base: V3 = [Math.cos(a) * 0.45 * R, 0.85 * R, Math.sin(a) * 0.45 * R - 0.1 * R];
      return capsule(base, [base[0] * 1.8, 1.45 * R * L, base[2] * 1.8], 0.14 * R * V, 0.02 * R, color);
    }));
    case "undercut": return union(cap(0.03, 0.55, 0.05), clip(inflate(scalp, 0.2 * R * V, color), above(0.35), notFace(0.6)));
    case "mullet": return union(cap(0.08), roundBox([0, -0.55 * R - 0.15 * L, -0.65 * R], [0.75 * R, 0.45 * R * L, 0.35 * R * V], 0.15 * R, color));
    case "dreadlocks": return union(cap(0.08), ...strands(11, 0.35 * L, 0.07 * R * V));
  }
}

function armsShape({ spec, sk }: Ctx): Shape {
  const k = spec.body.build, skin = spec.materials.skin;
  return union(...[0, 1].flatMap((s) => [capsule(sk.shoulder[s], sk.elbow[s], 0.046 * k, 0.038 * k, skin), capsule(sk.elbow[s], sk.wrist[s], 0.037 * k, 0.028 * k, skin)]));
}

/**
 * Both hands: the same parametric hand placed in each wrist's own frame.
 * +Y along the hand, +Z out of the back of the hand (lateral for a hanging
 * arm), +X on the thumb side — so the digits stay in the palm plane whatever
 * the arm pose, and the palm faces the body instead of the camera.
 */
function handsShape({ spec, sk, h }: Ctx): Shape {
  const parts = [0, 1].map((side) => {
    const wrist = sk.wrist[side];
    const along = vsub(sk.handTip[side], wrist);
    const b = basisFrom(wrist, along, [side === 0 ? 1 : -1, 0, 0]);
    const hand = handLocal(spec);
    // the thumb points forward on both sides: the right hand is the mirror image
    return placeLocal(side === 0 ? hand : mirrorX(hand), b);
  });
  // the two hands cannot touch, so each is sampled in its own box
  return group(...parts);
}

function legsShape({ spec, sk }: Ctx): Shape {
  const k = spec.body.build, skin = spec.materials.skin;
  return union(...[0, 1].flatMap((s) => [capsule(sk.hip[s], sk.knee[s], 0.072 * k, 0.05 * k, skin), capsule(sk.knee[s], sk.ankle[s], 0.049 * k, 0.034 * k, skin)]));
}

function feetShape({ spec, sk }: Ctx): Shape {
  const skin = spec.materials.skin;
  return union(...[0, 1].map((s) => capsule(add(sk.ankle[s], [0, -0.025, -0.03]), add(sk.ankle[s], [0, -0.04, 0.16]), 0.04, 0.034, skin)));
}

/** Sleeve: shell around a limb capsule, kept up to `frac` of the limb from its root. */
function sleeve(a: V3, b: V3, ra: number, rb: number, frac: number, gap: number, t: number, color: Rgb): Shape {
  const d: V3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const cut = add(a, d, frac);
  return clip(inflate(capsule(a, b, ra, rb, color), gap + t, color), P.plane(cut, d));
}

function topShape(ctx: Ctx): Shape | null {
  const { spec, sk } = ctx;
  const type = spec.clothing.top;
  if (type === "none") return null;
  const c = m(ctx).top, k = spec.body.build;
  const t = type === "jacket" ? 0.016 : 0.008;
  const torsoT = clip(inflate(torsoShape(ctx), 0.003 + t, c), P.plane([0, sk.pelvisY + 0.03, 0], [0, -1, 0]), P.plane([0, sk.shoulderY + 0.035, 0], [0, 1, 0]));
  const parts: Shape[] = [torsoT];
  const frac = type === "tank" ? 0 : type === "tshirt" ? 0.45 : 1;
  for (const s of [0, 1]) {
    if (frac > 0) parts.push(sleeve(sk.shoulder[s], sk.elbow[s], 0.046 * k, 0.038 * k, Math.min(1, frac), 0.003, t, c));
    if (frac >= 1) parts.push(sleeve(sk.elbow[s], sk.wrist[s], 0.037 * k, 0.028 * k, 0.92, 0.003, t, c));
  }
  if (type === "jacket") parts.push(torus([0, sk.shoulderY + 0.01, -0.005], 0.07 * k, 0.02, 1, c));
  return union(...parts);
}

function bottomShape(ctx: Ctx): Shape | null {
  const { spec, sk } = ctx;
  const type = spec.clothing.bottom;
  if (type === "none") return null;
  const c = m(ctx).bottom, k = spec.body.build;
  const hips = clip(inflate(pelvisShape(ctx), 0.01, c), P.plane([0, sk.waistY - 0.02, 0], [0, 1, 0]));
  if (type === "skirt") {
    // hem from REST proportions (not the posed knee), so a pose cannot move it
    const bottomY = restKneeY(spec) + 0.03;
    return union(hips, clip(capsule([0, sk.pelvisY + 0.02, 0], [0, bottomY, 0.01], spec.body.hipWidth * 0.52, spec.body.hipWidth * 0.78, c), P.plane([0, bottomY, 0], [0, -1, 0]), P.plane([0, sk.waistY - 0.02, 0], [0, 1, 0])));
  }
  const frac = type === "shorts" ? 0.6 : 1;
  const parts: Shape[] = [hips];
  for (const s of [0, 1]) {
    parts.push(sleeve(sk.hip[s], sk.knee[s], 0.072 * k, 0.05 * k, frac, 0.003, 0.008, c));
    if (frac >= 1) parts.push(sleeve(sk.knee[s], sk.ankle[s], 0.049 * k, 0.034 * k, 0.95, 0.003, 0.008, c));
  }
  return union(...parts);
}

function shoesShape(ctx: Ctx): Shape | null {
  if (!ctx.spec.clothing.shoes) return null;
  const c = m(ctx).shoes;
  return union(...[0, 1].map((s) => capsule(add(ctx.sk.ankle[s], [0, -0.03, -0.04]), add(ctx.sk.ankle[s], [0, -0.042, 0.175]), 0.052, 0.045, c)));
}

function headAccessoriesLocal(ctx: Ctx): Shape | null {
  const R = ctx.sk.headR, c = m(ctx).accessory, parts: Shape[] = [];
  for (const a of ctx.spec.accessories.head) {
    if (a === "glasses") {
      const ex = 0.36 * R * ctx.spec.face.eyeSpacing;
      parts.push(torus([ex, 0.05 * R, 1.02 * R], 0.24 * R, 0.035 * R, 2, c), torus([-ex, 0.05 * R, 1.02 * R], 0.24 * R, 0.035 * R, 2, c));
      parts.push(capsule([ex - 0.24 * R, 0.08 * R, 1.04 * R], [-ex + 0.24 * R, 0.08 * R, 1.04 * R], 0.03 * R, 0.03 * R, c));
      for (const s of [1, -1]) parts.push(capsule([s * (ex + 0.24 * R), 0.08 * R, 0.98 * R], [s * 0.92 * R, 0.05 * R, -0.1 * R], 0.03 * R, 0.03 * R, c));
    } else if (a === "hat") {
      parts.push(capsule([0, 0.55 * R, -0.05 * R], [0, 1.25 * R, -0.05 * R], 0.98 * R, 0.9 * R, c), ellipsoid([0, 0.55 * R, 0], [1.75 * R, 0.07 * R, 1.75 * R], c));
    } else if (a === "earrings") {
      parts.push(sphere([0.95 * R, -0.42 * R, -0.02 * R], 0.07 * R, c), sphere([-0.95 * R, -0.42 * R, -0.02 * R], 0.07 * R, c));
    }
  }
  return parts.length ? union(...parts) : null;
}

function bodyAccessories(ctx: Ctx): Shape | null {
  const { sk, spec } = ctx, c = m(ctx).accessory, parts: Shape[] = [];
  for (const a of spec.accessories.body) {
    if (a === "necklace") parts.push(torus([0, sk.shoulderY + 0.005, 0.01], 0.075 * spec.body.build, 0.006, 1, c));
    if (a === "backpack") parts.push(roundBox([0, sk.chestY - 0.03, -0.17 * spec.body.build], [0.15, 0.2, 0.07], 0.04, [0.25, 0.3, 0.2]));
  }
  return parts.length ? union(...parts) : null;
}

/* ---------------------------- component registry ---------------------------- */

export interface ComponentDef {
  id: ComponentId;
  frame: "world" | "head";
  deps: (spec: CharacterSpec) => ComponentId[];
  params: (spec: CharacterSpec, sk: Skeleton) => unknown;
  build: (ctx: Ctx) => Shape | null;
}

const bodyP = (s: CharacterSpec) => ({ body: s.body, skin: s.materials.skin });
const pose = (s: CharacterSpec) => s.pose;

export const COMPONENTS: Record<ComponentId, ComponentDef> = {
  torso: { id: "torso", frame: "world", deps: () => [], params: (s) => bodyP(s), build: torsoShape },
  pelvis: { id: "pelvis", frame: "world", deps: () => [], params: (s) => bodyP(s), build: pelvisShape },
  neck: { id: "neck", frame: "world", deps: () => ["torso"], params: (s, sk) => ({ ...bodyP(s), neckTop: sk.neckTop }), build: neckShape },
  head: { id: "head", frame: "head", deps: () => [], params: (s) => ({ headScale: s.face.headScale, skin: s.materials.skin }), build: headLocal },
  face: { id: "face", frame: "head", deps: () => ["head"], params: (s) => ({ face: s.face, eyes: s.materials.eyes, brows: s.materials.hair }), build: faceLocal },
  hair: { id: "hair", frame: "head", deps: () => ["head"], params: (s) => ({ hair: s.hair, color: s.materials.hair }), build: ({ spec, sk }) => hairLocal(sk.headR, spec.hair, spec.materials.hair) },
  arms: { id: "arms", frame: "world", deps: () => ["torso"], params: (s) => ({ ...bodyP(s), pose: pose(s) }), build: armsShape },
  hands: { id: "hands", frame: "world", deps: () => ["arms"], params: (s) => ({ hands: s.hands, skin: s.materials.skin, height: s.body.height, build: s.body.build }), build: handsShape },
  legs: { id: "legs", frame: "world", deps: () => ["pelvis"], params: (s) => ({ ...bodyP(s), pose: pose(s) }), build: legsShape },
  feet: { id: "feet", frame: "world", deps: () => ["legs"], params: (s) => ({ skin: s.materials.skin }), build: feetShape },
  "clothing.top": {
    id: "clothing.top",
    frame: "world",
    // a tank top has no sleeves: arm pose cannot affect it
    deps: (s) => (s.clothing.top === "tank" || s.clothing.top === "none" ? ["torso"] : ["torso", "arms"]),
    params: (s) => ({ top: s.clothing.top, color: s.materials.top }),
    build: topShape,
  },
  "clothing.bottom": {
    id: "clothing.bottom",
    frame: "world",
    // a skirt hangs from the pelvis; trousers follow the legs
    deps: (s) => (s.clothing.bottom === "skirt" || s.clothing.bottom === "none" ? ["pelvis"] : ["pelvis", "legs"]),
    params: (s) => ({ bottom: s.clothing.bottom, color: s.materials.bottom, ...(s.clothing.bottom === "skirt" ? { restKneeY: restKneeY(s), hipWidth: s.body.hipWidth } : {}) }),
    build: bottomShape,
  },
  "clothing.shoes": { id: "clothing.shoes", frame: "world", deps: () => ["feet"], params: (s) => ({ shoes: s.clothing.shoes, color: s.materials.shoes }), build: shoesShape },
  "accessories.head": { id: "accessories.head", frame: "head", deps: () => ["head", "face"], params: (s) => ({ items: s.accessories.head, color: s.materials.accessory }), build: headAccessoriesLocal },
  "accessories.body": { id: "accessories.body", frame: "world", deps: () => ["torso", "neck"], params: (s) => ({ items: s.accessories.body, color: s.materials.accessory }), build: bodyAccessories },
};

/** Content keys for every component (topological order). */
export function componentKeys(spec: CharacterSpec, sk: Skeleton): Record<ComponentId, string> {
  const keys = {} as Record<ComponentId, string>;
  for (const id of COMPONENT_ORDER) {
    const def = COMPONENTS[id];
    const deps = def.deps(spec);
    keys[id] = sha256Hex(canonicalJson({ id, params: def.params(spec, sk), deps: deps.map((d) => keys[d]) })).slice(0, 16);
  }
  return keys;
}

/** Anchor (absolute lattice cell) where a component's local frame is placed. */
export function anchorCells(def: ComponentDef, sk: Skeleton, lattice: number): V3 {
  if (def.frame === "head") return sk.headCenter.map((v) => Math.round(v / lattice)) as V3;
  return [0, 0, 0];
}

export function contextFor(spec: CharacterSpec, sk: Skeleton, h?: number): Ctx {
  return { spec, sk, h };
}

