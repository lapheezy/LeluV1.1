/**
 * ==========================================================
 * LÉLU — PORTAL FIELD MODEL (pure)
 *
 * Where each registry portal sits in the world, how big its
 * mouth is, and whether two portals would overlap each other.
 * Pure maths only: no React, no Three, no DOM, so the geometry
 * can be tested without a renderer and the probe that maps
 * registry ids to drawn meshes can reuse the same numbers.
 *
 * WHY SIZE COMES FROM SPACING
 * ---------------------------
 * Mission 5.4B measured a click on the `files` portal travelling
 * to `portal`. The cause was arithmetic, not event handling: the
 * ring put slots 2πR/N apart (R framed from the camera), while
 * every portal's mouth was sized from its own base radius — an
 * unrelated number. At the framed ring size the hit surfaces were
 * wider than the gap between slots, so they overlapped; all of
 * them lie in the same plane at the same depth from the camera,
 * so the raycast was a tie broken by scene traversal order and a
 * click on one portal could be answered by its neighbour.
 *
 * Enlarging the hit surfaces would have made that worse. Instead
 * the mouth of every portal is now derived FROM the distance to
 * its nearest neighbour: a hit surface may never be wider than
 * 45 % of that distance, so two mouths can touch but never cover
 * each other. The visual seam is scaled by the same factor, so
 * what you see and what you can click stay the same object.
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
  /**
   * World-space radius of the interactive mouth. Always ≥ the seam and never
   * more than 45 % of the nearest-neighbour distance, which is what makes one
   * portal's click answerable only by that portal.
   */
  hitRadius: number;
  builtin: boolean;
  /** 0 for the built-in portal; 0,1,2… for extra portals to the same place. */
  orbitIndex: number;
  /** Offset from the destination's live anchor (the camera target it faces). */
  offset: PortalOffset;
}

/** The ring used when no camera-framed radius is supplied (tests, SSR). */
export const RING_RADIUS = 7.2;
const RING_Y_SCALE = 0.6;
/** Extra portals to the same place hang beside that place's slot. */
const EXTRA_ORBIT = 1.25;
/** How many extra portals fit in one orbit before a wider orbit is opened. */
const CLUSTER_CAPACITY = 6;
/** The interactive mouth is slightly wider than the seam it covers. */
export const HIT_SCALE = 1.08;
/**
 * The hard guarantee: a mouth's radius may not exceed this fraction of the
 * distance to its nearest neighbour. 0.45 leaves a 10 % gap between two
 * adjacent mouths, so they can never both claim the same pointer position.
 */
export const MOUTH_SEPARATION = 0.45;

function baseRadiusFor(destination: SpatialSceneId, builtin: boolean): number {
  if (!builtin) return 0.55;
  const kind = destinationFor(destination).kind;
  if (kind === "portal") return 1.15;
  if (kind === "galaxy") return 1.0;
  return 0.9;
}

/** Distance between two adjacent built-in slots on a ring of `radius`. */
export function ringSpacing(radius: number, count: number): number {
  return (Math.PI * 2 * radius) / Math.max(1, count);
}

/** Distance between two portals sharing one orbit of the extras cluster. */
export function orbitSpacing(orbitRadius: number): number {
  return 2 * orbitRadius * Math.sin(Math.PI / CLUSTER_CAPACITY);
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
  // Offsets are expressed in ring units and scaled to the framed radius, so a
  // camera change moves the whole field without changing its shape.
  const unit = ringRadius / RING_RADIUS;
  const visible = records.filter((record) => {
    const kind = destinationFor(record.destination).kind;
    return kind !== "core" && kind !== "cosmos";
  });

  // A built-in portal's slot is its position in the registry's ring order, so
  // it stays put for as long as that destination exists: creating or removing
  // another portal never moves an unrelated one, and a reload puts every
  // portal back where it was.
  const slots = new Map<SpatialSceneId, number>();
  visible.filter(isBuiltinPortal).forEach((record, index) => {
    if (!slots.has(record.destination)) slots.set(record.destination, index);
  });
  const total = Math.max(1, slots.size);

  // Geometry: built-in slots on the main ring, extras in orbits beside the
  // slot of the place they open.
  const builtinSpacing = ringSpacing(ringRadius, total);
  const orbit = Math.max(EXTRA_ORBIT * unit, builtinSpacing * 0.5);

  const extras = new Map<SpatialSceneId, number>();
  const placements: PortalPlacement[] = [];
  for (const record of visible) {
    const builtin = isBuiltinPortal(record);
    const slot = slots.get(record.destination) ?? total - 1;
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
      // Rings of six around the slot, opening outward: an extra portal never
      // lands on the built-in one, and a crowded place grows outward rather
      // than piling up in the same few pixels.
      const ring = Math.floor(orbitIndex / CLUSTER_CAPACITY);
      const within = orbitIndex % CLUSTER_CAPACITY;
      const clusterRadius = orbit * (1 + ring * 1.5);
      const angle = baseAngle + Math.PI + (within / CLUSTER_CAPACITY) * Math.PI * 2;
      offset = {
        x: base.x + Math.cos(angle) * clusterRadius,
        y: base.y + Math.sin(angle) * clusterRadius * 0.62,
        z: 0.4,
      };
    }
    const radius = baseRadiusFor(record.destination, builtin);
    placements.push({
      id: record.id,
      destination: record.destination,
      label: record.label,
      accent: destinationFor(record.destination).accent,
      radius,
      hitRadius: radius * HIT_SCALE,
      builtin,
      orbitIndex,
      offset,
    });
  }
  // Every mouth is then clamped against the distance to ITS nearest neighbour,
  // which is the invariant that makes a click unambiguous: for any pair at
  // distance d, each mouth is at most 0.45·d, so their sum is under d and they
  // cannot both cover one pointer position.
  clampMouths(placements);
  return placements;
}

/**
 * Shrinks any mouth that would cover a neighbour's. Deterministic, single pass,
 * and expressed in the same units the renderer draws, so the visible seam and
 * the interactive mouth stay one object of one size.
 */
function clampMouths(placements: PortalPlacement[]): void {
  for (const placement of placements) {
    let nearest = Number.POSITIVE_INFINITY;
    for (const other of placements) {
      if (other === placement) continue;
      const distance = Math.hypot(
        placement.offset.x - other.offset.x,
        placement.offset.y - other.offset.y,
      );
      if (distance < nearest) nearest = distance;
    }
    if (!Number.isFinite(nearest)) continue;
    const allowed = MOUTH_SEPARATION * nearest;
    if (placement.hitRadius > allowed) {
      placement.hitRadius = allowed;
      placement.radius = allowed / HIT_SCALE;
    }
  }
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
 * Portals drawn at exactly the same offset. Kept for the "no stale duplicate"
 * invariant; overlap of the interactive mouths is `overlappingHitIds`.
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

/**
 * Portals whose interactive mouths actually overlap in the ring plane.
 *
 * This is the measurable form of "a click is answered by the portal aimed at":
 * two coplanar mouths that overlap are a tie in the raycast, and the tie is
 * broken by traversal order rather than by the pointer. Empty is the only
 * acceptable answer for a field that claims to be aimable.
 */
export function overlappingHitIds(placements: readonly PortalPlacement[]): string[] {
  const overlapping = new Set<string>();
  for (let i = 0; i < placements.length; i += 1) {
    for (let j = i + 1; j < placements.length; j += 1) {
      const a = placements[i];
      const b = placements[j];
      const distance = Math.hypot(a.offset.x - b.offset.x, a.offset.y - b.offset.y);
      if (distance < a.hitRadius + b.hitRadius - 1e-6) {
        overlapping.add(a.id);
        overlapping.add(b.id);
      }
    }
  }
  return [...overlapping];
}
