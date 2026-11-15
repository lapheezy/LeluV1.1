/**
 * Mission 16 — the Cosmos object ecosystem.
 *
 * A construction becoming an independent object, and staying that object
 * through moving, grouping, integrating, extracting, duplicating, removing
 * and restoring — with the same id, the same geometry and the same source.
 */

import assert from "node:assert/strict";
import test from "node:test";
import CosmosObjectStore from "../src/core/cosmos/objects/CosmosObjectStore";
import { describeObject } from "../src/core/cosmos/objects/CosmosObjectTypes";
import { buildGearbox, buildCabin, buildV8, buildCircuit, buildCell, buildFabric, warpOnTop, BUILDERS, findBuilder } from "../src/core/creative/kit/build";
import { compileDirect } from "../src/core/creative/kit/DirectCompiler";

const sceneOf = (program: { scene: unknown }) => program.scene as never;

function storeWithGearbox(): { store: CosmosObjectStore; id: string } {
  const store = CosmosObjectStore.createIsolated();
  const built = buildGearbox({ teethIn: 12, teethOut: 24 }).program!;
  const spawned = store.spawn({ name: "Gearbox", scene: sceneOf(built), domain: built.domain, builder: built.builder, partCount: built.parts.length, source: { artifactId: "art_test", rev: 1 } });
  assert.ok(spawned.ok);
  return { store, id: spawned.value.id };
}

/* --------------------------- new domains -------------------------------- */

test("six domains construct, and each derives its own facts", () => {
  const v8 = buildV8({}).program!;
  assert.equal(v8.domain, "mechanical");
  assert.equal(v8.derived.find((d) => d.label === "Configuration")?.value, "V8 (90°)");
  assert.ok(v8.parts.length > 30, "a V8 is a real assembly");
  const displacement = Number(v8.derived.find((d) => d.label === "Displacement")!.value.replace(" L", ""));
  const expected = Math.PI * (0.092 / 2) ** 2 * 0.082 * 8 * 1000;
  assert.ok(Math.abs(displacement - expected) < 0.05, `displacement ${displacement} vs ${expected.toFixed(2)}`);

  const circuit = buildCircuit({ volts: 9, resistors: 2, ohms: 100 }).program!;
  assert.equal(circuit.domain, "electrical");
  assert.equal(circuit.derived.find((d) => d.label === "Current")?.value, "45.0 mA", "Ohm's law: 9 V / 200 Ω");
  const open = buildCircuit({ volts: 9, resistors: 2, ohms: 100, switchClosed: "open" }).program!;
  assert.equal(open.derived.find((d) => d.label === "Current")?.value, "0.0 mA");
  assert.equal(open.derived.find((d) => d.label === "Power")?.value, "0.00 W");

  const cell = buildCell({ radius: 0.03 }).program!;
  assert.equal(cell.domain, "biology");
  const area = Number(cell.derived.find((d) => d.label === "Surface area")!.value.replace(" mm²", ""));
  assert.ok(Math.abs(area - 4 * Math.PI * 0.03 * 0.03 * 1e6) < 0.02, `surface area ${area}`);
  assert.ok(cell.parts.some((p) => p.id === "nucleus"));

  const fabric = buildFabric({ weave: "twill", threads: 8, rows: 8 }).program!;
  assert.equal(fabric.domain, "textiles");
  assert.equal(fabric.derived.find((d) => d.label === "Intersections")?.value, "64");
  assert.equal(fabric.parts.filter((p) => p.id.startsWith("cross-")).length, 64);

  assert.deepEqual(new Set(BUILDERS.map((b) => b.domain)).size, 8, "eight domains, one framework");
});

test("the weave rules are the rules, not decoration", () => {
  // plain: alternate every thread; twill: diagonal; satin: long floats.
  assert.equal(warpOnTop("plain", 0, 0), true);
  assert.equal(warpOnTop("plain", 1, 0), false);
  assert.equal(warpOnTop("plain", 0, 1), false);
  // A twill steps one thread per row: row y+1 at x is row y at x+1.
  for (let x = 0; x < 6; x += 1) for (let y = 0; y < 6; y += 1) {
    assert.equal(warpOnTop("twill", x, y + 1), warpOnTop("twill", x + 1, y), `twill diagonal at ${x},${y}`);
  }
  assert.notDeepEqual([0, 1, 2, 3].map((x) => warpOnTop("twill", x, 0)), [0, 1, 2, 3].map((x) => warpOnTop("plain", x, 0)), "twill is not plain");
  let satinOver = 0;
  for (let x = 0; x < 5; x += 1) for (let y = 0; y < 5; y += 1) if (warpOnTop("satin", x, y)) satinOver += 1;
  assert.equal(satinOver, 5, "satin lifts one in five");
});

test("new builders are reachable from words", () => {
  assert.equal(findBuilder("build a V8 engine")?.id, "v8");
  assert.equal(findBuilder("a series circuit with a 9 V battery")?.id, "circuit");
  assert.equal(findBuilder("a eukaryotic cell")?.id, "cell");
  assert.equal(findBuilder("a twill fabric sample")?.id, "fabric");
  const v8 = compileDirect("build a V8 engine");
  assert.equal(v8!.steps[0].args.builder, "v8");
  const cell = compileDirect("build a cell with 9 mitochondria");
  assert.equal((cell!.steps[0].args.params as Record<string, unknown>).mitochondria, 9);
});

/* ------------------------- the object lifecycle -------------------------- */

test("a constructed thing becomes an object with its own life", () => {
  const { store, id } = storeWithGearbox();
  const object = store.get(id)!;
  assert.equal(object.name, "Gearbox");
  assert.equal(object.parent, null);
  assert.equal(object.frame.scale, 4);
  assert.ok(object.scene.objects.length > 10, "it carries its own geometry");
  assert.equal(object.source?.artifactId, "art_test");
  assert.match(describeObject(object), /Gearbox/);

  const moved = store.transform(id, { position: [3, 1, -20], rotation: [0, 45, 0], scale: 2 });
  assert.ok(moved.ok);
  assert.deepEqual(store.get(id)!.frame.position, [3, 1, -20]);
  assert.equal(store.get(id)!.frame.rotation[1], 45);
  assert.equal(store.get(id)!.frame.scale, 2);

  const lock = store.lock(id, true);
  assert.ok(lock.ok);
  const blocked = store.transform(id, { position: [0, 0, 0] });
  assert.equal(blocked.ok, false, "a locked object does not move");
  store.lock(id, false);
});

test("integrating keeps identity; extracting keeps geometry", () => {
  const { store, id } = storeWithGearbox();
  const cabin = store.spawn({ name: "Cabin", scene: sceneOf(buildCabin({}).program!) });
  assert.ok(cabin.ok);
  const geometry = JSON.stringify(store.get(id)!.scene);

  const inside = store.integrate(id, cabin.value.id);
  assert.ok(inside.ok);
  assert.equal(store.get(id)!.parent, cabin.value.id);
  assert.deepEqual(store.get(cabin.value.id)!.children, [id]);

  const loop = store.integrate(cabin.value.id, id);
  assert.equal(loop.ok, false, "a cycle is refused");

  const out = store.extract(id);
  assert.ok(out.ok);
  assert.equal(store.get(id)!.parent, null);
  assert.equal(store.get(id)!.id, id, "the same object, not a copy");
  assert.equal(JSON.stringify(store.get(id)!.scene), geometry, "geometry untouched by the round trip");
  assert.deepEqual(store.get(cabin.value.id)!.children, []);
});

test("groups, duplication, isolation, removal and restoration", () => {
  const { store, id } = storeWithGearbox();
  const second = store.spawn({ name: "Molecule", scene: sceneOf(buildV8({}).program!) });
  assert.ok(second.ok);

  const group = store.group([id, second.value.id], "Workshop");
  assert.ok(group.ok);
  assert.equal(store.get(id)!.group, group.value.id);
  const ungroup = store.ungroup("Workshop");
  assert.ok(ungroup.ok);
  assert.equal(store.get(id)!.group, null, "ungrouped members are independent");

  const copy = store.duplicate(id, { name: "Gearbox copy", scale: 1 });
  assert.ok(copy.ok);
  assert.notEqual(copy.value.id, id, "a duplicate is a new object");
  assert.equal(store.get(id)!.name, "Gearbox", "the original is untouched");
  assert.equal(copy.value.frame.scale, 1);

  const hidden = store.isolate(id);
  assert.ok(hidden.ok);
  assert.equal(store.list().filter((o) => o.visible).length, 1);
  store.showAll();

  const removed = store.remove(id, false);
  assert.ok(removed.ok);
  assert.equal(store.get(id), undefined);
  const restored = store.restore(id);
  assert.ok(restored.ok);
  assert.equal(store.get(id)!.name, "Gearbox", "restored exactly");
  assert.ok(store.get(id)!.scene.objects.length > 10);
});

test("removing a parent refuses to silently drop its children", () => {
  const { store, id } = storeWithGearbox();
  const child = store.spawn({ name: "Small part", scene: sceneOf(buildCircuit({}).program!) });
  assert.ok(child.ok);
  store.integrate(child.value.id, id);
  const refused = store.remove(id);
  assert.equal(refused.ok, false);
  assert.match((refused as { reason: string }).reason, /extract them first/);
  const forced = store.remove(id, true);
  assert.ok(forced.ok);
});

test("pausing is a property of every moving object at once", () => {
  const { store, id } = storeWithGearbox();
  store.animate(id, { kind: "orbit", speed: 0.2 });
  const other = store.spawn({ name: "Cell", scene: sceneOf(buildCell({}).program!) });
  store.animate(other.ok ? other.value.id : id, { kind: "bob" });
  const paused = store.pauseAll(true);
  assert.equal(paused, 2);
  assert.ok(store.list().every((o) => o.motion.paused));
  store.pauseAll(false);
  assert.ok(store.list().every((o) => !o.motion.paused));
});

test("state is deterministic apart from identity, and repeated saves agree", () => {
  const a = CosmosObjectStore.createIsolated();
  const b = CosmosObjectStore.createIsolated();
  for (const store of [a, b]) {
    store.spawn({ name: "One", scene: sceneOf(buildCabin({}).program!) });
    store.spawn({ name: "Two", scene: sceneOf(buildCell({}).program!) });
  }
  const strip = (s: CosmosObjectStore) => JSON.stringify(s.list().map((o) => ({ ...o, id: undefined, createdAt: 0, updatedAt: 0, provenance: [] })));
  assert.equal(strip(a), strip(b), "the same inputs give the same scene arrangement");
  assert.deepEqual(a.list().map((o) => o.frame.position), b.list().map((o) => o.frame.position), "and the same ring slots");
});

/* ------------------------------- routing -------------------------------- */

test("cosmos operations compile to local tool calls, in words", () => {
  const spawn = compileDirect("Put it in the Cosmos");
  assert.equal(spawn?.steps[0].tool, "cosmos.object.spawn");
  assert.equal(spawn?.steps[0].args.artifact, "it");

  const { store } = storeWithGearbox();
  void store;

  const pause = compileDirect("pause all floating objects");
  assert.equal(pause?.steps[0].tool, "cosmos.object.animate");
  assert.equal(pause?.steps[0].args.all, true);

  const list = compileDirect("show me every object in my Cosmos");
  assert.equal(list?.steps[0].tool, "cosmos.object.list");

  const takeOut = compileDirect("take the cabin out and open it in the 3D workspace");
  assert.equal(takeOut?.steps[0].tool, "cosmos.object.extract");
  assert.equal(takeOut?.steps[0].args.open, "workspace", "asking for the workspace is carried through");

  const connect = compileDirect("connect the engine to the transmission");
  assert.equal(connect?.steps[0].tool, "cosmos.object.integrate");
  assert.deepEqual([connect?.steps[0].args.object, connect?.steps[0].args.into], ["engine", "transmission"]);

  const copy = compileDirect("duplicate the engine and make the second one smaller");
  assert.equal(copy?.steps[0].tool, "cosmos.object.duplicate");
  assert.equal(copy?.steps[0].args.scale, 0.6);

  const slash = compileDirect("/cosmos");
  assert.equal(slash?.steps[0].tool, "cosmos.object.list");
  assert.equal(slash?.explicit, true);
});
