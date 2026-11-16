/**
 * ==========================================================
 * LÉLU — SPATIAL RENDER MODEL
 *
 * One pure projection from the authoritative graph to the props
 * the EXISTING R3F renderer consumes. The scene layer and the
 * tests both read this, so a test that asserts "the mesh would
 * be at (x, y, z) in #ff0000" is asserting the same values the
 * live canvas receives — not a parallel description of them.
 *
 * No geometry is created here; three.js primitives stay in the
 * scene layer, where the existing renderer owns them.
 * ==========================================================
 */

import type {
  SpatialObject,
  SpatialRelationship,
  SpatialRelationshipKind,
} from "./SpatialTypes";

export type Vec3Tuple = [number, number, number];

export interface SpatialMeshModel {
  id: string;
  name: string;
  kind: SpatialObject["kind"];
  position: Vec3Tuple;
  rotation: Vec3Tuple;
  scale: Vec3Tuple;
  visible: boolean;
  color: string;
  emissive: string;
  emissiveIntensity: number;
  metalness: number;
  roughness: number;
  opacity: number;
  wireframe: boolean;
  /** True when the material needs the transparent pipeline. */
  transparent: boolean;
}

export const SPATIAL_RELATIONSHIP_COLORS: Record<SpatialRelationshipKind, string> = {
  connected: "#38bdf8",
  orbits: "#a78bfa",
  contains: "#f59e0b",
  aligned: "#34d399",
};

export interface SpatialLinkModel {
  id: string;
  kind: SpatialRelationshipKind;
  from: Vec3Tuple;
  to: Vec3Tuple;
  color: string;
}

export function spatialMeshModel(object: SpatialObject): SpatialMeshModel {
  const { position, rotation, scale } = object.transform;
  return {
    id: object.id,
    name: object.name,
    kind: object.kind,
    position: [position.x, position.y, position.z],
    rotation: [rotation.x, rotation.y, rotation.z],
    scale: [scale.x, scale.y, scale.z],
    visible: object.visible,
    color: object.material.color,
    emissive: object.material.emissive,
    emissiveIntensity: object.material.emissiveIntensity,
    metalness: object.material.metalness,
    roughness: object.material.roughness,
    opacity: object.material.opacity,
    wireframe: object.material.wireframe,
    transparent: object.material.opacity < 1,
  };
}

/**
 * Draw a relationship between the CURRENT positions of both ends.
 * The link is derived, never stored as geometry, so moving an
 * object moves its links with it.
 */
export function spatialLinkModels(
  objects: readonly SpatialObject[],
  relationships: readonly SpatialRelationship[],
): SpatialLinkModel[] {
  const byId = new Map(objects.map((object) => [object.id, object]));
  const links: SpatialLinkModel[] = [];
  for (const relationship of relationships) {
    const from = byId.get(relationship.from);
    const to = byId.get(relationship.to);
    if (!from || !to) continue;
    links.push({
      id: relationship.id,
      kind: relationship.kind,
      from: [from.transform.position.x, from.transform.position.y, from.transform.position.z],
      to: [to.transform.position.x, to.transform.position.y, to.transform.position.z],
      color: SPATIAL_RELATIONSHIP_COLORS[relationship.kind],
    });
  }
  return links;
}
