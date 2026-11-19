/**
 * ==========================================================
 * LÉLU CHARACTER FOUNDRY — MEASURED COMPARISON
 *
 * Part VII demands measurable comparisons, and warns that a high perceptual
 * score is not proof of correct geometry. So this module produces four
 * different kinds of number, each with its own caveat:
 *
 *   silhouette   normalised mask overlap (IoU) between a render and a reference
 *   landmarks    the sheet's ratios against the mesh's own measured landmarks
 *   hair         strand count / length / thickness / coverage against the sheet
 *   colour       a coarse masked histogram distance (appearance, not shape)
 *
 * A comparison that cannot be trusted says so: an unusable mask, or a feature
 * the mesh never measured, is reported as `not-measured` rather than skipped.
 * ==========================================================
 */

import type { RgbaImage } from "../image/png.ts";
import { REFERENCE_231 } from "../character/youth.ts";

export interface Mask {
  w: number;
  h: number;
  data: Uint8Array;
}

export interface MaskOptions {
  /** Use the alpha channel when the image has transparency. */
  alpha?: boolean;
  /** Background colour for opaque renders; defaults to the corner pixel. */
  background?: [number, number, number];
  /** RGB distance above which a pixel counts as subject (0..441). */
  tolerance?: number;
}

function rgbDistance(r: number, g: number, b: number, bg: [number, number, number]): number {
  return Math.hypot(r - bg[0], g - bg[1], b - bg[2]);
}

/** A subject mask from an RGBA image: alpha when present, background otherwise. */
export function maskFromImage(img: RgbaImage, options: MaskOptions = {}): Mask {
  const { width: w, height: h, data } = img;
  const alphaMode = options.alpha ?? data.some((v, i) => i % 4 === 3 && v < 250);
  const bg = options.background ?? ([data[0], data[1], data[2]] as [number, number, number]);
  const tolerance = options.tolerance ?? 12;
  const mask = new Uint8Array(w * h);
  for (let p = 0; p < w * h; p++) {
    const i = p * 4;
    if (alphaMode) mask[p] = data[i + 3] > 127 ? 1 : 0;
    else mask[p] = rgbDistance(data[i], data[i + 1], data[i + 2], bg) > tolerance ? 1 : 0;
  }
  return { w, h, data: mask };
}

export type Box = [number, number, number, number];

export function bboxOf(mask: Mask): Box | null {
  let x0 = mask.w, y0 = mask.h, x1 = -1, y1 = -1;
  for (let y = 0; y < mask.h; y++)
    for (let x = 0; x < mask.w; x++)
      if (mask.data[y * mask.w + x]) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
  return x1 < 0 ? null : [x0, y0, x1 + 1, y1 + 1];
}

/** Fraction of the frame the subject covers, after masking. */
export function maskFraction(mask: Mask): number {
  let n = 0;
  for (const v of mask.data) n += v;
  return n / mask.data.length;
}

function resample(mask: Mask, box: Box, size: number): Uint8Array {
  const [x0, y0, x1, y1] = box;
  const bw = Math.max(1, x1 - x0), bh = Math.max(1, y1 - y0);
  const out = new Uint8Array(size * size);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const sx = Math.min(mask.w - 1, x0 + Math.floor(((x + 0.5) / size) * bw));
      const sy = Math.min(mask.h - 1, y0 + Math.floor(((y + 0.5) / size) * bh));
      out[y * size + x] = mask.data[sy * mask.w + sx];
    }
  return out;
}

export interface SilhouetteComparison {
  iou: number;
  /** Render pixels inside the normalised frame that the reference does not cover, and vice versa. */
  excess: number;
  missing: number;
  usable: boolean;
  note: string;
}

/**
 * Compare two silhouettes after normalising each to its own content box. This
 * is a SHAPE comparison, not a pose or scale comparison, and normalising is
 * exactly the caveat: it cannot detect a proportion error that cancels out.
 */
export function silhouetteIou(render: Mask, reference: Mask, size = 192): SilhouetteComparison {
  const a = bboxOf(render), b = bboxOf(reference);
  const fa = maskFraction(render), fb = maskFraction(reference);
  if (!a || !b) return { iou: 0, excess: 0, missing: 1, usable: false, note: "one of the masks is empty — nothing to compare" };
  if (fa < 0.02 || fb < 0.02 || fa > 0.98 || fb > 0.98)
    return {
      iou: 0,
      excess: 0,
      missing: 0,
      usable: false,
      note: `mask coverage ${(fa * 100).toFixed(1)}% / ${(fb * 100).toFixed(1)}% — the background was not separable, so the silhouette is not measured`,
    };
  const A = resample(render, a, size), B = resample(reference, b, size);
  let intersection = 0, union = 0, onlyA = 0, onlyB = 0;
  for (let i = 0; i < A.length; i++) {
    if (A[i] && B[i]) intersection++;
    if (A[i] || B[i]) union++;
    if (A[i] && !B[i]) onlyA++;
    if (!A[i] && B[i]) onlyB++;
  }
  return {
    iou: union ? intersection / union : 0,
    excess: union ? onlyA / union : 0,
    missing: union ? onlyB / union : 0,
    usable: true,
    note: "normalised content-box IoU: shape agreement only, insensitive to absolute scale",
  };
}

export interface Discrepancy {
  feature: string;
  measured: number | null;
  reference: number | null;
  unit: string;
  delta: number | null;
  tolerance: number;
  status: "within" | "outside" | "not-measured";
  consequence: string;
}

/** Every landmark target, its unit, its tolerance and why it matters. */
export interface LandmarkTarget {
  key: string;
  label: string;
  reference: number;
  unit: "mm" | "ratio";
  tolerance: number;
  consequence: string;
}

const mm = REFERENCE_231.mm;

export const LANDMARK_TARGETS: LandmarkTarget[] = [
  { key: "jawWidthMm", label: "jaw width", reference: mm.jawWidth, unit: "mm", tolerance: 4, consequence: "a wider jaw reads as a different person" },
  { key: "jawToCheek", label: "jaw / cheek", reference: REFERENCE_231.widthRatios.jaw, unit: "ratio", tolerance: 0.04, consequence: "the face's taper" },
  { key: "chinToJaw", label: "chin / jaw", reference: 0.45, unit: "ratio", tolerance: 0.04, consequence: "square versus tapered chin" },
  { key: "mouthWidthMm", label: "mouth width", reference: mm.mouthWidth, unit: "mm", tolerance: 3, consequence: "lip width against the iris" },
  { key: "noseWidthMm", label: "nose width", reference: mm.noseWidth, unit: "mm", tolerance: 3, consequence: "alar definition" },
  { key: "interpupillaryMm", label: "interpupillary", reference: mm.interpupillary, unit: "mm", tolerance: 3, consequence: "eye spacing" },
  { key: "hairlineAboveEyeMm", label: "hairline above eye line", reference: 0.848 * 103.4, unit: "mm", tolerance: 8, consequence: "forehead height, the most visible hair defect" },
];

function read(obj: unknown, path: string): number | null {
  let cur: unknown = obj;
  for (const part of path.split(".")) {
    if (!cur || typeof cur !== "object") return null;
    cur = (cur as Record<string, unknown>)[part];
  }
  return typeof cur === "number" && Number.isFinite(cur) ? cur : null;
}

/** The mesh's own measurements, mapped onto the target keys. Null means "not measured". */
export function landmarksFromMetrics(metrics: Record<string, unknown>): Record<string, number | null> {
  return {
    jawWidthMm: read(metrics, "face.jawWidthMm"),
    jawToCheek: read(metrics, "head.jawToCheek") ?? read(metrics, "face.jawToCheek"),
    chinToJaw: read(metrics, "head.chinToJaw"),
    mouthWidthMm: read(metrics, "face.mouthWidthMm"),
    noseWidthMm: read(metrics, "face.noseWidthMm"),
    interpupillaryMm: read(metrics, "eyes.spacingMm"),
    // The ACHIEVED hairline, not the target: comparing the target to itself is
    // how a report shows a 40 mm bald gap as "within tolerance".
    hairlineAboveEyeMm: read(metrics, "babyHair.hairline.scalpHairlineMm"),
    hairlineReferenceMm: read(metrics, "babyHair.hairline.referenceHairlineMm"),
  };
}

export function compareLandmarks(metrics: Record<string, unknown>, targets: LandmarkTarget[] = LANDMARK_TARGETS): Discrepancy[] {
  const measured = landmarksFromMetrics(metrics);
  return targets.map((t) => {
    const value = measured[t.key];
    if (value === null || value === undefined) {
      return { feature: t.label, measured: null, reference: t.reference, unit: t.unit, delta: null, tolerance: t.tolerance, status: "not-measured" as const, consequence: `${t.consequence}; this build does not measure it` };
    }
    const delta = value - t.reference;
    return {
      feature: t.label,
      measured: Number(value.toFixed(2)),
      reference: Number(t.reference.toFixed(2)),
      unit: t.unit,
      delta: Number(delta.toFixed(2)),
      tolerance: t.tolerance,
      status: Math.abs(delta) <= t.tolerance ? ("within" as const) : ("outside" as const),
      consequence: t.consequence,
    };
  });
}

/* ---------------------------------- hair ---------------------------------- */

export interface HairAgreement {
  feature: string;
  measured: number | null;
  spec: number;
  unit: string;
  status: "within" | "outside" | "not-measured";
}

export const HAIR_SPEC = {
  strandCount: 96,
  rootThicknessMm: 0.1,
  maxThicknessMm: 0.12,
  curlRadiusMinMm: 5,
  curlRadiusMaxMm: 11,
  coveragePct: 100,
  lengthMm: [5.8, 33.9] as [number, number],
};

/** Compare the strand diagnostics against the sheet's own numbers. */
export function compareHair(hair: Record<string, unknown> | null): HairAgreement[] {
  if (!hair) return [{ feature: "hair", measured: null, spec: HAIR_SPEC.strandCount, unit: "strands", status: "not-measured" }];
  const count = read(hair, "count");
  const coverage = read(hair, "hairline.coveragePct");
  const rootMin = read(hair, "rootThicknessMm.min");
  const rootMax = read(hair, "rootThicknessMm.max");
  const lengthMin = read(hair, "lengthMm.min");
  const lengthMax = read(hair, "lengthMm.max");
  const within = (value: number | null, lo: number, hi: number) => (value === null ? ("not-measured" as const) : value >= lo && value <= hi ? ("within" as const) : ("outside" as const));
  return [
    { feature: "front strands", measured: count, spec: HAIR_SPEC.strandCount, unit: "strands", status: count === null ? "not-measured" : count >= HAIR_SPEC.strandCount * 0.5 ? "within" : "outside" },
    { feature: "hairline coverage", measured: coverage, spec: HAIR_SPEC.coveragePct, unit: "%", status: within(coverage, 99, 100) },
    { feature: "root thickness (min)", measured: rootMin, spec: HAIR_SPEC.rootThicknessMm, unit: "mm", status: within(rootMin, 0.06, 0.13) },
    { feature: "root thickness (max)", measured: rootMax, spec: HAIR_SPEC.maxThicknessMm, unit: "mm", status: within(rootMax, 0.06, 0.13) },
    { feature: "strand length (min)", measured: lengthMin, spec: HAIR_SPEC.lengthMm[0], unit: "mm", status: within(lengthMin, 0, HAIR_SPEC.lengthMm[1]) },
    { feature: "strand length (max)", measured: lengthMax, spec: HAIR_SPEC.lengthMm[1], unit: "mm", status: within(lengthMax, 0, HAIR_SPEC.lengthMm[1] * 1.2) },
  ];
}

/* --------------------------------- colour --------------------------------- */

/** Coarse 4×4×4 masked RGB histogram; the weight sums to 1. */
export function colourHistogram(img: RgbaImage, mask?: Mask, bins = 4): Float64Array {
  const hist = new Float64Array(bins * bins * bins);
  let n = 0;
  for (let p = 0; p < img.width * img.height; p++) {
    if (mask && !mask.data[p]) continue;
    const i = p * 4;
    const r = Math.min(bins - 1, Math.floor((img.data[i] / 256) * bins));
    const g = Math.min(bins - 1, Math.floor((img.data[i + 1] / 256) * bins));
    const b = Math.min(bins - 1, Math.floor((img.data[i + 2] / 256) * bins));
    hist[(r * bins + g) * bins + b]++;
    n++;
  }
  if (n) for (let i = 0; i < hist.length; i++) hist[i] /= n;
  return hist;
}

/** Bhattacharyya distance, 0 = identical distributions, 1 = no overlap. */
export function histogramDistance(a: Float64Array, b: Float64Array): number {
  if (a.length !== b.length) throw new Error("histogram bin mismatch");
  let bc = 0;
  for (let i = 0; i < a.length; i++) bc += Math.sqrt(a[i] * b[i]);
  return Number((1 - bc).toFixed(4));
}

/* -------------------------------- report -------------------------------- */

export interface RenderComparison {
  silhouette: SilhouetteComparison;
  colourDistance: number | null;
  landmarks: Discrepancy[];
  hair: HairAgreement[];
  verdict: "matches" | "close" | "differs" | "unknown";
  notes: string[];
}

export interface CompareInput {
  render: RgbaImage;
  reference: RgbaImage;
  metrics: Record<string, unknown> | null;
  hair: Record<string, unknown> | null;
  silhouetteSize?: number;
}

export function compareRenderToReference(input: CompareInput): RenderComparison {
  const renderMask = maskFromImage(input.render);
  const referenceMask = maskFromImage(input.reference);
  const silhouette = silhouetteIou(renderMask, referenceMask, input.silhouetteSize ?? 192);
  const colourDistance =
    silhouette.usable && maskFraction(renderMask) > 0.02 && maskFraction(referenceMask) > 0.02
      ? histogramDistance(colourHistogram(input.render, renderMask), colourHistogram(input.reference, referenceMask))
      : null;
  const landmarks = input.metrics ? compareLandmarks(input.metrics) : [];
  const hair = compareHair(input.hair);
  const outside = landmarks.filter((l) => l.status === "outside").length;
  const notes: string[] = [];
  if (!silhouette.usable) notes.push(silhouette.note);
  if (colourDistance !== null) notes.push("colour distance compares masked histograms; it rewards a similar palette, not correct geometry");
  if (landmarks.some((l) => l.status === "not-measured")) notes.push("features this build never measured are reported as not-measured, never assumed close");
  const verdict: RenderComparison["verdict"] = !silhouette.usable
    ? "unknown"
    : silhouette.iou >= 0.9 && outside === 0
      ? "matches"
      : silhouette.iou >= 0.75
        ? "close"
        : "differs";
  return { silhouette, colourDistance, landmarks, hair, verdict, notes };
}
