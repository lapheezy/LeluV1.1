/**
 * ==========================================================
 * LÉLU — SPATIAL LAYOUT FOR CREATIONS
 *
 * "Put the pendant in front of the chair" is a placement in
 * relation to ANOTHER object, and it has to be computed from
 * real geometry: the two bounding boxes, not two arbitrary
 * numbers. This module does that arithmetic once, in the
 * canonical conventions the rest of the engine uses:
 *
 *   store units   millimetres, z up   (what a transform holds)
 *   scene units   metres, y up        (what the renderer draws)
 *
 * Axes, in store space: +x is right, −y is toward the viewer
 * (the camera's side of the world), +z is up.
 *
 * Nothing here writes state and nothing here touches a scene:
 * it returns numbers the store operation applies, so there is
 * still exactly one transform authority.
 * ==========================================================
 */

import { meshToScene } from "./geometry";
import type { CreativeObject } from "./objects";
import {
  creativePositionToScene,
  creativeRotationToSceneQuat,
  creativeScaleToScene,
  scenePositionToCreative,
  type Vec3Tuple,
} from "./sceneTransform";

export interface Box {
  min: Vec3Tuple;
  max: Vec3Tuple;
}

export type SpatialRelation =
  | "left"
  | "right"
  | "above"
  | "below"
  | "in-front"
  | "behind"
  | "beside"
  | "centre";

export const SPATIAL_RELATIONS: SpatialRelation[] = [
  "left",
  "right",
  "above",
  "below",
  "in-front",
  "behind",
  "beside",
  "centre",
];

/** Rotate a vector by a plain quaternion (no THREE dependency in core). */
function rotate(v: Vec3Tuple, q: { x: number; y: number; z: number; w: number }): Vec3Tuple {
  const [x, y, z] = v;
  const ix = q.w * x + q.y * z - q.z * y;
  const iy = q.w * y + q.z * x - q.x * z;
  const iz = q.w * z + q.x * y - q.y * x;
  const iw = -q.x * x - q.y * y - q.z * z;
  return [
    ix * q.w + iw * -q.x + iy * -q.z - iz * -q.y,
    iy * q.w + iw * -q.y + iz * -q.x - ix * -q.z,
    iz * q.w + iw * -q.z + ix * -q.y - iy * -q.x,
  ];
}

/**
 * The object's real bounding box in scene metres, as drawn.
 *
 * Every part mesh is converted exactly the way the renderer converts it, then
 * the object's own transform (position, rotation, scale) is applied. An object
 * whose origin sits outside its body — a chair's origin is the floor between
 * its legs — still gets a correct box, because the box comes from the vertices.
 */
export function objectWorldBox(object: CreativeObject): Box | null {
  if (!object.parts.length) return null;
  const position = creativePositionToScene(object.transform.position);
  const rotation = creativeRotationToSceneQuat(object.transform.rotation);
  const scale = creativeScaleToScene(object.transform.scale);

  let min: Vec3Tuple = [Infinity, Infinity, Infinity];
  let max: Vec3Tuple = [-Infinity, -Infinity, -Infinity];

  for (const part of object.parts) {
    const scene = meshToScene(part.mesh);
    for (let i = 0; i < scene.positions.length; i += 3) {
      const local: Vec3Tuple = [scene.positions[i], scene.positions[i + 1], scene.positions[i + 2]];
      const scaled: Vec3Tuple = [local[0] * scale, local[1] * scale, local[2] * scale];
      const turned = rotate(scaled, rotation);
      const world: Vec3Tuple = [turned[0] + position[0], turned[1] + position[1], turned[2] + position[2]];
      for (let axis = 0; axis < 3; axis += 1) {
        if (!Number.isFinite(world[axis])) continue;
        if (world[axis] < min[axis]) min[axis] = world[axis];
        if (world[axis] > max[axis]) max[axis] = world[axis];
      }
    }
  }

  if (!Number.isFinite(min[0]) || !Number.isFinite(max[0])) return null;
  return { min, max };
}

export function boxCentre(box: Box): Vec3Tuple {
  return [(box.min[0] + box.max[0]) / 2, (box.min[1] + box.max[1]) / 2, (box.min[2] + box.max[2]) / 2];
}

export function boxSize(box: Box): Vec3Tuple {
  return [box.max[0] - box.min[0], box.max[1] - box.min[1], box.max[2] - box.min[2]];
}

/**
 * How far to move a subject so it sits in the given relation to a target.
 *
 * The subject's own size participates: a gown beside a pendant needs much more
 * room than a pendant beside a gown, and a fixed offset would bury one inside
 * the other. `gap` is the clear space left between the two bodies, in metres.
 *
 * Returns the delta in scene metres, which the caller applies to the object's
 * canonical position through the store.
 */
export function relationOffset(subject: Box, target: Box, relation: SpatialRelation, gap = 0.25): Vec3Tuple {
  const subjectCentre = boxCentre(subject);
  const targetCentre = boxCentre(target);
  const subjectSize = boxSize(subject);
  const targetSize = boxSize(target);

  // Scene axes: x right, y up, z toward the viewer.
  const axisGap = (axis: 0 | 1 | 2) => (subjectSize[axis] + targetSize[axis]) / 2 + gap;
  const delta: Vec3Tuple = [0, 0, 0];

  switch (relation) {
    case "left":
      delta[0] = targetCentre[0] - subjectCentre[0] - axisGap(0);
      delta[1] = targetCentre[1] - subjectCentre[1];
      delta[2] = targetCentre[2] - subjectCentre[2];
      break;
    case "right":
    case "beside":
      delta[0] = targetCentre[0] - subjectCentre[0] + axisGap(0);
      delta[1] = targetCentre[1] - subjectCentre[1];
      delta[2] = targetCentre[2] - subjectCentre[2];
      break;
    case "in-front":
      delta[0] = targetCentre[0] - subjectCentre[0];
      delta[1] = targetCentre[1] - subjectCentre[1];
      delta[2] = targetCentre[2] - subjectCentre[2] + axisGap(2);
      break;
    case "behind":
      delta[0] = targetCentre[0] - subjectCentre[0];
      delta[1] = targetCentre[1] - subjectCentre[1];
      delta[2] = targetCentre[2] - subjectCentre[2] - axisGap(2);
      break;
    case "above":
      delta[0] = targetCentre[0] - subjectCentre[0];
      delta[1] = targetCentre[1] - subjectCentre[1] + axisGap(1);
      delta[2] = targetCentre[2] - subjectCentre[2];
      break;
    case "below":
      delta[0] = targetCentre[0] - subjectCentre[0];
      delta[1] = targetCentre[1] - subjectCentre[1] - axisGap(1);
      delta[2] = targetCentre[2] - subjectCentre[2];
      break;
    case "centre":
    default:
      delta[0] = targetCentre[0] - subjectCentre[0];
      delta[1] = targetCentre[1] - subjectCentre[1];
      delta[2] = targetCentre[2] - subjectCentre[2];
      break;
  }
  return delta;
}

/** The canonical position (mm, z up) that puts `subject` in that relation. */
export function positionedRelativeTo(
  subject: CreativeObject,
  target: CreativeObject,
  relation: SpatialRelation,
  gap = 0.25,
): Vec3Tuple | null {
  const subjectBox = objectWorldBox(subject);
  const targetBox = objectWorldBox(target);
  if (!subjectBox || !targetBox) return null;
  const delta = relationOffset(subjectBox, targetBox, relation, gap);
  const current = creativePositionToScene(subject.transform.position);
  const next: Vec3Tuple = [current[0] + delta[0], current[1] + delta[1], current[2] + delta[2]];
  return scenePositionToCreative(next);
}
