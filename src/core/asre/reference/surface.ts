/**
 * ==========================================================
 * LÉLU ASRE — EXPLICIT SURFACES
 *
 * The render mesh of a reference component used to be re-derived from a
 * distance field: the CC0 body was turned into a 3 mm SDF and re-meshed with
 * surface nets. That throws away the asset's real topology and replaces it
 * with grid-aligned contour terraces, rounds every crease (eyelids, lips,
 * finger gaps) into the cell size, and caps each anatomical region with a
 * flat wall where it was clipped — so the body read as a stack of separate
 * solids instead of one person.
 *
 * An explicit surface keeps the asset's own triangles. Occupancy is still
 * the region's distance field sampled on the shared lattice (so every
 * cell-indexed invariant is unchanged); only the mesh a viewer sees is the
 * real one, subdivided and smooth-shaded across region boundaries.
 * ==========================================================
 */
import type { Mesh } from "../volume/mesh.ts";

/** A per-vertex attribute carried through subdivision (positions, rest positions, parameters…). */
export interface Attr {
  data: Float32Array;
  stride: number;
}

/**
 * One level of Loop subdivision (Loop 1987, Warren's β), with the standard
 * crease rule on open boundaries. Every attribute is subdivided with the
 * same linear weights, so anything stored per vertex — rest positions,
 * garment coordinates — stays consistent with the refined positions.
 */
export function loopSubdivideOnce(indices: Uint32Array, attrs: Attr[]): { indices: Uint32Array; attrs: Attr[] } {
  let nv = 0;
  for (const i of indices) if (i + 1 > nv) nv = i + 1;
  const N = nv + 1;
  const edgeId = new Map<number, number>();
  const edgeA: number[] = [], edgeB: number[] = [], opp1: number[] = [], opp2: number[] = [];
  const key = (a: number, b: number) => (a < b ? a * N + b : b * N + a);
  const triEdges = new Uint32Array(indices.length);
  for (let t = 0; t < indices.length; t += 3)
    for (let k = 0; k < 3; k++) {
      const a = indices[t + k], b = indices[t + ((k + 1) % 3)], c = indices[t + ((k + 2) % 3)];
      const kk = key(a, b);
      let e = edgeId.get(kk);
      if (e === undefined) {
        e = edgeA.length;
        edgeId.set(kk, e);
        edgeA.push(a);
        edgeB.push(b);
        opp1.push(c);
        opp2.push(-1);
      } else opp2[e] = c;
      triEdges[t + k] = e;
    }
  const ne = edgeA.length;
  // neighbours and boundary neighbours of every old vertex
  const deg = new Uint32Array(nv), bdeg = new Uint32Array(nv);
  const bn = new Int32Array(nv * 2).fill(-1);
  for (let e = 0; e < ne; e++) {
    const a = edgeA[e], b = edgeB[e];
    deg[a]++;
    deg[b]++;
    if (opp2[e] < 0) {
      bn[2 * a + (bdeg[a] ? 1 : 0)] = b;
      bn[2 * b + (bdeg[b] ? 1 : 0)] = a;
      bdeg[a]++;
      bdeg[b]++;
    }
  }
  const out: Attr[] = [];
  for (const at of attrs) {
    const s = at.stride, src = at.data;
    const dst = new Float32Array((nv + ne) * s);
    // old vertices
    const sum = new Float64Array(nv * s);
    for (let e = 0; e < ne; e++) {
      const a = edgeA[e], b = edgeB[e];
      for (let c = 0; c < s; c++) {
        sum[a * s + c] += src[b * s + c];
        sum[b * s + c] += src[a * s + c];
      }
    }
    for (let v = 0; v < nv; v++) {
      if (bdeg[v] >= 2) {
        const p = bn[2 * v], q = bn[2 * v + 1];
        for (let c = 0; c < s; c++) dst[v * s + c] = 0.75 * src[v * s + c] + 0.125 * (src[p * s + c] + src[q * s + c]);
      } else if (deg[v] > 0 && bdeg[v] === 0) {
        const n = deg[v];
        const beta = n === 3 ? 3 / 16 : 3 / (8 * n);
        for (let c = 0; c < s; c++) dst[v * s + c] = (1 - n * beta) * src[v * s + c] + beta * sum[v * s + c];
      } else for (let c = 0; c < s; c++) dst[v * s + c] = src[v * s + c];
    }
    // edge vertices
    for (let e = 0; e < ne; e++) {
      const a = edgeA[e], b = edgeB[e], o = (nv + e) * s;
      if (opp2[e] < 0) for (let c = 0; c < s; c++) dst[o + c] = 0.5 * (src[a * s + c] + src[b * s + c]);
      else {
        const p = opp1[e], q = opp2[e];
        for (let c = 0; c < s; c++) dst[o + c] = 0.375 * (src[a * s + c] + src[b * s + c]) + 0.125 * (src[p * s + c] + src[q * s + c]);
      }
    }
    out.push({ data: dst, stride: s });
  }
  const idx = new Uint32Array(indices.length * 4);
  let o = 0;
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t], b = indices[t + 1], c = indices[t + 2];
    const ab = nv + triEdges[t], bc = nv + triEdges[t + 1], ca = nv + triEdges[t + 2];
    idx.set([a, ab, ca, ab, b, bc, ca, bc, c, ab, bc, ca], o);
    o += 12;
  }
  return { indices: idx, attrs: out };
}

export function loopSubdivide(indices: Uint32Array, attrs: Attr[], levels: number): { indices: Uint32Array; attrs: Attr[] } {
  let r = { indices, attrs };
  for (let i = 0; i < levels; i++) r = loopSubdivideOnce(r.indices, r.attrs);
  return r;
}

/** Area-weighted vertex normals of an indexed triangle list (outward for CCW winding). */
export function smoothNormals(positions: Float32Array, indices: Uint32Array): Float32Array {
  const n = new Float32Array(positions.length);
  for (let t = 0; t < indices.length; t += 3) {
    const a = 3 * indices[t], b = 3 * indices[t + 1], c = 3 * indices[t + 2];
    const ux = positions[b] - positions[a], uy = positions[b + 1] - positions[a + 1], uz = positions[b + 2] - positions[a + 2];
    const vx = positions[c] - positions[a], vy = positions[c + 1] - positions[a + 1], vz = positions[c + 2] - positions[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const v of [a, b, c]) {
      n[v] += nx;
      n[v + 1] += ny;
      n[v + 2] += nz;
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

/**
 * The triangles of `indices` whose label is `want`, with their vertices
 * compacted. Normals are copied from the WHOLE surface, so two components
 * that share a boundary shade as one continuous skin.
 */
export function extractSubmesh(positions: Float32Array, normals: Float32Array, indices: Uint32Array, labels: Uint8Array, want: number, offset: [number, number, number] = [0, 0, 0]): Mesh {
  const remap = new Int32Array(positions.length / 3).fill(-1);
  const idx: number[] = [];
  let nv = 0;
  for (let t = 0; t < labels.length; t++) {
    if (labels[t] !== want) continue;
    for (let k = 0; k < 3; k++) {
      const v = indices[3 * t + k];
      if (remap[v] < 0) remap[v] = nv++;
      idx.push(remap[v]);
    }
  }
  const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3);
  for (let v = 0; v < remap.length; v++) {
    const r = remap[v];
    if (r < 0) continue;
    for (let a = 0; a < 3; a++) {
      pos[3 * r + a] = positions[3 * v + a] - offset[a];
      nor[3 * r + a] = normals[3 * v + a];
    }
  }
  return { positions: pos, indices: new Uint32Array(idx), normals: nor };
}

/** Count of edges used by exactly one / more than two triangles: 0/0 means closed 2-manifold. */
export function edgeStats(indices: Uint32Array): { edges: number; boundary: number; nonManifold: number } {
  const m = new Map<string, number>();
  for (let t = 0; t < indices.length; t += 3)
    for (let k = 0; k < 3; k++) {
      const a = indices[t + k], b = indices[t + ((k + 1) % 3)];
      const kk = a < b ? `${a},${b}` : `${b},${a}`;
      m.set(kk, (m.get(kk) ?? 0) + 1);
    }
  let boundary = 0, nonManifold = 0;
  for (const c of m.values()) {
    if (c === 1) boundary++;
    else if (c > 2) nonManifold++;
  }
  return { edges: m.size, boundary, nonManifold };
}
