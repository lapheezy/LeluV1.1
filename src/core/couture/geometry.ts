/**
 * ==========================================================
 * LÉLU — COUTURE: SHARED GEOMETRY
 *
 * Everything the fashion, textile and product engines measure
 * is in millimetres (z-up); scenes convert to metres at the
 * edge. These are the primitives: signed area, polygon offset
 * (seam allowance), ear-clipping triangulation, polylines and
 * triangle meshes. No dependency, no network.
 * ==========================================================
 */

export interface Vec2 { x: number; y: number }
export interface Vec3 { x: number; y: number; z: number }

/** A triangle surface: positions are x,y,z triples; indices are triangle corners. */
export interface Mesh {
  positions: number[];
  indices: number[];
  normals?: number[];
}

export const v2 = (x: number, y: number): Vec2 => ({ x, y });
export const v3 = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
export const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
export const round = (n: number, places = 2) => {
  const f = 10 ** places;
  return Math.round(n * f) / f;
};

/* ---------------- 2D polygons ---------------- */

export function signedArea(points: Vec2[]): number {
  let a = 0;
  for (let i = 0; i < points.length; i += 1) {
    const p = points[i];
    const q = points[(i + 1) % points.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

export const polygonArea = (points: Vec2[]): number => Math.abs(signedArea(points));

export function perimeter(points: Vec2[], closed = true): number {
  let total = 0;
  for (let i = 0; i < points.length - (closed ? 0 : 1); i += 1) {
    const p = points[i];
    const q = points[(i + 1) % points.length];
    total += Math.hypot(q.x - p.x, q.y - p.y);
  }
  return total;
}

/** Remove consecutive duplicates (and a closing duplicate), keeping the shape. */
export function dedupe(points: Vec2[], epsilon = 1e-6): Vec2[] {
  const out: Vec2[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (!last || Math.hypot(p.x - last.x, p.y - last.y) > epsilon) out.push({ x: p.x, y: p.y });
  }
  while (out.length > 1 && Math.hypot(out[0].x - out[out.length - 1].x, out[0].y - out[out.length - 1].y) <= epsilon) out.pop();
  return out;
}

const cross = (a: Vec2, b: Vec2, c: Vec2) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);

function pointInTriangle(p: Vec2, a: Vec2, b: Vec2, c: Vec2): boolean {
  const d1 = cross(a, b, p);
  const d2 = cross(b, c, p);
  const d3 = cross(c, a, p);
  const neg = d1 < -1e-9 || d2 < -1e-9 || d3 < -1e-9;
  const pos = d1 > 1e-9 || d2 > 1e-9 || d3 > 1e-9;
  return !(neg && pos);
}

export function pointInPolygon(p: Vec2, points: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
    const a = points[i], b = points[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y || 1e-12) + a.x) inside = !inside;
  }
  return inside;
}

/**
 * Ear-clipping triangulation of a simple polygon (concave allowed).
 * Returns triangle corner indices into `points` (CCW). A polygon that
 * cannot be fully clipped (self-intersecting) falls back to a fan, so a
 * caller can still draw it — the checks report the failure separately.
 */
export function triangulate(points: Vec2[]): number[] {
  const pts = dedupe(points);
  if (pts.length < 3) return [];
  const idx = pts.map((_, i) => i);
  const flip = signedArea(pts) < 0;
  if (flip) idx.reverse();
  const out: number[] = [];
  let guard = 0;
  while (idx.length > 3 && guard < 20_000) {
    guard += 1;
    let clipped = false;
    for (let i = 0; i < idx.length; i += 1) {
      const a = idx[(i + idx.length - 1) % idx.length];
      const b = idx[i];
      const c = idx[(i + 1) % idx.length];
      if (cross(pts[a], pts[b], pts[c]) <= 1e-9) continue;
      let blocked = false;
      for (const j of idx) {
        if (j === a || j === b || j === c) continue;
        if (pointInTriangle(pts[j], pts[a], pts[b], pts[c])) { blocked = true; break; }
      }
      if (blocked) continue;
      out.push(a, b, c);
      idx.splice(i, 1);
      clipped = true;
      break;
    }
    if (!clipped) break;
  }
  if (idx.length === 3) out.push(idx[0], idx[1], idx[2]);
  else if (out.length === 0) {
    for (let i = 1; i < pts.length - 1; i += 1) out.push(0, i, i + 1);
  }
  return out;
}

/**
 * Outward offset of a simple polygon — the seam allowance.
 * `fixed` vertices (index set) are left untouched: an edge that is cut
 * on a fold carries no allowance. Miter joins are clamped to 4× the
 * offset so a sharp corner cannot explode the outline.
 */
export function offsetPolygon(points: Vec2[], distance: number, fixed: Set<number> = new Set()): Vec2[] {
  const pts = dedupe(points);
  if (!distance) return pts.map((p) => ({ ...p }));
  const n = pts.length;
  const ccw = signedArea(pts) >= 0;
  const s = ccw ? 1 : -1;
  const out: Vec2[] = [];
  for (let i = 0; i < n; i += 1) {
    const prev = pts[(i - 1 + n) % n], cur = pts[i], next = pts[(i + 1) % n];
    if (fixed.has(i)) { out.push({ ...cur }); continue; }
    const l1 = Math.hypot(cur.x - prev.x, cur.y - prev.y) || 1;
    const l2 = Math.hypot(next.x - cur.x, next.y - cur.y) || 1;
    const n1 = { x: ((cur.y - prev.y) / l1) * s, y: (-(cur.x - prev.x) / l1) * s };
    const n2 = { x: ((next.y - cur.y) / l2) * s, y: (-(next.x - cur.x) / l2) * s };
    let bx = n1.x + n2.x, by = n1.y + n2.y;
    const bl = Math.hypot(bx, by);
    if (bl < 1e-6) { bx = n1.x; by = n1.y; } else { bx /= bl; by /= bl; }
    const cosHalf = bx * n1.x + by * n1.y;
    const miter = Math.min(distance / Math.max(0.2, cosHalf), distance * 4);
    out.push({ x: cur.x + bx * miter, y: cur.y + by * miter });
  }
  return out;
}

/** True when two non-adjacent segments cross (a self-intersecting outline). */
export function selfIntersects(points: Vec2[], limit = 400): boolean {
  const pts = dedupe(points);
  if (pts.length > limit) return false; // bounded check; large outlines are reported as unchecked
  const seg = (a: Vec2, b: Vec2, c: Vec2, d: Vec2) => {
    const o = (p: Vec2, q: Vec2, r: Vec2) => Math.sign(cross(p, q, r));
    const o1 = o(a, b, c), o2 = o(a, b, d), o3 = o(c, d, a), o4 = o(c, d, b);
    return o1 !== o2 && o3 !== o4 && o1 !== 0 && o2 !== 0 && o3 !== 0 && o4 !== 0;
  };
  for (let i = 0; i < pts.length; i += 1) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    for (let j = i + 2; j < pts.length; j += 1) {
      if (i === 0 && j === pts.length - 1) continue;
      if (seg(a, b, pts[j], pts[(j + 1) % pts.length])) return true;
    }
  }
  return false;
}

/* ---------------- polylines ---------------- */

export interface Sample { p: Vec2; t: number }

/** Even samples along a closed or open polyline, `count` points including both ends. */
export function samplePolyline(points: Vec2[], count: number, closed = false): Vec2[] {
  const pts = closed ? [...points, points[0]] : points;
  const lengths: number[] = [0];
  for (let i = 1; i < pts.length; i += 1) lengths.push(lengths[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  const total = lengths[lengths.length - 1];
  const n = Math.max(2, count);
  const out: Vec2[] = [];
  for (let k = 0; k < n; k += 1) {
    const target = (total * k) / (n - 1);
    let i = 1;
    while (i < lengths.length - 1 && lengths[i] < target) i += 1;
    const span = lengths[i] - lengths[i - 1] || 1;
    const f = (target - lengths[i - 1]) / span;
    out.push({ x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * f, y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * f });
  }
  return out;
}

/* ---------------- triangle meshes ---------------- */

export function meshNormals(positions: number[], indices: number[]): number[] {
  const normals = new Array<number>(positions.length).fill(0);
  for (let t = 0; t < indices.length; t += 3) {
    const ia = indices[t] * 3, ib = indices[t + 1] * 3, ic = indices[t + 2] * 3;
    const ux = positions[ib] - positions[ia], uy = positions[ib + 1] - positions[ia + 1], uz = positions[ib + 2] - positions[ia + 2];
    const vx = positions[ic] - positions[ia], vy = positions[ic + 1] - positions[ia + 1], vz = positions[ic + 2] - positions[ia + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const i of [ia, ib, ic]) { normals[i] += nx; normals[i + 1] += ny; normals[i + 2] += nz; }
  }
  for (let i = 0; i < normals.length; i += 3) {
    const l = Math.hypot(normals[i], normals[i + 1], normals[i + 2]) || 1;
    normals[i] /= l; normals[i + 1] /= l; normals[i + 2] /= l;
  }
  return normals;
}

export function triCount(mesh: Mesh): number {
  return mesh.indices.length / 3;
}

export function meshBounds(meshes: Mesh[]): { min: Vec3; max: Vec3 } {
  const min = v3(Infinity, Infinity, Infinity), max = v3(-Infinity, -Infinity, -Infinity);
  for (const m of meshes) for (let i = 0; i < m.positions.length; i += 3) {
    min.x = Math.min(min.x, m.positions[i]); max.x = Math.max(max.x, m.positions[i]);
    min.y = Math.min(min.y, m.positions[i + 1]); max.y = Math.max(max.y, m.positions[i + 1]);
    min.z = Math.min(min.z, m.positions[i + 2]); max.z = Math.max(max.z, m.positions[i + 2]);
  }
  return { min, max };
}

/** Merge meshes into one, keeping a per-source group id for every vertex. */
export function mergeMeshes(meshes: Mesh[]): { mesh: Mesh; groups: Array<{ owner: number; from: number; to: number }> } {
  const positions: number[] = [];
  const indices: number[] = [];
  const groups: Array<{ owner: number; from: number; to: number }> = [];
  meshes.forEach((m, owner) => {
    const base = positions.length / 3;
    const from = base;
    for (const p of m.positions) positions.push(p);
    for (const i of m.indices) indices.push(i + base);
    groups.push({ owner, from, to: positions.length / 3 - 1 });
  });
  return { mesh: { positions, indices, normals: meshNormals(positions, indices) }, groups };
}

/** Millimetres, z-up → scene metres, y-up (three.js / glTF). */
export function meshToScene(mesh: Mesh): Mesh {
  const positions: number[] = new Array(mesh.positions.length);
  for (let i = 0; i < mesh.positions.length; i += 3) {
    positions[i] = mesh.positions[i] / 1000;
    positions[i + 1] = mesh.positions[i + 2] / 1000;
    positions[i + 2] = -mesh.positions[i + 1] / 1000;
  }
  return { positions, indices: [...mesh.indices], normals: meshNormals(positions, mesh.indices) };
}

/** Area of a mesh's surface, mm². */
export function surfaceArea(mesh: Mesh): number {
  let a = 0;
  for (let t = 0; t < mesh.indices.length; t += 3) {
    const p = mesh.positions;
    const ia = mesh.indices[t] * 3, ib = mesh.indices[t + 1] * 3, ic = mesh.indices[t + 2] * 3;
    const ux = p[ib] - p[ia], uy = p[ib + 1] - p[ia + 1], uz = p[ib + 2] - p[ia + 2];
    const vx = p[ic] - p[ia], vy = p[ic + 1] - p[ia + 1], vz = p[ic + 2] - p[ia + 2];
    a += Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2;
  }
  return a;
}

/** A deterministic, seedable PRNG — no Math.random anywhere in this engine. */
export function rng(seed: number): () => number {
  let s = (seed || 1) >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
