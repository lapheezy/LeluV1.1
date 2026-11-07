/**
 * ==========================================================
 * LÉLU — PORTAL FIELD MODEL (pure)
 *
 * Where each registry portal sits in the world, and whether two
 * of them would land on top of each other. Pure maths only: no
 * React, no Three, no DOM, so the ring's geometry can be tested
 * without a renderer and the probe that maps registry ids to
 * drawn meshes can reuse the same numbers.
 *
 * The field is built FROM the registry (see PortalRegistry):
 * built-in environments seeded once sit at their destination's
 * anchor; a portal a person or an agent created orbits beside
 * it on the golden angle, so a second portal to the same
 * environment never hides behind the first.
 * ==========================================================
 */

import { destinationFor, type SpatialSceneId } from "./SpatialScenes";
import { isBuiltinPortal, type PortalRecord } from "./PortalRegistry";

export interface PortalOffset {
  x: number;
  y: number;
  z: number;
}

export interface PortalPlacement {
  /** The registry id — stable across reloads, and the mesh name's suffix. */
  id: string;
  destination: SpatialSceneId;
  label: string;
  accent: string;
  /** World-space radius of the drawn seam. */
  radius: number;
  builtin: boolean;
  /** 0 for the built-in portal; 0,1,2… for extra portals to the same place. */
  orbitIndex: number;
  /** Offset from the destination's live anchor (the camera target it faces). */
  offset: PortalOffset;
}

const GOLDEN_ANGLE = 2.399963;

/**
 * The ring's geometry.
 *
 * Portals used to be placed at each destination's own camera target, which in
 * the wide view projects most of them into the same few dozen pixels: their
 * interactive regions overlapped, so a measured click on one portal's centre
 * started a transition to a DIFFERENT portal. A field of places you cannot aim
 * at is not an interactive field, so the built-in ring is laid out as an
 * actual ring around the Core — one deterministic slot per destination, each
 * portal's mouth far enough from its neighbours to be aimed at — while every
 * portal still travels to the real destination it names.
 */
const RING_RADIUS = 7.2;
const RING_Y_SCALE = 0.6;
/** Extra portals to the same place hang beside that place's slot. */
const EXTRA_ORBIT = 1.25;

function radiusFor(destination: SpatialSceneId, builtin: boolean): number {
  if (!builtin) return 0.55;
  const kind = destinationFor(destination).kind;
  if (kind === "portal") return 1.15;
  if (kind === "galaxy") return 1.0;
  return 0.9;
}

/**
 * One placement per drawn portal. The Core and the Cosmos are the world
 * itself, not places to go, so they are not portals in the field.
 */
export function portalPlacements(
  records: readonly PortalRecord[],
  options: { radius?: number } = {},
): PortalPlacement[] {
  const ringRadius = options.radius && options.radius > 0 ? options.radius : RING_RADIUS;
  const visible = records.filter((record) => {
    const kind = destinationFor(record.destination).kind;
    return kind !== "core" && kind !== "cosmos";
  });
  // The built-in ring's order is the registry's order, so a slot is stable for
  // as long as the destination exists — the same portal is in the same place
  // after a reload, and a newly created portal never displaces it.
  const slots = new Map<SpatialSceneId, number>();
  visible.filter(isBuiltinPortal).forEach((record, index) => {
    if (!slots.has(record.destination)) slots.set(record.destination, index);
  });
  const total = Math.max(1, slots.size);
  const extras = new Map<SpatialSceneId, number>();
  const placements: PortalPlacement[] = [];
  for (const record of visible) {
    const builtin = isBuiltinPortal(record);
    const slot = slots.get(record.destination) ?? slots.size;
    const baseAngle = -Math.PI / 2 + (slot / total) * Math.PI * 2;
    const base = {
      x: Math.cos(baseAngle) * ringRadius,
      y: Math.sin(baseAngle) * ringRadius * RING_Y_SCALE,
      z: 0,
    };
    let orbitIndex = 0;
    let offset = base;
    if (!builtin) {
      orbitIndex = extras.get(record.destination) ?? 0;
      extras.set(record.destination, orbitIndex + 1);
      const angle = baseAngle + 0.6 + orbitIndex * GOLDEN_ANGLE;
      offset = {
        x: base.x + Math.cos(angle) * EXTRA_ORBIT * (ringRadius / RING_RADIUS),
        y: base.y + Math.sin(angle) * EXTRA_ORBIT * 0.62 * (ringRadius / RING_RADIUS),
        z: 0.4,
      };
    }
    placements.push({
      id: record.id,
      destination: record.destination,
      label: record.label,
      accent: destinationFor(record.destination).accent,
      radius: radiusFor(record.destination, builtin),
      builtin,
      orbitIndex,
      offset,
    });
  }
  return placements;
}

/**
 * Ids that appear more than once, and destinations that more than one portal
 * would draw at the same offset. The registry keys by id, so a duplicate here
 * means a stale visual object survived a registry change — which is exactly
 * what the field must never accumulate.
 */
export function duplicatePortalIds(records: readonly PortalRecord[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const record of records) {
    const key = `${record.id}|${record.destination}`;
    if (seen.has(key)) duplicates.add(record.id);
    seen.add(key);
  }
  return [...duplicates];
}

/**
 * Portals that would be drawn on top of the built-in portal of their own
 * environment at exactly the same offset. Empty in a healthy field: extra
 * portals get an orbit, and the built-in one sits at the anchor.
 */
export function collidingPortalIds(placements: readonly PortalPlacement[]): string[] {
  const byKey = new Map<string, PortalPlacement[]>();
  for (const placement of placements) {
    const key = `${placement.destination}:${placement.offset.x.toFixed(4)}:${placement.offset.y.toFixed(4)}:${placement.offset.z.toFixed(4)}`;
    const list = byKey.get(key) ?? [];
    list.push(placement);
    byKey.set(key, list);
  }
  const collisions: string[] = [];
  for (const list of byKey.values()) {
    if (list.length > 1) collisions.push(...list.map((placement) => placement.id));
  }
  return collisions;
}
