/**
 * ==========================================================
 * LÉLU — SPATIAL VALIDATION
 *
 * Every mutation is validated against a DRAFT before anything is
 * committed. A draft that fails leaves the live scene exactly as
 * it was — there is no partial apply and no silent clamping.
 * ==========================================================
 */

import {
  SPATIAL_LIMITS,
  SPATIAL_PRIMITIVES,
  SPATIAL_RELATIONSHIP_KINDS,
  type SpatialObject,
  type SpatialRelationship,
  type SpatialSceneSnapshot,
  type SpatialVec3,
} from "./SpatialTypes";

const COLOR_PATTERN = /^#[0-9a-f]{6}$/i;
const ID_PATTERN = /^[a-z0-9][a-z0-9-]{2,63}$/i;

export function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function normalizeSpatialColor(value: string | undefined | null): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return COLOR_PATTERN.test(trimmed) ? trimmed.toLowerCase() : null;
}

export function cloneSpatialVec3(value: SpatialVec3): SpatialVec3 {
  return { x: value.x, y: value.y, z: value.z };
}

export function cloneSpatialObject(object: SpatialObject): SpatialObject {
  return {
    ...object,
    transform: {
      position: cloneSpatialVec3(object.transform.position),
      rotation: cloneSpatialVec3(object.transform.rotation),
      scale: cloneSpatialVec3(object.transform.scale),
    },
    material: { ...object.material },
    tags: [...object.tags],
  };
}

export function cloneSpatialRelationship(
  relationship: SpatialRelationship,
): SpatialRelationship {
  return { ...relationship };
}

function validateVec3(value: SpatialVec3, axisLimit: number): string | null {
  for (const axis of ["x", "y", "z"] as const) {
    const component = value[axis];
    if (!isFiniteNumber(component)) {
      return `${axis} is not a finite number`;
    }
    if (Math.abs(component) > axisLimit) {
      return `${axis} is outside the scene bounds (±${axisLimit})`;
    }
  }
  return null;
}

/** Validate one object as it would exist after a commit. */
export function validateSpatialObject(object: SpatialObject): string | null {
  if (!ID_PATTERN.test(object.id)) return `object id "${object.id}" is not a stable id`;
  const name = object.name.trim();
  if (name.length === 0 || name.length > SPATIAL_LIMITS.nameLength) {
    return `object name must be 1–${SPATIAL_LIMITS.nameLength} characters`;
  }
  if (!SPATIAL_PRIMITIVES.includes(object.kind)) {
    return `unknown primitive "${object.kind}"`;
  }
  const positionError = validateVec3(object.transform.position, SPATIAL_LIMITS.position);
  if (positionError) return `position ${positionError}`;
  const rotationError = validateVec3(object.transform.rotation, Math.PI * 16);
  if (rotationError) return `rotation ${rotationError}`;
  const scaleError = validateVec3(object.transform.scale, SPATIAL_LIMITS.scaleMax);
  if (scaleError) return `scale ${scaleError}`;
  for (const axis of ["x", "y", "z"] as const) {
    const scale = object.transform.scale[axis];
    if (scale < SPATIAL_LIMITS.scaleMin) {
      return `scale ${axis} is below the minimum (${SPATIAL_LIMITS.scaleMin})`;
    }
  }
  if (!COLOR_PATTERN.test(object.material.color)) {
    return `material colour "${object.material.color}" is not #rrggbb`;
  }
  if (!COLOR_PATTERN.test(object.material.emissive)) {
    return `emissive colour "${object.material.emissive}" is not #rrggbb`;
  }
  for (const [key, value] of [
    ["metalness", object.material.metalness],
    ["roughness", object.material.roughness],
    ["opacity", object.material.opacity],
  ] as const) {
    if (!isFiniteNumber(value) || value < 0 || value > 1) {
      return `material ${key} must be between 0 and 1`;
    }
  }
  if (object.material.opacity < 0.05) {
    return "material opacity below 0.05 would make the object invisible";
  }
  if (
    !isFiniteNumber(object.material.emissiveIntensity) ||
    object.material.emissiveIntensity < 0 ||
    object.material.emissiveIntensity > 3
  ) {
    return "emissive intensity must be between 0 and 3";
  }
  return null;
}

export function validateSpatialRelationship(
  relationship: SpatialRelationship,
  objectIds: ReadonlySet<string>,
): string | null {
  if (!ID_PATTERN.test(relationship.id)) return `relationship id "${relationship.id}" is invalid`;
  if (!objectIds.has(relationship.from)) {
    return `relationship source "${relationship.from}" is not in the scene`;
  }
  if (!objectIds.has(relationship.to)) {
    return `relationship target "${relationship.to}" is not in the scene`;
  }
  if (relationship.from === relationship.to) {
    return "an object cannot be related to itself";
  }
  if (!SPATIAL_RELATIONSHIP_KINDS.includes(relationship.kind)) {
    return `unknown relationship kind "${relationship.kind}"`;
  }
  return null;
}

/** Validate a complete snapshot used for recovery. */
export function validateSpatialSnapshot(snapshot: SpatialSceneSnapshot): string | null {
  if (!Number.isInteger(snapshot.revision) || snapshot.revision < 0) {
    return "snapshot revision must be a non-negative integer";
  }
  if (snapshot.objects.length > SPATIAL_LIMITS.objects) {
    return `snapshot holds more than ${SPATIAL_LIMITS.objects} objects`;
  }
  if (snapshot.relationships.length > SPATIAL_LIMITS.relationships) {
    return `snapshot holds more than ${SPATIAL_LIMITS.relationships} relationships`;
  }
  const ids = new Set<string>();
  for (const object of snapshot.objects) {
    const error = validateSpatialObject(object);
    if (error) return error;
    if (ids.has(object.id)) return `duplicate object id "${object.id}"`;
    ids.add(object.id);
  }
  const relationshipIds = new Set<string>();
  for (const relationship of snapshot.relationships) {
    const error = validateSpatialRelationship(relationship, ids);
    if (error) return error;
    if (relationshipIds.has(relationship.id)) {
      return `duplicate relationship id "${relationship.id}"`;
    }
    relationshipIds.add(relationship.id);
  }
  return null;
}

/** True when two positions are the same within float tolerance. */
export function sameSpatialPosition(a: SpatialVec3, b: SpatialVec3): boolean {
  return (
    Math.abs(a.x - b.x) < 1e-6 &&
    Math.abs(a.y - b.y) < 1e-6 &&
    Math.abs(a.z - b.z) < 1e-6
  );
}
