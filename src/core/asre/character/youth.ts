/**
 * ==========================================================
 * LÉLU 2.3 — FACIAL IDENTITY: THE YOUTH PASS
 *
 * The 2.1 head carried her locked identity correctly and still read OLDER than
 * the reference. That is not a texture problem and it is not fixed by smoothing
 * skin: it is four measurable shape facts about a young face, and each one is a
 * number that can be measured before and after.
 *
 * Measured on `ref10_face_primary` (the locked primary reference, 1024 × 1536)
 * by reading landmark rows/columns off the image with a labelled 64 px grid:
 *
 *   landmark                     px            ratio used here
 *   brow line                    360           —
 *   eye centres                  390           —
 *   nose base                    545           —
 *   mouth centre                 610           —
 *   chin                         700           —
 *   bizygomatic (cheek) width    250 px        —
 *   jaw width (at 640)           200 px        jaw / cheek = 0.80
 *   chin width (at 680)           90 px        chin / jaw  = 0.45
 *   face height (brow → chin)    340 px        cheek / face height = 0.735
 *   lower third (nose → chin)    155 px        = midface (eye → nose) = 155 px
 *
 * What that means geometrically, and what this pass therefore changes:
 *
 *   1. LOWER FACE TOO LONG. Her eye→chin span is proportionally longer than the
 *      reference's. Compressing the lower face lifts the chin and shortens the
 *      midface — the single largest contributor to "looks older".
 *   2. JAW TOO WIDE, CHIN TOO SQUARE. Reference chin/jaw is 0.45; her measured
 *      0.485 with a wide flat chin. Narrow the jaw and round the chin.
 *   3. CHEEKS TOO FLAT. Reference midface carries real volume; hers measured
 *      18.8 % of head volume in the cheek slab. Add fullness at cheekbone height.
 *   4. LIPS AND LIDS TOO SMALL. Reference mouth is 0.66 of the interpupillary
 *      distance and the lids are heavy; hers read small and thin.
 *
 * Everything here is a DEFORMATION of the field she already has — no generic
 * face is substituted, her skull, marks, eye joints and rig are untouched, and
 * the pass is gated by `spec.geometry.youth` so the canonical build stays
 * byte-identical and every earlier artifact still reproduces.
 * ==========================================================
 */
import type { Sdf, V3 } from "./sdf.ts";

/** The reference's measured ratios (see the table above). */
export const REFERENCE_FACE = {
  source: "leluverse/assets/characters/lelu_character/references/ref10_face_primary.png",
  method: "landmark rows/columns read off the image against a 64 px labelled grid",
  pixelLandmarks: {
    browY: 360,
    eyeY: 390,
    noseBaseY: 545,
    mouthY: 610,
    chinY: 700,
    cheekWidth: 250,
    jawWidth: 200,
    chinWidth: 90,
    faceHeight: 340,
    lowerThird: 155,
    midface: 155,
  },
  jawToCheek: 0.8,
  chinToJaw: 0.45,
  cheekToFaceHeight: 250 / 340,
  /** Mouth width ÷ interpupillary distance, measured as 115 px ÷ 175 px. */
  mouthToEyeSpan: 0.66,
  /** Eye line → chin, in interpupillary spans: 310 px ÷ 175 px on ref10. */
  eyeToChinSpans: 1.77,
} as const;

export interface YouthParams {
  /** Lower face shortened by this fraction of the eye→chin span. */
  lowerFaceCompression: number;
  /** Jaw narrowed by this fraction of its half-width. */
  jawNarrowing: number;
  /** Extra cheek volume, millimetres of forward displacement at the cheekbone. */
  cheekFullnessMm: number;
  /** Chin rounding, millimetres of forward displacement at the chin. */
  chinRoundnessMm: number;
  /** Lip fullness, millimetres of forward displacement over the mouth. */
  lipFullnessMm: number;
}

/**
 * Defaults, chosen as the smallest deformation that closes the measured gap:
 * 8.5 % of an ~80 mm lower face is ~7 mm of chin lift, 5 % jaw narrowing takes
 * chin/jaw from 0.485 toward the reference 0.45.
 */
export const DEFAULT_YOUTH: YouthParams = {
  lowerFaceCompression: 0.085,
  jawNarrowing: 0.05,
  cheekFullnessMm: 2.4,
  chinRoundnessMm: 2.2,
  lipFullnessMm: 1.4,
};

/** Paint-scale changes that go with the shape (thresholds, not new geometry). */
export const YOUTH_PAINT = {
  /** Brow arch raised by this fraction of the interpupillary span. */
  browLiftSpan: 0.235,
  /** Brow thickness as a fraction of the span (was 0.058). */
  browThicknessSpan: 0.049,
  /** Lip ellipse semi-axes as fractions of the span (was 0.46 / 0.20). */
  lipWidthSpan: 0.5,
  lipHeightSpan: 0.23,
  /** Eye aperture scaled by this factor (was 1.0). */
  apertureScale: 1.08,
} as const;

/** Her face's own landmarks, in world metres, from the rig she is built on. */
export interface YouthLandmarks {
  eyeY: number;
  chinY: number;
  mouthY: number;
  mouthX: number;
  cheekX: number;
  /** Front-most skin at eye height, so the displacement is gated to the face. */
  faceZ: number;
}

/** What the last youth-warped head build actually applied — read, not guessed. */
export const youthDiagnostics: {
  enabled: boolean;
  params: YouthParams;
  landmarks: YouthLandmarks | null;
  /** Chin lift and jaw narrowing actually realised, in mm and as a ratio. */
  chinLiftMm: number;
  jawNarrowMm: number;
  /**
   * How far the mouth line itself rose, in mm. The face is PAINTED from the rig's
   * mouth joint, which does not move, so the paint has to be shifted by exactly
   * this much or her lips are drawn a few millimetres below her lips.
   */
  mouthLiftMm: number;
} = {
  enabled: false,
  params: { ...DEFAULT_YOUTH },
  landmarks: null,
  chinLiftMm: 0,
  jawNarrowMm: 0,
  mouthLiftMm: 0,
};

export function resetYouthDiagnostics(): void {
  youthDiagnostics.enabled = false;
  youthDiagnostics.params = { ...DEFAULT_YOUTH };
  youthDiagnostics.landmarks = null;
  youthDiagnostics.chinLiftMm = 0;
  youthDiagnostics.jawNarrowMm = 0;
  youthDiagnostics.mouthLiftMm = 0;
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smoothstep = (t: number) => t * t * (3 - 2 * t);
const gauss = (v: number, sigma: number) => Math.exp(-(v / sigma) * (v / sigma));

/**
 * How far the head's surface at height `y` rises, in metres.
 *
 * Zero at the eye line and a full lift at and below the chin: the lower face is
 * SHORTER by translating it up, not by scaling it. A scale was tried first and it
 * was wrong twice — it distorts distances the SDF does not survive, and at the
 * bottom of the head field it sampled outside the grid, where the field reads
 * zero and a false solid slab appeared across the whole box (measured as a head
 * 303 mm wide instead of 172 mm). A translation keeps the field a distance field.
 */
export function youthLift(y: number, lm: YouthLandmarks, params: YouthParams = DEFAULT_YOUTH): number {
  const span = Math.max(0.02, lm.eyeY - lm.chinY);
  const t = clamp01((lm.eyeY - y) / span);
  /**
   * Nothing below the jaw moves. The head field's box ends ~35 mm under the chin,
   * and a lifted sample there falls outside its own grid, where the field reads
   * zero — which is exactly how a false solid slab appeared across the bottom of
   * the head. The lift therefore fades out over the 20 mm beneath the chin, in
   * the region her jaw covers anyway.
   */
  const underJaw = clamp01((y - (lm.chinY - 0.02)) / 0.02);
  return (lm.eyeY - lm.chinY) * params.lowerFaceCompression * smoothstep(t) * smoothstep(underJaw);
}

/**
 * Warp her head field so the lower face is shorter, the jaw narrower, and the
 * cheeks, chin and lips carry the volume the reference shows.
 *
 * The deformation is applied as a coordinate warp (not as extra geometry), so
 * the result is still one closed solid and the SDF remains a distance estimate
 * everywhere the warp is smooth. The eye line is the fixed point: nothing at or
 * above it moves, which is what keeps her eye joints, aperture and hairline
 * valid.
 */
export function youthWarp(base: Sdf, lm: YouthLandmarks, params: YouthParams = DEFAULT_YOUTH): Sdf {
  const span = Math.max(0.02, lm.eyeY - lm.chinY);
  const narrow = 1 + params.jawNarrowing;
  const cheekX = Math.max(0.02, Math.abs(lm.cheekX));
  const cheekY = lm.eyeY - span * 0.34;
  const chinY = lm.chinY + span * 0.12;
  const cheekMm = params.cheekFullnessMm / 1000;
  const chinMm = params.chinRoundnessMm / 1000;
  const lipMm = params.lipFullnessMm / 1000;
  // The bumps only move the FRONT of the head: a z displacement applied at the
  // back of the skull at the same height would dent it, and the cheek gaussian
  // does reach that far.
  const frontEdge = lm.faceZ - 0.045;

  return (x, y, z) => {
    const t = clamp01((lm.eyeY - y) / span);
    const s = smoothstep(t);
    // 1. lower face lift: the surface at y is the base surface at y − lift, so
    //    the chin rises by `lift` and the face gets shorter by that much.
    const yy = y - youthLift(y, lm, params);
    // 2. jaw narrowing, faded in below the cheekbone
    const xx = x * (1 + (narrow - 1) * s);
    // 3./4./5. forward displacement of cheeks, chin and lips
    const front = smoothstep(clamp01((z - frontEdge) / 0.035));
    if (front <= 0) return base(xx, yy, z);
    const cheek = gauss(Math.abs(x) - cheekX, cheekX * 0.6) * gauss(y - cheekY, span * 0.17);
    const chin = gauss(x, cheekX * 0.55) * gauss(y - chinY, span * 0.1);
    const lip = gauss(x - lm.mouthX, cheekX * 0.55) * gauss(y - lm.mouthY, span * 0.085);
    const push = (cheek * cheekMm + chin * chinMm + lip * lipMm) * (0.35 + 0.65 * front);
    return base(xx, yy, z - push);
  };
}

/** Record what a warp with these landmarks realises, in millimetres. */
export function recordYouth(lm: YouthLandmarks, params: YouthParams = DEFAULT_YOUTH): void {
  youthDiagnostics.enabled = true;
  youthDiagnostics.params = { ...params };
  youthDiagnostics.landmarks = lm;
  youthDiagnostics.chinLiftMm = (lm.eyeY - lm.chinY) * params.lowerFaceCompression * 1000;
  youthDiagnostics.jawNarrowMm = Math.abs(lm.cheekX) * params.jawNarrowing * 1000;
  youthDiagnostics.mouthLiftMm = youthLift(lm.mouthY, lm, params) * 1000;
}

/**
 * How far the head still is from the reference's three measurable face ratios.
 * `metrics` is the shape `scripts/asre/lelu2/head.ts` already writes; this does
 * not invent a second definition of the same measurement.
 */
export function youthGap(metrics: {
  head: { jawToCheek: number; chinToJaw: number; cheekShareOfHead: number };
  eyes: { spacingToHeadWidth: number };
}): { ratio: string; measured: number; reference: number; gap: number }[] {
  return [
    { ratio: "jaw / cheek", measured: metrics.head.jawToCheek, reference: REFERENCE_FACE.jawToCheek, gap: metrics.head.jawToCheek - REFERENCE_FACE.jawToCheek },
    { ratio: "chin / jaw", measured: metrics.head.chinToJaw, reference: REFERENCE_FACE.chinToJaw, gap: metrics.head.chinToJaw - REFERENCE_FACE.chinToJaw },
    {
      ratio: "cheek share of head volume",
      measured: metrics.head.cheekShareOfHead,
      reference: 0.18,
      gap: metrics.head.cheekShareOfHead - 0.18,
    },
  ];
}

/**
 * The warp's own landmark points, for a caller that only has the rig joints.
 * Kept here so the CLI, the browser build and the tests all derive the same
 * numbers from the same joints.
 */
export function landmarksFromJoints(
  joint: (name: string) => V3,
  faceZ: number,
): YouthLandmarks {
  const eyeL = joint("joint-l-eye");
  const eyeR = joint("joint-r-eye");
  const mouth = joint("joint-mouth");
  const chin = joint("joint-chin");
  const span = Math.abs(eyeL[0] - eyeR[0]) || 0.062;
  /**
   * The CC0 rig has no usable chin joint — it resolves to the origin, and a
   * 1.579 m "lower face" is what an 8.5 % compression of it produced: a warp
   * that was mathematically applied and geometrically inert. Her chin is
   * therefore measured from her own eye line with the REFERENCE's ratio
   * (eye → chin = 1.77 interpupillary spans), and a real joint wins when one
   * exists.
   */
  const chinY = chin[1] > 1 ? chin[1] : eyeL[1] - span * REFERENCE_FACE.eyeToChinSpans;
  /** The mouth is 0.71 of the way from the eye line down to the chin on ref10. */
  const mouthY = mouth[1] > 0.5 ? mouth[1] : eyeL[1] - (eyeL[1] - chinY) * 0.71;
  return {
    eyeY: eyeL[1],
    chinY,
    mouthY,
    mouthX: mouth[0],
    cheekX: Math.abs(eyeL[0]) * 1.42,
    faceZ,
  };
}
