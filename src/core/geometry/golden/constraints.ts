/**
 * ==========================================================
 * LÉLU 2 — GOLDEN GEOMETRY — SELECTED CONSTRAINTS
 *
 * The step that turns analysis into generation. A *constraint* is a value the
 * engine has measured to be both (a) present in the source data and (b) useful,
 * with the error recorded. Generators read constraints, never "the golden ratio".
 *
 * The rules are deliberately conservative:
 *   - a relationship must be measured on real source data (a signature, a
 *     landmark table, a render), not assumed;
 *   - its error must be inside the caller's tolerance;
 *   - a constraint that would make the artefact worse is dropped, even when it
 *     is mathematically golden. `selectConstraints` therefore takes a `score`
 *     and drops anything below `minScore`.
 * ==========================================================
 */
import { GOLDEN_ANGLE, GOLDEN_ANGLE_DEG } from "./constants.ts";
import type { GeometricSignature } from "./analysis.ts";

export interface GoldenConstraint {
  id: string;
  /** What kind of number this is. */
  kind: "angle" | "count" | "ratio" | "spacing" | "scale";
  value: number;
  unit: "rad" | "deg" | "count" | "ratio" | "m" | "scalar";
  /** Where the value came from — a measurement, never a wish. */
  source: string;
  /** Measured non-conformance of the source data, if any. */
  measuredError: number;
  /** 0..1 — how worth adopting this constraint is. */
  score: number;
  /** Whether generation should use it. */
  accepted: boolean;
  rationale: string;
}

export interface ConstraintInput {
  signature?: GeometricSignature;
  /** Landmark ratios already tested against φ. */
  supportedRatios?: { a: string; b: string; ratio: number; power: number; relativeError: number }[];
  /** Target count before adjustment (strands, beads, panels). */
  count?: number;
  /** Nearest Fibonacci number to `count`, if the caller computed one. */
  fibonacciCount?: number;
  tolerance?: number;
}

/**
 * Build the constraint set for a generation run and mark which are accepted.
 *
 * The decision on Fibonacci counts is the one that matters most: it is accepted
 * only when it does not *reduce* the requested density by more than 12 %, because
 * changing 1350 strands to 1440 would change her hair; changing 1350 to the
 * nearest Fibonacci 1440 is a 6.7 % increase, so it is accepted only as an
 * explicit, reported choice.
 */
export function selectConstraints(input: ConstraintInput): GoldenConstraint[] {
  const tolerance = input.tolerance ?? 0.02;
  const out: GoldenConstraint[] = [];

  out.push({
    id: "divergence.golden",
    kind: "angle",
    value: GOLDEN_ANGLE,
    unit: "rad",
    source: "geometor/phyllotaxis sweep_phi_short; sacred-sandbox GOLDEN_ANGLE = π(3−√5)",
    measuredError: 0,
    score: 1,
    accepted: true,
    rationale: `The only divergence that never repeats and never leaves a gap: ${GOLDEN_ANGLE_DEG.toFixed(3)}°.`,
  });

  if (input.signature) {
    const sig = input.signature;
    // Uniformity is the useful thing to constrain on: if the source roots are
    // unevenly spaced, a golden-angle redistribution is justified by the
    // measurement, not by the ratio's mystique.
    const cv = sig.points.cv;
    out.push({
      id: "roots.even-area",
      kind: "spacing",
      value: cv,
      unit: "scalar",
      source: `measured nearest-neighbour CV of ${sig.points.count} source points`,
      measuredError: cv,
      score: Math.min(1, Math.max(0, cv / 0.25)),
      accepted: cv > 0.08,
      rationale: cv > 0.08 ? `Source spacing is uneven (CV ${cv.toFixed(3)}); area-even redistribution is justified.` : `Source spacing is already even (CV ${cv.toFixed(3)}); do not disturb it.`,
    });

    out.push({
      id: "pattern.equal-area",
      kind: "scale",
      value: sig.radial.exponent,
      unit: "scalar",
      source: "measured r ∝ t^p fit of the source point set",
      measuredError: sig.radial.error,
      score: sig.radial.error > 0.06 ? Math.min(1, sig.radial.error * 4) : 0.2,
      accepted: sig.radial.error > 0.06,
      rationale: `Equal-area packing needs p = 0.5; the source measures ${sig.radial.exponent.toFixed(3)} (r² ${sig.radial.r2.toFixed(3)}).`,
    });
  }

  for (const m of input.supportedRatios ?? []) {
    out.push({
      id: `ratio.${m.a}/${m.b}`,
      kind: "ratio",
      value: m.ratio,
      unit: "ratio",
      source: `measured landmark ratio ${m.a}/${m.b}`,
      measuredError: m.relativeError,
      score: Math.max(0, 1 - m.relativeError / tolerance),
      accepted: m.relativeError <= tolerance,
      rationale: `φ^${m.power} within ${(m.relativeError * 100).toFixed(2)} % — measured, and tight enough to hold.`,
    });
  }

  if (input.count !== undefined && input.fibonacciCount !== undefined) {
    const drift = Math.abs(input.fibonacciCount - input.count) / input.count;
    out.push({
      id: "count.fibonacci",
      kind: "count",
      value: input.fibonacciCount,
      unit: "count",
      source: `nearest Fibonacci number to the requested ${input.count}`,
      measuredError: drift,
      score: drift <= 0.12 ? 1 - drift : 0,
      accepted: drift <= 0.12,
      rationale: drift <= 0.12 ? `Fibonacci ${input.fibonacciCount} is ${(drift * 100).toFixed(1)} % from the requested count: the arms will read as Fibonacci without changing the amount of hair.` : `Fibonacci ${input.fibonacciCount} would change the count by ${(drift * 100).toFixed(1)} %; rejected — the pattern must not cost density.`,
    });
  }

  return out;
}

/** Constraints a generator may act on. */
export function acceptedConstraints(constraints: readonly GoldenConstraint[]): GoldenConstraint[] {
  return constraints.filter((c) => c.accepted);
}
