/**
 * Seeded noise shared by every world adapter, so the trees stand on the
 * same hills the terrain draws and the 2D contours trace the same land.
 * Pure and deterministic.
 */

export function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const hash = (x: number, y: number, seed: number) => {
  let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};
const fade = (t: number) => t * t * (3 - 2 * t);

export function valueNoise(x: number, y: number, seed = 7): number {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = fade(x - xi), yf = fade(y - yi);
  const a = hash(xi, yi, seed), b = hash(xi + 1, yi, seed), c = hash(xi, yi + 1, seed), d = hash(xi + 1, yi + 1, seed);
  return a + (b - a) * xf + (c - a) * yf + (a - b - c + d) * xf * yf;
}

export function fbm(x: number, y: number, octaves = 5, seed = 7): number {
  let sum = 0, amp = 0.5, f = 1, norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * valueNoise(x * f, y * f, seed + i);
    norm += amp;
    amp *= 0.5;
    f *= 2.03;
  }
  return sum / norm;
}

/** The river's centre line (x for a given z). */
export const riverX = (z: number) => Math.sin(z * 0.045) * 14 + Math.sin(z * 0.11) * 4;

/**
 * Terrain height at (x, z): valley floor near the camera rising into hills
 * behind, with a river carved along riverX. `height` scales the hills.
 */
export function terrainHeight(x: number, z: number, height: number): number {
  const n = fbm(x * 0.018 + 10, z * 0.018 + 10, 5);
  const ridges = 1 - Math.abs(fbm(x * 0.03, z * 0.03, 3, 11) * 2 - 1);
  const back = Math.min(1, Math.max(0, (-z - 10) / 70)); // hills rise with distance
  const side = Math.min(1, Math.abs(x) / 60);
  let h = (n * 0.75 + ridges * 0.35) * height * (0.35 + back * 1.4 + side * 0.6);
  const d = Math.abs(x - riverX(z));
  if (d < 7) h *= 0.15 + 0.85 * fade(d / 7);
  return h - 2;
}
