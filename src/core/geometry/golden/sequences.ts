/**
 * ==========================================================
 * LÉLU 2 — GOLDEN GEOMETRY — SEQUENCES AND SYNTHETIC DIVISION
 *
 * Fibonacci/Lucas integers, continued fractions and their convergents, and the
 * measurements that say *how close* a real quantity is to the golden ratio.
 * Nothing here is a metaphor: every function returns a number that can be
 * asserted against.
 * ==========================================================
 */
import { PHI, PHI_INV } from "./constants.ts";

/** F(n) with F(0)=0, F(1)=1. Exact for n ≤ 78 in a double. */
export function fibonacci(n: number): number {
  let a = 0, b = 1;
  for (let i = 0; i < Math.max(0, Math.floor(n)); i++) {
    const t = a + b;
    a = b;
    b = t;
  }
  return a;
}

/** The first `count` Fibonacci numbers, starting at F(1)=1. */
export function fibonacciSequence(count: number): number[] {
  const out: number[] = [];
  let a = 0, b = 1;
  for (let i = 0; i < count; i++) {
    out.push(b);
    const t = a + b;
    a = b;
    b = t;
  }
  return out;
}

/** Lucas numbers L(n) with L(0)=2, L(1)=1. */
export function lucas(n: number): number {
  let a = 2, b = 1;
  for (let i = 0; i < Math.max(0, Math.floor(n)); i++) {
    const t = a + b;
    a = b;
    b = t;
  }
  return a;
}

/** The n-th convergent F(n+1)/F(n), i.e. the best rational φ has at that size. */
export function phiConvergent(n: number): number {
  const a = fibonacci(n + 1), b = fibonacci(n);
  return b === 0 ? 1 : a / b;
}

/** |convergent − φ| for each convergent up to `count`. Convergence is alternating and monotone in magnitude. */
export function ratioConvergence(count: number): { n: number; ratio: number; error: number }[] {
  const out: { n: number; ratio: number; error: number }[] = [];
  for (let n = 1; n <= count; n++) {
    const ratio = phiConvergent(n);
    out.push({ n, ratio, error: Math.abs(ratio - PHI) });
  }
  return out;
}

/**
 * Nearest Fibonacci integer pair to a target: the phyllotaxis counts that keep
 * a *visible* number of parastichies equal to Fibonacci numbers. Used to pick
 * strand/bead counts that read as Fibonacci arms rather than arbitrary numbers.
 */
export function nearestFibonacci(target: number): { value: number; index: number; error: number } {
  let index = 1;
  let value = 1;
  let best = { value: 1, index: 1, error: Math.abs(target - 1) };
  while (value < target * 4) {
    value = fibonacci(++index);
    const error = Math.abs(target - value);
    if (error < best.error) best = { value, index, error };
  }
  return best;
}

/** Continued fraction [a0; a1, a2, …] of a positive real. φ is [1;1,1,1,…]. */
export function continuedFraction(x: number, depth = 12): number[] {
  const out: number[] = [];
  let v = x;
  for (let i = 0; i < depth; i++) {
    const a = Math.floor(v);
    out.push(a);
    const frac = v - a;
    if (frac < 1e-12) break;
    v = 1 / frac;
  }
  return out;
}

/** Evaluate a continued fraction back to a real. */
export function fromContinuedFraction(terms: readonly number[]): number {
  let v = 0;
  for (let i = terms.length - 1; i >= 0; i--) v = terms[i] + (i === terms.length - 1 ? 0 : 1 / v);
  return v;
}

/** The golden section point of [a,b]: a + (b−a)/φ² ≈ 0.382 of the way. */
export function goldenSection(a: number, b: number): number {
  return a + (b - a) * PHI_INV * PHI_INV;
}

/** The two golden-section points of [a,b], larger first. */
export function goldenSectionPoints(a: number, b: number): [number, number] {
  const lo = a + (b - a) * PHI_INV * PHI_INV;
  const hi = a + (b - a) * PHI_INV;
  return [hi, lo];
}

/**
 * How far a measured ratio is from the nearest power of φ, in relative terms.
 * `power` is the exponent k with ratio ≈ φ^k (k may be negative or fractional
 * when `allowFractional`). This is the honest primitive behind every claim that
 * some proportion is "golden": it returns the error, so the claim can fail.
 */
export function closestPhiPower(ratio: number, opts: { maxPower?: number; allowFractional?: boolean } = {}): { power: number; target: number; error: number; relativeError: number } {
  const maxPower = opts.maxPower ?? 6;
  if (!(ratio > 0) || !Number.isFinite(ratio)) return { power: 0, target: 1, error: Infinity, relativeError: Infinity };
  if (opts.allowFractional) {
    const power = Math.log(ratio) / Math.log(PHI);
    const target = Math.pow(PHI, power);
    return { power, target, error: Math.abs(ratio - target), relativeError: Math.abs(ratio - target) / ratio };
  }
  let best = { power: 0, target: 1, error: Infinity, relativeError: Infinity };
  for (let k = -maxPower; k <= maxPower; k++) {
    const target = Math.pow(PHI, k);
    const relativeError = Math.abs(ratio - target) / ratio;
    if (relativeError < best.relativeError) best = { power: k, target, error: Math.abs(ratio - target), relativeError };
  }
  return best;
}
