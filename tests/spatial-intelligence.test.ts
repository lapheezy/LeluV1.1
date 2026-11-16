/**
 * M17.3-WP01 — spatial intelligence: words → the right operation → the
 * right position, on the REAL CosmosObjectStore singleton the tools use.
 *
 *   - the parser reads relative placement, distance and direction;
 *   - the router gives an object sentence to the object tools when its
 *     names are real objects, and keeps window sentences for the windows;
 *   - the position tool resolves names without guessing (ambiguity asks),
 *     computes positions with the existing conventions, and never
 *     attaches, detaches, regroups or touches lineage;
 *   - the Neural Map records a move as position only — no relation.
 *
 * The running app is checked by scripts/cosmos/verify-spatial.mjs.
 */

import assert from "node:assert/strict";
import test from "node:test";
import CosmosObjectStore from "../src/core/cosmos/objects/CosmosObjectStore";
import { COSMOS_OBJECT_EXECUTORS } from "../src/core/cosmos/objects/CosmosObjectTools";
import { parseSpatialIntent, placeDirection, placeRelative, reachOf } from "../src/core/cosmos/objects/spatialIntent";
import { directPlanFor, namesCosmosObjects } from "../src/core/router/DirectResolver";
import { buildCabin, buildGearbox } from "../src/core/creative/kit/build";
import { cosmosObjectsPartition } from "../src/core/neural/adapters";
import { NeuralMapIndex } from "../src/core/neural/NeuralMap";
import { NID } from "../src/core/neural/NeuralMapTypes";

const position = COSMOS_OBJECT_EXECUTORS.find((e) => e.id === "cosmos.object.position")!;
const run = (args: Record<string, unknown>) => position.run(args, undefined as never) as Promise<{ ok: boolean; content: string; data?: Record<string, unknown> }>;

function world() {
  const store = CosmosObjectStore.getInstance();
  store.clear();
  const spawn = (name: string, program: ReturnType<typeof buildGearbox>["program"]) => {
    const r = store.spawn({ name, scene: program!.scene as never, domain: program!.domain, builder: program!.builder, partCount: program!.parts.length, source: { artifactId: `art_${name.replace(/\W/g, "")}`, rev: 1 } });
    assert.ok(r.ok, "spawned");
    return r.value;
  };
  const cabin = spawn("3-bay cabin — 6 × 4.5 m", buildCabin({}).program);
  const gear = spawn("Gear train — 14:28 with idler", buildGearbox({ teethIn: 14, teethOut: 28 }).program);
  return { store, cabin, gear, spawn };
}
const pos = (store: CosmosObjectStore, id: string) => [...store.get(id)!.frame.position];

test("the parser reads relative placement, distance and direction — and only those", () => {
  const cases: Array<[string, Record<string, unknown> | null]> = [
    ["Move the gear next to the cabin", { kind: "relative", target: "gear", relation: "beside", reference: "cabin" }],
    ["put the gear beside the cabin.", { relation: "beside" }],
    ["Move the gear near the cabin", { relation: "near" }],
    ["Move the gear to the left of the cabin", { relation: "left-of", reference: "cabin" }],
    ["position the gear to the right of the cabin", { relation: "right-of" }],
    ["Put the gear behind the cabin", { relation: "behind" }],
    ["place the gear in front of the cabin", { relation: "in-front-of" }],
    ["move the gear above the cabin", { relation: "above" }],
    ["move the gear below the cabin", { relation: "below" }],
    ["Move the gear closer to the cabin", { relation: "closer", reference: "cabin", degree: "normal" }],
    ["Put the gear a little closer to the cabin", { relation: "closer", degree: "little" }],
    ["Move the gear farther away", { relation: "farther", reference: null }],
    ["move the gear farther away from the cabin", { relation: "farther", reference: "cabin" }],
    ["move the gear left", { kind: "direction", direction: "left" }],
    ["move the gear to the right", { kind: "direction", direction: "right" }],
    ["move it forward", { kind: "direction", target: "it", direction: "forward" }],
    ["move the cabin backward a little", { direction: "backward", degree: "little" }],
    ["move the gear up by 2", { direction: "up", distance: 2 }],
    ["move the gear downward", { direction: "down" }],
    ["put the browser next to the chat", { relation: "beside", target: "browser", reference: "chat" }], // words only: the router decides
    ["tile my windows", null],
    ["move the gear behind", null], // "behind" needs something to be behind
  ];
  for (const [text, want] of cases) {
    const got = parseSpatialIntent(text) as Record<string, unknown> | null;
    if (want === null) {
      assert.equal(got, null, text);
      continue;
    }
    assert.ok(got, `${text} → parsed`);
    for (const [k, v] of Object.entries(want)) assert.deepEqual(got[k], v, `${text} → ${k}`);
  }
});

test("positions use the Cosmos's own conventions (world frame, +x right, +y up, +z toward the viewer, beside = 1.4 × scale)", () => {
  const ref = { position: [10, 0, -5] as [number, number, number], scale: 1 };
  const t = { position: [0, 0, 0] as [number, number, number], scale: 1 };
  assert.equal(reachOf(t, ref), 1.4);
  assert.deepEqual(placeRelative(t, ref, "beside"), [11.4, 0, -5]);
  assert.deepEqual(placeRelative(t, ref, "left-of"), [8.6, 0, -5]);
  assert.deepEqual(placeRelative(t, ref, "right-of"), [11.4, 0, -5]);
  assert.deepEqual(placeRelative(t, ref, "behind"), [10, 0, -6.4]);
  assert.deepEqual(placeRelative(t, ref, "in-front-of"), [10, 0, -3.6]);
  assert.deepEqual(placeRelative(t, ref, "above"), [10, 1.4, -5]);
  assert.deepEqual(placeRelative(t, ref, "below"), [10, -1.4, -5]);
  const d0 = Math.hypot(10, 0, -5);
  const closer = placeRelative(t, ref, "closer");
  const farther = placeRelative(t, ref, "farther");
  const dist = (p: number[]) => Math.hypot(p[0] - 10, p[1], p[2] + 5);
  assert.ok(dist(closer) < d0 && dist(closer) >= 1.4 * 0.6, "closer: nearer, never into the reference");
  // Already beside it: "closer" still moves it (inside the beside spacing), never past CLOSEST.
  const beside = { position: placeRelative(t, ref, "behind"), scale: 1 };
  const nearer = placeRelative(beside, ref, "closer");
  assert.ok(dist(nearer) < 1.4 && dist(nearer) >= 0.84 - 1e-9, `closer from beside: ${dist(nearer)}`);
  assert.ok(dist(farther) > d0, "farther: further away");
  assert.ok(dist(placeRelative(t, ref, "closer", "little")) > dist(closer), "a little closer is less than closer");
  assert.deepEqual(placeDirection(t, "left"), [-1.5, 0, 0]);
  assert.deepEqual(placeDirection(t, "up", "normal", 2), [0, 2, 0]);
  assert.deepEqual(placeDirection(t, "backward", "little"), [0, 0, -0.75]);
});

test("routing: an object sentence goes to the object tool when its names are real objects; window sentences stay with the windows", () => {
  world();
  for (const text of ["Move the gear next to the cabin", "move the gear to the left of the cabin", "Put the gear behind the cabin", "Move the gear closer to the cabin", "Move the gear farther away", "move the gear to the right of the cabin", "put the gearbox next to the cabin", "move the gear left"]) {
    const plan = directPlanFor(text);
    assert.equal(plan?.steps[0].tool, "cosmos.object.position", `${text} → ${plan?.steps.map((s) => s.tool)}`);
    assert.ok(namesCosmosObjects(plan!), text);
  }
  // Names no window, names a real object: object intent (the tool then refuses "spaceship").
  assert.equal(directPlanFor("move the spaceship next to the cabin")?.steps[0].tool, "cosmos.object.position");
  for (const text of ["put the browser next to the chat", "tile my windows", "split the chat and the browser side by side"]) {
    const plan = directPlanFor(text);
    assert.ok(plan?.steps.every((s) => s.tool.startsWith("workspace.")), `${text} → ${plan?.steps.map((s) => s.tool)}`);
  }
});

test("the position tool: each relation lands where the convention says; nothing else about the object changes", async () => {
  const { store, cabin, gear } = world();
  const before = store.get(gear.id)!;
  const lineage = JSON.stringify(before.provenance.filter((p) => p.action !== "transformed"));
  const c = pos(store, cabin.id);
  const reach = Math.max(store.get(cabin.id)!.frame.scale, store.get(gear.id)!.frame.scale) * 1.4;
  const expect: Array<[Record<string, unknown>, number[]]> = [
    [{ relation: "beside" }, [c[0] + reach, c[1], c[2]]],
    [{ relation: "left-of" }, [c[0] - reach, c[1], c[2]]],
    [{ relation: "behind" }, [c[0], c[1], c[2] - reach]],
    [{ relation: "right-of" }, [c[0] + reach, c[1], c[2]]],
    [{ relation: "above" }, [c[0], c[1] + reach, c[2]]],
  ];
  for (const [args, want] of expect) {
    const r = await run({ object: "gear", near: "cabin", ...args });
    assert.ok(r.ok, r.content);
    assert.deepEqual(pos(store, gear.id).map((n) => Math.round(n * 1000) / 1000), want.map((n) => Math.round(n * 1000) / 1000), JSON.stringify(args));
    assert.equal(r.data?.referenceId, cabin.id);
  }
  const after = store.get(gear.id)!;
  assert.equal(after.parent, before.parent, "not attached or detached");
  assert.equal(after.group, before.group, "not regrouped");
  assert.equal(JSON.stringify(after.provenance.filter((p) => p.action !== "transformed")), lineage, "lineage untouched");
  assert.equal(store.list().length, 2, "nothing duplicated");
});

test("closer, then farther with no reference: farther from what it was last placed against", async () => {
  const { store, cabin, gear } = world();
  await run({ object: gear.id, position: [12, 0, 0] });
  const dist = () => Math.hypot(...pos(store, gear.id).map((v, i) => v - pos(store, cabin.id)[i]));
  const d0 = dist();
  assert.ok((await run({ object: "gear", near: "cabin", relation: "closer" })).ok);
  const d1 = dist();
  assert.ok(d1 < d0, `${d1} < ${d0}`);
  const far = await run({ object: "gear", relation: "farther" });
  assert.ok(far.ok, far.content);
  assert.equal(far.data?.referenceId, cabin.id, "the cabin, from the last placement");
  assert.ok(dist() > d1);
});

test("ambiguity: after a duplicate, 'the gear' is not guessed — nothing moves and the candidates are named; ids and whole names still work", async () => {
  const { store, gear } = world();
  const dup = store.duplicate(gear.id);
  assert.ok(dup.ok);
  const p0 = pos(store, gear.id);
  const p1 = pos(store, dup.value.id);
  const r = await run({ object: "gear", near: "cabin" });
  assert.equal(r.ok, false);
  assert.equal(r.data?.ambiguous, true);
  assert.deepEqual([...((r.data?.candidates as string[] | undefined) ?? [])].sort(), [gear.id, dup.value.id].sort());
  assert.match(r.content, /Which one/);
  assert.deepEqual(pos(store, gear.id), p0, "the original did not move");
  assert.deepEqual(pos(store, dup.value.id), p1, "the copy did not move");
  // The routing still treats it as an object sentence (so the windows are not rearranged); the tool asks.
  assert.equal(directPlanFor("move the gear next to the cabin")?.steps[0].tool, "cosmos.object.position");
  assert.ok((await run({ object: dup.value.id, near: "cabin" })).ok, "by id");
  assert.ok((await run({ object: store.get(dup.value.id)!.name, near: "cabin" })).ok, "by its whole name");
  // Missing: refused, nothing invented.
  const missing = await run({ object: "spaceship", near: "cabin" });
  assert.equal(missing.ok, false);
  assert.match(missing.content, /No object matches/);
});

test("an attached object moves without being detached; the Neural Map shows position, not a new relation", async () => {
  const { store, cabin, gear, spawn } = world();
  const bolt = spawn("Bolt", buildGearbox({ teethIn: 10, teethOut: 20 }).program);
  assert.ok(store.integrate(bolt.id, cabin.id).ok);
  const map = new NeuralMapIndex();
  const sync = () => {
    const s = store.getState();
    return map.setPartition(cosmosObjectsPartition({ objects: s.objects, trash: s.trash, groups: s.groups }));
  };
  sync();
  const relsBefore = map.relations(NID.object(gear.id)).map((n) => n.relation.id).sort();
  const boltBefore = map.relations(NID.object(bolt.id)).map((n) => n.relation.id).sort();
  assert.ok((await run({ object: "gear", near: "cabin", relation: "beside" })).ok);
  assert.ok((await run({ object: "bolt", direction: "up" })).ok);
  const u = sync();
  assert.equal(store.get(bolt.id)!.parent, cabin.id, "still attached");
  assert.deepEqual(map.relations(NID.object(gear.id)).map((n) => n.relation.id).sort(), relsBefore, "moving beside creates no attached-to");
  assert.deepEqual(map.relations(NID.object(bolt.id)).map((n) => n.relation.id).sort(), boltBefore);
  assert.deepEqual(map.get(NID.object(gear.id))!.spatial!.position, pos(store, gear.id), "the map has the new position");
  assert.deepEqual(u.changed.sort(), [NID.object(bolt.id), NID.object(gear.id)].sort(), "only the two moved objects changed");
  store.clear();
});
