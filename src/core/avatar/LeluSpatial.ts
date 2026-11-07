/**
 * ==========================================================
 * LÉLU — SPATIAL POLICY
 *
 * The single source of truth for where LÉLU may stand and how she gets
 * there. It is deliberately pure: no three.js, no React, no DOM. The
 * presence component owns the refs and the frame loop; this module only
 * answers three questions.
 *
 *   1. clampToRoom  — is that point inside the walkable disc?
 *   2. isOccupied   — does furniture, a workspace window or the viewer
 *                     already hold that point?
 *   3. planSpatialTarget / stepTowards — where should she go next, and what
 *                     is the next safe increment of that walk?
 *
 * Two rules matter more than the geometry:
 *
 *   - A manual placement outranks everything. Once the person has dragged
 *     her somewhere, autonomy must not walk her back.
 *   - She never overlaps furniture. If the intended point is taken, she
 *     steps to the nearest genuinely free point instead of pushing into it.
 *
 * Ground coordinates are `[x, z]`; a solved world point is `[x, y, z]` so it
 * can be written straight into a `THREE.Vector3`.
 * ==========================================================
 */

/** The walkable disc and the height she stands on. */
export interface SpatialBounds {
  /** Centre of the room on the ground plane: `[x, z]`. */
  centre: [number, number];
  /** Walkable radius, before clearance. */
  radius: number;
  /** The floor height her feet rest on. */
  floorY: number;
}

/** Something she may not stand inside: furniture, a window footprint, a prop. */
export interface SpatialObstacle {
  id: string;
  x: number;
  z: number;
  radius: number;
}

/** A point on the ground plane. */
export type GroundPoint = [number, number];

/** A solved position in world space. */
export type WorldPoint = [number, number, number];

/** Where her current activity belongs, as an offset from the room centre. */
const ACTIVITY_ANCHORS: Record<string, GroundPoint> = {
  IDLE: [0, 1.3],
  LISTENING: [0, 1.5],
  THINKING: [0, 1.1],
  SPEAKING: [0, 1.5],
  WORKING: [-1.7, 1.1],
  BUILDING: [-1.7, 1.1],
  RENDERING: [-1.7, 1.1],
  SEARCHING: [1.7, 1.1],
  BROWSING: [1.7, 1.1],
  EXPLORING: [1.7, 1.1],
  PRESENTING: [0, 2.1],
};

const distance = (a: GroundPoint, b: GroundPoint): number =>
  Math.hypot(a[0] - b[0], a[1] - b[1]);

/** The viewer is a soft obstacle: she should not stand in the camera. */
const VIEWER_RADIUS = 0.45;

/**
 * Keep a point inside the walkable disc, leaving `clearance` from the wall.
 * Returns a world point so callers can use it directly.
 */
export function clampToRoom(
  point: GroundPoint,
  bounds: SpatialBounds,
  clearance = 0,
): WorldPoint {
  const limit = Math.max(0, bounds.radius - Math.max(0, clearance));
  const dx = point[0] - bounds.centre[0];
  const dz = point[1] - bounds.centre[1];
  const length = Math.hypot(dx, dz);
  if (length === 0) return [point[0], bounds.floorY, point[1]];
  if (length <= limit) return [point[0], bounds.floorY, point[1]];
  const scale = limit / length;
  return [bounds.centre[0] + dx * scale, bounds.floorY, bounds.centre[1] + dz * scale];
}

/**
 * Is this ground point already held by something? `clearance` is her body
 * radius plus a margin, so "occupied" means "she would overlap it".
 */
export function isOccupied(
  point: GroundPoint,
  obstacles: readonly SpatialObstacle[],
  clearance = 0,
  viewer: GroundPoint | null = null,
): boolean {
  const margin = Math.max(0, clearance);
  for (const obstacle of obstacles) {
    if (!obstacle) continue;
    const radius = Math.max(0, obstacle.radius ?? 0) + margin;
    if (distance(point, [obstacle.x, obstacle.z]) < radius) return true;
  }
  if (viewer && distance(point, viewer) < VIEWER_RADIUS + margin * 0.5) return true;
  return false;
}

/**
 * The nearest point she can actually stand on. Searches outward in rings from
 * the requested point, so a blocked window footprint pushes her aside by the
 * smallest real distance instead of teleporting her across the room. If the
 * room is genuinely full she stays where she is; overlap is never preferred
 * over refusing to move.
 */
export function nearestFree(
  point: GroundPoint,
  bounds: SpatialBounds,
  obstacles: readonly SpatialObstacle[],
  clearance = 0,
  viewer: GroundPoint | null = null,
): WorldPoint {
  const origin = clampToRoom(point, bounds, clearance);
  if (!isOccupied([origin[0], origin[2]], obstacles, clearance, viewer)) return origin;

  const step = Math.max(0.2, Math.max(0, clearance) * 0.5);
  for (let ring = 1; ring <= 24; ring += 1) {
    const radius = ring * step;
    const samples = Math.max(8, Math.ceil((Math.PI * 2 * radius) / step));
    for (let index = 0; index < samples; index += 1) {
      const angle = (index / samples) * Math.PI * 2;
      const candidate: GroundPoint = [
        origin[0] + Math.cos(angle) * radius,
        origin[2] + Math.sin(angle) * radius,
      ];
      const inside = clampToRoom(candidate, bounds, clearance);
      if (!isOccupied([inside[0], inside[2]], obstacles, clearance, viewer)) return inside;
    }
  }
  return origin;
}

export interface SpatialPlanInput {
  activity: string;
  /** Where she is now. */
  current: GroundPoint;
  /** A placement the person chose by dragging. Outranks everything. */
  preferred: GroundPoint | null;
  /** The camera, so she does not stand in the viewer's face. */
  viewer: GroundPoint | null;
  /** The work in progress she should stand near, if any. */
  focus: GroundPoint | null;
  bounds: SpatialBounds;
  obstacles: readonly SpatialObstacle[];
  clearance: number;
}

/**
 * Choose her next standing position. Priority is intentional and stable:
 *
 *   1. a manual placement wins, forever, until the person moves her again;
 *   2. otherwise the work in progress pulls her to a free spot beside it;
 *   3. otherwise her activity's anchor;
 *   4. otherwise she keeps the free ground she already holds.
 *
 * Step 4 is what makes the result calm: an unblocked avatar does not pace
 * for no reason, and an avatar whose anchor is taken by a window steps only
 * as far as it must (the documented "avoid occupied space" movement).
 */
export function planSpatialTarget(input: SpatialPlanInput): WorldPoint {
  const { activity, current, preferred, viewer, focus, bounds, obstacles, clearance } = input;

  const free = (point: GroundPoint): WorldPoint | null => {
    const inside = clampToRoom(point, bounds, clearance);
    return isOccupied([inside[0], inside[2]], obstacles, clearance, viewer) ? null : inside;
  };

  // 1. Manual placement is authoritative. Autonomy never undoes a drag.
  if (preferred) {
    const chosen = free(preferred);
    if (chosen) return chosen;
  }

  // 2. Stand beside the work in progress, on whichever side is free.
  if (focus) {
    const offsets: GroundPoint[] = [
      [0.95, 0.95],
      [-0.95, 0.95],
      [0.95, -0.95],
      [-0.95, -0.95],
    ];
    for (const offset of offsets) {
      const chosen = free([focus[0] + offset[0], focus[1] + offset[1]]);
      if (chosen) return chosen;
    }
  }

  // 3. Her role's anchor, if that ground is free.
  const anchor =
    ACTIVITY_ANCHORS[String(activity ?? "").toUpperCase()] ?? ACTIVITY_ANCHORS.IDLE;
  const anchorPoint: GroundPoint = [bounds.centre[0] + anchor[0], bounds.centre[1] + anchor[1]];
  const anchored = free(anchorPoint);
  if (anchored) return anchored;

  // 4. The anchor is held by furniture or a window: take the closest free
  //    ground instead of overlapping it.
  const nearest = nearestFree(anchorPoint, bounds, obstacles, clearance, viewer);
  if (!isOccupied([nearest[0], nearest[2]], obstacles, clearance, viewer)) return nearest;

  // 5. Nothing is free: keep the ground she already holds.
  const here = free(current);
  return here ?? [current[0], bounds.floorY, current[1]];
}

export interface SpatialStep {
  moving: boolean;
  /** Next ground position: `[x, z]`. */
  position: GroundPoint;
  /** True when an obstacle forced a detour on this step. */
  deflected: boolean;
}

/**
 * The next safe increment of a walk. Movement is capped by `maxStep`, so the
 * presence can accelerate and decelerate smoothly instead of teleporting. A
 * blocked straight line is deflected to the nearest free ground; if even that
 * is blocked she holds still rather than pushing through furniture.
 */
export function stepTowards(
  from: GroundPoint,
  to: GroundPoint,
  maxStep: number,
  bounds: SpatialBounds,
  obstacles: readonly SpatialObstacle[],
  clearance = 0,
  viewer: GroundPoint | null = null,
): SpatialStep {
  if (!(maxStep > 0)) return { moving: false, position: from, deflected: false };

  const dx = to[0] - from[0];
  const dz = to[1] - from[1];
  const length = Math.hypot(dx, dz);
  if (length < 1e-6) return { moving: false, position: from, deflected: false };

  const travel = Math.min(maxStep, length);
  const candidate: GroundPoint = [from[0] + (dx / length) * travel, from[1] + (dz / length) * travel];
  const inside = clampToRoom(candidate, bounds, clearance);

  if (!isOccupied([inside[0], inside[2]], obstacles, clearance, viewer)) {
    return { moving: true, position: [inside[0], inside[2]], deflected: false };
  }

  const deflect = nearestFree([inside[0], inside[2]], bounds, obstacles, clearance, viewer);
  if (isOccupied([deflect[0], deflect[2]], obstacles, clearance, viewer)) {
    return { moving: false, position: from, deflected: true };
  }
  return { moving: true, position: [deflect[0], deflect[2]], deflected: true };
}
