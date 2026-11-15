/**
 * ==========================================================
 * LÉLU — CREATIVE SPACE ↔ SCENE SPACE
 *
 * Creative objects are authored in millimetres, z-up, waist at
 * z = 0. The three.js scene is metres, y-up. These are the only
 * conversion functions, so the renderer cannot invent its own
 * idea of where an object is.
 *
 * Rotation is converted as a quaternion through a basis change
 * rather than by swapping Euler angles, so a combined rotation
 * renders where the store says it is.
 * ==========================================================
 */

export type Vec3Tuple = [number, number, number];
export interface Quat {
  x: number;
  y: number;
  z: number;
  w: number;
}

const MM = 1000;

/** mm, z-up → metres, y-up. */
export function creativePositionToScene([x, y, z]: Vec3Tuple): Vec3Tuple {
  return [x / MM, z / MM, -y / MM];
}

/** metres, y-up → mm, z-up. */
export function scenePositionToCreative([x, y, z]: Vec3Tuple): Vec3Tuple {
  return [x * MM, -z * MM, y * MM];
}

function multiply(a: Quat, b: Quat): Quat {
  return {
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  };
}

const conjugate = (q: Quat): Quat => ({ x: -q.x, y: -q.y, z: -q.z, w: q.w });

function axisQuat(axis: "x" | "y" | "z", degrees: number): Quat {
  const half = (degrees * Math.PI) / 360;
  const s = Math.sin(half);
  return { x: axis === "x" ? s : 0, y: axis === "y" ? s : 0, z: axis === "z" ? s : 0, w: Math.cos(half) };
}

/** Basis change: creative (x, y, z) → scene (x, z, −y), i.e. a −90° turn about X. */
const BASIS = axisQuat("x", -90);

/**
 * Creative Euler degrees (applied X then Y then Z) → scene quaternion.
 * q = B · (Rz·Ry·Rx) · B⁻¹
 */
export function creativeRotationToSceneQuat(rotation: Vec3Tuple): Quat {
  const q = multiply(multiply(axisQuat("z", rotation[2]), axisQuat("y", rotation[1])), axisQuat("x", rotation[0]));
  return multiply(multiply(BASIS, q), conjugate(BASIS));
}

/** Scene quaternion → the creative yaw (rotation about the creative up axis, Z), in degrees. */
export function sceneQuatToCreativeYaw(q: Quat): number {
  const local = multiply(multiply(conjugate(BASIS), q), BASIS);
  // Yaw of Rz·Ry·Rx is atan2 of the rotated X axis.
  const yaw = Math.atan2(
    2 * (local.w * local.z + local.x * local.y),
    1 - 2 * (local.y * local.y + local.z * local.z),
  );
  return (yaw * 180) / Math.PI;
}

/** A uniform scene scale for a creative scale vector (largest axis, guarded). */
export function creativeScaleToScene(scale: Vec3Tuple): number {
  const value = Math.max(Math.abs(scale[0]), Math.abs(scale[1]), Math.abs(scale[2]));
  return Number.isFinite(value) && value > 0 ? value : 1;
}
