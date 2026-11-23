/**
 * ==========================================================
 * LÉLU 2 — THE GOLDEN GEOMETRY ENGINE
 *
 * A small, dependency-free geometry engine built from published mathematics
 * (Vogel phyllotaxis, Fibonacci lattices, the logarithmic spiral family,
 * continued-fraction convergence) and reimplemented in LÉLU's own units. Two
 * MIT-licensed repositories were read and their published algorithms verified
 * against this implementation — see `research/LICENSES.md` and
 * `research/COMPATIBILITY.md`; neither is vendored, because importing a
 * framework to call `π(3−√5)` would be a dependency, not an integration.
 *
 * The engine has four layers:
 *
 *   construct  constants, sequences, phyllotaxis, sphere, spirals, symmetry
 *   measure    signatures: spacing, divergence, radial law, symmetry, spiral fit
 *   decide     proportions and selected constraints (what is worth adopting)
 *   generate   LÉLU integration: hair roots, curls, ornaments, composition
 * ==========================================================
 */
export * from "./constants.ts";
export * from "./sequences.ts";
export * from "./phyllotaxis.ts";
export * from "./sphere.ts";
export * from "./spirals.ts";
export * from "./symmetry.ts";
export * from "./analysis.ts";
export * from "./proportions.ts";
export * from "./constraints.ts";

/** Version of the engine's measurement contract: bump when a metric's meaning changes. */
export const GOLDEN_ENGINE_VERSION = "0.1.0";
