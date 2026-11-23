/**
 * ==========================================================
 * LÉLU 2.1 — WP02: FIVE DISTRIBUTION LAWS, ONE SURFACE, ONE BUDGET
 *
 * Every method here selects the same number of points from the same cloud, with
 * the same index and the same seed, so the only variable is the law that
 * decides *which* points are chosen:
 *
 *   A conventional   ordered stride through the surface's own vertex order —
 *                    what LÉLU's builder does today
 *   B fibonacci      Fibonacci-sphere directions projected to the nearest
 *                    surface point (cos-latitude even, longitude turned by φ)
 *   C vogel          Vogel/Vogel-style disc law mapped onto the surface's own
 *                    elevation range: equal area per point, golden-angle turn
 *   D log spiral     a golden logarithmic spiral swept over the surface, sampled
 *                    at equal arc length
 *   E hybrid         golden-angle seed order plus farthest-point relaxation:
 *                    spacing adapts to the surface's local extent
 *
 * A method may not invent points — it snaps to the cloud, because a hair root
 * that is not on her scalp is a floating strand. Snapping can collide, so each
 * method reports the number it actually achieved.
 * ==========================================================
 */
import { GOLDEN_ANGLE, PHI_INV } from "../../geometry/golden/index.ts";
import { cloudSize, collect, type Cloud, type PointIndex } from "./pointcloud.ts";

export type MethodId = "A-conventional" | "B-fibonacci" | "C-vogel" | "D-logspiral" | "E-hybrid";

export interface Selection {
  id: MethodId;
  label: string;
  points: Float32Array;
  indices: number[];
  requested: number;
  achieved: number;
  /** Directions the law asked for, when it asked for more than it got. */
  attempts: number;
  ms: number;
  notes: string[];
}

const LABELS: Record<MethodId, string> = {
  "A-conventional": "ordered stride over the surface's vertex order (current builder)",
  "B-fibonacci": "Fibonacci-sphere directions snapped to the surface",
  "C-vogel": "Vogel equal-area disc law over the surface's elevation range",
  "D-logspiral": "golden logarithmic spiral at equal arc length",
  "E-hybrid": "golden-angle seed + farthest-point relaxation (density adaptive)",
};

function dedupe(cloud: Cloud, index: PointIndex, directions: (k: number, pass: number) => { x: number; y: number; z: number }, n: number): { indices: number[]; attempts: number } {
  // Directions are unit vectors; the surface is centimetres away. Snapping the
  // unit vector directly searches a shell a metre from the cloud and finds
  // nothing, so every direction is scaled to the cloud's own radius first.
  let scale = 0;
  for (let i = 0; i < cloudSize(cloud); i++) {
    const d = Math.hypot(cloud.points[3 * i] - cloud.centre[0], cloud.points[3 * i + 1] - cloud.centre[1], cloud.points[3 * i + 2] - cloud.centre[2]);
    if (d > scale) scale = d;
  }
  const chosen = new Set<number>();
  const indices: number[] = [];
  // Extra passes rotate the whole direction set by the golden angle, so a
  // second attempt asks for genuinely new points instead of re-asking for the
  // same ones (a direction law parameterised by `count` clamps if pushed past
  // it, which would silently starve every method but the strided baseline).
  const limit = n * 8;
  let attempts = 0;
  for (let k = 0; k < limit && indices.length < n; k++) {
    attempts++;
    const d = directions(k % n, Math.floor(k / n));
    const hit = index.nearestUnused(cloud.centre[0] + d.x * scale, cloud.centre[1] + d.y * scale, cloud.centre[2] + d.z * scale, chosen);
    if (hit.index < 0) continue;
    chosen.add(hit.index);
    indices.push(hit.index);
  }
  return { indices, attempts };
}

/** A — the builder's own law: walk the surface's vertex order at a fixed stride. */
export function selectConventional(cloud: Cloud, n: number): Selection {
  const t0 = performance.now();
  const size = cloudSize(cloud);
  const count = Math.min(n, size);
  const step = Math.max(1, Math.floor(size / count));
  const indices: number[] = [];
  for (let i = 0; i < size && indices.length < count; i += step) indices.push(i);
  return {
    id: "A-conventional",
    label: LABELS["A-conventional"],
    points: collect(cloud, indices),
    indices,
    requested: n,
    achieved: indices.length,
    attempts: indices.length,
    ms: performance.now() - t0,
    notes: ["vertex order carries whatever density the source mesh had"],
  };
}

/** B — Fibonacci-sphere directions over the surface's own elevation range. */
export function selectFibonacci(cloud: Cloud, n: number, index: PointIndex): Selection {
  const t0 = performance.now();
  const { lo, hi } = elevation(cloud);
  const count = Math.min(n, cloudSize(cloud));
  const span = hi - lo || 1;
  const dir = (k: number, pass: number) => fibonacciDirection(k, count, lo, span, pass);
  const { indices, attempts } = dedupe(cloud, index, dir, count);
  return {
    id: "B-fibonacci",
    label: LABELS["B-fibonacci"],
    points: collect(cloud, indices),
    indices,
    requested: n,
    achieved: indices.length,
    attempts,
    ms: performance.now() - t0,
    notes: [`elevation range ${lo.toFixed(3)}…${hi.toFixed(3)}`, "collisions at the poles are dropped, never merged"],
  };
}

/** C — Vogel's equal-area disc law, mapped onto the surface's elevation range. */
export function selectVogel(cloud: Cloud, n: number, index: PointIndex): Selection {
  const t0 = performance.now();
  const { lo, hi } = elevation(cloud);
  const count = Math.min(n, cloudSize(cloud));
  const span = hi - lo || 1;
  const dir = (k: number, pass: number) => {
    const t = (k + 0.5) / count;
    const cosLat = Math.min(1, Math.max(-1, lo + t * span));
    const az = k * GOLDEN_ANGLE + 0.5 + pass * GOLDEN_ANGLE;
    const r = Math.sqrt(Math.max(0, 1 - cosLat * cosLat));
    return { x: r * Math.cos(az), y: cosLat, z: r * Math.sin(az) };
  };
  const { indices, attempts } = dedupe(cloud, index, dir, count);
  return {
    id: "C-vogel",
    label: LABELS["C-vogel"],
    points: collect(cloud, indices),
    indices,
    requested: n,
    achieved: indices.length,
    attempts,
    ms: performance.now() - t0,
    notes: [`elevation range ${lo.toFixed(3)}…${hi.toFixed(3)}`, "equal area per point"],
  };
}

/** D — a golden logarithmic spiral over the same elevation range, equal arc length. */
export function selectLogSpiral(cloud: Cloud, n: number, index: PointIndex): Selection {
  const t0 = performance.now();
  const { lo, hi } = elevation(cloud);
  const count = Math.min(n, cloudSize(cloud));
  const span = Math.max(1e-6, hi - lo);
  // Radius grows by 1/φ per quarter turn; walk it in small steps and keep the
  // first `count` distinct surface hits, so the spacing along the spiral is equal.
  const turns = 3.2;
  const steps = count * 12;
  const radiusAt = (u: number) => Math.pow(1 / PHI_INV, (u * turns * Math.PI * 2) / Math.PI / 2); // φ^(2θ/π)
  const maxR = radiusAt(1);
  const dir = (k: number, pass: number) => {
    const u = (k % steps) / steps;
    const r = radiusAt(u) / maxR;
    const theta = u * turns * Math.PI * 2 + pass * GOLDEN_ANGLE;
    const cosLat = Math.min(1, Math.max(-1, hi - span * r));
    const ringR = Math.sqrt(Math.max(0, 1 - cosLat * cosLat));
    return { x: ringR * Math.cos(theta), y: cosLat, z: ringR * Math.sin(theta) };
  };
  const { indices, attempts } = dedupe(cloud, index, dir, count);
  return {
    id: "D-logspiral",
    label: LABELS["D-logspiral"],
    points: collect(cloud, indices),
    indices,
    requested: n,
    achieved: indices.length,
    attempts,
    ms: performance.now() - t0,
    notes: [`φ⁴ per turn × ${turns} turns`, "one continuous arm, so azimuthal coverage is deliberately uneven"],
  };
}

/**
 * E — hybrid: golden-angle seed order, then farthest-point relaxation on a
 * strided candidate set. Farthest-point spacing is what adapts: on a region the
 * surface covers densely the next point lands far away, so the pattern follows
 * the surface instead of the mesh's vertex order.
 */
export function selectHybrid(cloud: Cloud, n: number, index: PointIndex): Selection {
  const t0 = performance.now();
  const size = cloudSize(cloud);
  const count = Math.min(n, size);
  const candidateStride = Math.max(1, Math.trunc(size / Math.max(count * 16, 4096)));
  const candidates: number[] = [];
  for (let i = 0; i < size; i += candidateStride) candidates.push(i);
  const cx = new Float64Array(candidates.length);
  for (let c = 0; c < candidates.length; c++) cx[c] = Infinity;

  const chosen: number[] = [];
  const chosenSet = new Set<number>();
  const take = (i: number) => {
    chosen.push(i);
    chosenSet.add(i);
    const p = cloud.points;
    for (let c = 0; c < candidates.length; c++) {
      const j = candidates[c];
      const d = (p[3 * j] - p[3 * i]) ** 2 + (p[3 * j + 1] - p[3 * i + 1]) ** 2 + (p[3 * j + 2] - p[3 * i + 2]) ** 2;
      if (d < cx[c]) cx[c] = d;
    }
  };
  // Seed on the first Fibonacci direction so the layout does not depend on the
  // mesh's vertex order at all.
  const { lo, hi } = elevation(cloud);
  const seedDir = fibonacciDirection(0, count, lo, hi - lo);
  const seed = index.nearest(seedDir.x, seedDir.y, seedDir.z);
  take(seed.index >= 0 ? seed.index : 0);
  while (chosen.length < count) {
    let bestC = -1;
    let bestD = -1;
    for (let c = 0; c < candidates.length; c++) {
      if (chosenSet.has(candidates[c])) continue;
      if (cx[c] > bestD) {
        bestD = cx[c];
        bestC = c;
      }
    }
    if (bestC < 0) break;
    take(candidates[bestC]);
  }
  return {
    id: "E-hybrid",
    label: LABELS["E-hybrid"],
    points: collect(cloud, chosen),
    indices: chosen,
    requested: n,
    achieved: chosen.length,
    attempts: chosen.length,
    ms: performance.now() - t0,
    notes: [`candidates strided by ${candidateStride}`, "no snapping: farthest-point relaxation picks real vertices"],
  };
}

/** Elevation of the cloud about its centre, along +Y (her up axis). */
function elevation(cloud: Cloud): { lo: number; hi: number } {
  let lo = 1, hi = -1;
  for (let i = 0; i < cloudSize(cloud); i++) {
    const dx = cloud.points[3 * i] - cloud.centre[0];
    const dy = cloud.points[3 * i + 1] - cloud.centre[1];
    const dz = cloud.points[3 * i + 2] - cloud.centre[2];
    const l = Math.hypot(dx, dy, dz) || 1;
    const c = dy / l;
    if (c < lo) lo = c;
    if (c > hi) hi = c;
  }
  return { lo, hi };
}

function fibonacciDirection(k: number, n: number, lo: number, span: number, pass = 0): { x: number; y: number; z: number } {
  const cosLat = Math.min(1, Math.max(-1, lo + ((k + 0.5) / n) * span));
  const r = Math.sqrt(Math.max(0, 1 - cosLat * cosLat));
  const az = k * GOLDEN_ANGLE + pass * GOLDEN_ANGLE;
  return { x: r * Math.cos(az), y: cosLat, z: r * Math.sin(az) };
}

/**
 * Planar laws for a flat ornament disc.
 *
 * A Fibonacci SPHERE law has no meaning on a plane: every point shares one
 * elevation, so the directions collapse onto the rim and the method delivers a
 * handful of points. The planar counterpart of the equal-area sphere law is
 * Vogel's disc, so the disc experiment reports A, C (planar), D (single golden
 * arm) and E, and omits B with that reason recorded rather than printing a
 * meaningless 0.4 % coverage.
 */
export function selectPlanar(cloud: Cloud, n: number, index: PointIndex): { selections: Selection[]; omitted: { id: MethodId; reason: string }[] } {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < cloudSize(cloud); i++) {
    minX = Math.min(minX, cloud.points[3 * i]);
    maxX = Math.max(maxX, cloud.points[3 * i]);
    minZ = Math.min(minZ, cloud.points[3 * i + 2]);
    maxZ = Math.max(maxZ, cloud.points[3 * i + 2]);
  }
  const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;
  const radius = Math.min(maxX - minX, maxZ - minZ) / 2;
  const plane = (x: number, z: number) => ({ x, y: 0, z });

  const vogelPlanar = (): Selection => {
    const t0 = performance.now();
    const chosen = new Set<number>();
    const indices: number[] = [];
    let attempts = 0;
    for (let k = 0; k < n * 8 && indices.length < n; k++) {
      attempts++;
      const i = k % n;
      const r = radius * Math.sqrt((i + 0.5) / n);
      const a = i * GOLDEN_ANGLE + 0.5 + Math.floor(k / n) * GOLDEN_ANGLE;
      const p = plane(cx + r * Math.cos(a), cz + r * Math.sin(a));
      const hit = index.nearestUnused(p.x, p.y, p.z, chosen);
      if (hit.index < 0) continue;
      chosen.add(hit.index);
      indices.push(hit.index);
    }
    return { id: "C-vogel", label: "Vogel equal-area disc (planar)", points: collect(cloud, indices), indices, requested: n, achieved: indices.length, attempts, ms: performance.now() - t0, notes: ["equal area per point", "golden-angle turn"] };
  };

  const spiralPlanar = (): Selection => {
    const t0 = performance.now();
    const chosen = new Set<number>();
    const indices: number[] = [];
    const turns = 3.2;
    let attempts = 0;
    for (let k = 0; k < n * 8 && indices.length < n; k++) {
      attempts++;
      const u = (k % (n * 4)) / (n * 4);
      const r = radius * Math.pow(PHI_INV, turns * u); // φ^(−1) per turn inward
      const a = u * turns * Math.PI * 2 + Math.floor(k / (n * 4)) * GOLDEN_ANGLE;
      const p = plane(cx + r * Math.cos(a), cz + r * Math.sin(a));
      const hit = index.nearestUnused(p.x, p.y, p.z, chosen);
      if (hit.index < 0) continue;
      chosen.add(hit.index);
      indices.push(hit.index);
    }
    return { id: "D-logspiral", label: "single golden spiral arm at equal arc length", points: collect(cloud, indices), indices, requested: n, achieved: indices.length, attempts, ms: performance.now() - t0, notes: [`${turns} turns, 1/φ per turn inward`, "one arm: azimuthal coverage is deliberately uneven"] };
  };

  return {
    selections: [selectConventional(cloud, n), vogelPlanar(), spiralPlanar(), selectHybrid(cloud, n, index)],
    omitted: [{ id: "B-fibonacci", reason: "a Fibonacci-sphere law is undefined on a flat disc; C is its planar counterpart" }],
  };
}

export const METHOD_ORDER: MethodId[] = ["A-conventional", "B-fibonacci", "C-vogel", "D-logspiral", "E-hybrid"];

export function selectAll(cloud: Cloud, n: number, index: PointIndex): Selection[] {
  return [selectConventional(cloud, n), selectFibonacci(cloud, n, index), selectVogel(cloud, n, index), selectLogSpiral(cloud, n, index), selectHybrid(cloud, n, index)];
}
