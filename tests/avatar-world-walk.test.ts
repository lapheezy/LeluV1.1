/**
 * M15.3 WP03: her first world walk under load.
 *
 * The geometry below is the measured state of her world during the failing
 * walk (docs/missions/m15-home/avatar-15.3/wp03/trace-*-world.json): the
 * "home" room (centre [0, 2.2], radius 6.5), its four fixed obstacles, and
 * the open chat window projected onto the floor as a 2.2 m footprint. She
 * started at (0.27, 3.99), inside that footprint, and was asked to walk to
 * the Studio approach point (-3.99, 0.26).
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  isOccupied,
  planPath,
  remainingOnPath,
  segmentClear,
  stepTowards,
  walkPath,
  type GroundPoint,
  type SpatialBounds,
  type SpatialObstacle,
} from "../src/core/avatar/LeluSpatial";

const CLEARANCE = 0.38;
const WALK_SPEED = 1.15;
const bounds: SpatialBounds = { centre: [0, 2.2], radius: 6.5, floorY: -2.55 };
const scene: SpatialObstacle[] = [
  { id: "core", x: 0, z: 2.0, radius: 1.55 },
  { id: "studio", x: -4.5, z: -1.05, radius: 0.8 },
  { id: "lab", x: 4.5, z: -1.05, radius: 0.8 },
  { id: "vault", x: 0, z: -2.1, radius: 0.8 },
];
const chatWindow: SpatialObstacle = { id: "window:chat", x: 0.31, z: 2.78, radius: 2.2 };
const traced = [...scene, chatWindow];
const start: GroundPoint = [0.27, 3.99];
const studio: GroundPoint = [-3.99, 0.26];
const dist = (a: GroundPoint, b: GroundPoint) => Math.hypot(a[0] - b[0], a[1] - b[1]);

test("WP03 root cause: the greedy stepper alone is trapped by the window + Core pocket (as traced)", () => {
  // The WP02 loop: per frame, up to 5 s of elapsed time in 0.1 s steps aimed
  // straight at the goal. 1 frame/s, 60 s.
  let at = start;
  for (let frame = 0; frame < 60; frame += 1) {
    for (let k = 0; k < 10; k += 1) {
      const left = dist(at, studio);
      if (left <= 0.06) break;
      const s = stepTowards(at, studio, Math.min(WALK_SPEED, left * 1.8) * 0.1, bounds, traced, CLEARANCE, null);
      if (!s.moving) break;
      at = s.position;
    }
  }
  assert.ok(dist(at, studio) > 3, `the greedy walk should be stuck far from the Studio (got ${dist(at, studio).toFixed(2)} m)`);
});

test("WP03: a free way round exists, and the planned route never enters occupied ground", () => {
  const route = planPath(start, studio, bounds, traced, CLEARANCE, null);
  assert.ok(route, "a route exists");
  const end = route[route.length - 1];
  assert.deepEqual(end, studio, "the route ends at the requested point, not a substitute");
  // Every leg after stepping out of the footprint she started in is clear.
  for (let i = 1; i < route.length; i += 1) assert.ok(segmentClear(route[i - 1], route[i], bounds, traced, CLEARANCE, null), `leg ${i} is clear`);
  assert.ok(!isOccupied(route[0], traced, CLEARANCE, null), "she first steps out of the window's footprint");
});

for (const fps of [1, 0.2]) {
  test(`WP03: following the route she arrives within the 20 s deadline at ${fps} frame/s`, () => {
    const route = planPath(start, studio, bounds, traced, CLEARANCE, null)!;
    const walk = { waypoints: route, index: 0 };
    let at = start;
    let seconds = 0;
    while (seconds < 20 && dist(at, studio) > 0.1) {
      const frame = Math.min(5, 1 / fps);
      at = walkPath(at, walk, frame, WALK_SPEED, bounds, traced, CLEARANCE, null).position;
      seconds += 1 / fps;
    }
    assert.ok(dist(at, studio) <= 0.1, `arrived (measured ${dist(at, studio).toFixed(3)} m from the goal after ${seconds} s)`);
    assert.ok(seconds <= 20, `within the deadline (${seconds} s)`);
    assert.equal(remainingOnPath(at, walk) <= 0.1, true);
  });
}

test("WP03: an enclosed goal has no route (she must decline as blocked, not push through)", () => {
  const wall: SpatialObstacle[] = [];
  for (let a = 0; a < Math.PI * 2; a += Math.PI / 12) wall.push({ id: `ring${a}`, x: -3 + Math.cos(a) * 1.2, z: 0 + Math.sin(a) * 1.2, radius: 0.3 });
  assert.equal(planPath([3, 3], [-3, 0], bounds, wall, CLEARANCE, null), null);
});

test("WP03: a straight free line is one leg (no needless corners)", () => {
  assert.deepEqual(planPath([2, 4], [3, 5], bounds, scene, CLEARANCE, null), [[3, 5]]);
});

test("WP03: the presence waits for her world before aiming, keeps the goal across loads, and reports exactly once", () => {
  const presence = readFileSync("src/app/scene/genesis/LeluV2Presence.tsx", "utf8");
  // Navigation readiness: the goal is aimed only once her world has loaded.
  assert.match(presence, /navReady\.current/);
  assert.match(presence, /if \(!asked\.ready\)/);
  // A command issued before she mounted is picked up from the bus, once.
  assert.match(presence, /const pending = bus\.current;/);
  assert.match(presence, /handledCommand\.current === command\.id/);
  // Paths come from the one spatial policy; no second navigation authority.
  assert.match(presence, /planPath\(/);
  assert.match(presence, /walkPath\(/);
  assert.doesNotMatch(presence, /new (NavMesh|Pathfinder|Navigation)/);
  // One resolution: the bus is told once; later outcomes go to telemetry only.
  assert.match(presence, /function resolve\(/);
  assert.match(presence, /if \(asked\.resolved\) return;/);
  // Stall detection keeps running after a progress report.
  assert.doesNotMatch(presence, /if \(asked && !asked\.confirmed && !isDragging\)/);
  // Time spent paused before the command existed is not credited to the walk.
  assert.match(presence, /walkSeconds = Math\.min\(elapsed, \(now - asked\.startedAt\) \/ 1000\)/);
});
