/**
 * M15.3 WP05: walks that must not stall. Geometry and start are the
 * measured state of scenario C (wp04/scenarios/wp05-repro-desktop):
 * her default spot (0, 3.3) inside the Core's footprint, no chat window,
 * goal the Studio approach point.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { isOccupied, planPath, PLAN_MARGIN, segmentClear, walkPath, type GroundPoint, type SpatialBounds, type SpatialObstacle } from "../src/core/avatar/LeluSpatial";

const bounds: SpatialBounds = { centre: [0, 2.2], radius: 6.5, floorY: -2.55 };
const scene: SpatialObstacle[] = [
  { id: "core", x: 0, z: 2.0, radius: 1.55 },
  { id: "studio", x: -4.5, z: -1.05, radius: 0.8 },
  { id: "lab", x: 4.5, z: -1.05, radius: 0.8 },
  { id: "vault", x: 0, z: -2.1, radius: 0.8 },
];
const C = 0.38;
const dist = (a: GroundPoint, b: GroundPoint) => Math.hypot(a[0] - b[0], a[1] - b[1]);

test("WP05: from her default spot inside the Core, the walk to the Studio does not stall on a grazing leg", () => {
  const start: GroundPoint = [0, 3.3];
  const goal: GroundPoint = [-3.99, 0.26];
  const route = planPath(start, goal, bounds, scene, C, null)!;
  assert.ok(route);
  assert.deepEqual(route[route.length - 1], goal, "the requested point is unchanged");
  const walk = { waypoints: route, index: 0 };
  let at = start;
  let seconds = 0;
  while (seconds < 15 && dist(at, goal) > 0.1) {
    at = walkPath(at, walk, 1, 1.15, bounds, scene, C, null).position;
    seconds += 1;
  }
  assert.ok(dist(at, goal) <= 0.1, `arrived (${dist(at, goal).toFixed(3)} m after ${seconds} s)`);
  assert.ok(seconds <= 8, `in about the time the distance takes (${seconds} s); WP04 code oscillated in place`);
});

test("WP05: inner legs keep the planning margin; the margin never moves the requested point", () => {
  const route = planPath([0.3, 3.99], [-3.99, 0.26], bounds, scene, C, null)!;
  for (let i = 1; i < route.length - 1; i += 1) assert.ok(segmentClear(route[i - 1], route[i], bounds, scene, C + PLAN_MARGIN, null), `leg ${i} keeps the margin`);
  // A goal reachable only with the normal clearance is still reachable.
  const tight: GroundPoint = [0, 2.0 + 1.55 + C + 0.02];
  assert.ok(!isOccupied(tight, scene, C, null));
  assert.ok(planPath([3, 5], tight, bounds, scene, C, null), "a goal inside the margin band is still planned (normal-clearance fallback)");
});

test("WP05: a command a presence takes on is marked accepted; an answer clears it", async () => {
  const { default: AvatarCommandBus } = await import("../src/core/avatar/AvatarCommandBus");
  const bus = AvatarCommandBus.getInstance();
  let id = "";
  const off = bus.subscribe((c) => { id = c.id; });
  const pending = bus.issue("move", "walk to the studio", 20_000, { place: "studio" });
  off();
  assert.equal(bus.isAccepted(id), false, "nobody has taken it yet");
  bus.accept(id);
  assert.equal(bus.isAccepted(id), true);
  bus.confirm(id, "arrived");
  assert.equal(await pending, "arrived");
  assert.equal(bus.isAccepted(id), false, "answered exactly once, then forgotten");
  bus.accept(id);
  assert.equal(bus.isAccepted(id), false, "an answered command cannot be accepted again");
});

test("WP05: honest states — not in her world, not set off yet, on her way", async () => {
  const { readFileSync } = await import("node:fs");
  const presence = readFileSync("src/app/scene/genesis/LeluV2Presence.tsx", "utf8");
  assert.match(presence, /AvatarCommandBus\.getInstance\(\)\.accept\(command\.id\)/, "the world presence marks what it takes on");
  assert.match(presence, /my world is still loading .*haven't started walking yet/, "initialising: not walking yet");
  assert.match(presence, /walked < 0\.05[\s\S]*haven't set off yet/, "aimed but not moved: not 'on my way'");
  assert.match(presence, /I'm still on my way \(\$\{walked/, "walking: measured progress");
  const companion = readFileSync("src/app/scene/genesis/avatar/LeluCompanion.tsx", "utf8");
  assert.match(companion, /if \(bus\.isAccepted\(command\.id\) \|\| bus\.current\?\.id !== command\.id\) return;/, "only when nobody took it on");
  assert.match(companion, /I'm not in my world right now, so I haven't started/);
  assert.match(companion, /command\.issuedAt \+ command\.timeoutMs - 600 - Date\.now\(\)/, "just before the bus's own deadline, same clock");
});
