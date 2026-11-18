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
import { fieldFromMesh, fieldSdf, fieldShape, fieldShellShape } from "./field.ts";
import { CELL } from "../character/lattice.ts";
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
      shape = { ...result, color: (x, y, z) => (m.lips(x, y, z) < 0 ? [0.44, 0.19, 0.17] : m.brows(x, y, z) < 0 ? hairC : skinC) };
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
      const feats: Shape[] = [];
      for (const e of [J("joint-l-eye"), J("joint-r-eye")]) {
        // Iris and pupil are proud of the sclera by a fraction of a cell, so
        // they survive sampling as geometry instead of being averaged away
        // into the ball's vertex colours.
        const sclera: V3 = [e[0], e[1], e[2] - 0.0022];
        feats.push(sphereShape(sclera, 0.0112, [0.93, 0.91, 0.89]));
        feats.push(sphereShape([e[0], e[1], e[2] + 0.0086], 0.0060, spec.materials.eyes));
        feats.push(sphereShape([e[0], e[1], e[2] + 0.0118], 0.0026, [0.02, 0.02, 0.02]));
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
      // Hair assets are open card surfaces: shell them into a volume with
      // real thickness rather than pretending they enclose a solid.
      // 8 mm: at FIELD_H this is 2.7 cells, so the shell cannot self-cancel.
      const f = proxyField(`hair:${spec.hair.style}`, h);
      shape = f ? fieldShellShape(f, Math.max(0.008, 0.008 * spec.hair.volume), spec.materials.hair) : null;
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
