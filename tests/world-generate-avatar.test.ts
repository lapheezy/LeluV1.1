/**
 * LÉLUVERSE — ROOM GENERATION AND LÉLU'S PERSISTENT PLACE IN THE WORLD
 *
 * A description becomes a furnished, versioned environment (deterministic,
 * nothing overlaps, her spot and the view to her stay clear), and where she
 * stands / faces / her mood survive a server restart, per environment.
 */

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { ForgeStore } from "../plugins/forgeStore";
import { LELU_SPOT, WorldEngine } from "../plugins/worldEngine";
import { FURNITURE, generateRoom } from "../src/core/world/RoomGenerator";

const FRAME = { centre: [0, 2.2] as [number, number], floorY: -2.55, lelu: [0, 3.3] as [number, number] };

test("a description becomes a deterministic, non-overlapping room that keeps LÉLU visible", () => {
  const a = generateRoom({ description: "a cozy pink reading nook with plants, a bookshelf and candles" }, FRAME);
  const b = generateRoom({ description: "a cozy pink reading nook with plants, a bookshelf and candles" }, FRAME);
  assert.deepEqual(a, b, "same description → same room");
  assert.equal(a.kind, "room");
  assert.equal(a.settings.accent, "#f472b6", "the first colour named becomes the accent");
  assert.equal(a.settings.radius, 4.5, "a nook is small");
  const types = a.pieces.map((p) => p.type);
  for (const t of ["plant", "bookshelf", "candles"] as const) assert.ok(types.includes(t), `${t} was asked for`);

  const other = generateRoom({ description: "a cozy pink reading nook with plants, a bookshelf and candles", seed: 99 }, FRAME);
  assert.notDeepEqual(other.pieces, a.pieces, "another seed → another layout");

  const lab = generateRoom({ description: "an engineering lab with computers" }, FRAME);
  assert.equal(lab.kind, "lab");
  assert.ok(lab.pieces.some((p) => p.type === "screen"));

  for (const plan of [a, lab, generateRoom({ description: "a starry observatory with a telescope and crystals" }, FRAME)]) {
    const radius = plan.settings.radius ?? 6.5;
    const solid = plan.pieces.filter((p) => p.type !== "rug");
    for (const p of solid) {
      const [x, z] = p.position;
      assert.ok(Math.hypot(x - FRAME.centre[0], z - FRAME.centre[1]) < radius, `${p.group} is inside the room`);
      assert.ok(Math.hypot(x - FRAME.lelu[0], z - FRAME.lelu[1]) > 0.9, `${p.group} keeps clear of LÉLU`);
      // Nothing stands in the open sector between her and the camera (+z from the centre).
      const angle = Math.atan2(x - FRAME.centre[0], z - FRAME.centre[1]);
      assert.ok(Math.abs(angle) > (45 * Math.PI) / 180, `${p.group} is not in front of her`);
    }
    for (let i = 0; i < solid.length; i++) {
      for (let j = i + 1; j < solid.length; j++) {
        const d = Math.hypot(solid[i].position[0] - solid[j].position[0], solid[i].position[1] - solid[j].position[1]);
        assert.ok(d > 0.4, `${solid[i].group} and ${solid[j].group} do not overlap`);
      }
    }
    for (const part of plan.parts) {
      assert.ok(part.position[1] >= FRAME.floorY - 1e-9, "parts stand on or above the floor");
      assert.ok(part.proportions.every((v) => v > 0 && v <= 1), "proportions are fractions of height");
    }
  }

  const exact = generateRoom({ description: "anything", items: ["desk", { type: "chair", count: 2 }, "unicorn"] }, FRAME);
  assert.deepEqual(exact.pieces.map((p) => p.type).sort(), ["chair", "chair", "desk"], "explicit items win; unknown ones are ignored");
  assert.ok(FURNITURE.length >= 20);
});

test("the world engine stores a generated room as one version, and LÉLU's place persists per environment", () => {
  const root = mkdtempSync(path.join(tmpdir(), "lelu-world-gen-"));
  try {
    const store = new ForgeStore(root);
    let world = new WorldEngine(store);
    assert.deepEqual(world.avatar().position, LELU_SPOT.position, "she starts at her spot in the home room");

    const { environment, plan, objects } = world.generateEnvironment({ description: "a bright green garden with a fountain" });
    assert.equal(environment.kind, "garden");
    assert.equal(world.state().current, environment.id, "she enters the new room");
    assert.ok(plan.pieces.some((p) => p.type === "fountain"));
    assert.equal(world.state().objects.length, objects.length);
    assert.ok(objects.every((o) => o.group && o.primitive?.proportions), "parts carry their piece and proportions");
    const history = world.history(environment.id);
    assert.equal(history.length, 1, "generated as one version");
    assert.match(history[0].reason, /generated \d+ pieces/);

    // Remove a whole piece, then restore the generated version.
    const fountain = plan.pieces.find((p) => p.type === "fountain")!.group;
    const gone = world.removeGroup(environment.id, fountain);
    assert.ok(gone.length >= 3, "every part of the fountain goes");
    world.restore(environment.id, 1);
    assert.equal(world.state().objects.length, objects.length, "restore brings it back");

    // Move her, turn her towards the fountain, set a mood.
    let me = world.setAvatar("lelu_character", { position: [1, 2.5], mood: "happy" });
    assert.deepEqual(me.position.map((n) => +n.toFixed(3)), [1, -2.55, 2.5], "on the floor where asked");
    me = world.setAvatar("lelu_character", { towards: fountain });
    const f = plan.pieces.find((p) => p.group === fountain)!.position;
    assert.ok(Math.abs(me.facing - Math.atan2(f[0] - 1, f[1] - 2.5)) < 1e-6, "faces the fountain");
    world.setAvatar("lelu_character", { position: [40, 40] });
    const clamped = world.avatar();
    assert.ok(Math.hypot(clamped.position[0], clamped.position[2] - 2.2) <= (environment.settings.radius - 0.4) + 1e-9, "never through the wall");
    assert.throws(() => world.setAvatar("lelu_character", { mood: "furious" }), /mood must be one of/);

    // A restart (new engine on the same store) remembers all of it, per environment.
    world = new WorldEngine(store);
    assert.equal(world.avatar().mood, "happy");
    assert.deepEqual(world.avatar().position, clamped.position);
    assert.equal(world.state().avatar.environmentId, environment.id);
    assert.deepEqual(world.avatar("lelu_character", "home").position, LELU_SPOT.position, "home keeps its own spot");

    // Furnishing an existing environment with replace clears it first.
    const before = world.state().objects.length;
    const again = world.generateEnvironment({ description: "a garden", environmentId: environment.id, replace: true, items: ["bench"] });
    assert.equal(again.objects.length, world.state().objects.length, "only the new piece remains");
    assert.ok(world.state().objects.length < before);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
