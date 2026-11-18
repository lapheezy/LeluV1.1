/**
 * ==========================================================
 * LÉLU ASRE — MESH TO SIGNED-DISTANCE FIELD
 *
 * Turns a triangle mesh into the only thing LÉLU's builders understand: a
 * signed distance function with bounds. That is the bridge that lets real
 * reference anatomy enter her SDF pipeline — the same surface nets, the same
 * shared lattice, the same occupancy cells, the same component keys.
 *
 * Exact point-triangle distance in a narrow band, ray-parity inside/outside
 * over the whole grid, then a BFS fill for the far field. O(triangles × cells
 * in band), not O(cells × triangles).
 * ==========================================================
 */
import type { Rgb } from "../character/shape.ts";
import type { Shape } from "../character/shape.ts";
import type { Sdf, V3 } from "../character/sdf.ts";

export interface SdfField {
  /** Cell size (metres). */
  h: number;
  /** Centre of cell (0,0,0), metres. */
  origin: V3;
  dims: [number, number, number];
  /** Signed distance, negative inside. NaN never survives construction. */
  values: Float32Array;
  /** Bounds that contain the whole grid. */
  lo: V3;
  hi: V3;
  /** Band width in cells: inside it values are exact. */
  band: number;
}

/** Squared distance from p to triangle (a,b,c), plus the closest point. */
function pointTriangle(px: number, py: number, pz: number, ax: number, ay: number, az: number, bx: number, by: number, bz: number, cx: number, cy: number, cz: number): number {
  const abx = bx - ax, aby = by - ay, abz = bz - az;
  const acx = cx - ax, acy = cy - ay, acz = cz - az;
  const apx = px - ax, apy = py - ay, apz = pz - az;
  const d1 = abx * apx + aby * apy + abz * apz;
  const d2 = acx * apx + acy * apy + acz * apz;
  if (d1 <= 0 && d2 <= 0) return apx * apx + apy * apy + apz * apz;
  const bpx = px - bx, bpy = py - by, bpz = pz - bz;
  const d3 = abx * bpx + aby * bpy + abz * bpz;
  const d4 = acx * bpx + acy * bpy + acz * bpz;
  if (d3 >= 0 && d4 <= d3) return bpx * bpx + bpy * bpy + bpz * bpz;
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const v = d1 / (d1 - d3);
    const qx = apx - abx * v, qy = apy - aby * v, qz = apz - abz * v;
    return qx * qx + qy * qy + qz * qz;
  }
  const cpx = px - cx, cpy = py - cy, cpz = pz - cz;
  const d5 = abx * cpx + aby * cpy + abz * cpz;
  const d6 = acx * cpx + acy * cpy + acz * cpz;
  if (d6 >= 0 && d5 <= d6) return cpx * cpx + cpy * cpy + cpz * cpz;
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const w = d2 / (d2 - d6);
    const qx = apx - acx * w, qy = apy - acy * w, qz = apz - acz * w;
    return qx * qx + qy * qy + qz * qz;
  }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const w = (d4 - d3) / (d4 - d3 + (d5 - d6));
    const qx = bpx + (cx - bx) * w, qy = bpy + (cy - by) * w, qz = bpz + (cz - bz) * w;
    return qx * qx + qy * qy + qz * qz;
  }
  const denom = 1 / (va + vb + vc);
  const v = vb * denom, w = vc * denom;
  const qx = apx - abx * v - acx * w, qy = apy - aby * v - acy * w, qz = apz - abz * v - acz * w;
  return qx * qx + qy * qy + qz * qz;
}

/**
 * Sample a triangle mesh onto a regular grid of signed distances.
 *
 * `band` is in cells. Inside the band the value is the exact euclidean
 * distance to the nearest triangle, signed by that triangle's normal; outside
 * it the sign is the exact inside/outside from a +Z ray parity test and the
 * magnitude is a conservative fill. Surface nets only reads crossings, so the
 * band is what matters; occupancy only needs the sign, which is exact.
 */
export function fieldFromMesh(positions: Float32Array, indices: Uint32Array, h: number, band = 3, pad = 4, window?: { lo: V3; hi: V3 }): SdfField {
  const nv = positions.length / 3;
  let lox = Infinity, loy = Infinity, loz = Infinity, hix = -Infinity, hiy = -Infinity, hiz = -Infinity;
  for (let i = 0; i < nv; i++) {
    const x = positions[3 * i], y = positions[3 * i + 1], z = positions[3 * i + 2];
    if (x < lox) lox = x; if (y < loy) loy = y; if (z < loz) loz = z;
    if (x > hix) hix = x; if (y > hiy) hiy = y; if (z > hiz) hiz = z;
  }
  if (window) {
    lox = Math.max(lox, window.lo[0]); loy = Math.max(loy, window.lo[1]); loz = Math.max(loz, window.lo[2]);
    hix = Math.min(hix, window.hi[0]); hiy = Math.min(hiy, window.hi[1]); hiz = Math.min(hiz, window.hi[2]);
  }
  const margin = (pad + band + 1) * h;
  const origin: V3 = [lox - margin + h / 2, loy - margin + h / 2, loz - margin + h / 2];
  const nx = Math.ceil((hix - lox + 2 * margin) / h) + 1;
  const ny = Math.ceil((hiy - loy + 2 * margin) / h) + 1;
  const nz = Math.ceil((hiz - loz + 2 * margin) / h) + 1;
  const dims: [number, number, number] = [nx, ny, nz];
  const n = nx * ny * nz;
  const values = new Float32Array(n).fill(NaN);

  // ---- narrow band: exact distance to the nearest triangle, signed by it ----
  const bandCells = band * h;
  for (let t = 0; t < indices.length; t += 3) {
    const i0 = indices[t] * 3, i1 = indices[t + 1] * 3, i2 = indices[t + 2] * 3;
    const ax = positions[i0], ay = positions[i0 + 1], az = positions[i0 + 2];
    const bx = positions[i1], by = positions[i1 + 1], bz = positions[i1 + 2];
    const cx = positions[i2], cy = positions[i2 + 1], cz = positions[i2 + 2];
    // triangle normal, for the sign
    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = cx - ax, vy = cy - ay, vz = cz - az;
    let nnx = uy * vz - uz * vy, nny = uz * vx - ux * vz, nnz = ux * vy - uy * vx;
    const nl = Math.hypot(nnx, nny, nnz) || 1;
    nnx /= nl; nny /= nl; nnz /= nl;
    const x0 = Math.max(0, Math.floor((Math.min(ax, bx, cx) - bandCells - origin[0]) / h));
    const x1 = Math.min(nx - 1, Math.ceil((Math.max(ax, bx, cx) + bandCells - origin[0]) / h));
    const y0 = Math.max(0, Math.floor((Math.min(ay, by, cy) - bandCells - origin[1]) / h));
    const y1 = Math.min(ny - 1, Math.ceil((Math.max(ay, by, cy) + bandCells - origin[1]) / h));
    const z0 = Math.max(0, Math.floor((Math.min(az, bz, cz) - bandCells - origin[2]) / h));
    const z1 = Math.min(nz - 1, Math.ceil((Math.max(az, bz, cz) + bandCells - origin[2]) / h));
    for (let k = z0; k <= z1; k++) {
      const pz = origin[2] + k * h;
      for (let j = y0; j <= y1; j++) {
        const py = origin[1] + j * h;
        let base = (k * ny + j) * nx;
        for (let i = x0; i <= x1; i++) {
          const px = origin[0] + i * h;
          const d2 = pointTriangle(px, py, pz, ax, ay, az, bx, by, bz, cx, cy, cz);
          const d = Math.sqrt(d2);
          if (d > bandCells) continue;
          const cur = values[base + i];
          if (!(cur !== cur) && Math.abs(cur) <= d) continue; // keep the closer one
          const sgn = (px - ax) * nnx + (py - ay) * nny + (pz - az) * nnz >= 0 ? 1 : -1;
          values[base + i] = sgn * d;
        }
      }
    }
  }

  // ---- exact inside/outside by +Z ray parity, per (x,y) column ----
  const inside = new Uint8Array(nx * ny);
  /** cell → z indices where a ray enters or leaves the surface. */
  const counts: Record<number, number> = {};
  for (let t = 0; t < indices.length; t += 3) {
    const i0 = indices[t] * 3, i1 = indices[t + 1] * 3, i2 = indices[t + 2] * 3;
    const ax = positions[i0], ay = positions[i0 + 1], az = positions[i0 + 2];
    const bx = positions[i1], by = positions[i1 + 1], bz = positions[i1 + 2];
    const cx = positions[i2], cy = positions[i2 + 1], cz = positions[i2 + 2];
    const ymin = Math.min(ay, by, cy), ymax = Math.max(ay, by, cy);
    const j0 = Math.max(0, Math.floor((ymin - origin[1]) / h)), j1 = Math.min(ny - 1, Math.ceil((ymax - origin[1]) / h));
    if (j1 < j0) continue;
    const xmin = Math.min(ax, bx, cx), xmax = Math.max(ax, bx, cx);
    const i0c = Math.max(0, Math.floor((xmin - origin[0]) / h)), i1c = Math.min(nx - 1, Math.ceil((xmax - origin[0]) / h));
    if (i1c < i0c) continue;
    for (let j = j0; j <= j1; j++) {
      const py = origin[1] + j * h;
      for (let i = i0c; i <= i1c; i++) {
        const px = origin[0] + i * h;
        // barycentric test in xy
        const d = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
        if (Math.abs(d) < 1e-12) continue;
        const w0 = ((by - cy) * (px - cx) + (cx - bx) * (py - cy)) / d;
        const w1 = ((cy - ay) * (px - cx) + (ax - cx) * (py - cy)) / d;
        const w2 = 1 - w0 - w1;
        if (w0 < 0 || w1 < 0 || w2 < 0) continue;
        const z = w0 * az + w1 * bz + w2 * cz;
        // count crossings above each cell centre in this column
        const cell = j * nx + i;
        const kStart = Math.max(0, Math.ceil((z - origin[2]) / h));
        if (kStart < nz) counts[kStart * nx * ny + cell] = 1;
      }
    }
  }
  // counts is a sparse map: applying it as a sorted z list per column is simpler
  const flips = new Map<number, number[]>();
  for (const key of Object.keys(counts)) {
    const k = Number(key);
    const cell = k % (nx * ny);
    const kk = (k - cell) / (nx * ny);
    const arr = flips.get(cell);
    if (arr) arr.push(kk); else flips.set(cell, [kk]);
  }
  for (let cell = 0; cell < nx * ny; cell++) {
    const arr = flips.get(cell);
    const list = arr ?? [];
    list.sort((a, b) => a - b);
    let insideNow = 0;
    let ptr = 0;
    for (let k = 0; k < nz; k++) {
      while (ptr < list.length && list[ptr] === k) { insideNow ^= 1; ptr++; }
      if (insideNow) inside[cell] = 1;
    }
  }

  // ---- fill the far field: band cells seed a symmetric BFS ----
  const queue = new Int32Array(n);
  let qh = 0, qt = 0;
  const visited = new Uint8Array(n);
  for (let k = 0; k < nz; k++)
    for (let j = 0; j < ny; j++) {
      let base = (k * ny + j) * nx;
      for (let i = 0; i < nx; i++) {
        const q = base + i;
        if (values[q] === values[q]) { visited[q] = 1; queue[qt++] = q; }
      }
    }
  const sx = 1, sy = nx, sz = nx * ny;
  while (qh < qt) {
    const q = queue[qh++];
    const v = values[q];
    const i = q % nx, j = Math.floor(q / nx) % ny, k = Math.floor(q / (nx * ny));
    const grow = Math.abs(v) + h;
    const sgn = v < 0 ? -1 : 1;
    for (let a = 0; a < 6; a++) {
      const ni = i + (a === 0 ? 1 : a === 1 ? -1 : 0);
      const nj = j + (a === 2 ? 1 : a === 3 ? -1 : 0);
      const nk = k + (a === 4 ? 1 : a === 5 ? -1 : 0);
      if (ni < 0 || nj < 0 || nk < 0 || ni >= nx || nj >= ny || nk >= nz) continue;
      const q2 = nk * sz + nj * sy + ni * sx;
      if (visited[q2]) continue;
      visited[q2] = 1;
      values[q2] = sgn * grow;
      queue[qt++] = q2;
    }
  }
  // any cell the band never reached and BFS never seeded: use parity sign at a
  // conservative distance (only reachable for degenerate meshes)
  for (let k = 0; k < nz; k++)
    for (let j = 0; j < ny; j++) {
      const base = (k * ny + j) * nx;
      for (let i = 0; i < nx; i++) {
        const q = base + i;
        if (values[q] === values[q]) continue;
        values[q] = inside[j * nx + i] ? -10 * h : 10 * h;
      }
    }

  return { h, origin, dims, values, lo: [origin[0] - h / 2, origin[1] - h / 2, origin[2] - h / 2], hi: [origin[0] + (nx - 0.5) * h, origin[1] + (ny - 0.5) * h, origin[2] + (nz - 0.5) * h], band };
}

/** Conservative stand-off used outside a field's grid. */
const band_h = (f: SdfField) => f.h * (f.band + 1);

/** Trilinear lookup inside the grid; outside it, "outside the solid". */
export function fieldSdf(f: SdfField): Sdf {
  const [nx, ny, nz] = f.dims;
  const { origin, h, values } = f;
  const clamp = (v: number, n: number) => (v < 0 ? 0 : v > n - 1 ? n - 1 : v);
  // Outside the grid the field is OUTSIDE the solid, at a conservative
  // distance. Clamping to the nearest edge value instead would keep negative
  // (inside) values at the box face, and the mesher would then cut the surface
  // open there — the boundary-edge holes this pipeline must not have.
  const outside = 2 * band_h(f);
  return (x, y, z) => {
    const gx = (x - origin[0]) / h, gy = (y - origin[1]) / h, gz = (z - origin[2]) / h;
    if (gx < 0 || gy < 0 || gz < 0 || gx > nx - 1 || gy > ny - 1 || gz > nz - 1) return outside;
    const fx = clamp(gx, nx), fy = clamp(gy, ny), fz = clamp(gz, nz);
    const i0 = Math.floor(fx), j0 = Math.floor(fy), k0 = Math.floor(fz);
    const i1 = Math.min(i0 + 1, nx - 1), j1 = Math.min(j0 + 1, ny - 1), k1 = Math.min(k0 + 1, nz - 1);
    const tx = fx - i0, ty = fy - j0, tz = fz - k0;
    const g = (i: number, j: number, k: number) => values[(k * ny + j) * nx + i];
    const c00 = g(i0, j0, k0) * (1 - tx) + g(i1, j0, k0) * tx;
    const c10 = g(i0, j1, k0) * (1 - tx) + g(i1, j1, k0) * tx;
    const c01 = g(i0, j0, k1) * (1 - tx) + g(i1, j0, k1) * tx;
    const c11 = g(i0, j1, k1) * (1 - tx) + g(i1, j1, k1) * tx;
    return (c00 * (1 - ty) + c10 * ty) * (1 - tz) + (c01 * (1 - ty) + c11 * ty) * tz;
  };
}

/** A Shape over a field: same bounds, SDF from the grid, one colour. */
export function fieldShape(f: SdfField, color: Rgb): Shape {
  return { f: fieldSdf(f), lo: f.lo, hi: f.hi, color: () => color };
}

/** How many field cells hold each sign — a cheap sanity check on a new field. */
export function fieldOccupancy(f: SdfField): { inside: number; cells: number } {
  let inside = 0;
  for (let i = 0; i < f.values.length; i++) if (f.values[i] < 0) inside++;
  return { inside, cells: f.values.length };
}

/**
 * A closed shell of a mesh's surface: |d| − t/2.
 *
 * Garment and hair meshes are frequently open surfaces (a shirt has no
 * inside). A signed field of an open mesh has no reliable sign, but the
 * unsigned distance to its surface does — so shelling it gives real garment
 * geometry with honest thickness instead of a leaky solid.
 */
export function fieldShellShape(f: SdfField, t: number, color: Rgb): Shape {
  const s = fieldSdf(f);
  return { f: (x, y, z) => Math.abs(s(x, y, z)) - t / 2, lo: f.lo, hi: f.hi, color: () => color };
}
