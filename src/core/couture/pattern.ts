/**
 * ==========================================================
 * LÉLU — GARMENT CONSTRUCTION: 2D PATTERN ENGINEERING
 *
 * A pattern is drafted from body measurements, not traced from
 * a picture. Pieces are closed outlines with named edges
 * (shoulder, armscye, side-seam, waist, cf-fold …), so a seam
 * can be declared between two edges and its two lengths
 * compared — the check a patternmaker makes before cutting.
 *
 * Everything is millimetres in pattern space: x across the
 * body, y up from the waist line, origin at centre front.
 * Darts are real wedge cut-outs in the outline (fabric
 * removed), so the net area is true.
 *
 * The sleeve is not drawn by eye: its cap is solved against the
 * armscye that was just drafted, so cap ease is a number the
 * checks can verify.
 *
 * Grading re-drafts from graded measurements with recorded grade
 * rules — construction moves with the size instead of a picture
 * being scaled.
 * ==========================================================
 */

import {
  clamp,
  dedupe,
  offsetPolygon,
  perimeter,
  pointInPolygon,
  polygonArea,
  round,
  samplePolyline,
  selfIntersects,
  triangulate,
  type Vec2,
} from "./geometry";

/* ---------------- body ---------------- */

export interface BodyMeasurements {
  /** All lengths in millimetres. */
  height: number;
  bust: number;
  underbust: number;
  waist: number;
  hip: number;
  neck: number;
  /** Acromion to acromion. */
  shoulder: number;
  armLength: number;
  bicep: number;
  wrist: number;
  /** Nape to waist. */
  backLength: number;
  /** Front neck point to waist. */
  frontLength: number;
  acrossBack: number;
  acrossFront: number;
  /** Chest depth ÷ chest width; 0.7 is a typical adult torso. */
  depthRatio: number;
  hipDepth: number;
  /** Waist to the knee. */
  waistToKnee: number;
}

export const DEFAULT_MEASUREMENTS: BodyMeasurements = {
  height: 1680,
  bust: 920,
  underbust: 780,
  waist: 740,
  hip: 980,
  neck: 370,
  shoulder: 400,
  armLength: 590,
  bicep: 300,
  wrist: 170,
  backLength: 415,
  frontLength: 430,
  acrossBack: 360,
  acrossFront: 340,
  depthRatio: 0.72,
  hipDepth: 195,
  waistToKnee: 470,
};

/** Validate and complete a measurement set. Odd values are kept but flagged, never silently clamped. */
export function normalizeMeasurements(input: Partial<BodyMeasurements> = {}): { measurements: BodyMeasurements; warnings: string[] } {
  const warnings: string[] = [];
  const merged: BodyMeasurements = { ...DEFAULT_MEASUREMENTS };
  for (const key of Object.keys(DEFAULT_MEASUREMENTS) as Array<keyof BodyMeasurements>) {
    const value = input[key];
    if (value === undefined || value === null) continue;
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
      warnings.push(`${key} was ignored: “${String(value)}” is not a positive number of mm.`);
      continue;
    }
    merged[key] = value;
  }
  const bounds: Array<[keyof BodyMeasurements, number, number]> = [
    ["height", 1200, 2300], ["bust", 600, 1700], ["underbust", 500, 1600], ["waist", 400, 1700],
    ["hip", 600, 1800], ["neck", 250, 600], ["shoulder", 280, 560], ["armLength", 380, 800],
    ["bicep", 180, 600], ["wrist", 110, 280], ["backLength", 300, 560], ["frontLength", 300, 600],
    ["acrossBack", 260, 520], ["acrossFront", 240, 500], ["depthRatio", 0.5, 1.05],
    ["hipDepth", 120, 300], ["waistToKnee", 300, 650],
  ];
  for (const [key, lo, hi] of bounds) {
    if (merged[key] < lo || merged[key] > hi) warnings.push(`${key} ${merged[key]} is outside the plausible adult range ${lo}–${hi}; it was used as given.`);
  }
  if (merged.underbust > merged.bust) warnings.push("underbust is larger than the bust: check the measurement.");
  if (merged.waist > merged.hip) warnings.push("waist is larger than the hip: check the measurement.");
  if (merged.acrossBack > merged.bust / 2) warnings.push("across-back is more than half the bust: check the tape.");
  return { measurements: merged, warnings };
}

/* ---------------- style ---------------- */

export type Neckline = "crew" | "v" | "sweetheart" | "square" | "halter" | "off-shoulder" | "high" | "boat";
export type SleeveStyle = "none" | "cap" | "short" | "three-quarter" | "long" | "bishop" | "flare";
export type LengthStyle = "cropped" | "hip" | "knee" | "midi" | "floor";
export type Silhouette = "column" | "a-line" | "fit-and-flare" | "mermaid" | "ball" | "asymmetric";
export type SeamType = "plain" | "french" | "overlock" | "flat-felled";

export interface GarmentStyle {
  category: "dress" | "gown" | "top" | "skirt" | "jacket" | "coat" | "trousers" | "wearable" | "sculpture";
  neckline: Neckline;
  sleeves: SleeveStyle;
  length: LengthStyle;
  silhouette: Silhouette;
  darts: boolean;
  /** Skirt joins the bodice at a waist seam; false = a one-piece dress. */
  waistSeam: boolean;
}

export const DEFAULT_STYLE: GarmentStyle = {
  category: "dress",
  neckline: "crew",
  sleeves: "none",
  length: "midi",
  silhouette: "fit-and-flare",
  darts: true,
  waistSeam: true,
};

export interface Ease { bust: number; waist: number; hip: number }
export const DEFAULT_EASE: Ease = { bust: 40, waist: 24, hip: 48 };

/* ---------------- pattern pieces ---------------- */

/**
 * One outline point. `edge` names the segment running from this point to
 * the next; `curve` puts a quadratic control point on that segment.
 */
export interface PatternPoint {
  x: number;
  y: number;
  edge: string;
  curve?: { cx: number; cy: number };
}

export interface PatternPiece {
  id: string;
  name: string;
  label: string;
  outline: PatternPoint[];
  /** Pieces to cut: 1 for a half-pattern cut on a fold (it mirrors to the full panel). */
  cut: number;
  onFold: boolean;
  seamAllowance: number;
  grainline: { a: Vec2; b: Vec2 };
  notches: Array<{ edge: string; t: number; label: string }>;
  drillHoles: Vec2[];
  notes: string[];
  /** Area of ONE cut piece in the cloth, mm² (a half pattern on a fold counts double). */
  areaMm2: number;
}

export interface Seam {
  id: string;
  a: { piece: string; edge: string };
  b: { piece: string; edge: string };
  type: SeamType;
  allowanceMm: number;
  description: string;
}

export interface PatternCheck {
  name: string;
  ok: boolean;
  detail: string;
}

export interface GradeRule {
  measurement: keyof BodyMeasurements;
  perStep: number;
  unit: "mm";
}

export const GRADE_RULES: GradeRule[] = [
  { measurement: "bust", perStep: 40, unit: "mm" },
  { measurement: "underbust", perStep: 34, unit: "mm" },
  { measurement: "waist", perStep: 30, unit: "mm" },
  { measurement: "hip", perStep: 40, unit: "mm" },
  { measurement: "neck", perStep: 5, unit: "mm" },
  { measurement: "shoulder", perStep: 5, unit: "mm" },
  { measurement: "armLength", perStep: 5, unit: "mm" },
  { measurement: "bicep", perStep: 10, unit: "mm" },
  { measurement: "wrist", perStep: 4, unit: "mm" },
  { measurement: "backLength", perStep: 5, unit: "mm" },
  { measurement: "acrossBack", perStep: 5, unit: "mm" },
  { measurement: "acrossFront", perStep: 5, unit: "mm" },
  { measurement: "waistToKnee", perStep: 3, unit: "mm" },
];

export interface Pattern {
  id: string;
  name: string;
  size: string;
  unit: "mm";
  measurements: BodyMeasurements;
  style: GarmentStyle;
  pieces: PatternPiece[];
  seams: Seam[];
  checks: PatternCheck[];
  eases: Ease;
  fabricWidthMm: number;
}

export const SIZES = ["XXS", "XS", "S", "M", "L", "XL", "XXL", "3XL"] as const;
export type SizeLabel = (typeof SIZES)[number];
export const BASE_SIZE: SizeLabel = "M";

/* ---------------- edge geometry ---------------- */

function segmentSamples(points: PatternPoint[], i: number, perSegment: number): Vec2[] {
  const a = points[i];
  const b = points[(i + 1) % points.length];
  const out: Vec2[] = [];
  const n = Math.max(2, perSegment);
  for (let k = 0; k < n; k += 1) {
    const t = k / (n - 1);
    if (a.curve) {
      const mt = 1 - t;
      out.push({
        x: mt * mt * a.x + 2 * mt * t * a.curve.cx + t * t * b.x,
        y: mt * mt * a.y + 2 * mt * t * a.curve.cy + t * t * b.y,
      });
    } else {
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    }
  }
  return out;
}

/** The net (stitching) outline, densely sampled. */
export function netOutline(piece: { outline: PatternPoint[] }): Vec2[] {
  const out: Vec2[] = [];
  for (let i = 0; i < piece.outline.length; i += 1) {
    const seg = segmentSamples(piece.outline, i, 14);
    out.push(...(i === 0 ? seg : seg.slice(1)));
  }
  return dedupe(out);
}

export function pieceEdges(piece: PatternPiece): string[] {
  return [...new Set(piece.outline.map((p) => p.edge))];
}

export function edgePoints(piece: PatternPiece, edge: string, perSegment = 24): Vec2[] {
  const out: Vec2[] = [];
  for (let i = 0; i < piece.outline.length; i += 1) {
    if (piece.outline[i].edge !== edge) continue;
    const seg = segmentSamples(piece.outline, i, perSegment);
    out.push(...(out.length ? seg.slice(1) : seg));
  }
  return out;
}

export function edgeLength(piece: PatternPiece, edge: string): number {
  const pts = edgePoints(piece, edge, 24);
  return pts.length > 1 ? perimeter(pts, false) : 0;
}

/** How far the waistline runs from the centre front/back to the side seam, mm. */
export function waistlineExtent(piece: PatternPiece): number {
  const pts = piece.outline.filter((p) => Math.abs(p.y) < 2);
  return pts.length ? Math.max(...pts.map((p) => Math.abs(p.x))) : 0;
}

export function pieceAnchor(piece: PatternPiece): Vec2 {
  const net = netOutline(piece);
  return {
    x: net.reduce((s, p) => s + p.x, 0) / Math.max(1, net.length),
    y: net.reduce((s, p) => s + p.y, 0) / Math.max(1, net.length),
  };
}

/** The cut line: net outline plus seam allowance, with fold edges left un-offset. */
export function cutOutline(piece: PatternPiece): Vec2[] {
  const foldIndices = new Set<number>();
  if (piece.onFold) piece.outline.forEach((p, i) => { if (p.edge === "cf-fold" || p.edge === "cb-fold") foldIndices.add(i); });
  return offsetPolygon(piece.outline.map((p) => ({ x: p.x, y: p.y })), piece.seamAllowance, foldIndices);
}

/** Notch marks in pattern space, for the cutter. */
export function notchPositions(piece: PatternPiece): Array<{ x: number; y: number; label: string }> {
  const out: Array<{ x: number; y: number; label: string }> = [];
  for (const notch of piece.notches) {
    const pts = edgePoints(piece, notch.edge, 40);
    if (pts.length < 2) continue;
    const p = pts[clamp(Math.round(notch.t * (pts.length - 1)), 0, pts.length - 1)];
    out.push({ x: p.x, y: p.y, label: notch.label });
  }
  return out;
}

/* ---------------- drafting ---------------- */

/** How far the neckline drops below the shoulder line, front and back, mm. */
export const necklineDrop = (style: GarmentStyle): { front: number; back: number } => ({ front: neckDrop(style, true), back: neckDrop(style, false) });

const neckDrop = (style: GarmentStyle, front: boolean): number => {
  if (!front) return 22;
  switch (style.neckline) {
    case "high": return 30;
    case "crew": return 55;
    case "boat": return 60;
    case "off-shoulder": return 90;
    case "square": return 120;
    case "sweetheart": return 120;
    case "v": return 160;
    case "halter": return 180;
    default: return 55;
  }
};

const neckWidthFactor = (style: GarmentStyle): number => (style.neckline === "boat" ? 1.5 : style.neckline === "halter" ? 0.7 : 1);

export function hemY(style: GarmentStyle, m: BodyMeasurements): number {
  switch (style.length) {
    case "cropped": return -120;
    case "hip": return -m.hipDepth - 40;
    case "knee": return -m.waistToKnee;
    case "midi": return -Math.round(m.height * 0.38);
    case "floor": return -Math.round(m.height * 0.58);
    default: return -Math.round(m.height * 0.38);
  }
}

const hemFlare = (style: GarmentStyle): number => {
  switch (style.silhouette) {
    case "column": return 0.95;
    case "a-line": return 1.35;
    case "fit-and-flare": return 1.9;
    case "mermaid": return 1.8;
    case "ball": return 2.8;
    case "asymmetric": return 1.6;
    default: return 1.35;
  }
};

/** Derived construction numbers shared by the 2D net and the 3D shell. */
export interface Construction {
  quarterBust: number;
  quarterWaist: number;
  quarterHip: number;
  neckHalf: number;
  armholeDepth: number;
  shoulderY: number;
  underarmY: number;
  shoulderPoint: Vec2;
  waistX: number;
  hipY: number;
  hemY: number;
  hemQuarter: number;
  kneeY: number;
  dartDepth: number;
}

export function construction(style: GarmentStyle, m: BodyMeasurements, ease: Ease = DEFAULT_EASE): Construction {
  const quarterBust = m.bust / 4 + ease.bust / 4;
  const quarterWaist = m.waist / 4 + ease.waist / 4;
  const quarterHip = m.hip / 4 + ease.hip / 4;
  const neckHalf = (m.neck / 6 + 3) * neckWidthFactor(style);
  const armholeDepth = m.bust / 8 + 40;
  const shoulderY = m.backLength;
  const underarmY = shoulderY - armholeDepth;
  const shoulderLen = Math.max(60, (style.category === "skirt" ? m.acrossBack : m.acrossFront) / 2 - neckHalf + 10);
  return {
    quarterBust,
    quarterWaist,
    quarterHip,
    neckHalf,
    armholeDepth,
    shoulderY,
    underarmY,
    shoulderPoint: { x: neckHalf + shoulderLen, y: shoulderY - 22 },
    waistX: quarterWaist,
    hipY: -m.hipDepth,
    hemY: hemY(style, m),
    hemQuarter: quarterHip * hemFlare(style),
    kneeY: -m.waistToKnee,
    dartDepth: clamp(m.backLength * 0.23, 60, 120),
  };
}

function finishPiece(piece: Omit<PatternPiece, "areaMm2">): PatternPiece {
  const area = Math.abs(polygonArea(netOutline(piece))) * (piece.onFold ? 2 : 1);
  return { ...piece, areaMm2: round(area, 0) };
}

/** One bodice half (front or back), centre on the fold at x = 0. */
function bodice(front: boolean, style: GarmentStyle, m: BodyMeasurements, ease: Ease): PatternPiece {
  const c = construction(style, m, ease);
  const shoulderY = c.shoulderY;
  const drop = neckDrop(style, front);
  const intake = Math.max(0, c.quarterBust - c.quarterWaist);
  const dartIntake = style.darts ? intake * 0.6 : 0;
  const dartX = Math.max(c.quarterWaist * 0.45, c.neckHalf * 0.9);

  const outline: PatternPoint[] = [{ x: 0, y: 0, edge: "waist" }];
  if (dartIntake > 6 && dartX - dartIntake / 2 > 15) {
    outline.push({ x: dartX - dartIntake / 2, y: 0, edge: "dart-in" });
    outline.push({ x: dartX, y: c.dartDepth, edge: "dart-out" });
    outline.push({ x: dartX + dartIntake / 2, y: 0, edge: "waist-side" });
  }
  // The waistline ends at the side seam at quarter-waist: the dart removes the
  // excess inside it, which is why the waist seam lengths of bodice and skirt match.
  outline.push({ x: c.waistX, y: 0, edge: "side-seam" });
  outline.push({ x: c.quarterBust, y: c.underarmY, edge: "armscye", curve: { cx: c.quarterBust + 12, cy: c.underarmY + c.armholeDepth * 0.55 } });
  outline.push({ x: c.shoulderPoint.x, y: c.shoulderPoint.y, edge: "shoulder" });
  outline.push({ x: c.neckHalf, y: shoulderY, edge: "neck", curve: { cx: c.neckHalf * 0.55, cy: shoulderY - drop * 0.35 } });
  outline.push({ x: 0, y: shoulderY - drop, edge: front ? "cf-fold" : "cb-fold" });

  return finishPiece({
    id: front ? "bodice-front" : "bodice-back",
    name: front ? "Bodice front" : "Bodice back",
    label: `${front ? "FRONT" : "BACK"} BODICE`,
    outline,
    cut: 1,
    onFold: true,
    seamAllowance: 10,
    grainline: { a: { x: c.quarterBust * 0.45, y: 40 }, b: { x: c.quarterBust * 0.45, y: shoulderY * 0.8 } },
    notches: [
      { edge: "armscye", t: 0.55, label: "armhole pitch" },
      { edge: "shoulder", t: 0.5, label: "shoulder midpoint" },
      { edge: "side-seam", t: 0, label: "waist" },
    ],
    drillHoles: [],
    notes: [
      "Cut 1 on folded cloth: it mirrors to the full panel. Cut a second set for a lining.",
      `Dart intake ${round(dartIntake, 1)} mm at the waist; side seam ${round(c.quarterBust - c.quarterWaist, 1)} mm of shaping.`,
    ],
  });
}

/** Skirt half from the waist down, centre on the fold. */
function skirt(front: boolean, style: GarmentStyle, m: BodyMeasurements, ease: Ease): PatternPiece {
  const c = construction(style, m, ease);
  const intake = Math.max(0, c.quarterHip - c.quarterWaist);
  const dartIntake = style.darts ? intake * 0.55 : 0;
  const dartX = c.quarterWaist * 0.55;

  const outline: PatternPoint[] = [{ x: 0, y: 0, edge: "waist" }];
  if (dartIntake > 8 && dartX - dartIntake / 2 > 15) {
    outline.push({ x: dartX - dartIntake / 2, y: 0, edge: "dart-in" });
    outline.push({ x: dartX, y: 120, edge: "dart-out" });
    outline.push({ x: dartX + dartIntake / 2, y: 0, edge: "waist-side" });
  }
  outline.push({ x: c.quarterWaist, y: 0, edge: "hip-curve", curve: { cx: c.quarterHip, cy: c.hipY * 0.55 } });
  outline.push({ x: c.quarterHip, y: c.hipY, edge: "side-seam" });
  if (style.silhouette === "mermaid") {
    outline.push({ x: c.quarterHip * 0.8, y: c.kneeY, edge: "knee-flare", curve: { cx: c.quarterHip * 0.78, cy: (c.hipY + c.kneeY) / 2 } });
    outline.push({ x: c.hemQuarter, y: c.hemY, edge: "hem" });
  } else if (style.silhouette === "asymmetric") {
    outline.push({ x: c.hemQuarter, y: c.hemY + 90, edge: "hem" });
  } else {
    outline.push({ x: c.hemQuarter, y: c.hemY, edge: "hem" });
  }
  outline.push({ x: 0, y: c.hemY, edge: front ? "cf-fold" : "cb-fold" });

  return finishPiece({
    id: front ? "skirt-front" : "skirt-back",
    name: front ? "Skirt front" : "Skirt back",
    label: `${front ? "FRONT" : "BACK"} SKIRT`,
    outline,
    cut: 1,
    onFold: true,
    seamAllowance: 12,
    grainline: { a: { x: c.quarterHip * 0.45, y: c.hipY * 0.8 }, b: { x: c.quarterHip * 0.45, y: c.hemY * 0.85 } },
    notches: [{ edge: "hip-curve", t: 0.5, label: "hip" }, { edge: "hem", t: 0.5, label: "hem" }],
    drillHoles: [],
    notes: [
      `Hem width ${round(c.hemQuarter, 0)} mm from centre to side (${style.silhouette}).`,
      "Cut 1 on folded cloth; cut a second set for a lining.",
    ],
  });
}

const CAP_SAMPLES = 9;

/** A sleeve cap curve: half-width w, height h; returns points for t = 0…1. */
function capCurve(width: number, height: number): Vec2[] {
  const pts: Vec2[] = [];
  const x0 = width * 0.12;
  const x1 = width * 0.88;
  for (let i = 0; i < CAP_SAMPLES; i += 1) {
    const t = i / (CAP_SAMPLES - 1);
    const y = height * Math.sin(Math.PI * t) ** 0.72;
    pts.push({ x: x0 + (x1 - x0) * t, y });
  }
  return pts;
}

const halfCapLength = (pts: Vec2[], from: number, to: number) => perimeter(pts.slice(from, to + 1), false);

/**
 * Solve the cap height so the front and back halves of the cap equal the
 * armscye lengths they will be sewn to, plus the target ease. A patternmaker
 * measures the armhole and drafts the cap to it; so does this.
 */
function solveCapHeight(width: number, targetHalf: number): { height: number; error: number; pts: Vec2[] } {
  let lo = 20, hi = 320, best = { height: 20, error: Infinity, pts: capCurve(width, 20) };
  for (let i = 0; i < 40; i += 1) {
    const mid = (lo + hi) / 2;
    const pts = capCurve(width, mid);
    const half = halfCapLength(pts, 0, (CAP_SAMPLES - 1) / 2);
    const error = half - targetHalf;
    if (Math.abs(error) < Math.abs(best.error)) best = { height: mid, error, pts };
    if (error > 0) hi = mid; else lo = mid;
  }
  return best;
}

function sleeveFor(style: GarmentStyle, m: BodyMeasurements, frontArmscye: number, backArmscye: number): PatternPiece | null {
  if (style.sleeves === "none") return null;
  const lengthByStyle: Record<SleeveStyle, number> = {
    none: 0, cap: 130, short: 220, "three-quarter": 430, long: m.armLength - 25, bishop: m.armLength - 20, flare: m.armLength - 10,
  };
  const length = lengthByStyle[style.sleeves];
  const width = m.bicep / 2 + 26 + (style.sleeves === "bishop" ? 60 : style.sleeves === "flare" ? 80 : 0);
  const wristHalf = style.sleeves === "bishop" || style.sleeves === "flare" ? width * 0.36 : m.wrist / 2 + 22;
  const targetFront = frontArmscye * 1.04;
  const targetBack = backArmscye * 1.04;
  const solved = solveCapHeight(width, (targetFront + targetBack) / 2);
  const pts = solved.pts;
  const last = pts.length - 1;
  const mid = Math.round(last / 2);
  const cx = width / 2;

  const outline: PatternPoint[] = [];
  pts.forEach((p, i) => {
    const edge = i < mid ? "cap-front" : i < last ? "cap-back" : "underarm";
    outline.push({ x: round(p.x, 2), y: round(p.y, 2), edge });
  });
  outline.push({ x: round(cx + wristHalf, 2), y: -length, edge: "wrist" });
  outline.push({ x: round(cx - wristHalf, 2), y: -length, edge: "underarm-front" });

  return finishPiece({
    id: "sleeve",
    name: "Sleeve",
    label: `${style.sleeves.toUpperCase()} SLEEVE`,
    outline,
    cut: 2,
    onFold: false,
    seamAllowance: 10,
    grainline: { a: { x: cx, y: -length * 0.2 }, b: { x: cx, y: -length * 0.85 } },
    notches: [{ edge: "cap-front", t: 0.75, label: "front pitch" }, { edge: "cap-back", t: 0.25, label: "back pitch" }],
    drillHoles: [],
    notes: [
      "Cut 2 (a mirror pair).",
      `Cap height ${round(solved.height, 1)} mm, solved to ${round((solved.error / Math.max(1, (targetFront + targetBack) / 2)) * 100, 1)}% from the target ease over the armscye.`,
      "Ease the cap in between the notches; do not pleat it.",
    ],
  });
}

/* ---------------- the pattern ---------------- */

export function draftPattern(styleInput: Partial<GarmentStyle>, measurementsInput: Partial<BodyMeasurements>, size: string = BASE_SIZE, easeInput: Partial<Ease> = {}): Pattern {
  const style: GarmentStyle = { ...DEFAULT_STYLE, ...styleInput };
  const { measurements: m } = normalizeMeasurements(measurementsInput);
  const ease: Ease = { ...DEFAULT_EASE, ...easeInput };
  const pieces: PatternPiece[] = [];
  const wantsTop = style.category !== "skirt";
  const wantsSkirt = ["dress", "gown", "skirt"].includes(style.category);

  let frontArmscye = 0;
  let backArmscye = 0;
  if (wantsTop) {
    const front = bodice(true, style, m, ease);
    const back = bodice(false, style, m, ease);
    frontArmscye = edgeLength(front, "armscye");
    backArmscye = edgeLength(back, "armscye");
    pieces.push(front, back);
  }
  if (wantsSkirt) pieces.push(skirt(true, style, m, ease), skirt(false, style, m, ease));
  if (wantsTop) {
    const slv = sleeveFor(style, m, frontArmscye, backArmscye);
    if (slv) pieces.push(slv);
  }

  const seams: Seam[] = [];
  const add = (id: string, a: Seam["a"], b: Seam["b"], type: SeamType, allowanceMm: number, description: string) => seams.push({ id, a, b, type, allowanceMm, description });

  if (wantsTop) {
    add("shoulder", { piece: "bodice-front", edge: "shoulder" }, { piece: "bodice-back", edge: "shoulder" }, "french", 10, "Front shoulder to back shoulder, right sides together, notches matched.");
    add("side", { piece: "bodice-front", edge: "side-seam" }, { piece: "bodice-back", edge: "side-seam" }, "french", 10, "Front side seam to back side seam, underarm to waist.");
  }
  if (wantsSkirt) {
    add("skirt-side", { piece: "skirt-front", edge: "side-seam" }, { piece: "skirt-back", edge: "side-seam" }, "french", 12, "Skirt front to skirt back, hip notch matched.");
  }
  if (wantsTop && wantsSkirt && style.waistSeam) {
    add("waist", { piece: "bodice-front", edge: "waist" }, { piece: "skirt-front", edge: "waist" }, "plain", 10, "Front bodice waist to skirt waist, darts aligned.");
    add("waist-back", { piece: "bodice-back", edge: "waist" }, { piece: "skirt-back", edge: "waist" }, "plain", 10, "Back bodice waist to skirt waist, darts aligned.");
  }
  if (pieces.some((p) => p.id === "sleeve")) {
    add("sleeve-underarm", { piece: "sleeve", edge: "underarm" }, { piece: "sleeve", edge: "underarm-front" }, "french", 10, "Sleeve underarm seam: the front and back underarm edges joined.");
    add("sleeve-cap-front", { piece: "sleeve", edge: "cap-front" }, { piece: "bodice-front", edge: "armscye" }, "plain", 10, "Front half of the cap eased into the front armscye.");
    add("sleeve-cap-back", { piece: "sleeve", edge: "cap-back" }, { piece: "bodice-back", edge: "armscye" }, "plain", 10, "Back half of the cap eased into the back armscye.");
  }

  const pattern: Pattern = {
    id: `pat_${Math.abs(Math.round((m.bust * 7 + m.waist * 13 + m.hip * 17 + m.height + m.backLength * 3) * 10 + style.length.length * 7 + style.silhouette.length * 11 + style.neckline.length))}`,
    name: `${style.category} — ${style.silhouette}, ${style.neckline} neckline`,
    size,
    unit: "mm",
    measurements: m,
    style,
    pieces,
    seams,
    checks: [],
    eases: ease,
    fabricWidthMm: 1400,
  };
  pattern.checks = checkPattern(pattern);
  return pattern;
}

/* ---------------- checks ---------------- */

function seamLengths(pattern: Pattern, seam: Seam): { a: number; b: number } {
  const pa = pattern.pieces.find((p) => p.id === seam.a.piece);
  const pb = pattern.pieces.find((p) => p.id === seam.b.piece);
  if (seam.a.edge === "waist" && pa && pb) {
    // The waist seam runs centre-front to side seam; the dart is removed inside it.
    return { a: waistlineExtent(pa), b: waistlineExtent(pb) };
  }
  return { a: pa ? edgeLength(pa, seam.a.edge) : 0, b: pb ? edgeLength(pb, seam.b.edge) : 0 };
}

/** Everything a patternmaker checks before the cloth is cut. */
export function checkPattern(pattern: Pattern): PatternCheck[] {
  const checks: PatternCheck[] = [];
  for (const seam of pattern.seams) {
    const { a, b } = seamLengths(pattern, seam);
    if (a <= 0 || b <= 0) {
      checks.push({ name: `${seam.id}: edges exist`, ok: false, detail: `edge ${a <= 0 ? seam.a.edge : seam.b.edge} was not found on its piece` });
      continue;
    }
    const isCap = seam.id.startsWith("sleeve-cap");
    const ease = a - b;
    const ok = isCap ? ease >= -1 && ease <= b * 0.09 : Math.abs(a - b) <= 2.5;
    checks.push({
      name: `${seam.id}: seam lengths`,
      ok,
      detail: `${round(a, 1)} mm against ${round(b, 1)} mm — ${ease >= 0 ? "ease" : "short by"} ${round(Math.abs(ease), 1)} mm (allowed ${isCap ? "0–9% ease" : "±2.5 mm"})`,
    });
  }
  for (const piece of pattern.pieces) {
    const net = netOutline(piece);
    const tris = triangulate(net);
    const grainMid = { x: (piece.grainline.a.x + piece.grainline.b.x) / 2, y: (piece.grainline.a.y + piece.grainline.b.y) / 2 };
    checks.push({ name: `${piece.id}: outline`, ok: net.length >= 3 && piece.areaMm2 > 0, detail: `${net.length} outline points, ${round(piece.areaMm2 / 100, 0)} cm² per cut piece` });
    checks.push({ name: `${piece.id}: simple outline`, ok: !selfIntersects(net), detail: selfIntersects(net) ? "the outline crosses itself — a dart or allowance is too large for the shape" : "no self-intersection detected" });
    checks.push({ name: `${piece.id}: grainline inside`, ok: pointInPolygon(grainMid, net), detail: piece.grainline.a.y !== piece.grainline.b.y ? "the grainline runs through the piece" : "the grainline is degenerate" });
    checks.push({ name: `${piece.id}: seam allowance`, ok: piece.seamAllowance >= 5 && piece.seamAllowance <= 20, detail: `${piece.seamAllowance} mm (a garment seam is 8–15 mm)` });
    checks.push({ name: `${piece.id}: triangulates`, ok: tris.length >= 3, detail: `${tris.length / 3} triangles for area and the 3D mapping` });
  }
  return checks;
}

export const patternOk = (pattern: Pattern): boolean => pattern.checks.every((c) => c.ok);

/* ---------------- grading ---------------- */

export interface GradeResult {
  base: string;
  patterns: Array<{ size: SizeLabel; measurements: BodyMeasurements; pattern: Pattern; ok: boolean }>;
  rules: GradeRule[];
  notes: string[];
}

/**
 * Grade by re-drafting at graded measurements. The armscye, neck and
 * shoulder do not grow at the bust's rate, so a size is constructed,
 * not scaled.
 */
export function gradePattern(base: Pattern, sizes: SizeLabel[] = ["XXS", "XS", "S", "M", "L", "XL", "XXL"]): GradeResult {
  const baseIndex = Math.max(0, SIZES.indexOf(base.size as SizeLabel));
  const patterns: GradeResult["patterns"] = [];
  for (const size of sizes) {
    const step = SIZES.indexOf(size) - baseIndex;
    if (step === 0) { patterns.push({ size, measurements: base.measurements, pattern: base, ok: patternOk(base) }); continue; }
    const measured: BodyMeasurements = { ...DEFAULT_MEASUREMENTS };
    for (const key of Object.keys(DEFAULT_MEASUREMENTS) as Array<keyof BodyMeasurements>) measured[key] = base.measurements[key];
    for (const rule of GRADE_RULES) measured[rule.measurement] = round(measured[rule.measurement] + rule.perStep * step, 1);
    const pattern = draftPattern(base.style, measured, size, base.eases);
    patterns.push({ size, measurements: measured, pattern, ok: patternOk(pattern) });
  }
  return {
    base: base.size,
    patterns,
    rules: GRADE_RULES,
    notes: [
      "Grading re-drafts: neck, shoulder and armscye grow at their own rates, which is what a scaled picture gets wrong.",
      "Increments are typical women's-apparel grade rules; confirm them against the size chart the garment is sold with.",
      "Every graded pattern runs its own seam checks; a grade that breaks a seam match is reported as not ok.",
      "The base row reuses the base pattern object, so its checks are the ones that were already run.",
    ],
  };
}

/* ---------------- editing ---------------- */

export type PatternEdit =
  | { kind: "move-point"; piece: string; index: number; dx: number; dy: number }
  | { kind: "set-seam-allowance"; piece: string; mm: number }
  | { kind: "set-grainline-angle"; piece: string; degrees: number }
  | { kind: "add-notch"; piece: string; edge: string; t: number; label: string }
  | { kind: "set-ease"; key: keyof Ease; mm: number }
  | { kind: "set-neckline"; neckline: Neckline }
  | { kind: "set-length"; length: LengthStyle }
  | { kind: "set-silhouette"; silhouette: Silhouette }
  | { kind: "set-sleeves"; sleeves: SleeveStyle };

/**
 * Edit one pattern. Point moves are applied to the net outline, so every
 * dependent number (seam lengths, area, fabric requirement, 3D mapping) is
 * recomputed and re-checked afterwards.
 */
export function editPattern(base: Pattern, edit: PatternEdit): { ok: true; pattern: Pattern; changed: string[] } | { ok: false; reason: string } {
  const next: Pattern = JSON.parse(JSON.stringify(base));
  const changed: string[] = [];
  const redraft = () => {
    const fresh = draftPattern(next.style, next.measurements, next.size, next.eases);
    next.pieces = fresh.pieces;
    next.seams = fresh.seams;
    next.id = fresh.id;
  };
  switch (edit.kind) {
    case "move-point": {
      const piece = next.pieces.find((p) => p.id === edit.piece);
      if (!piece) return { ok: false, reason: `no piece ${edit.piece} (have ${next.pieces.map((p) => p.id).join(", ")})` };
      if (!Number.isInteger(edit.index) || edit.index < 0 || edit.index >= piece.outline.length) return { ok: false, reason: `${edit.piece} has ${piece.outline.length} outline points (0–${piece.outline.length - 1})` };
      if (!Number.isFinite(edit.dx) || !Number.isFinite(edit.dy)) return { ok: false, reason: "dx and dy must be numbers of mm" };
      const point = piece.outline[edit.index];
      point.x = round(point.x + edit.dx, 2);
      point.y = round(point.y + edit.dy, 2);
      piece.areaMm2 = round(Math.abs(polygonArea(netOutline(piece))) * (piece.onFold ? 2 : 1), 0);
      changed.push(`${edit.piece} point ${edit.index} moved ${edit.dx >= 0 ? "+" : ""}${edit.dx}, ${edit.dy >= 0 ? "+" : ""}${edit.dy} mm`);
      break;
    }
    case "set-seam-allowance": {
      const piece = next.pieces.find((p) => p.id === edit.piece);
      if (!piece) return { ok: false, reason: `no piece ${edit.piece}` };
      if (!(edit.mm >= 0 && edit.mm <= 40)) return { ok: false, reason: "seam allowance must be 0–40 mm" };
      piece.seamAllowance = round(edit.mm, 1);
      changed.push(`${edit.piece} seam allowance ${piece.seamAllowance} mm`);
      break;
    }
    case "set-grainline-angle": {
      const piece = next.pieces.find((p) => p.id === edit.piece);
      if (!piece) return { ok: false, reason: `no piece ${edit.piece}` };
      const anchor = pieceAnchor(piece);
      const len = 260;
      const rad = (edit.degrees * Math.PI) / 180;
      piece.grainline = {
        a: { x: round(anchor.x - Math.sin(rad) * len * 0.35, 1), y: round(anchor.y - Math.cos(rad) * len * 0.35, 1) },
        b: { x: round(anchor.x + Math.sin(rad) * len * 0.65, 1), y: round(anchor.y + Math.cos(rad) * len * 0.65, 1) },
      };
      changed.push(`${edit.piece} grainline ${edit.degrees}° from the warp`);
      break;
    }
    case "add-notch": {
      const piece = next.pieces.find((p) => p.id === edit.piece);
      if (!piece) return { ok: false, reason: `no piece ${edit.piece}` };
      if (!pieceEdges(piece).includes(edit.edge)) return { ok: false, reason: `${edit.piece} has edges ${pieceEdges(piece).join(", ")}` };
      piece.notches.push({ edge: edit.edge, t: clamp(edit.t, 0, 1), label: edit.label.slice(0, 40) || "notch" });
      changed.push(`notch on ${edit.piece} ${edit.edge} at ${round(edit.t, 2)}`);
      break;
    }
    case "set-ease": {
      next.eases = { ...next.eases, [edit.key]: round(clamp(edit.mm, 0, 200), 1) };
      redraft();
      changed.push(`${edit.key} ease ${next.eases[edit.key]} mm (the pattern was re-drafted)`);
      break;
    }
    case "set-neckline": {
      next.style.neckline = edit.neckline;
      redraft();
      changed.push(`neckline ${edit.neckline}`);
      break;
    }
    case "set-length": {
      next.style.length = edit.length;
      redraft();
      changed.push(`length ${edit.length}`);
      break;
    }
    case "set-silhouette": {
      next.style.silhouette = edit.silhouette;
      redraft();
      changed.push(`silhouette ${edit.silhouette}`);
      break;
    }
    case "set-sleeves": {
      next.style.sleeves = edit.sleeves;
      redraft();
      changed.push(`sleeves ${edit.sleeves}`);
      break;
    }
    default:
      return { ok: false, reason: "unknown edit" };
  }
  next.checks = checkPattern(next);
  return { ok: true, pattern: next, changed };
}

/* ---------------- fabric requirement ---------------- */

export interface FabricRequirement {
  netAreaM2: number;
  grossAreaM2: number;
  metres: number;
  widthMm: number;
  byPiece: Array<{ piece: string; netAreaM2: number; cut: number }>;
  note: string;
}

export function fabricRequirement(pattern: Pattern, widthMm = pattern.fabricWidthMm): FabricRequirement {
  let net = 0;
  const byPiece = pattern.pieces.map((p) => {
    const area = (p.areaMm2 / 1_000_000) * p.cut;
    net += area;
    return { piece: p.id, netAreaM2: round(area, 3), cut: p.cut };
  });
  const gross = net * 1.12;
  return {
    netAreaM2: round(net, 3),
    grossAreaM2: round(gross, 3),
    metres: round(gross / (widthMm / 1000) / 0.82, 2),
    widthMm,
    byPiece,
    note: "Estimated from net piece area with 12% for seam allowances and 82% packing efficiency. This is not a marker/lay plan: a cutter should lay the pieces on the cloth.",
  };
}

/** Samples of a seam's two edges, paired point-for-point — the stitch list for 3D assembly. */
export function seamStitchPairs(pattern: Pattern, seam: Seam, count = 24): { a: Vec2[]; b: Vec2[] } {
  const pa = pattern.pieces.find((p) => p.id === seam.a.piece);
  const pb = pattern.pieces.find((p) => p.id === seam.b.piece);
  if (!pa || !pb) return { a: [], b: [] };
  const a = seam.a.edge === "waist" ? samplePolyline(pa.outline.filter((p) => Math.abs(p.y) < 2).map((p) => ({ x: p.x, y: p.y })), count) : samplePolyline(edgePoints(pa, seam.a.edge, 24), count);
  const b = seam.b.edge === "waist" ? samplePolyline(pb.outline.filter((p) => Math.abs(p.y) < 2).map((p) => ({ x: p.x, y: p.y })), count) : samplePolyline(edgePoints(pb, seam.b.edge, 24), count);
  return { a, b };
}
