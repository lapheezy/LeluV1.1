/**
 * ==========================================================
 * TEMPORAL STUDIO — ASRE — SHARED VOCABULARY
 *
 * Adaptive Spatial Reconstruction Engine.
 *
 * Mission 3 built the numerical representation and Mission 3.5 proved what
 * it preserves. ASRE adds the part that was missing: a reconstruction is
 * not one output but a set of *claims*, each one labelled with how it came
 * to exist, and each one revisable when more evidence arrives.
 *
 * The label is the whole point. A back surface guessed from a front
 * photograph must never be readable as something that was photographed.
 * Four labels, no more:
 *
 *   OBSERVED     — the image supports this directly (silhouette, colour,
 *                  shading gradient, a landmark that is actually visible).
 *   INFERRED     — derived from observations by an explicit rule (closure,
 *                  symmetry, inflation, anatomy proportions).
 *   SYNTHESIZED  — generated to fill information that no observation
 *                  covers (the unseen back, occluded interiors).
 *   INTERPOLATED — generated between two known states (temporal, or
 *                  between two hypotheses).
 *
 * Dependency-free: no DOM, no framework, no model runtime. Everything here
 * runs in a browser inspector, a Node worker and a test alike.
 * ==========================================================
 */

export type Provenance = "OBSERVED" | "INFERRED" | "SYNTHESIZED" | "INTERPOLATED";

/** Numeric encoding used inside voxel attribute channels. */
export const PROVENANCE_CODE: Readonly<Record<Provenance, number>> = {
  OBSERVED: 0,
  INFERRED: 1,
  SYNTHESIZED: 2,
  INTERPOLATED: 3,
};

export const PROVENANCE_BY_CODE: Readonly<Record<number, Provenance>> = {
  0: "OBSERVED",
  1: "INFERRED",
  2: "SYNTHESIZED",
  3: "INTERPOLATED",
};

export const PROVENANCE_ORDER: readonly Provenance[] = ["OBSERVED", "INFERRED", "SYNTHESIZED", "INTERPOLATED"];

/**
 * How much a cell is allowed to count as evidence. Observed geometry is
 * worth its measured confidence; anything the engine made up carries a
 * ceiling so it can never outrank a real observation when hypotheses are
 * fused or when a later view contradicts it.
 */
export const PROVENANCE_CEILING: Readonly<Record<Provenance, number>> = {
  OBSERVED: 1,
  INFERRED: 0.6,
  INTERPOLATED: 0.5,
  SYNTHESIZED: 0.35,
};

/**
 * A decoded image: straight 8-bit RGBA, row-major, top-left origin.
 * Decoding lives outside the engine (scripts/temporal/png.ts) so this
 * module never depends on a codec.
 */
export interface ImageFrame {
  width: number;
  height: number;
  /** width * height * 4 bytes. */
  rgba: Uint8Array;
}

export type Vec2 = [number, number];

export interface BBox2D {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function emptyBBox(): BBox2D {
  return { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
}

export function bboxIsEmpty(box: BBox2D): boolean {
  return !(box.maxX >= box.minX && box.maxY >= box.minY);
}

export function bboxWidth(box: BBox2D): number {
  return bboxIsEmpty(box) ? 0 : box.maxX - box.minX + 1;
}

export function bboxHeight(box: BBox2D): number {
  return bboxIsEmpty(box) ? 0 : box.maxY - box.minY + 1;
}

export function bboxArea(box: BBox2D): number {
  return bboxWidth(box) * bboxHeight(box);
}

export function bboxCentre(box: BBox2D): Vec2 {
  return [(box.minX + box.maxX) / 2, (box.minY + box.maxY) / 2];
}

export function bboxUnion(a: BBox2D, b: BBox2D): BBox2D {
  if (bboxIsEmpty(a)) return { ...b };
  if (bboxIsEmpty(b)) return { ...a };
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  };
}

/**
 * The components ASRE can reason about for a human character. Not every one
 * is separable from a single photograph, and the analysis reports what it
 * could not separate rather than quietly merging it into a neighbour.
 */
export type ComponentId =
  | "head"
  | "face"
  | "hair"
  | "neck"
  | "torso"
  | "arms"
  | "hands"
  | "pelvis"
  | "legs"
  | "feet"
  | "clothing"
  | "accessories";

export const COMPONENT_IDS: readonly ComponentId[] = [
  "head",
  "face",
  "hair",
  "neck",
  "torso",
  "arms",
  "hands",
  "pelvis",
  "legs",
  "feet",
  "clothing",
  "accessories",
];

export const COMPONENT_LABELS: Readonly<Record<ComponentId, string>> = {
  head: "Head",
  face: "Face",
  hair: "Hair",
  neck: "Neck",
  torso: "Torso",
  arms: "Arms",
  hands: "Hands",
  pelvis: "Pelvis",
  legs: "Legs",
  feet: "Feet",
  clothing: "Clothing",
  accessories: "Accessories",
};

/** A landmark is a measured point with the evidence that produced it. */
export interface Landmark {
  id: string;
  label: string;
  x: number;
  y: number;
  confidence: number;
  provenance: Provenance;
  /** How it was found, in words, so a wrong landmark can be argued with. */
  evidence: string;
}

/** One row of the silhouette: extents and the horizontal runs that make them. */
export interface RowSpan {
  y: number;
  minX: number;
  maxX: number;
  count: number;
  /** [start, end] inclusive x ranges of foreground pixels, left to right. */
  runs: Array<[number, number]>;
}
