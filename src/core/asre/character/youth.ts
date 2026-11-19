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

/**
 * THE 39-PHOTOGRAPH LANDMARK SET (M23.1)
 *
 * `lelu-hair-14.png` in the committed collection is not a photograph: it is the
 * annotated landmark sheet that ships with the photographs, carrying her facial
 * landmark coordinates normalised to the face box, a calibrated millimetre table
 * and the derived ratios. It supersedes the hand-read ref10 table below wherever
 * the two disagree, because it is a measurement of the same face at a stated
 * normalisation rather than a reading off a grid.
 *
 * Source: leluverse/assets/characters/lelu_character/references/lelu-hair/lelu-hair-14.png
 * (branch integration/m16-3-wp05-reconciliation).
 *
 *   landmark              normalised (x, y)        millimetres
 *   left eye centre       0.342, 0.468             eye width 31.5
 *   right eye centre      0.658, 0.468             interpupillary 63.0
 *   nose tip              0.500, 0.596             nose width 37.8
 *   mouth centre          0.500, 0.713             mouth width 50.4
 *   chin point            0.500, 0.948             jaw width 96.0
 *   left brow peak        0.286, 0.367             face width 142.0
 *   right brow peak       0.714, 0.367             face length 176.0
 *   left cheekbone        0.231, 0.577
 *   right cheekbone       0.769, 0.577
 *   hairline centre       0.500, 0.061
 *
 * derived: eye 0.222 · nose 0.266 · mouth 0.355 · jaw 0.676 of face width,
 *          face length 1.239 × face width.
 *
 * Everything downstream is expressed in ONE unit — the eye→chin span — because
 * that is the only span both a photograph and the mesh can supply. On the sheet
 * eye→chin is (0.948 − 0.468) × 176 mm = 84.5 mm, so each ratio below is a
 * normalised landmark difference over 0.48.
 */
export const REFERENCE_231 = {
  source: "leluverse/assets/characters/lelu_character/references/lelu-hair/lelu-hair-14.png",
  method: "annotated landmark sheet shipped with the 39 photographs; normalised coordinates and calibrated mm read from the sheet itself",
  normalized: {
    leftEye: [0.342, 0.468],
    rightEye: [0.658, 0.468],
    noseTip: [0.5, 0.596],
    mouthCentre: [0.5, 0.713],
    chin: [0.5, 0.948],
    leftBrowPeak: [0.286, 0.367],
    rightBrowPeak: [0.714, 0.367],
    leftCheekbone: [0.231, 0.577],
    rightCheekbone: [0.769, 0.577],
    hairlineCentre: [0.5, 0.061],
  },
  mm: { faceWidth: 142, faceLength: 176, eyeWidth: 31.5, interpupillary: 63, noseWidth: 37.8, mouthWidth: 50.4, jawWidth: 96 },
  /** Of face width. */
  widthRatios: { eye: 0.222, nose: 0.266, mouth: 0.355, jaw: 0.676 },
  faceLengthPerWidth: 1.239,
  /** Landmark height above (+) or below (−) the eye line, in eye→chin spans. */
  heights: {
    hairline: (0.468 - 0.061) / 0.48,
    browPeak: (0.468 - 0.367) / 0.48,
    cheekbone: (0.577 - 0.468) / 0.48 * -1,
    noseTip: (0.596 - 0.468) / 0.48 * -1,
    mouth: (0.713 - 0.468) / 0.48 * -1,
  },
} as const;

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
  /**
   * 0.145, not 0.05. The landmark sheet puts the jaw at 0.676 of face width; her
   * mesh measured 0.792 — a 17 mm jaw on a 144 mm face that every render shows as
   * a mask-like lower face. This is the largest single identity error in 2.3.
   */
  jawNarrowing: 0.3,
  cheekFullnessMm: 2.8,
  chinRoundnessMm: 2.2,
  lipFullnessMm: 1.4,
};

/** Paint-scale changes that go with the shape (thresholds, not new geometry). */
export const YOUTH_PAINT = {
  /**
   * Brow peak above the eye line: REFERENCE_231.heights.browPeak = 0.210 of the
   * eye→chin span. Her eye→chin is 1.68 interpupillary spans, so a fraction of
   * the span is 0.210 × 1.68 = 0.353 … but her brow sits over her eye, and the
   * peak is measured at the arch, 0.72 of the way out, not at the medial end.
   * 0.30 is the medial height that puts the arch at 0.21 of eye→chin.
   */
  browLiftSpan: 0.3,
  /** Medial brow half-thickness as a fraction of the span. */
  browThicknessSpan: 0.056,
  /** Mouth half-width: 0.355 of face width on 0.222 eye:face … 0.415 of the span. */
  lipWidthSpan: 0.415,
  lipHeightSpan: 0.21,
  /** Eye aperture scaled by this factor (was 1.0). */
  apertureScale: 1.15,
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
