/**
 * ==========================================================
 * LÉLU — CREATIVE KIT: SEEDED RANDOMNESS AND NOISE
 *
 * Every generated artwork, scene and film is a pure function of
 * its spec and seed, so the same request always reproduces the
 * same result, a revision can change one parameter and keep the
 * rest, and tests can assert exact output. No Math.random here.
 * ==========================================================
 */

/** mulberry32: small, fast, good enough for visuals. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A stable 32-bit seed from any text ("ocean dusk" → the same seed every time). */
export function seedFrom(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** 2-D value noise with smooth interpolation, seeded. Range ≈ [-1, 1]. */
export function noise2D(seed: number): (x: number, y: number) => number {
  const random = rng(seed);
  const size = 256;
  const perm = new Uint8Array(size * 2);
  const values = new Float32Array(size);
  for (let i = 0; i < size; i += 1) {
    perm[i] = i;
    values[i] = random() * 2 - 1;
  }
  for (let i = size - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    const t = perm[i];
    perm[i] = perm[j];
    perm[j] = t;
  }
  for (let i = 0; i < size; i += 1) perm[i + size] = perm[i];
  const fade = (t: number) => t * t * (3 - 2 * t);
  const at = (x: number, y: number) => values[perm[(perm[x & 255] + y) & 511] & 255];
  return (x, y) => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = x - xi;
    const yf = y - yi;
    const u = fade(xf);
    const v = fade(yf);
    const a = at(xi, yi) + (at(xi + 1, yi) - at(xi, yi)) * u;
    const b = at(xi, yi + 1) + (at(xi + 1, yi + 1) - at(xi, yi + 1)) * u;
    return a + (b - a) * v;
  };
}

/** Fractal (octave) noise built on noise2D. */
export function fbm(noise: (x: number, y: number) => number, x: number, y: number, octaves = 4): number {
  let sum = 0;
  let amp = 0.5;
  let freq = 1;
  for (let i = 0; i < octaves; i += 1) {
    sum += amp * noise(x * freq, y * freq);
    freq *= 2;
    amp *= 0.5;
  }
  return sum;
}

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
