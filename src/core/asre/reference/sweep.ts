/**
 * ==========================================================
 * LÉLU ASRE — SWEPT GEOMETRY
 *
 * A closed profile swept along a polyline with a rotation-minimising frame:
 * the building block for straps, laces, piping, cords and hair strands. The
 * result is a closed 2-manifold (end caps included), so it needs no field to
 * be a solid, and its triangles follow the curve instead of a voxel grid.
 * ==========================================================
 */
import type { V3 } from "../character/sdf.ts";
import type { Mesh } from "../volume/mesh.ts";

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a: V3): V3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

export interface SweepOptions {
  /** Profile half-extent along the frame's normal (u) and binormal (v), per point (scale 0..1 multiplies). */
  width: number;
  height: number;
  /** "rect" for straps (width = across the strap), "round" for cords and hair. */
  profile: "rect" | "round";
  /** Profile vertices for round profiles. */
  sides?: number;
  /** Per-point scale of the profile (taper), default 1. */
  scale?: (t: number) => number;
  /** Preferred "up" of the profile at each point (e.g. the surface normal for a strap lying on skin). */
  up?: (i: number) => V3;
  /** Close the ends. */
  caps?: boolean;
}

/** Sweep along `pts`. Returns positions + indices (colours are the caller's). Also returns, per vertex, its curve parameter t. */
export function sweep(pts: V3[], o: SweepOptions): Mesh & { t: Float32Array } {
  const n = pts.length;
  const prof: [number, number][] = [];
  if (o.profile === "rect") {
    // a rectangle with chamfered corners, counter-clockwise: soft strap edges
    const k = 0.75;
    prof.push([1, k], [k, 1], [-k, 1], [-1, k], [-1, -k], [-k, -1], [k, -1], [1, -k]);
  } else {
    const s = o.sides ?? 6;
    for (let k = 0; k < s; k++) prof.push([Math.cos((2 * Math.PI * k) / s), Math.sin((2 * Math.PI * k) / s)]);
  }
  const m = prof.length;
  // tangents and a rotation-minimising frame (double reflection, Wang et al. 2008)
  const T: V3[] = pts.map((_, i) => unit(sub(pts[Math.min(n - 1, i + 1)], pts[Math.max(0, i - 1)])));
  let U: V3;
  if (o.up) {
    const u0 = o.up(0);
    U = unit(sub(u0, [T[0][0] * dot(u0, T[0]), T[0][1] * dot(u0, T[0]), T[0][2] * dot(u0, T[0])]));
  } else {
    const ref: V3 = Math.abs(T[0][1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    U = unit(cross(cross(T[0], ref), T[0]));
  }
  const frames: [V3, V3][] = [];
  for (let i = 0; i < n; i++) {
    if (i > 0) {
      if (o.up) {
        const u = o.up(i);
        U = unit(sub(u, [T[i][0] * dot(u, T[i]), T[i][1] * dot(u, T[i]), T[i][2] * dot(u, T[i])]));
      } else {
        const v1 = sub(pts[i], pts[i - 1]);
        const c1 = dot(v1, v1) || 1e-12;
        const rL = sub(U, [v1[0] * (2 / c1) * dot(v1, U), v1[1] * (2 / c1) * dot(v1, U), v1[2] * (2 / c1) * dot(v1, U)]);
        const tL = sub(T[i - 1], [v1[0] * (2 / c1) * dot(v1, T[i - 1]), v1[1] * (2 / c1) * dot(v1, T[i - 1]), v1[2] * (2 / c1) * dot(v1, T[i - 1])]);
        const v2 = sub(T[i], tL);
        const c2 = dot(v2, v2) || 1e-12;
        U = unit(sub(rL, [v2[0] * (2 / c2) * dot(v2, rL), v2[1] * (2 / c2) * dot(v2, rL), v2[2] * (2 / c2) * dot(v2, rL)]));
      }
    }
    frames.push([U, unit(cross(T[i], U))]);
  }
  const caps = o.caps !== false;
  const nv = n * m + (caps ? 2 : 0);
  const P = new Float32Array(nv * 3), tt = new Float32Array(nv);
  for (let i = 0; i < n; i++) {
    const [u, v] = frames[i];
    const s = o.scale ? o.scale(i / Math.max(1, n - 1)) : 1;
    for (let k = 0; k < m; k++) {
      // u (the "up") carries the height, v the width — a strap lies flat on its up-vector's surface
      const a = prof[k][0] * o.width * s, b = prof[k][1] * o.height * s;
      const q = (i * m + k) * 3;
      for (let c = 0; c < 3; c++) P[q + c] = pts[i][c] + v[c] * a + u[c] * b;
      tt[i * m + k] = i / Math.max(1, n - 1);
    }
  }
  const idx: number[] = [];
  for (let i = 0; i + 1 < n; i++)
    for (let k = 0; k < m; k++) {
      const a = i * m + k, b = i * m + ((k + 1) % m), c = (i + 1) * m + k, d = (i + 1) * m + ((k + 1) % m);
      idx.push(a, c, b, b, c, d);
    }
  if (caps) {
    const c0 = n * m, c1 = n * m + 1;
    P.set(pts[0], c0 * 3);
    P.set(pts[n - 1], c1 * 3);
    tt[c0] = 0;
    tt[c1] = 1;
    for (let k = 0; k < m; k++) {
      idx.push(c0, k, (k + 1) % m);
      idx.push(c1, (n - 1) * m + ((k + 1) % m), (n - 1) * m + k);
    }
  }
  // orientation: make the swept faces point away from the curve
  const I = new Uint32Array(idx);
  if (n > 1 && m > 2) {
    const a = I[0], b = I[1], c = I[2];
    const e1: V3 = [P[3 * b] - P[3 * a], P[3 * b + 1] - P[3 * a + 1], P[3 * b + 2] - P[3 * a + 2]];
    const e2: V3 = [P[3 * c] - P[3 * a], P[3 * c + 1] - P[3 * a + 1], P[3 * c + 2] - P[3 * a + 2]];
    const nrm = cross(e1, e2);
    const out: V3 = [P[3 * a] - pts[0][0], P[3 * a + 1] - pts[0][1], P[3 * a + 2] - pts[0][2]];
    if (dot(nrm, out) < 0) for (let i = 0; i < I.length; i += 3) [I[i + 1], I[i + 2]] = [I[i + 2], I[i + 1]];
  }
  return { positions: P, indices: I, t: tt };
}

/** Distance from p to the polyline, for occupancy fields of swept parts. */
export function polylineDistance(pts: V3[]): (x: number, y: number, z: number) => number {
  return (x, y, z) => {
    let best = Infinity;
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i], b = pts[i + 1];
      const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
      const bb = dx * dx + dy * dy + dz * dz || 1e-12;
      const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy + (z - a[2]) * dz) / bb));
      const d = Math.hypot(x - a[0] - dx * t, y - a[1] - dy * t, z - a[2] - dz * t);
      if (d < best) best = d;
    }
    return best;
  };
}
