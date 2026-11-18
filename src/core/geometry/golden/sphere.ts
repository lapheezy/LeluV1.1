/**
 * ==========================================================
 * LÉLU 2 — GOLDEN GEOMETRY — SPHERES
 *
 * The Fibonacci sphere: `n` directions whose z is evenly spaced and whose
 * longitude advances by the golden angle, so the points are evenly spread over
 * the *area* of the sphere rather than clustered at the poles the way a
 * latitude/longitude grid does.
 *
 * That property is what makes it useful for LÉLU: hair roots on a scalp are an
 * area-filling problem on a curved surface, not a row-and-column problem. The
 * engine also projects Fibonacci directions onto an actual surface point cloud
 * (`mapDirectionsToSurface`), which is the bridge from mathematics to her skull.
 * ==========================================================
 */
import { GOLDEN_ANGLE } from "./constants.ts";

export interface Direction {
  x: number;
  y: number;
  z: number;
  /** Index in the golden-angle order. */
  index: number;
}

/**
 * `n` evenly-spread unit directions (spherical Fibonacci lattice).
 * `hemisphere: "top"` keeps z ≥ 0, `"bottom"` keeps z ≤ 0.
 */
export function fibonacciSphere(n: number, opts: { hemisphere?: "top" | "bottom" | "full"; phase?: number } = {}): Direction[] {
  const mode = opts.hemisphere ?? "full";
  const phase = opts.phase ?? 0;
  const out: Direction[] = [];
  const range = mode === "full" ? n : n;
  for (let i = 0; i < range; i++) {
    // z in (−1, 1); +0.5 centres the samples in their latitude bands.
    let z = 1 - (2 * (i + 0.5)) / range;
    if (mode === "top") z = Math.abs(z);
    if (mode === "bottom") z = -Math.abs(z);
    const r = Math.sqrt(Math.max(0, 1 - z * z));
    const theta = i * GOLDEN_ANGLE + phase;
    out.push({ x: Math.cos(theta) * r, y: Math.sin(theta) * r, z, index: i });
  }
  return out;
}

/** Directions inside a spherical cap of half-angle `capRad` around `axis`. */
export function sphericalCap(n: number, capRad: number, axis: [number, number, number] = [0, 1, 0]): Direction[] {
  const all = fibonacciSphere(n, { hemisphere: "full" });
  const [ax, ay, az] = axis;
  const len = Math.hypot(ax, ay, az) || 1;
  const cosCap = Math.cos(capRad);
  return all.filter((d) => (d.x * ax + d.y * ay + d.z * az) / len >= cosCap);
}

/**
 * A single continuous spiral from pole to pole — the sphere's own golden
 * spiral. Useful where a *path* is wanted (a braid, a wire, a camera orbit)
 * rather than a point distribution.
 */
export function sphereSpiral(n: number, turns = 9): { x: number; y: number; z: number; u: number }[] {
  const out: { x: number; y: number; z: number; u: number }[] = [];
  for (let i = 0; i < n; i++) {
    const u = i / Math.max(1, n - 1);
    const z = 1 - 2 * u;
    const r = Math.sqrt(Math.max(0, 1 - z * z));
    const theta = u * turns * Math.PI * 2;
    out.push({ x: Math.cos(theta) * r, y: Math.sin(theta) * r, z, u });
  }
  return out;
}

/**
 * Choose `count` of the given surface points so that they are evenly spread over
 * the *sphere of directions* around `centre` — the discrete version of the
 * Fibonacci sphere, constrained to points that actually exist.
 *
 * This is the tool for a scalp: the root candidates come from a real hair asset
 * (a few hundred vertices on a dome), and what is wanted is a subset of those
 * candidates with equal angular area, not new points invented in space. The
 * matching is O(count · points), which at a couple of thousand candidates is
 * milliseconds.
 */
export function selectSphericalEvenSubset(
  points: Float32Array | readonly { x: number; y: number; z: number }[],
  count: number,
  centre: [number, number, number],
  opts: { axis?: "y" | "z"; phase?: number } = {},
): { points: Float32Array; skipped: number } {
  const pts = points instanceof Float32Array ? points : Float32Array.from((points as readonly { x: number; y: number; z: number }[]).flatMap((p) => [p.x, p.y, p.z]));
  const n = Math.floor(pts.length / 3);
  const want = Math.max(0, Math.min(count, n));
  if (!want) return { points: new Float32Array(0), skipped: n };
  const axisIsZ = opts.axis === "z";
  const phase = opts.phase ?? 0;
  const dirs = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const dx = pts[3 * i] - centre[0], dy = pts[3 * i + 1] - centre[1], dz = pts[3 * i + 2] - centre[2];
    const l = Math.hypot(dx, dy, dz) || 1;
    dirs[3 * i] = dx / l;
    dirs[3 * i + 1] = dy / l;
    dirs[3 * i + 2] = dz / l;
  }
  const used = new Uint8Array(n);
  const chosen: number[] = [];
  // cosθ from the +axis end to the −axis end, evenly in area; azimuth by the
  // golden angle, which is what keeps successive picks from lining up.
  for (let k = 0; k < want; k++) {
    const c = 1 - (2 * (k + 0.5)) / want;
    const sr = Math.sqrt(Math.max(0, 1 - c * c));
    const az = k * GOLDEN_ANGLE + phase;
    const ax1 = Math.cos(az) * sr, ax2 = Math.sin(az) * sr;
    // Target unit vector in world axes: the even-area coordinate is along `axis`.
    const tx = axisIsZ ? ax1 : ax1, ty = axisIsZ ? ax2 : c, tz = axisIsZ ? c : ax2;
    let best = -1;
    let bestScore = Infinity;
    for (let i = 0; i < n; i++) {
      if (used[i]) continue;
      const score = 1 - (dirs[3 * i] * tx + dirs[3 * i + 1] * ty + dirs[3 * i + 2] * tz);
      if (score < bestScore) {
        bestScore = score;
        best = i;
      }
    }
    if (best < 0) break;
    used[best] = 1;
    chosen.push(best);
  }
  const out = new Float32Array(chosen.length * 3);
  for (let k = 0; k < chosen.length; k++) {
    out[3 * k] = pts[3 * chosen[k]];
    out[3 * k + 1] = pts[3 * chosen[k] + 1];
    out[3 * k + 2] = pts[3 * chosen[k] + 2];
  }
  return { points: out, skipped: n - chosen.length };
}

/** Uniform grid keyed by cell size, for nearest-point queries in O(1)-ish. */
export class PointGrid {
  private cells = new Map<string, number[]>();
  readonly points: Float32Array;
  readonly cell: number;
  constructor(points: Float32Array, cell: number) {
    this.points = points;
    this.cell = cell;
    const n = points.length / 3;
    for (let i = 0; i < n; i++) {
      const key = this.key(points[3 * i], points[3 * i + 1], points[3 * i + 2]);
      const bucket = this.cells.get(key);
      if (bucket) bucket.push(i);
      else this.cells.set(key, [i]);
    }
  }
  private key(x: number, y: number, z: number): string {
    return `${Math.floor(x / this.cell)},${Math.floor(y / this.cell)},${Math.floor(z / this.cell)}`;
  }
  /** Nearest stored point to (x,y,z), searching outward ring by ring. */
  nearest(x: number, y: number, z: number, maxRings = 6): { index: number; distance: number } | null {
    let best = -1;
    let bestD2 = Infinity;
    const cx = Math.floor(x / this.cell), cy = Math.floor(y / this.cell), cz = Math.floor(z / this.cell);
    for (let ring = 0; ring <= maxRings; ring++) {
      for (let dx = -ring; dx <= ring; dx++)
        for (let dy = -ring; dy <= ring; dy++)
          for (let dz = -ring; dz <= ring; dz++) {
            if (Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz)) !== ring) continue;
            const bucket = this.cells.get(`${cx + dx},${cy + dy},${cz + dz}`);
            if (!bucket) continue;
            for (const i of bucket) {
              const d2 = (this.points[3 * i] - x) ** 2 + (this.points[3 * i + 1] - y) ** 2 + (this.points[3 * i + 2] - z) ** 2;
              if (d2 < bestD2) {
                bestD2 = d2;
                best = i;
              }
            }
          }
      // A point found inside ring r is guaranteed nearest once r covers it plus one cell.
      if (best >= 0 && Math.sqrt(bestD2) <= ring * this.cell) break;
    }
    return best < 0 ? null : { index: best, distance: Math.sqrt(bestD2) };
  }
}

/**
 * Map golden-angle directions onto an arbitrary surface point cloud: shoot each
 * direction from `centre`, take the surface point nearest along that ray
 * (projected by nearest-neighbour over a scaled copy of the cloud), and return
 * the unique surface points that won.
 *
 * `filter` rejects candidates (e.g. hair must not start on the face). The result
 * is an *area-even* root set on a surface that is not a sphere, which is exactly
 * what a scalp is.
 */
export function mapDirectionsToSurface(
  count: number,
  surface: Float32Array,
  centre: [number, number, number],
  opts: { filter?: (x: number, y: number, z: number) => boolean; shell?: number; cell?: number; hemisphere?: "top" | "bottom" | "full"; phase?: number } = {},
): { points: Float32Array; unmatched: number } {
  const filter = opts.filter ?? (() => true);
  const grid = new PointGrid(surface, opts.cell ?? 0.02);
  // Directions are scaled to the surface's mean radius so the nearest surface
  // point to `centre + dir·shell` is the point that direction actually hits.
  let sum = 0;
  const n = surface.length / 3;
  for (let i = 0; i < n; i++) sum += Math.hypot(surface[3 * i] - centre[0], surface[3 * i + 1] - centre[1], surface[3 * i + 2] - centre[2]);
  const meanR = n ? sum / n : 0.1;
  const shell = opts.shell ?? meanR;
  const dirs = fibonacciSphere(count, { hemisphere: opts.hemisphere ?? "full", phase: opts.phase });
  const chosen = new Map<number, number>();
  let unmatched = 0;
  for (const d of dirs) {
    const px = centre[0] + d.x * shell, py = centre[1] + d.y * shell, pz = centre[2] + d.z * shell;
    const hit = grid.nearest(px, py, pz, 8);
    if (!hit) {
      unmatched++;
      continue;
    }
    const sx = surface[3 * hit.index], sy = surface[3 * hit.index + 1], sz = surface[3 * hit.index + 2];
    if (!filter(sx, sy, sz)) continue;
    // Several directions can land on the same surface point; keep the closest.
    const prev = chosen.get(hit.index);
    if (prev === undefined || hit.distance < prev) chosen.set(hit.index, hit.distance);
  }
  const points = new Float32Array(chosen.size * 3);
  let o = 0;
  for (const [index] of chosen) {
    points[o++] = surface[3 * index];
    points[o++] = surface[3 * index + 1];
    points[o++] = surface[3 * index + 2];
  }
  return { points, unmatched };
}
