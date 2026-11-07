import assert from "node:assert/strict";
import test from "node:test";

import {
  GATE,
  NPC,
  OBSTACLES,
  SHARDS,
  WORLD,
  circleIntersectsRect,
  collectNearby,
  createState,
  interact,
  isBlocked,
  movePlayer,
  questLabel,
  shardCount,
  step,
} from "../src/logic.js";

test("a new run starts at the spawn with every shard uncollected", () => {
  const state = createState();
  assert.deepEqual(state.player, { x: 0, z: 8 });
  assert.equal(shardCount(state), 0);
  assert.equal(state.gateOpen, false);
  assert.equal(state.won, false);
  assert.equal(questLabel(state), "Speak to the Keeper");
});

test("the spawn point and world edge behave consistently", () => {
  const state = createState();
  assert.equal(isBlocked(state, 0, 8), false);
  assert.equal(isBlocked(state, 0, WORLD.half + 1), true);
  assert.equal(isBlocked(state, -5, -2), true, "the first pillar occupies the centre-left");
});

test("circle/rectangle collision is exact at the boundary", () => {
  const rect = { x: 0, z: 0, w: 2, d: 2 };
  assert.equal(circleIntersectsRect(0.9, 0, 0.2, rect), true);
  assert.equal(circleIntersectsRect(1.4, 0, 0.2, rect), false);
  assert.equal(circleIntersectsRect(0, 0, 0.45, rect), true);
});

test("moving into a pillar is refused and counted as a collision", () => {
  const state = { ...createState(), player: { x: -5, z: 0.2 } };
  const moved = movePlayer(state, 0, -1);
  assert.equal(moved.player.z, 0.2, "the pillar blocks forward movement");
  assert.equal(moved.collisions, 1);
});

test("movement slides along a wall instead of sticking", () => {
  const state = { ...createState(), player: { x: 0, z: -9.5 } };
  const moved = movePlayer(state, 1.2, -1);
  assert.equal(moved.player.z, -9.5, "the long wall blocks Z");
  assert.equal(moved.player.x, 1.2, "and X still moves, without sticking");
});

test("walking onto a shard collects it and hides the dialogue", () => {
  const shard = SHARDS[0];
  const state = { ...createState(), player: { x: shard.x, z: shard.z } };
  const collected = collectNearby(state);
  assert.equal(shardCount(collected), 1);
  assert.equal(collected.quest, "collect");
  assert.equal(questLabel(collected), "Recover the shards (1/4)");
});

test("the gate opens only when all four shards are collected", () => {
  let state = createState();
  for (const shard of SHARDS.slice(0, 3)) {
    state = { ...state, player: { x: shard.x, z: shard.z } };
    state = collectNearby(state);
  }
  assert.equal(state.gateOpen, false);
  assert.equal(isBlocked(state, GATE.x, GATE.z), true);

  state = { ...state, player: { x: SHARDS[3].x, z: SHARDS[3].z } };
  state = collectNearby(state);
  assert.equal(state.gateOpen, true);
  assert.equal(isBlocked(state, GATE.x, GATE.z), false);
  assert.equal(questLabel(state), "Enter the open gate");
});

test("talking to the Keeper gives real progress, and talking to air does nothing", () => {
  let state = { ...createState(), player: { x: NPC.x, z: NPC.z + 1 } };
  state = interact(state);
  assert.match(state.dialogue, /Four shards/);

  const doubled = interact(state);
  assert.equal(doubled.dialogue, null, "the same key closes the dialogue");

  const away = interact({ ...createState(), player: { x: 14, z: 14 } });
  assert.equal(away.dialogue, null);
});

test("reaching the open gate wins, and a won run stops accepting input", () => {
  let state = createState();
  state = { ...state, shards: state.shards.map((shard) => ({ ...shard, collected: true })) };
  state = collectNearby(state);
  assert.equal(state.gateOpen, true);
  state = step({ ...state, player: { x: GATE.x, z: GATE.z } }, { x: 0, y: 0 }, 0.016);
  assert.equal(state.won, true);
  assert.equal(questLabel(state), "Rift closed");
  assert.deepEqual(step(state, { x: 1, y: 1 }, 0.016).player, state.player);
});

test("a frame of movement is bounded by dt, so a slow tab cannot teleport", () => {
  const state = createState();
  const one = step(state, { x: 0, y: -1 }, 0.016);
  const huge = step(state, { x: 0, y: -1 }, 5);
  const shortHop = Math.abs(one.player.z - state.player.z);
  const hugeHop = Math.abs(huge.player.z - state.player.z);
  assert.ok(shortHop > 0 && shortHop < 0.2);
  assert.ok(hugeHop <= WORLD.speed * 0.1 + 0.001, "dt is clamped to 0.1 s");
});

test("every obstacle is inside the world and actually blocks its centre", () => {
  for (const obstacle of OBSTACLES) {
    assert.ok(Math.abs(obstacle.x) + obstacle.w / 2 < WORLD.half);
    assert.ok(Math.abs(obstacle.z) + obstacle.d / 2 < WORLD.half);
    assert.equal(isBlocked(createState(), obstacle.x, obstacle.z), true);
  }
});
