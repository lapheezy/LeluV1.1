/**
 * ==========================================================
 * LÉLU ASRE — LINEAR BLEND SKINNING FOR REFERENCE ANATOMY
 *
 * MakeHuman's CC0 rig gives 139 bones with per-vertex weights. This
 * evaluates the rig by hand so a real hand can actually close, a real foot
 * can grip, and a real jaw can open — geometry, not a pose applied to a
 * picture. Rest pose is identity, so an unpicked bone changes nothing.
 * ==========================================================
 */
import type { V3 } from "../character/sdf.ts";

export interface BonePose {
  bone: string;
  /** Unit rotation axis in rest space. */
  axis: V3;
  /** Radians. */
  angle: number;
}

type Mat = { r: number[]; t: V3 }; // row-major 3x3 rotation + translation

const IDENTITY: Mat = { r: [1, 0, 0, 0, 1, 0, 0, 0, 1], t: [0, 0, 0] };

function rotAxis(axis: V3, angle: number): number[] {
  const [x, y, z] = axis;
  const l = Math.hypot(x, y, z) || 1;
  const [ux, uy, uz] = [x / l, y / l, z / l];
  const c = Math.cos(angle), s = Math.sin(angle), k = 1 - c;
  return [
    c + ux * ux * k, ux * uy * k - uz * s, ux * uz * k + uy * s,
    uy * ux * k + uz * s, c + uy * uy * k, uy * uz * k - ux * s,
    uz * ux * k - uy * s, uz * uy * k + ux * s, c + uz * uz * k,
  ];
}

/** Rotation about `pivot`, as an affine map. */
function aboutPivot(axis: V3, angle: number, pivot: V3): Mat {
  const r = rotAxis(axis, angle);
  const t: V3 = [
    pivot[0] - (r[0] * pivot[0] + r[1] * pivot[1] + r[2] * pivot[2]),
    pivot[1] - (r[3] * pivot[0] + r[4] * pivot[1] + r[5] * pivot[2]),
    pivot[2] - (r[6] * pivot[0] + r[7] * pivot[1] + r[8] * pivot[2]),
  ];
  return { r, t };
}

/** a ∘ b (apply b first, then a) — the parent composition LBS needs. */
function compose(a: Mat, b: Mat): Mat {
  const r = new Array<number>(9);
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++) r[3 * i + j] = a.r[3 * i] * b.r[j] + a.r[3 * i + 1] * b.r[3 + j] + a.r[3 * i + 2] * b.r[6 + j];
  const t: V3 = [
    a.r[0] * b.t[0] + a.r[1] * b.t[1] + a.r[2] * b.t[2] + a.t[0],
    a.r[3] * b.t[0] + a.r[4] * b.t[1] + a.r[5] * b.t[2] + a.t[1],
    a.r[6] * b.t[0] + a.r[7] * b.t[1] + a.r[8] * b.t[2] + a.t[2],
  ];
  return { r, t };
}

export interface Rig {
  /** Rest head position of each bone, metres. */
  heads: Map<string, V3>;
  /** parent bone name, or null for a root. */
  parents: Map<string, string | null>;
  /** Per vertex, (bone, weight) pairs that sum to 1. */
  vertexBones: Array<Array<[string, number]>>;
}

/**
 * World matrix per pose: a bone's local rotation is applied about its own
 * rest head, then composed with its parent's, so a finger bone inherits the
 * knuckle it hangs from.
 */
export function poseMatrices(rig: Rig, poses: BonePose[]): Map<string, Mat> {
  const local = new Map<string, Mat>();
  for (const p of poses) {
    const head = rig.heads.get(p.bone);
    if (!head) continue;
    local.set(p.bone, aboutPivot(p.axis, p.angle, head));
  }
  const out = new Map<string, Mat>();
  const resolve = (bone: string, depth = 0): Mat => {
    const done = out.get(bone);
    if (done) return done;
    if (depth > 24) return IDENTITY;
    const self = local.get(bone) ?? IDENTITY;
    const parent = rig.parents.get(bone) ?? null;
    const m = parent ? compose(resolve(parent, depth + 1), self) : self;
    out.set(bone, m);
    return m;
  };
  for (const bone of local.keys()) resolve(bone);
  for (const [bone] of out) resolve(bone);
  return out;
}

/** Apply a pose to positions (in place-safe: returns a new array). */
export function skin(positions: Float32Array, rig: Rig, poses: BonePose[]): Float32Array {
  if (!poses.length) return positions.slice();
  const mats = poseMatrices(rig, poses);
  const out = new Float32Array(positions.length);
  const n = positions.length / 3;
  for (let v = 0; v < n; v++) {
    const px = positions[3 * v], py = positions[3 * v + 1], pz = positions[3 * v + 2];
    let ax = 0, ay = 0, az = 0, wsum = 0;
    for (const [bone, w] of rig.vertexBones[v] ?? []) {
      const m = mats.get(bone);
      if (!m) {
        ax += w * px; ay += w * py; az += w * pz;
      } else {
        ax += w * (m.r[0] * px + m.r[1] * py + m.r[2] * pz + m.t[0]);
        ay += w * (m.r[3] * px + m.r[4] * py + m.r[5] * pz + m.t[1]);
        az += w * (m.r[6] * px + m.r[7] * py + m.r[8] * pz + m.t[2]);
      }
      wsum += w;
    }
    if (wsum < 1e-6) { ax = px; ay = py; az = pz; wsum = 1; }
    out[3 * v] = ax / wsum;
    out[3 * v + 1] = ay / wsum;
    out[3 * v + 2] = az / wsum;
  }
  return out;
}

/** Unit vector helper shared by the rig builders. */
export function unit(v: V3): V3 {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

export function cross(a: V3, b: V3): V3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

export function sub(a: V3, b: V3): V3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}
