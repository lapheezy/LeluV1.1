/**
 * ==========================================================
 * LÉLU 2.1 — WP03: SWEPT-TUBE HAIR
 *
 * The 2.0 hair is a voxel field: locks are stamped into a 2.5 mm density grid
 * and meshed with surface nets. That grid is why the curls read as clumps — any
 * detail below 2.5 mm (the tip of a ringlet, the gap between two coils) cannot
 * exist in the output, whatever the strand mathematics does.
 *
 * This module builds the hair as geometry instead: one tube swept along each
 * strand's own path, with:
 *
 *   parallel-transport frames   no twisting seam where the strand bends
 *   elliptical cross-section    flattened locks, not wires
 *   per-strand taper            a lock thins toward its tip
 *   per-strand diameter/length  variation from a deterministic seed
 *   collapsed ends              the root ring closes on the scalp point and the
 *                               tip closes, so a tube has no open cap
 *   three LODs                  (7×26), (5×14), (3×7) sides × segments
 *
 * The hair's OCCUPANCY cells stay the ones the voxel field produced: swapping
 * the mesh must not change ASRE/NRE occupancy, or a rendering improvement would
 * silently move her structure. `hairTubeDiagnostics` records what the geometry
 * actually did so the claims can be measured.
 * ==========================================================
 */
import type { Mesh } from "../volume/mesh.ts";

/**
 * The swept-tube mesh of the last build, in WORLD coordinates, or null. The hair
 * component's occupancy cells never come from here — they stay the voxel
 * field's — so enabling tubes changes how her hair is drawn, not what she
 * occupies.
 */
export const hairTubeBuild: { mesh: Mesh | null } = { mesh: null };

/**
 * Roots of the strands that were actually drawn in the last tube build. Read by
 * the WP03 experiment to measure root clearance against her head MESH — the 3 mm
 * occupancy field is too coarse to certify a 0.5 mm root offset.
 */
export let hairRootPoints: Float32Array | null = null;
export function setHairRootPoints(points: Float32Array | null): void {
  hairRootPoints = points;
}

export interface StrandPoint {
  x: number;
  y: number;
  z: number;
}

export interface TubeOptions {
  sides: number;
  segments: number;
  /** Cross-section width ÷ thickness: 1 is round, 0.45 is a flat lock. */
  flatness: number;
  /** Radius multiplier at the tip. */
  tipScale: number;
  /** Radius exponent along the strand: 1 linear, 2 concave (thicker mid-length). */
  taper: number;
  twist?: number;
}

export const TUBE_LOD: Record<"high" | "medium" | "low", TubeOptions> = {
  high: { sides: 7, segments: 26, flatness: 0.55, tipScale: 0.12, taper: 1.2 },
  medium: { sides: 5, segments: 14, flatness: 0.55, tipScale: 0.14, taper: 1.2 },
  low: { sides: 3, segments: 7, flatness: 0.6, tipScale: 0.18, taper: 1.1 },
};

export interface TubeResult {
  positions: Float32Array;
  indices: Uint32Array;
  triangles: number;
  /** Closed ends: true when the first and last rings collapsed to a point. */
  closedRoot: boolean;
  closedTip: boolean;
}

/**
 * Sweep a tube along a path. Frames are transported, not recomputed from a
 * global up-vector, so a strand that turns 180° does not flip its cross-section.
 */
export function sweepTube(path: readonly StrandPoint[], radiusAt: (t: number) => number, options: TubeOptions): TubeResult {
  const segments = Math.max(2, options.segments);
  const sides = Math.max(3, options.sides);
  const pts: StrandPoint[] = resample(path, segments + 1);
  const tangents: StrandPoint[] = [];
  for (let i = 0; i <= segments; i++) {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(segments, i + 1)];
    tangents.push(normalise({ x: b.x - a.x, y: b.y - a.y, z: b.z - a.z }));
  }
  // Initial frame: any vector not parallel to the first tangent.
  let normal = perpendicular(tangents[0]);
  const positions: number[] = [];
  const rings: number[][] = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    if (i > 0) normal = transport(normal, tangents[i - 1], tangents[i]);
    const binormal = normalise(cross(tangents[i], normal));
    const r = Math.max(0, radiusAt(t));
    const ring: number[] = [];
    const collapse = i === 0 || i === segments;
    for (let s = 0; s < sides; s++) {
      const ang = (s / sides) * Math.PI * 2 + (options.twist ?? 0) * t;
      const w = Math.cos(ang) * r;
      const h = Math.sin(ang) * r * options.flatness;
      const px = pts[i].x + normal.x * w + binormal.x * h;
      const py = pts[i].y + normal.y * w + binormal.y * h;
      const pz = pts[i].z + normal.z * w + binormal.z * h;
      if (collapse) {
        // One shared point at each end: no open cap, no floating disc.
        positions.push(pts[i].x, pts[i].y, pts[i].z);
        ring.push(positions.length / 3 - 1);
      } else {
        positions.push(px, py, pz);
        ring.push(positions.length / 3 - 1);
      }
    }
    rings.push(ring);
  }
  const indices: number[] = [];
  for (let i = 0; i < segments; i++) {
    const a = rings[i], b = rings[i + 1];
    for (let s = 0; s < sides; s++) {
      const s2 = (s + 1) % sides;
      // At a collapsed end the quad degenerates to a triangle; skipping the
      // degenerate half keeps the index buffer free of zero-area faces.
      if (i === 0) indices.push(a[0], b[s], b[s2]);
      else if (i === segments - 1) indices.push(a[s], a[s2], b[0]);
      else {
        indices.push(a[s], a[s2], b[s]);
        indices.push(a[s2], b[s2], b[s]);
      }
    }
  }
  return {
    positions: Float32Array.from(positions),
    indices: Uint32Array.from(indices),
    triangles: indices.length / 3,
    closedRoot: true,
    closedTip: true,
  };
}

export interface StrandSpec {
  path: StrandPoint[];
  radius: number;
  /** Deterministic per-strand value in [0,1); drives taper and diameter. */
  seed: number;
  droop: number;
  /**
   * Per-strand override of the bundle's diameter jitter. A baby hair's recorded
   * thickness IS its drawn thickness, so those strands pass 0 and the number in
   * the strand record cannot disagree with the geometry.
   */
  diameterJitter?: number;
  /** Per-strand override of the bundle's tip jitter. */
  taperJitter?: number;
}

export interface BundleOptions extends TubeOptions {
  /** Diameter varies by this fraction across strands (0 = every lock identical). */
  diameterVariation: number;
  /** Tip thickness varies by this fraction across strands. */
  taperVariation: number;
}

/** One tube per strand, merged into a single indexed mesh. */
export function bundleTubes(strands: readonly StrandSpec[], options: BundleOptions): TubeResult & { perStrand: { radius: number; tipScale: number; triangles: number }[] } {
  const positions: number[] = [];
  const indices: number[] = [];
  const perStrand: { radius: number; tipScale: number; triangles: number }[] = [];
  let vertexOffset = 0;
  for (const s of strands) {
    const radius = s.radius * (1 + (s.diameterJitter ?? options.diameterVariation) * (s.seed - 0.5) * 2);
    const tipScale = Math.max(0.05, options.tipScale * (1 + (s.taperJitter ?? options.taperVariation) * (s.seed - 0.5) * 2));
    const radiusAt = (t: number) => {
      // taper: radius falls from `radius` at the root to `radius * tipScale` at the tip
      const shaped = Math.pow(1 - t, options.taper);
      return radius * (tipScale + (1 - tipScale) * shaped);
    };
    const tube = sweepTube(s.path, radiusAt, options);
    positions.push(...tube.positions);
    for (const i of tube.indices) indices.push(i + vertexOffset);
    vertexOffset += tube.positions.length / 3;
    perStrand.push({ radius, tipScale, triangles: tube.triangles });
  }
  return {
    positions: Float32Array.from(positions),
    indices: Uint32Array.from(indices),
    triangles: indices.length / 3,
    closedRoot: true,
    closedTip: true,
    perStrand,
  };
}

export function tubeMesh(result: TubeResult): Mesh {
  return { positions: result.positions, indices: result.indices };
}

/* ------------------------------- helpers -------------------------------- */

function resample(path: readonly StrandPoint[], count: number): StrandPoint[] {
  if (path.length < 2) return Array.from({ length: count }, () => path[0] ?? { x: 0, y: 0, z: 0 });
  const cumulative: number[] = [0];
  for (let i = 1; i < path.length; i++) cumulative.push(cumulative[i - 1] + dist(path[i - 1], path[i]));
  const total = cumulative[cumulative.length - 1] || 1;
  const out: StrandPoint[] = [];
  let cursor = 0;
  for (let k = 0; k < count; k++) {
    const target = (k / (count - 1)) * total;
    while (cursor < path.length - 2 && cumulative[cursor + 1] < target) cursor++;
    const span = cumulative[cursor + 1] - cumulative[cursor] || 1;
    const u = Math.min(1, Math.max(0, (target - cumulative[cursor]) / span));
    const a = path[cursor], b = path[cursor + 1] ?? path[cursor];
    out.push({ x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u, z: a.z + (b.z - a.z) * u });
  }
  return out;
}

function transport(normal: StrandPoint, t0: StrandPoint, t1: StrandPoint): StrandPoint {
  // Rotate the previous normal by the minimal rotation taking t0 to t1.
  const axis = cross(t0, t1);
  const axisLen = Math.hypot(axis.x, axis.y, axis.z);
  if (axisLen < 1e-9) return normal;
  const a = normalise(axis);
  const dot = Math.min(1, Math.max(-1, t0.x * t1.x + t0.y * t1.y + t0.z * t1.z));
  const angle = Math.acos(dot);
  return rotate(normal, a, angle);
}

function rotate(v: StrandPoint, axis: StrandPoint, angle: number): StrandPoint {
  const c = Math.cos(angle), s = Math.sin(angle);
  const dot = v.x * axis.x + v.y * axis.y + v.z * axis.z;
  const cr = cross(axis, v);
  return {
    x: v.x * c + cr.x * s + axis.x * dot * (1 - c),
    y: v.y * c + cr.y * s + axis.y * dot * (1 - c),
    z: v.z * c + cr.z * s + axis.z * dot * (1 - c),
  };
}

function perpendicular(t: StrandPoint): StrandPoint {
  const ref = Math.abs(t.y) > 0.9 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 1, z: 0 };
  return normalise(cross(t, ref));
}

function cross(a: StrandPoint, b: StrandPoint): StrandPoint {
  return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
}

function normalise(v: StrandPoint): StrandPoint {
  const l = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / l, y: v.y / l, z: v.z / l };
}

function dist(a: StrandPoint, b: StrandPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

/** What the last tube build actually did — read by the experiment, not guessed. */
export interface TubeDiagnostics {
  enabled: boolean;
  lod: keyof typeof TUBE_LOD | null;
  strands: number;
  triangles: number;
  sides: number;
  segments: number;
  /** Root offset from the scalp surface, mm: negative is penetration. */
  rootOffsetMinMm: number;
  rootOffsetMaxMm: number;
  rootPenetrations: number;
  floatingRoots: number;
  /** Per-strand tube diameter, mm. */
  diameterMinMm: number;
  diameterMaxMm: number;
  diameterCv: number;
  tipScaleMin: number;
  tipScaleMax: number;
  babyStrands: number;
  babyMaxLengthMm: number;
  /** Roots whose clearance could be measured inside the head field's box. */
  rootsMeasured: number;
  rootsOutsideFieldBox: number;
  rootOffsetP50Mm: number;
  rootOffsetP99Mm: number;
}

export const tubeDiagnostics: TubeDiagnostics = {
  enabled: false,
  lod: null,
  strands: 0,
  triangles: 0,
  sides: 0,
  segments: 0,
  rootOffsetMinMm: 0,
  rootOffsetMaxMm: 0,
  rootPenetrations: 0,
  floatingRoots: 0,
  diameterMinMm: 0,
  diameterMaxMm: 0,
  diameterCv: 0,
  tipScaleMin: 0,
  tipScaleMax: 0,
  babyStrands: 0,
  babyMaxLengthMm: 0,
  rootsMeasured: 0,
  rootsOutsideFieldBox: 0,
  rootOffsetP50Mm: 0,
  rootOffsetP99Mm: 0,
};

export function resetTubeDiagnostics(): void {
  tubeDiagnostics.enabled = false;
  tubeDiagnostics.lod = null;
  tubeDiagnostics.strands = 0;
  tubeDiagnostics.triangles = 0;
  tubeDiagnostics.sides = 0;
  tubeDiagnostics.segments = 0;
  tubeDiagnostics.rootOffsetMinMm = 0;
  tubeDiagnostics.rootOffsetMaxMm = 0;
  tubeDiagnostics.rootPenetrations = 0;
  tubeDiagnostics.floatingRoots = 0;
  tubeDiagnostics.diameterMinMm = 0;
  tubeDiagnostics.diameterMaxMm = 0;
  tubeDiagnostics.diameterCv = 0;
  tubeDiagnostics.tipScaleMin = 0;
  tubeDiagnostics.tipScaleMax = 0;
  tubeDiagnostics.babyStrands = 0;
  tubeDiagnostics.babyMaxLengthMm = 0;
  tubeDiagnostics.rootsMeasured = 0;
  tubeDiagnostics.rootsOutsideFieldBox = 0;
  tubeDiagnostics.rootOffsetP50Mm = 0;
  tubeDiagnostics.rootOffsetP99Mm = 0;
}
