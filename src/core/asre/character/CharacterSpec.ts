/**
 * ==========================================================
 * LÉLU ASRE — PERSISTENT CHARACTER SPEC
 *
 * One identity, many variations. The identity (id, face, skin, head
 * shape) is what makes her HER; hair, clothing, accessories, materials,
 * body proportions and pose vary around it. Every component reads only
 * its own slice of this spec (see components.ts), which is what lets a
 * hair change leave the body untouched.
 *
 * Units: metres. Frame: Y up, +Z is the character's front, +X her left.
 * ==========================================================
 */

import type { Rgb } from "./shape.ts";

export interface CharacterIdentity {
  id: string;
  name: string;
  /** Link to LÉLU's persona look (src/core/avatar/LeluRig.ts LeluLookId), when there is one. */
  leluLook?: string;
}

export interface BodyParams {
  height: number;
  shoulderWidth: number;
  hipWidth: number;
  /** Thickness multiplier for limbs and torso. */
  build: number;
  legRatio: number;
  armRatio: number;
}

export interface FaceParams {
  headScale: number;
  eyeSize: number;
  eyeSpacing: number;
  noseSize: number;
}

export type HairStyleId =
  | "buzz" | "pixie" | "bob" | "lob" | "long-straight" | "long-wavy" | "ponytail" | "high-ponytail" | "bun" | "top-knot"
  | "double-buns" | "pigtails" | "afro" | "mohawk" | "curtain-bangs" | "side-swept" | "braids" | "spiky" | "undercut" | "mullet"
  | "dreadlocks" | "none";

export interface HairParams {
  style: HairStyleId;
  /** 0.5 … 1.5 — scales length-type features. */
  length: number;
  /** 0.7 … 1.4 — scales thickness/volume. */
  volume: number;
}

export type TopType = "none" | "tank" | "tshirt" | "longsleeve" | "jacket";
export type BottomType = "none" | "shorts" | "pants" | "skirt";

export interface ClothingParams {
  top: TopType;
  bottom: BottomType;
  shoes: boolean;
}

export type HeadAccessory = "glasses" | "hat" | "earrings";
export type BodyAccessory = "necklace" | "backpack";

export interface Materials {
  skin: Rgb;
  hair: Rgb;
  top: Rgb;
  bottom: Rgb;
  shoes: Rgb;
  accessory: Rgb;
  eyes: Rgb;
}

export type PoseId = "relaxed" | "a-pose" | "t-pose" | "wave" | "stride";

/**
 * Hand articulation. These bend the real phalanx chain (see anatomy.ts), so a
 * different value is different geometry — a fist and an open hand are both
 * closed, watertight meshes, not a skin of the same shape.
 */
export interface HandParams {
  /** 0 = extended fingers, 1 = relaxed, 2 = clenched. */
  curl: number;
  /** 0 = digits together, 1 = fully spread. */
  spread: number;
  /** 0 = thumb at the side, 1 = thumb across the palm. */
  opposition: number;
}

/**
 * Where the body's anatomy comes from.
 *
 * "procedural" is LÉLU's own SDF vocabulary (the M5.8 baseline).
 * "reference" builds the same components from a fitted CC0 reference body
 * (MakeHuman base mesh + morph targets + rig), resampled into her own lattice.
 * The choice is part of every body component's content key, so switching it
 * regenerates exactly the components it affects and nothing else.
 */
export interface AnatomyParams {
  source: "procedural" | "reference";
  /** CC0 morph target names applied to the reference body, e.g. "macrodetails/…". */
  targets: string[];
}

/** Foot articulation, in the same spirit as HandParams: geometry, not a pose. */
export interface FeetParams {
  /** 0 = flat, 1 = toes gripping the ground. */
  toeCurl: number;
}

/**
 * Geometric-generation options. `golden` swaps LÉLU's hair root distribution for
 * an area-even Fibonacci one and her curls for a golden-logarithmic ringlet, and
 * adds the Fibonacci bead work to her jewelry. It changes generation, never
 * identity: her colours, marks, rig and canonical spec are untouched, and the
 * canonical build leaves this off.
 */
export interface GeometryParams {
  golden?: boolean;
  /**
   * Draw the hair as swept tube geometry instead of the occupancy-field mesh.
   * The occupancy cells are unchanged: this is a rendering representation, not
   * a structural one, so ASRE/NRE still see exactly the canonical hair volume.
   */
  hairTubes?: boolean;
  /** Tube detail level: 7×26, 5×14 or 3×7 sides × segments.
   */
  hairLod?: "high" | "medium" | "low";
}

export interface CharacterSpec {
  identity: CharacterIdentity;
  body: BodyParams;
  face: FaceParams;
  hair: HairParams;
  clothing: ClothingParams;
  accessories: { head: HeadAccessory[]; body: BodyAccessory[] };
  materials: Materials;
  pose: PoseId;
  hands: HandParams;
  feet: FeetParams;
  anatomy: AnatomyParams;
  geometry?: GeometryParams;
}

export const BASE_CHARACTER: CharacterSpec = {
  identity: { id: "lelu-asre-base", name: "LÉLU (ASRE base)", leluLook: "gothic" },
  body: { height: 1.7, shoulderWidth: 0.4, hipWidth: 0.34, build: 1, legRatio: 0.48, armRatio: 1 },
  face: { headScale: 1, eyeSize: 1, eyeSpacing: 1, noseSize: 1 },
  hair: { style: "long-straight", length: 1, volume: 1 },
  clothing: { top: "tshirt", bottom: "pants", shoes: true },
  accessories: { head: [], body: [] },
  materials: {
    skin: [0.62, 0.42, 0.32],
    hair: [0.08, 0.06, 0.07],
    top: [0.12, 0.1, 0.16],
    bottom: [0.1, 0.1, 0.12],
    shoes: [0.05, 0.05, 0.05],
    accessory: [0.75, 0.68, 0.45],
    eyes: [0.05, 0.03, 0.03],
  },
  pose: "relaxed",
  hands: { curl: 0.22, spread: 0.45, opposition: 0.5 },
  feet: { toeCurl: 0 },
  anatomy: { source: "procedural", targets: [] },
  geometry: { golden: false },
};

export const HAIR_STYLES: HairStyleId[] = [
  "buzz", "pixie", "bob", "lob", "long-straight", "long-wavy", "ponytail", "high-ponytail", "bun", "top-knot",
  "double-buns", "pigtails", "afro", "mohawk", "curtain-bangs", "side-swept", "braids", "spiky", "undercut", "mullet", "dreadlocks",
];

const HAIR_COLORS: Rgb[] = [
  [0.08, 0.06, 0.07], [0.35, 0.2, 0.1], [0.75, 0.55, 0.3], [0.55, 0.12, 0.08], [0.85, 0.85, 0.85], [0.3, 0.1, 0.45], [0.1, 0.35, 0.45],
];

/** Deterministic hairstyle variations: every style × (short/long or thin/full), then colours. */
export function hairVariations(count = 40): Array<{ hair: HairParams; color: Rgb; label: string }> {
  const out: Array<{ hair: HairParams; color: Rgb; label: string }> = [];
  const shapes: Array<[number, number, string]> = [[0.8, 0.9, "a"], [1.25, 1.2, "b"]];
  for (const [length, volume, tag] of shapes)
    for (const style of HAIR_STYLES) {
      if (out.length >= count) break;
      const color = HAIR_COLORS[out.length % HAIR_COLORS.length];
      out.push({ hair: { style, length, volume }, color, label: `${style}-${tag}` });
    }
  return out;
}

export const OUTFITS: Array<{ label: string; clothing: ClothingParams; top: Rgb; bottom: Rgb }> = [
  { label: "tee-jeans", clothing: { top: "tshirt", bottom: "pants", shoes: true }, top: [0.85, 0.85, 0.82], bottom: [0.15, 0.22, 0.4] },
  { label: "tank-shorts", clothing: { top: "tank", bottom: "shorts", shoes: true }, top: [0.75, 0.2, 0.25], bottom: [0.3, 0.3, 0.32] },
  { label: "longsleeve-skirt", clothing: { top: "longsleeve", bottom: "skirt", shoes: true }, top: [0.12, 0.1, 0.16], bottom: [0.35, 0.05, 0.1] },
  { label: "jacket-pants", clothing: { top: "jacket", bottom: "pants", shoes: true }, top: [0.3, 0.22, 0.12], bottom: [0.08, 0.08, 0.1] },
  { label: "tee-skirt", clothing: { top: "tshirt", bottom: "skirt", shoes: true }, top: [0.95, 0.75, 0.3], bottom: [0.1, 0.2, 0.15] },
  { label: "longsleeve-pants", clothing: { top: "longsleeve", bottom: "pants", shoes: true }, top: [0.2, 0.35, 0.3], bottom: [0.4, 0.35, 0.28] },
  { label: "jacket-shorts", clothing: { top: "jacket", bottom: "shorts", shoes: false }, top: [0.1, 0.1, 0.1], bottom: [0.6, 0.55, 0.45] },
  { label: "tank-skirt", clothing: { top: "tank", bottom: "skirt", shoes: false }, top: [0.9, 0.9, 0.95], bottom: [0.05, 0.05, 0.07] },
];

export const BODY_VARIANTS: Array<{ label: string; body: Partial<BodyParams> }> = [
  { label: "base", body: {} },
  { label: "tall", body: { height: 1.84, legRatio: 0.5 } },
  { label: "broad", body: { shoulderWidth: 0.47, build: 1.18 } },
  { label: "petite", body: { height: 1.56, shoulderWidth: 0.36, hipWidth: 0.31, build: 0.9 } },
];

export function withChanges(spec: CharacterSpec, patch: {
  body?: Partial<BodyParams>; face?: Partial<FaceParams>; hair?: Partial<HairParams>; clothing?: Partial<ClothingParams>;
  accessories?: Partial<CharacterSpec["accessories"]>; materials?: Partial<Materials>; pose?: PoseId; hands?: Partial<HandParams>;
  feet?: Partial<FeetParams>; anatomy?: Partial<AnatomyParams>; geometry?: GeometryParams;
}): CharacterSpec {
  return {
    identity: spec.identity,
    body: { ...spec.body, ...patch.body },
    face: { ...spec.face, ...patch.face },
    hair: { ...spec.hair, ...patch.hair },
    clothing: { ...spec.clothing, ...patch.clothing },
    accessories: { ...spec.accessories, ...patch.accessories },
    materials: { ...spec.materials, ...patch.materials },
    pose: patch.pose ?? spec.pose,
    hands: { ...spec.hands, ...patch.hands },
    feet: { ...spec.feet, ...patch.feet },
    anatomy: { ...spec.anatomy, ...patch.anatomy },
    geometry: { ...spec.geometry, ...patch.geometry },
  };
}
