/**
 * LÉLUVERSE — PHYSICS IS A SIMULATION
 *
 * Checks the physical laws the step function must obey, not how
 * it looks: free fall matches g, bounces lose energy by the
 * restitution, settled bodies rest on the floor and sleep, the
 * circular wall contains them, and collisions conserve momentum.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { PhysicsWorld, type Body } from "../src/core/world/Physics";

const bounds = { floorY: 0, centre: [0, 0] as [number, number], radius: 5, gravity: 9.81 };
/** Advance in display frames, as the renderer does (one step() call is capped at 0.25 s). */
const advance = (w: PhysicsWorld, seconds: number) => {
  let awake = true;
  for (let t = 0; t < seconds - 1e-9; t += 1 / 60) awake = w.step(1 / 60);
  return awake;
};
const ball = (id: string, over: Partial<Body> = {}): Body => ({
  id, position: [0, 5, 0], velocity: [0, 0, 0], radius: 0.25, mass: 1, restitution: 0.6, friction: 0.4, dynamic: true, ...over,
});

test("free fall follows g, then the ball bounces lower each time, settles on the floor and sleeps", () => {
  const b = ball("a");
  const w = new PhysicsWorld([b], bounds);
  advance(w, 0.5);
  // y = 5 − ½·g·t² at t = 0.5 → 3.774 (fixed-step Euler is within a few mm).
  assert.ok(Math.abs(b.position[1] - (5 - 0.5 * 9.81 * 0.25)) < 0.03, `free fall y=${b.position[1].toFixed(3)}`);

  const peaks: number[] = [];
  let rising = false;
  let last = b.position[1];
  for (let t = 0; t < 10 && !b.sleeping; t += 1 / 60) {
    w.step(1 / 60);
    if (b.position[1] > last) rising = true;
    else if (rising) {
      peaks.push(last);
      rising = false;
    }
    last = b.position[1];
  }
  assert.ok(peaks.length >= 2, `bounced ${peaks.length} times`);
  for (let i = 1; i < peaks.length; i++) assert.ok(peaks[i] < peaks[i - 1], "each bounce is lower");
  // Bounce height scales by e² (0.36) per bounce from the drop height.
  assert.ok(Math.abs((peaks[0] - 0.25) / (5 - 0.25) - 0.36) < 0.05, `first rebound ratio ${((peaks[0] - 0.25) / 4.75).toFixed(3)}`);
  assert.equal(b.sleeping, true, "comes to rest and sleeps");
  assert.ok(Math.abs(b.position[1] - 0.25) < 1e-6, "resting on the floor");
});

test("the circular wall contains bodies and friction stops a sliding ball", () => {
  const b = ball("a", { position: [0, 0.25, 0], velocity: [20, 0, 3] });
  const w = new PhysicsWorld([b], bounds);
  for (let t = 0; t < 15; t += 1 / 60) {
    w.step(1 / 60);
    assert.ok(Math.hypot(b.position[0], b.position[2]) <= 5 - 0.25 + 1e-9, "inside the room");
  }
  assert.equal(b.sleeping, true, "friction brought it to rest");
});

test("collisions conserve momentum; equal elastic masses exchange velocities; static bodies do not move", () => {
  const noGravity = { ...bounds, gravity: 0, radius: 100, floorY: -100 };
  const a = ball("a", { position: [-1, 0, 0], velocity: [2, 0, 0], restitution: 1 });
  const c = ball("c", { position: [1, 0, 0], velocity: [-1, 0, 0], restitution: 1 });
  const w = new PhysicsWorld([a, c], noGravity);
  const p0 = a.mass * a.velocity[0] + c.mass * c.velocity[0];
  advance(w, 1.5);
  const p1 = a.mass * a.velocity[0] + c.mass * c.velocity[0];
  assert.ok(Math.abs(p1 - p0) < 1e-9, "momentum conserved");
  assert.ok(Math.abs(a.velocity[0] - -1) < 1e-6 && Math.abs(c.velocity[0] - 2) < 1e-6, "velocities exchanged");

  const wall = ball("w", { position: [1, 0, 0], dynamic: false, radius: 0.5 });
  const d = ball("d", { position: [-1, 0, 0], velocity: [3, 0, 0], restitution: 1 });
  advance(new PhysicsWorld([wall, d], noGravity), 1);
  assert.deepEqual(wall.position, [1, 0, 0], "static body unmoved");
  assert.ok(d.velocity[0] < 0, "dynamic body rebounds");
});

test("energy never increases (inelastic floor, inelastic collisions)", () => {
  const bodies = [ball("a"), ball("b", { position: [0.1, 7, 0.05] }), ball("c", { position: [-0.05, 9, 0] })];
  const w = new PhysicsWorld(bodies, bounds);
  let e = w.energy();
  for (let t = 0; t < 6; t += 1 / 60) {
    w.step(1 / 60);
    const next = w.energy();
    assert.ok(next <= e + 0.05, `energy rose from ${e.toFixed(3)} to ${next.toFixed(3)}`);
    e = next;
  }
  assert.equal(advance(w, 10), false, "everything settles");
});
