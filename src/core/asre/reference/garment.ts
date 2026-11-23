/**
 * ==========================================================
 * LÉLU ASRE — GARMENT CONSTRUCTION
 *
 * Why the old clothing failed: each garment was the body's distance field
 * pushed out by a stand-off and cut by planes and leg capsules. A shell like
 * that has no hem (it ends in a flat cut), follows every concavity of the
 * skin (so it reads as paint), and whatever the masks missed — the front of
 * the pelvis between two leg capsules, the seat between a high-hip corset
 * cut and a waist cut — was simply bare skin.
 *
 * A garment here is made the way a pattern is: a PIECE of her own skin
 * surface is cut along a smooth hem curve, lifted off the body, relaxed so it
 * bridges the concavities a real cloth spans (gluteal cleft, cleavage, the
 * hollow of the crotch), kept outside the body by her distance field, and
 * thickened into a closed solid with rolled hems. Because the piece is cut
 * from one continuous surface, coverage is continuous by construction: the
 * crotch and seat are part of the same sheet as the thighs and waist.
 *
 * Everything is deterministic: same body + same pattern = same garment.
 * ==========================================================
 */
import type { Sdf, V3 } from "../character/sdf.ts";
import type { Mesh } from "../volume/mesh.ts";
import { smoothNormals } from "./surface.ts";

export interface Sheet {
  positions: Float32Array;
  indices: Uint32Array;
  /** Rest position on her skin of every sheet vertex (where it was cut from). */
  rest: Float32Array;
  /** Skin normal at the rest position. */
  restNormal: Float32Array;
}

/**
 * Keep the part of a surface where `g` ≤ 0, cutting triangles exactly along
 * the iso-line g = 0. Cut vertices are shared between neighbouring triangles
 * (one per cut edge), so the result has a single clean boundary curve instead
 * of the stair-step of whole-triangle selection.
 */
export function clipSurface(positions: Float32Array, normals: Float32Array, indices: Uint32Array, g: (x: number, y: number, z: number, v: number) => number, keepTri?: (t: number) => boolean): Sheet {
  const nv = positions.length / 3;
  const gv = new Float64Array(nv);
  for (let v = 0; v < nv; v++) gv[v] = g(positions[3 * v], positions[3 * v + 1], positions[3 * v + 2], v);
  const pos: number[] = [], nor: number[] = [];
  const remap = new Int32Array(nv).fill(-1);
  const cut = new Map<number, number>();
  const vtx = (v: number) => {
    if (remap[v] < 0) {
      remap[v] = pos.length / 3;
      pos.push(positions[3 * v], positions[3 * v + 1], positions[3 * v + 2]);
      nor.push(normals[3 * v], normals[3 * v + 1], normals[3 * v + 2]);
    }
    return remap[v];
  };
  const cutVtx = (a: number, b: number) => {
    const k = a < b ? a * nv + b : b * nv + a;
    let r = cut.get(k);
    if (r !== undefined) return r;
    const t = gv[a] / (gv[a] - gv[b]);
    r = pos.length / 3;
    for (let c = 0; c < 3; c++) {
      pos.push(positions[3 * a + c] + (positions[3 * b + c] - positions[3 * a + c]) * t);
      nor.push(normals[3 * a + c] + (normals[3 * b + c] - normals[3 * a + c]) * t);
    }
    cut.set(k, r);
    return r;
  };
  const idx: number[] = [];
  for (let t = 0; t < indices.length; t += 3) {
    if (keepTri && !keepTri(t / 3)) continue;
    const tri = [indices[t], indices[t + 1], indices[t + 2]];
    const ins = tri.map((v) => gv[v] <= 0);
    const n = ins.filter(Boolean).length;
    if (n === 0) continue;
    if (n === 3) {
      idx.push(vtx(tri[0]), vtx(tri[1]), vtx(tri[2]));
      continue;
    }
    // rotate so the odd-one-out is first
    let r = 0;
    for (let k = 0; k < 3; k++) if ((n === 1 && ins[k]) || (n === 2 && !ins[k])) r = k;
    const a = tri[r], b = tri[(r + 1) % 3], c = tri[(r + 2) % 3];
    if (n === 1) idx.push(vtx(a), cutVtx(a, b), cutVtx(a, c));
    else {
      const ab = cutVtx(a, b), ac = cutVtx(a, c);
      idx.push(ab, vtx(b), vtx(c), ab, vtx(c), ac);
    }
  }
  // drop slivers whose cut put two vertices on top of each other
  const P = new Float32Array(pos), N = new Float32Array(nor);
  for (let i = 0; i < N.length; i += 3) {
    const l = Math.hypot(N[i], N[i + 1], N[i + 2]) || 1;
    N[i] /= l;
    N[i + 1] /= l;
    N[i + 2] /= l;
  }
  return { positions: P.slice(), indices: new Uint32Array(idx), rest: P, restNormal: N };
}

/** Keep only the largest edge-connected piece (removes islands a cut left behind). */
export function largestPieces(sheet: Sheet, keep = 1): Sheet {
  const nv = sheet.positions.length / 3;
  const parent = new Int32Array(nv).map((_, i) => i);
  const find = (x: number): number => {
    while (parent[x] !== x) x = parent[x] = parent[parent[x]];
    return x;
  };
  const I = sheet.indices;
  for (let t = 0; t < I.length; t += 3) {
    const a = find(I[t]), b = find(I[t + 1]), c = find(I[t + 2]);
    parent[b] = a;
    parent[find(c)] = a;
  }
  const size = new Map<number, number>();
  for (let t = 0; t < I.length; t += 3) size.set(find(I[t]), (size.get(find(I[t])) ?? 0) + 1);
  const best = new Set([...size.entries()].sort((a, b) => b[1] - a[1]).slice(0, keep).map((e) => e[0]));
  const idx: number[] = [];
  for (let t = 0; t < I.length; t += 3) if (best.has(find(I[t]))) idx.push(I[t], I[t + 1], I[t + 2]);
  return compact({ ...sheet, indices: new Uint32Array(idx) });
}

function compact(s: Sheet): Sheet {
  const nv = s.positions.length / 3;
  const remap = new Int32Array(nv).fill(-1);
  let n = 0;
  for (const i of s.indices) if (remap[i] < 0) remap[i] = n++;
  const pick = (src: Float32Array) => {
    const out = new Float32Array(n * 3);
    for (let v = 0; v < nv; v++) if (remap[v] >= 0) out.set(src.subarray(3 * v, 3 * v + 3), 3 * remap[v]);
    return out;
  };
  return { positions: pick(s.positions), rest: pick(s.rest), restNormal: pick(s.restNormal), indices: s.indices.map((i) => remap[i]) };
}

/** Vertex adjacency (CSR) and the boundary flag of every vertex. */
export function adjacency(nv: number, indices: Uint32Array): { start: Uint32Array; nbr: Uint32Array; boundary: Uint8Array } {
  const edges = new Map<number, number>();
  const N = nv + 1;
  for (let t = 0; t < indices.length; t += 3)
    for (let k = 0; k < 3; k++) {
      const a = indices[t + k], b = indices[t + ((k + 1) % 3)];
      const key = a < b ? a * N + b : b * N + a;
      edges.set(key, (edges.get(key) ?? 0) + 1);
    }
  const deg = new Uint32Array(nv);
  const boundary = new Uint8Array(nv);
  for (const [key, c] of edges) {
    const a = Math.floor(key / N), b = key % N;
    deg[a]++;
    deg[b]++;
    if (c === 1) boundary[a] = boundary[b] = 1;
  }
  const start = new Uint32Array(nv + 1);
  for (let v = 0; v < nv; v++) start[v + 1] = start[v] + deg[v];
  const fill = start.slice(0, nv);
  const nbr = new Uint32Array(start[nv]);
  for (const key of edges.keys()) {
    const a = Math.floor(key / N), b = key % N;
    nbr[fill[a]++] = b;
    nbr[fill[b]++] = a;
  }
  return { start, nbr, boundary };
}

/**
 * Lift the sheet off the skin and relax it as cloth.
 *
 * Each iteration (1) moves every vertex toward the mean of its neighbours —
 * which pulls cloth OUT of concavities and so bridges them, as a real
 * garment does — and (2) pushes any vertex closer to the body than its
 * stand-off back out along the body's distance gradient. Boundary vertices
 * relax only along the hem (they keep their height) so the hem curve stays
 * where the pattern put it.
 */
export function relaxOutside(sheet: Sheet, body: Sdf, standoff: (v: number) => number, iterations: number, lambda = 0.5, constrain?: (v: number, p: Float32Array) => void): void {
  const P = sheet.positions;
  const nv = P.length / 3;
  const { start, nbr, boundary } = adjacency(nv, sheet.indices);
  const push = (v: number) => {
    const so = standoff(v);
    for (let it = 0; it < 6; it++) {
      const x = P[3 * v], y = P[3 * v + 1], z = P[3 * v + 2];
      const d = body(x, y, z);
      if (d >= so) return;
      const e = 0.002;
      let gx = body(x + e, y, z) - body(x - e, y, z), gy = body(x, y + e, z) - body(x, y - e, z), gz = body(x, y, z + e) - body(x, y, z - e);
      const l = Math.hypot(gx, gy, gz);
      if (l < 1e-9) {
        // flat spot of a sampled field: fall back to the skin normal
        gx = sheet.restNormal[3 * v];
        gy = sheet.restNormal[3 * v + 1];
        gz = sheet.restNormal[3 * v + 2];
      } else {
        gx /= l;
        gy /= l;
        gz /= l;
      }
      const s = Math.min(0.01, so - d);
      P[3 * v] += gx * s;
      P[3 * v + 1] += gy * s;
      P[3 * v + 2] += gz * s;
    }
  };
  for (let v = 0; v < nv; v++) {
    constrain?.(v, P);
    push(v);
  }
  const tmp = new Float32Array(P.length);
  for (let it = 0; it < iterations; it++) {
    for (let v = 0; v < nv; v++) {
      let sx = 0, sy = 0, sz = 0, n = 0;
      for (let k = start[v]; k < start[v + 1]; k++) {
        const u = nbr[k];
        if (boundary[v] && !boundary[u]) continue;
        sx += P[3 * u];
        sy += P[3 * u + 1];
        sz += P[3 * u + 2];
        n++;
      }
      if (!n) {
        tmp.set(P.subarray(3 * v, 3 * v + 3), 3 * v);
        continue;
      }
      const l = boundary[v] ? lambda * 0.5 : lambda;
      tmp[3 * v] = P[3 * v] + (sx / n - P[3 * v]) * l;
      tmp[3 * v + 1] = boundary[v] ? P[3 * v + 1] : P[3 * v + 1] + (sy / n - P[3 * v + 1]) * l;
      tmp[3 * v + 2] = P[3 * v + 2] + (sz / n - P[3 * v + 2]) * l;
    }
    P.set(tmp);
    for (let v = 0; v < nv; v++) {
      constrain?.(v, P);
      push(v);
    }
  }
}

/** Ordered boundary loops of an open surface (each a list of vertex ids, interior on the left). */
export function boundaryLoops(indices: Uint32Array): number[][] {
  const next = new Map<number, number>();
  const count = new Map<string, number>();
  for (let t = 0; t < indices.length; t += 3)
    for (let k = 0; k < 3; k++) {
      const a = indices[t + k], b = indices[t + ((k + 1) % 3)];
      const key = a < b ? `${a},${b}` : `${b},${a}`;
      count.set(key, (count.get(key) ?? 0) + 1);
    }
  for (let t = 0; t < indices.length; t += 3)
    for (let k = 0; k < 3; k++) {
      const a = indices[t + k], b = indices[t + ((k + 1) % 3)];
      if (count.get(a < b ? `${a},${b}` : `${b},${a}`) === 1) next.set(a, b);
    }
  const loops: number[][] = [];
  const seen = new Set<number>();
  for (const s of next.keys()) {
    if (seen.has(s)) continue;
    const loop: number[] = [];
    let v: number | undefined = s;
    while (v !== undefined && !seen.has(v)) {
      seen.add(v);
      loop.push(v);
      v = next.get(v);
    }
    loops.push(loop);
  }
  return loops;
}

/**
 * Thicken an open sheet into a CLOSED solid: the sheet is the outer face,
 * an inner face sits `thickness` inside it, and every boundary loop is
 * closed with a rolled hem (an extra ring bulging past the edge), which is
 * what gives a garment edge its weight instead of a knife-cut.
 */
export function thicken(positions: Float32Array, indices: Uint32Array, thickness: number, hemBulge = 0.6): Mesh {
  const nv = positions.length / 3;
  const n = smoothNormals(positions, indices);
  const loops = boundaryLoops(indices);
  const hemCount = loops.reduce((a, l) => a + l.length, 0);
  const P = new Float32Array((2 * nv + hemCount) * 3);
  P.set(positions);
  for (let v = 0; v < nv; v++) for (let c = 0; c < 3; c++) P[3 * (nv + v) + c] = positions[3 * v + c] - n[3 * v + c] * thickness;
  const idx: number[] = Array.from(indices);
  for (let t = 0; t < indices.length; t += 3) idx.push(nv + indices[t], nv + indices[t + 2], nv + indices[t + 1]);
  let h = 2 * nv;
  for (const loop of loops) {
    const m = loop.length;
    const ring: number[] = [];
    for (let i = 0; i < m; i++) {
      const v = loop[i], a = loop[(i + m - 1) % m], b = loop[(i + 1) % m];
      // the hem bulges outward across the edge: along (tangent × normal)
      const tx = positions[3 * b] - positions[3 * a], ty = positions[3 * b + 1] - positions[3 * a + 1], tz = positions[3 * b + 2] - positions[3 * a + 2];
      const nx = n[3 * v], ny = n[3 * v + 1], nz = n[3 * v + 2];
      let ox = ty * nz - tz * ny, oy = tz * nx - tx * nz, oz = tx * ny - ty * nx;
      const l = Math.hypot(ox, oy, oz) || 1;
      ox /= l;
      oy /= l;
      oz /= l;
      for (let c = 0; c < 3; c++) P[3 * h + c] = positions[3 * v + c] - n[3 * v + c] * thickness * 0.5 + [ox, oy, oz][c] * thickness * hemBulge;
      ring.push(h++);
    }
    for (let i = 0; i < m; i++) {
      const j = (i + 1) % m;
      const o0 = loop[i], o1 = loop[j], i0 = nv + loop[i], i1 = nv + loop[j], h0 = ring[i], h1 = ring[j];
      // outer → hem → inner, wound so the faces point away from the cloth
      idx.push(o0, h0, o1, o1, h0, h1, h0, i0, h1, h1, i0, i1);
    }
  }
  const out = new Float32Array(P.subarray(0, 3 * h));
  const I = new Uint32Array(idx);
  return { positions: out, indices: I, normals: smoothNormals(out, I) };
}

/** Concatenate meshes (positions, normals, colours if all have them). */
export function mergeMeshes(meshes: Mesh[]): Mesh {
  let nv = 0, ni = 0;
  for (const m of meshes) [nv, ni] = [nv + m.positions.length, ni + m.indices.length];
  const positions = new Float32Array(nv), normals = new Float32Array(nv), indices = new Uint32Array(ni);
  const withColors = meshes.every((m) => m.colors);
  const colors = withColors ? new Float32Array((nv / 3) * 4) : undefined;
  let ov = 0, oi = 0, oc = 0;
  for (const m of meshes) {
    positions.set(m.positions, ov);
    normals.set(m.normals ?? smoothNormals(m.positions, m.indices), ov);
    for (let i = 0; i < m.indices.length; i++) indices[oi + i] = m.indices[i] + ov / 3;
    if (colors && m.colors) colors.set(m.colors, oc);
    ov += m.positions.length;
    oi += m.indices.length;
    oc += m.colors?.length ?? 0;
  }
  return { positions, indices, normals, ...(colors ? { colors } : {}) };
}

export const v3 = {
  add: (a: V3, b: V3, k = 1): V3 => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k],
  sub: (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  dot: (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  len: (a: V3) => Math.hypot(a[0], a[1], a[2]),
  unit: (a: V3): V3 => {
    const l = Math.hypot(a[0], a[1], a[2]) || 1;
    return [a[0] / l, a[1] / l, a[2] / l];
  },
  cross: (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
};
