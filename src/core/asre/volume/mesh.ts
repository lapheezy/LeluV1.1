/**
 * ==========================================================
 * LÉLU ASRE — MESHING
 *
 *   voxelFaceMesh   exact: one quad per exposed cell face, shared
 *                   corners welded. Watertight for any voxel set.
 *   surfaceNets     smooth: one vertex per sign-changing cube at the
 *                   mean of its edge crossings, one quad per crossing
 *                   edge (Gibson 1998, "naive surface nets").
 *
 * Both return indexed triangles in WORLD coordinates of the grid's
 * coordinate system, with outward (counter-clockwise) winding — the
 * tests check the signed volume is positive, not just "a mesh came out".
 * ==========================================================
 */

import { mortonDecode } from "../nre/morton.ts";
import type { SparseVoxelGrid } from "../nre/SparseVoxelGrid.ts";
import type { Vec3 } from "../nre/types.ts";

export interface Mesh {
  positions: Float32Array;
  indices: Uint32Array;
  normals?: Float32Array;
  /** RGBA per vertex, 0..1. */
  colors?: Float32Array;
}

/* ------------------------------- voxel faces ------------------------------- */

const FACES: Array<{ n: Vec3; corners: Vec3[] }> = [
  { n: [1, 0, 0], corners: [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]] },
  { n: [-1, 0, 0], corners: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]] },
  { n: [0, 1, 0], corners: [[0, 1, 0], [0, 1, 1], [1, 1, 1], [1, 1, 0]] },
  { n: [0, -1, 0], corners: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]] },
  { n: [0, 0, 1], corners: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]] },
  { n: [0, 0, -1], corners: [[0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0]] },
];

export function voxelFaceMesh(grid: SparseVoxelGrid, colorOf?: (x: number, y: number, z: number) => [number, number, number, number]): Mesh {
  const pos: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const weld = new Map<string, number>();
  const { origin, resolution } = grid.spec;
  const vert = (x: number, y: number, z: number, c?: number[]) => {
    const key = c ? `${x},${y},${z},${c.join(",")}` : `${x},${y},${z}`;
    let i = weld.get(key);
    if (i === undefined) {
      i = pos.length / 3;
      pos.push(origin[0] + x * resolution, origin[1] + y * resolution, origin[2] + z * resolution);
      if (c) col.push(...c);
      weld.set(key, i);
    }
    return i;
  };
  for (const code of grid.codes()) {
    const [x, y, z] = mortonDecode(code);
    const c = colorOf?.(x, y, z);
    for (const f of FACES) {
      if (grid.has(x + f.n[0], y + f.n[1], z + f.n[2])) continue;
      const q = f.corners.map(([a, b, d]) => vert(x + a, y + b, z + d, c));
      idx.push(q[0], q[1], q[2], q[0], q[2], q[3]);
    }
  }
  const mesh: Mesh = { positions: new Float32Array(pos), indices: new Uint32Array(idx) };
  if (colorOf) mesh.colors = new Float32Array(col);
  mesh.normals = vertexNormals(mesh);
  return mesh;
}

/* ------------------------------- surface nets ------------------------------- */

export interface ScalarField {
  /** Samples at grid points, x-major: index = (x * ny + y) * nz + z. Negative = inside. */
  values: Float32Array | Float64Array;
  dims: Vec3;
  /** World position of sample (0,0,0). */
  origin: Vec3;
  spacing: number;
}

export function surfaceNets(field: ScalarField, iso = 0): Mesh {
  const [nx, ny, nz] = field.dims;
  const f = field.values;
  const at = (x: number, y: number, z: number) => f[(x * ny + y) * nz + z] - iso;
  const cubeVert = new Int32Array((nx - 1) * (ny - 1) * (nz - 1)).fill(-1);
  const cIdx = (x: number, y: number, z: number) => (x * (ny - 1) + y) * (nz - 1) + z;
  const pos: number[] = [];
  const EDGES: Array<[Vec3, Vec3]> = [];
  for (const [a, b] of [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]]) {
    const ca: Vec3 = [a & 1, (a >> 1) & 1, (a >> 2) & 1];
    const cb: Vec3 = [b & 1, (b >> 1) & 1, (b >> 2) & 1];
    EDGES.push([ca, cb]);
  }
  for (let x = 0; x < nx - 1; x++)
    for (let y = 0; y < ny - 1; y++)
      for (let z = 0; z < nz - 1; z++) {
        let inside = 0;
        for (let k = 0; k < 8; k++) if (at(x + (k & 1), y + ((k >> 1) & 1), z + ((k >> 2) & 1)) < 0) inside++;
        if (inside === 0 || inside === 8) continue;
        let sx = 0, sy = 0, sz = 0, n = 0;
        for (const [ca, cb] of EDGES) {
          const va = at(x + ca[0], y + ca[1], z + ca[2]);
          const vb = at(x + cb[0], y + cb[1], z + cb[2]);
          if (va < 0 === vb < 0) continue;
          const t = va / (va - vb);
          sx += ca[0] + t * (cb[0] - ca[0]);
          sy += ca[1] + t * (cb[1] - ca[1]);
          sz += ca[2] + t * (cb[2] - ca[2]);
          n++;
        }
        cubeVert[cIdx(x, y, z)] = pos.length / 3;
        pos.push(
          field.origin[0] + (x + sx / n) * field.spacing,
          field.origin[1] + (y + sy / n) * field.spacing,
          field.origin[2] + (z + sz / n) * field.spacing,
        );
      }
  const idx: number[] = [];
  const quad = (a: number, b: number, c: number, d: number, flip: boolean) => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return;
    if (flip) idx.push(a, d, c, a, c, b);
    else idx.push(a, b, c, a, c, d);
  };
  for (let x = 0; x < nx; x++)
    for (let y = 0; y < ny; y++)
      for (let z = 0; z < nz; z++) {
        const v0 = at(x, y, z) < 0;
        // edge along +x: the 4 cubes around it vary in y,z
        if (x < nx - 1 && y > 0 && z > 0 && y < ny - 1 && z < nz - 1 && v0 !== at(x + 1, y, z) < 0)
          quad(cubeVert[cIdx(x, y - 1, z - 1)], cubeVert[cIdx(x, y, z - 1)], cubeVert[cIdx(x, y, z)], cubeVert[cIdx(x, y - 1, z)], !v0);
        if (y < ny - 1 && x > 0 && z > 0 && x < nx - 1 && z < nz - 1 && v0 !== at(x, y + 1, z) < 0)
          quad(cubeVert[cIdx(x - 1, y, z - 1)], cubeVert[cIdx(x - 1, y, z)], cubeVert[cIdx(x, y, z)], cubeVert[cIdx(x, y, z - 1)], !v0);
        if (z < nz - 1 && x > 0 && y > 0 && x < nx - 1 && y < ny - 1 && v0 !== at(x, y, z + 1) < 0)
          quad(cubeVert[cIdx(x - 1, y - 1, z)], cubeVert[cIdx(x, y - 1, z)], cubeVert[cIdx(x, y, z)], cubeVert[cIdx(x - 1, y, z)], !v0);
      }
  const mesh: Mesh = { positions: new Float32Array(pos), indices: new Uint32Array(idx) };
  mesh.normals = vertexNormals(mesh);
  return mesh;
}

/* --------------------------------- analysis --------------------------------- */

export function vertexNormals(mesh: Mesh): Float32Array {
  const p = mesh.positions, ix = mesh.indices;
  const n = new Float32Array(p.length);
  for (let i = 0; i < ix.length; i += 3) {
    const a = ix[i] * 3, b = ix[i + 1] * 3, c = ix[i + 2] * 3;
    const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
    const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const k of [a, b, c]) {
      n[k] += nx;
      n[k + 1] += ny;
      n[k + 2] += nz;
    }
  }
  for (let i = 0; i < n.length; i += 3) {
    const l = Math.hypot(n[i], n[i + 1], n[i + 2]) || 1;
    n[i] /= l;
    n[i + 1] /= l;
    n[i + 2] /= l;
  }
  return n;
}

export interface MeshReport {
  vertices: number;
  triangles: number;
  degenerateTriangles: number;
  /** Every undirected edge is shared by exactly two triangles. */
  watertight: boolean;
  /** Every directed edge appears once (neighbouring triangles agree on winding). */
  consistentlyOriented: boolean;
  boundaryEdges: number;
  nonManifoldEdges: number;
  /** Signed volume (m³ in world units); positive = outward winding. */
  signedVolume: number;
  bounds: { min: Vec3; max: Vec3 };
}

export function analyzeMesh(mesh: Mesh): MeshReport {
  const p = mesh.positions, ix = mesh.indices;
  const undirected = new Map<string, number>();
  const directed = new Set<string>();
  let dup = false;
  let degenerate = 0;
  let vol = 0;
  for (let i = 0; i < ix.length; i += 3) {
    const t = [ix[i], ix[i + 1], ix[i + 2]];
    if (t[0] === t[1] || t[1] === t[2] || t[0] === t[2]) degenerate++;
    const [a, b, c] = t.map((v) => v * 3);
    vol += (p[a] * (p[b + 1] * p[c + 2] - p[b + 2] * p[c + 1]) - p[a + 1] * (p[b] * p[c + 2] - p[b + 2] * p[c]) + p[a + 2] * (p[b] * p[c + 1] - p[b + 1] * p[c])) / 6;
    for (let e = 0; e < 3; e++) {
      const u = t[e], v = t[(e + 1) % 3];
      const key = u < v ? `${u}_${v}` : `${v}_${u}`;
      undirected.set(key, (undirected.get(key) ?? 0) + 1);
      const d = `${u}>${v}`;
      if (directed.has(d)) dup = true;
      directed.add(d);
    }
  }
  let boundary = 0, nonManifold = 0;
  for (const n of undirected.values()) {
    if (n === 1) boundary++;
    else if (n > 2) nonManifold++;
  }
  const min: Vec3 = [Infinity, Infinity, Infinity], max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < p.length; i += 3)
    for (let a = 0; a < 3; a++) {
      if (p[i + a] < min[a]) min[a] = p[i + a];
      if (p[i + a] > max[a]) max[a] = p[i + a];
    }
  return {
    vertices: p.length / 3,
    triangles: ix.length / 3,
    degenerateTriangles: degenerate,
    watertight: boundary === 0 && nonManifold === 0 && ix.length > 0,
    consistentlyOriented: !dup,
    boundaryEdges: boundary,
    nonManifoldEdges: nonManifold,
    signedVolume: vol,
    bounds: { min, max },
  };
}

/** Rasterize a closed mesh's interior onto a grid's lattice by parity ray casting along +x (cell centres). */
export function voxelizeMesh(mesh: Mesh, contains: (x: number, y: number, z: number) => boolean, dims: Vec3, origin: Vec3, resolution: number): Vec3[] {
  const p = mesh.positions, ix = mesh.indices;
  const out: Vec3[] = [];
  // bucket triangles by the (y,z) cells their bbox covers
  const buckets = new Map<number, number[]>();
  for (let i = 0; i < ix.length; i += 3) {
    let y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (let k = 0; k < 3; k++) {
      const v = ix[i + k] * 3;
      y0 = Math.min(y0, p[v + 1]); y1 = Math.max(y1, p[v + 1]);
      z0 = Math.min(z0, p[v + 2]); z1 = Math.max(z1, p[v + 2]);
    }
    const jy0 = Math.max(0, Math.floor((y0 - origin[1]) / resolution - 0.5)), jy1 = Math.min(dims[1] - 1, Math.ceil((y1 - origin[1]) / resolution - 0.5));
    const jz0 = Math.max(0, Math.floor((z0 - origin[2]) / resolution - 0.5)), jz1 = Math.min(dims[2] - 1, Math.ceil((z1 - origin[2]) / resolution - 0.5));
    for (let y = jy0; y <= jy1; y++) for (let z = jz0; z <= jz1; z++) {
      const key = y * dims[2] + z;
      let b = buckets.get(key);
      if (!b) buckets.set(key, (b = []));
      b.push(i);
    }
  }
  for (const [key, tris] of buckets) {
    const y = Math.floor(key / dims[2]), z = key % dims[2];
    // tiny irrational offset avoids rays grazing shared edges/vertices exactly
    const cy = origin[1] + (y + 0.5) * resolution + resolution * 1.234e-5;
    const cz = origin[2] + (z + 0.5) * resolution + resolution * 2.345e-5;
    const hits: number[] = [];
    for (const i of tris) {
      const a = ix[i] * 3, b = ix[i + 1] * 3, c = ix[i + 2] * 3;
      // 2D barycentric in (y,z)
      const d = (p[b + 1] - p[a + 1]) * (p[c + 2] - p[a + 2]) - (p[c + 1] - p[a + 1]) * (p[b + 2] - p[a + 2]);
      if (Math.abs(d) < 1e-18) continue;
      const u = ((cy - p[a + 1]) * (p[c + 2] - p[a + 2]) - (p[c + 1] - p[a + 1]) * (cz - p[a + 2])) / d;
      const v = ((p[b + 1] - p[a + 1]) * (cz - p[a + 2]) - (cy - p[a + 1]) * (p[b + 2] - p[a + 2])) / d;
      if (u < 0 || v < 0 || u + v > 1) continue;
      hits.push(p[a] + u * (p[b] - p[a]) + v * (p[c] - p[a]));
    }
    hits.sort((m, n) => m - n);
    for (let h = 0; h + 1 < hits.length; h += 2) {
      const x0 = Math.ceil((hits[h] - origin[0]) / resolution - 0.5), x1 = Math.floor((hits[h + 1] - origin[0]) / resolution - 0.5);
      for (let x = Math.max(0, x0); x <= Math.min(dims[0] - 1, x1); x++) if (contains(x, y, z)) out.push([x, y, z]);
    }
  }
  return out;
}


/** Concatenate meshes (indices re-based). */
export function mergeMeshes(meshes: Mesh[]): Mesh {
  let nv = 0, ni = 0;
  for (const m of meshes) {
    nv += m.positions.length;
    ni += m.indices.length;
  }
  const positions = new Float32Array(nv), normals = new Float32Array(nv), indices = new Uint32Array(ni);
  let ov = 0, oi = 0;
  for (const m of meshes) {
    positions.set(m.positions, ov);
    normals.set(m.normals ?? vertexNormals(m), ov);
    for (let i = 0; i < m.indices.length; i++) indices[oi + i] = m.indices[i] + ov / 3;
    ov += m.positions.length;
    oi += m.indices.length;
  }
  return { positions, normals, indices };
}
