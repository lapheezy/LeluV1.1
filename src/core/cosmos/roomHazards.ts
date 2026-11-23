/**
 * Where the Cosmos room markers actually are, and how much space each one
 * occupies — derived from the same numbers the scene draws them with.
 *
 * `CosmosRooms3D` positions every marker at `[x, y, z + ROOMS_Z_OFFSET]` and
 * sizes its torus from `roomMarkerRadius`. Both that drawing code and the
 * object store's placement read this module, so a marker's exclusion volume
 * cannot drift from the marker itself, and nothing here is a guessed
 * coordinate: it is the navigation store's own data.
 *
 * Kept away from the React components so the rule is testable without a
 * browser (the same reason the placement predicates live in the store).
 */

import type { NavNode } from "./CosmosNavigation";

/** The depth the scene draws its entities at. */
export const ROOMS_Z_OFFSET = -25;

/** The drawn torus's thickness — part of the marker's real extent. */
export const MARKER_TUBE = 0.05;

/** A marker's own drawn radius, by the level it represents. */
export function roomMarkerRadius(level: NavNode["level"]): number {
  if (level === "galaxy") return 1.2;
  if (level === "planet") return 0.7;
  return 0.4;
}

export interface RoomHazardVolume {
  id: string;
  center: [number, number, number];
  radius: number;
}

/**
 * One exclusion volume per marker that is on screen. Markers the layer does
 * not draw — the core (which reports its own, far larger, volume) and any
 * beyond the layer's node cap — are the caller's to filter out before calling.
 */
export function roomHazardVolumes(nodes: NavNode[]): RoomHazardVolume[] {
  return nodes.map((node) => ({
    id: `room-marker:${node.id}`,
    center: [node.position[0], node.position[1], node.position[2] + ROOMS_Z_OFFSET],
    radius: roomMarkerRadius(node.level) + MARKER_TUBE,
  }));
}
