/**
 * ==========================================================
 * LÉLU 2 — GOLDEN GEOMETRY — PROPORTION ANALYSIS
 *
 * Measures whether a set of real landmarks has golden relationships, and reports
 * the error when it does not. This exists so the engine can say "her knee-to-
 * floor ratio is 1.618 within 0.4 %, but her bust-to-waist ratio is 1.29, which
 * is not a φ power at all" — and then not force it.
 *
 * Nothing here changes geometry. It is analysis; constraints.ts decides whether a
 * measured relationship is tight enough to pass into a generator.
 * ==========================================================
 */
import { PHI, PHI_INV } from "./constants.ts";
import { closestPhiPower } from "./sequences.ts";

export interface RatioMatch {
  a: string;
  b: string;
  /** a / b. */
  ratio: number;
  /** Nearest φ^k. */
  power: number;
  target: number;
  /** |ratio − target| / ratio. */
  relativeError: number;
  withinTolerance: boolean;
}

export interface ProportionReport {
  matches: RatioMatch[];
  /** Share of pairs that land within tolerance of some φ^k. */
  shareWithinTolerance: number;
  /** Median relative error across all pairs. */
  medianRelativeError: number;
  /** Pairs whose ratio is within tolerance — the only ones worth constraining on. */
  supported: RatioMatch[];
}

/**
 * Pairwise ratio analysis of named landmarks.
 *
 * `tolerance` is a *relative* error, default 2 % — a real body is not a
 * construction, so 2 % is already generous; anything looser can be produced by
 * chance and is reported as unsupported.
 */
export function analyseProportions(
  landmarks: Record<string, number>,
  opts: { tolerance?: number; maxPower?: number; allowFractional?: boolean; minRatio?: number } = {},
): ProportionReport {
  const tolerance = opts.tolerance ?? 0.02;
  const minRatio = opts.minRatio ?? 0.25;
  const names = Object.keys(landmarks);
  const matches: RatioMatch[] = [];
  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) {
      const a = names[i], b = names[j];
      const ratio = landmarks[a] / landmarks[b];
      if (!(ratio > 0) || !Number.isFinite(ratio) || ratio < minRatio) continue;
      const fit = closestPhiPower(ratio, { maxPower: opts.maxPower ?? 4, allowFractional: opts.allowFractional ?? false });
      matches.push({ a, b, ratio, power: fit.power, target: fit.target, relativeError: fit.relativeError, withinTolerance: fit.relativeError <= tolerance });
    }
  }
  const errors = matches.map((m) => m.relativeError).sort((x, y) => x - y);
  const medianRelativeError = errors.length ? errors[Math.floor(errors.length / 2)] : 0;
  const supported = matches.filter((m) => m.withinTolerance).sort((x, y) => x.relativeError - y.relativeError);
  return {
    matches,
    shareWithinTolerance: matches.length ? supported.length / matches.length : 0,
    medianRelativeError,
    supported,
  };
}

/**
 * Are the *increments* of a sequence in golden proportion? Returns the ratio
 * between successive differences and whether each is ≈ φ^k. Used for bead
 * ladders, skirt tiers and self-similar ornament, where it is the spacing that
 * carries the proportion rather than a body landmark.
 */
export function analyseIncrements(values: readonly number[], opts: { tolerance?: number } = {}): { ratios: number[]; golden: boolean; meanError: number } {
  const tolerance = opts.tolerance ?? 0.03;
  const diffs: number[] = [];
  for (let i = 1; i < values.length; i++) diffs.push(values[i] - values[i - 1]);
  const ratios: number[] = [];
  for (let i = 1; i < diffs.length; i++) if (Math.abs(diffs[i - 1]) > 1e-12) ratios.push(diffs[i] / diffs[i - 1]);
  let sum = 0, golden = ratios.length > 0;
  for (const r of ratios) {
    const fit = closestPhiPower(Math.abs(r), { maxPower: 4 });
    sum += fit.relativeError;
    if (fit.relativeError > tolerance) golden = false;
  }
  return { ratios, golden, meanError: ratios.length ? sum / ratios.length : 0 };
}

/** The φ partition of a length: [1/φ², 1/φ] shares, i.e. 0.382 / 0.618. */
export function goldenPartition(length: number): { small: number; large: number; smallShare: number; largeShare: number } {
  return { small: length * PHI_INV * PHI_INV, large: length * PHI_INV, smallShare: PHI_INV * PHI_INV, largeShare: PHI_INV };
}

/** Height of a golden rectangle of the given width, and its diagonal. */
export function goldenRectangle(width: number): { width: number; height: number; diagonal: number; ratio: number } {
  const height = width * PHI;
  return { width, height, diagonal: Math.hypot(width, height), ratio: height / width };
}

/**
 * Where to put a single subject in a frame so the composition follows the
 * golden section: returns the normalised [0,1] position of the golden node on an
 * axis, and the "look room" share to leave on the short side.
 */
export function goldenFrameNode(): { x: number; y: number; marginShare: number } {
  return { x: PHI_INV * PHI_INV, y: PHI_INV * PHI_INV, marginShare: PHI_INV * PHI_INV };
}
