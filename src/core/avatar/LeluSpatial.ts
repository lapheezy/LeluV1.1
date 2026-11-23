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

/*
 * ----------------------------------------------------------
 * PATHS (M15.3 WP03)
 *
 * `stepTowards` alone is greedy: a blocked step is pushed to the nearest
 * free ground, which can be BACK the way she came. Two footprints that
 * together make a concave pocket (measured: an open chat window projected
 * as a 2.2 m footprint beside the Core) trapped her there, oscillating
 * around one point for over half a minute while a free corridor existed.
 *
 * `planPath` finds a way round with A* on a small grid over the same
 * walkable disc and the same `isOccupied` rule, then pulls the path tight
 * so she walks straight lines between corners. `walkPath` follows it with
 * the same collision-checked `stepTowards` increments. There is still one
 * occupancy rule and one stepper: the path only chooses where to aim.
 * ----------------------------------------------------------
 */

/** Is `point` inside the walkable disc (with `clearance` from the wall)? */
function insideRoom(point: GroundPoint, bounds: SpatialBounds, clearance: number): boolean {
  const limit = Math.max(0, bounds.radius - Math.max(0, clearance));
  return distance(point, bounds.centre) <= limit + 1e-6;
}

/** Can she walk the straight segment from `a` to `b`? Sampled every 5 cm. */
export function segmentClear(
  a: GroundPoint,
  b: GroundPoint,
  bounds: SpatialBounds,
  obstacles: readonly SpatialObstacle[],
  clearance = 0,
  viewer: GroundPoint | null = null,
): boolean {
  const n = Math.max(1, Math.ceil(distance(a, b) / 0.05));
  for (let i = 1; i <= n; i += 1) {
    const f = i / n;
    const p: GroundPoint = [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
    if (!insideRoom(p, bounds, clearance) || isOccupied(p, obstacles, clearance, viewer)) return false;
  }
  return true;
}

/** Total length of a walk through `points`, starting at `from`. */
export function pathLength(from: GroundPoint, points: readonly GroundPoint[]): number {
  let total = 0;
  let at = from;
  for (const p of points) {
    total += distance(at, p);
    at = p;
  }
  return total;
}

/**
 * A walkable route from `from` to `to`: the corners to aim at, ending at
 * `to`. Returns `null` when no free way exists (she must say so, not
 * push through). `from` may lie inside a footprint (a window can open
 * over where she stands): the route then starts by stepping out of it by
 * the smallest real distance, as `nearestFree` always has.
 */
export function planPath(
  from: GroundPoint,
  to: GroundPoint,
  bounds: SpatialBounds,
  obstacles: readonly SpatialObstacle[],
  clearance = 0,
  viewer: GroundPoint | null = null,
  cell = 0.2,
): GroundPoint[] | null {
  /*
   * Legs are planned PLAN_MARGIN wider than she walks (M15.3 WP05). A
   * pulled-tight leg used to graze a footprint by a centimetre; the
   * stepper's next increment then dipped inside, was deflected back by
   * `nearestFree`'s 0.2 m ring, and she oscillated in place (measured:
   * 8 s stuck beside the Core on a walk asked before her world existed).
   * The requested point and her start keep the normal clearance; if no
   * route exists with the margin, the exact WP03 plan is used.
   */
  return (
    planPathWith(from, to, bounds, obstacles, clearance + PLAN_MARGIN, clearance, viewer, cell) ??
    planPathWith(from, to, bounds, obstacles, clearance, clearance, viewer, cell)
  );
}

/** The free point on the nearest free ring around `from` that is closest to `toward`. */
function stepOutToward(
  from: GroundPoint,
  toward: GroundPoint,
  bounds: SpatialBounds,
  obstacles: readonly SpatialObstacle[],
  clearance: number,
  viewer: GroundPoint | null,
): GroundPoint | null {
  const step = Math.max(0.1, Math.max(0, clearance) * 0.25);
  for (let ring = 1; ring <= 48; ring += 1) {
    const radius = ring * step;
    const samples = Math.max(16, Math.ceil((Math.PI * 2 * radius) / (step * 0.5)));
    let best: GroundPoint | null = null;
    let bestD = Number.POSITIVE_INFINITY;
    for (let i = 0; i < samples; i += 1) {
      const a = (i / samples) * Math.PI * 2;
      const c = clampToRoom([from[0] + Math.cos(a) * radius, from[1] + Math.sin(a) * radius], bounds, clearance);
      const p: GroundPoint = [c[0], c[2]];
      if (isOccupied(p, obstacles, clearance, viewer) || !insideRoom(p, bounds, clearance)) continue;
      const d = distance(p, toward);
      if (d < bestD) { bestD = d; best = p; }
    }
    if (best) return best;
  }
  return null;
}

/** Extra width a planned leg keeps from every footprint. */
export const PLAN_MARGIN = 0.08;

function planPathWith(
  from: GroundPoint,
  to: GroundPoint,
  bounds: SpatialBounds,
  obstacles: readonly SpatialObstacle[],
  clearance: number,
  endClearance: number,
  viewer: GroundPoint | null,
  cell: number,
): GroundPoint[] | null {
  const free = (p: GroundPoint) => insideRoom(p, bounds, clearance) && !isOccupied(p, obstacles, clearance, viewer);
  if (!(insideRoom(to, bounds, endClearance) && !isOccupied(to, obstacles, endClearance, viewer))) return null;
  // A leg is clear with the margin, or (only for the leg that ends at the
  // requested point) with her normal clearance.
  const clear = (a: GroundPoint, b: GroundPoint) =>
    segmentClear(a, b, bounds, obstacles, clearance, viewer) ||
    (b === to && endClearance !== clearance && segmentClear(a, b, bounds, obstacles, endClearance, viewer));
  const route: GroundPoint[] = [];
  let start = from;
  if (!free(from)) {
    // Out by the smallest real distance, on the side toward the goal (the
    // plain nearestFree takes the first free sample from due east, which
    // sent her the wrong way round the Core first: M15.3 WP05).
    const out = stepOutToward(from, to, bounds, obstacles, clearance, viewer) ?? (() => { const o = nearestFree(from, bounds, obstacles, clearance, viewer); return [o[0], o[2]] as GroundPoint; })();
    start = out;
    if (!free(start)) return null;
    route.push(start);
  }
  if (clear(start, to)) return [...route, to];

  // Grid over the disc's bounding square.
  const limit = Math.max(0, bounds.radius - Math.max(0, clearance));
  const x0 = bounds.centre[0] - limit;
  const z0 = bounds.centre[1] - limit;
  const n = Math.max(2, Math.ceil((limit * 2) / cell) + 1);
  const at = (i: number, j: number): GroundPoint => [x0 + i * cell, z0 + j * cell];
  const open = new Uint8Array(n * n);
  for (let j = 0; j < n; j += 1) for (let i = 0; i < n; i += 1) open[j * n + i] = free(at(i, j)) ? 1 : 0;

  // Enter and leave the grid at the nearest open cell with a clear line.
  const attach = (p: GroundPoint): number => {
    const ci = Math.round((p[0] - x0) / cell);
    const cj = Math.round((p[1] - z0) / cell);
    let best = -1;
    let bestD = Number.POSITIVE_INFINITY;
    for (let r = 0; r <= 3 && best < 0; r += 1) {
      for (let j = cj - r; j <= cj + r; j += 1) {
        for (let i = ci - r; i <= ci + r; i += 1) {
          if (i < 0 || j < 0 || i >= n || j >= n || !open[j * n + i]) continue;
          const c = at(i, j);
          const d = distance(p, c);
          if (d < bestD && (p === to ? clear(c, to) : segmentClear(p, c, bounds, obstacles, clearance, viewer))) {
            best = j * n + i;
            bestD = d;
          }
        }
      }
    }
    return best;
  };
  const s = attach(start);
  const g = attach(to);
  if (s < 0 || g < 0) return null;

  // A* (8-connected; a diagonal needs both of its side cells open).
  const gScore = new Float64Array(n * n).fill(Number.POSITIVE_INFINITY);
  const came = new Int32Array(n * n).fill(-1);
  const closed = new Uint8Array(n * n);
  const gx = g % n;
  const gz = Math.floor(g / n);
  const h = (k: number) => Math.hypot((k % n) - gx, Math.floor(k / n) - gz) * cell;
  const heap: Array<[number, number]> = [];
  const push = (k: number, f: number) => {
    heap.push([f, k]);
    let c = heap.length - 1;
    while (c > 0) {
      const p = (c - 1) >> 1;
      if (heap[p][0] <= heap[c][0]) break;
      [heap[p], heap[c]] = [heap[c], heap[p]];
      c = p;
    }
  };
  const pop = (): number => {
    const top = heap[0][1];
    const last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      let c = 0;
      for (;;) {
        const l = c * 2 + 1;
        const r = l + 1;
        let m = c;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === c) break;
        [heap[m], heap[c]] = [heap[c], heap[m]];
        c = m;
      }
    }
    return top;
  };
  gScore[s] = 0;
  push(s, h(s));
  let found = false;
  while (heap.length) {
    const k = pop();
    if (closed[k]) continue;
    if (k === g) {
      found = true;
      break;
    }
    closed[k] = 1;
    const ki = k % n;
    const kj = Math.floor(k / n);
    for (let dj = -1; dj <= 1; dj += 1) {
      for (let di = -1; di <= 1; di += 1) {
        if (!di && !dj) continue;
        const i = ki + di;
        const j = kj + dj;
        if (i < 0 || j < 0 || i >= n || j >= n) continue;
        const m = j * n + i;
        if (!open[m] || closed[m]) continue;
        if (di && dj && (!open[kj * n + i] || !open[j * n + ki])) continue;
        const cost = gScore[k] + (di && dj ? Math.SQRT2 : 1) * cell;
        if (cost < gScore[m]) {
          gScore[m] = cost;
          came[m] = k;
          push(m, cost + h(m));
        }
      }
    }
  }
  if (!found) return null;

  const cells: GroundPoint[] = [];
  for (let k = g; k >= 0; k = came[k]) {
    cells.unshift(at(k % n, Math.floor(k / n)));
    if (k === s) break;
  }
  // Pull the route tight: from each corner, aim at the farthest point in sight.
  const raw: GroundPoint[] = [start, ...cells, to];
  let i = 0;
  while (i < raw.length - 1) {
    let j = raw.length - 1;
    while (j > i + 1 && !clear(raw[i], raw[j])) j -= 1;
    route.push(raw[j]);
    i = j;
  }
  return route;
}

/** Progress along a planned route. */
export interface PathWalk {
  waypoints: GroundPoint[];
  /** The waypoint she is walking to now. */
  index: number;
}

/**
 * Walk `seconds` along a route in collision-checked increments of at most
 * `substep` seconds (the same `stepTowards` every walk uses). Speed eases
 * down only near the END of the route, not at every corner.
 * `onStep` sees each increment (the presence turns her with it).
 */
export function walkPath(
  from: GroundPoint,
  walk: PathWalk,
  seconds: number,
  speed: number,
  bounds: SpatialBounds,
  obstacles: readonly SpatialObstacle[],
  clearance = 0,
  viewer: GroundPoint | null = null,
  onStep?: (from: GroundPoint, to: GroundPoint, dt: number) => void,
  substep = 0.1,
): { position: GroundPoint; moved: boolean } {
  const steps = Math.max(1, Math.ceil(Math.max(0, seconds) / substep));
  const dt = Math.max(0, seconds) / steps;
  let position = from;
  let moved = false;
  for (let k = 0; k < steps; k += 1) {
    // Corners within 12 cm count as reached.
    while (walk.index < walk.waypoints.length - 1 && distance(position, walk.waypoints[walk.index]) <= 0.12) walk.index += 1;
    const aim = walk.waypoints[walk.index];
    if (!aim) break;
    const left = distance(position, aim) + pathLength(aim, walk.waypoints.slice(walk.index + 1));
    if (left <= 0.06) break;
    const step = stepTowards(position, aim, Math.min(speed, left * 1.8) * dt, bounds, obstacles, clearance, viewer);
    if (!step.moving) break;
    onStep?.(position, step.position, dt);
    position = step.position;
    moved = true;
  }
  while (walk.index < walk.waypoints.length - 1 && distance(position, walk.waypoints[walk.index]) <= 0.12) walk.index += 1;
  return { position, moved };
}

/** How far she still has to walk on this route. */
export function remainingOnPath(position: GroundPoint, walk: PathWalk): number {
  const aim = walk.waypoints[walk.index];
  if (!aim) return 0;
  return distance(position, aim) + pathLength(aim, walk.waypoints.slice(walk.index + 1));
}
