/**
 * ==========================================================
 * LÉLU 2 — GOLDEN GEOMETRY — CONSTANTS
 *
 * The numbers this engine is built on, and nothing else. They are exact to
 * double precision, so every derived measurement in the engine can quote its
 * own error against them instead of asserting "golden".
 *
 * The golden angle is the *short* golden sweep, 2π/φ² — the same definition
 * geometor/phyllotaxis uses (`sweep_phi_short`) and sacred-sandbox's
 * `GOLDEN_ANGLE = π(3−√5)`, which is the same number written algebraically.
 * ==========================================================
 */

/** φ = (1 + √5)/2. */
export const PHI = (1 + Math.sqrt(5)) / 2;

/** φ² = φ + 1. */
export const PHI_SQ = PHI * PHI;

/** 1/φ = φ − 1. */
export const PHI_INV = 1 / PHI;

/** ln φ — the growth exponent of a golden logarithmic spiral. */
export const LN_PHI = Math.log(PHI);

/**
 * The golden angle in radians: 2π/φ² ≈ 2.399963229728653.
 * `Math.PI * (3 - Math.sqrt(5))` to the last bit, as sacred-sandbox writes it.
 */
export const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

/** The golden angle in degrees ≈ 137.50776405003785. */
export const GOLDEN_ANGLE_DEG = (GOLDEN_ANGLE * 180) / Math.PI;

/** The *long* golden sweep, 2π/φ ≈ 222.4922359°. */
export const GOLDEN_ANGLE_LONG = 2 * Math.PI - GOLDEN_ANGLE;
export const GOLDEN_ANGLE_LONG_DEG = 360 - GOLDEN_ANGLE_DEG;

/** The Lucas divergence angle 2π/(3 + 1/φ) ≈ 99.502°. */
export const LUCAS_ANGLE = (2 * Math.PI) / (3 + PHI_INV);

/** The silver ratio 1 + √2, the next continued-fraction family. */
export const SILVER_RATIO = 1 + Math.SQRT2;
