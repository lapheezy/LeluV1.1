/**
 * M17.2 — the Neural Map over the Cosmos authorities.
 *
 * Real lifecycle operations on a real CosmosObjectStore; after each one
 * the map is re-derived through the same adapter the app uses and its
 * identities and typed relations are checked. These prove the RULES.
 * The running interface is verified by scripts/cosmos/verify-neural-map.mjs.
 */

import assert from "node:assert/strict";
import test from "node:test";
import CosmosObjectStore from "../src/core/cosmos/objects/CosmosObjectStore";
import { buildGearbox, buildCabin } from "../src/core/creative/kit/build";
import { NeuralMapIndex } from "../src/core/neural/NeuralMap";
import { cosmosObjectsPartition, interfacesPartition, navigationPartition, placementsPartition, roomScenePartition } from "../src/core/neural/adapters";
import { COSMOS_CORE_NID, NID } from "../src/core/neural/NeuralMapTypes";
import { INTERFACES } from "../src/core/interface/InterfaceCatalog";
import { builtInCompositions } from "../src/core/interface/interfaceComposition";

const scene = (p: { scene: unknown }) => p.scene as never;
function setup() {
  const store = CosmosObjectStore.createIsolated();
  const map = new NeuralMapIndex();
  const core = { id: "cosmos-core", level: "core", label: "Cosmos", parentId: null, ref: null, opens: null, position: [0, 0, 0], origin: "system", createdAt: 0, visits: 0, lastVisited: null, removable: false, archived: false } as never;
  map.setPartition(navigationPartition([core]));
  const sync = () => {
    const s = store.getState();
    return map.setPartition(cosmosObjectsPartition({ objects: s.objects, trash: s.trash, groups: s.groups }));
  };
  const gear = buildGearbox({ teethIn: 12, teethOut: 24 }).program!;
  const cabin = buildCabin({}).program!;
  const spawn = (name: string, p = gear) => {
    const r = store.spawn({ name, scene: scene(p), domain: p.domain, builder: p.builder, partCount: p.parts.length, source: { artifactId: `art_${name}`, rev: 1 } });
    assert.ok(r.ok);
    return r.value.id;
  };
  return { store, map, sync, spawn, cabin };
}
const types = (map: NeuralMapIndex, id: string, dir: "out" | "in" = "out") => map.relations(id, { direction: dir }).map((n) => `${n.relation.type}>${dir === "out" ? n.relation.to : n.relation.from}`).sort();

test("objects become canonical entities located in the Cosmos core, created from their artifact", () => {
  const { map, sync, spawn } = setup();
  const a = spawn("Gearbox");
  sync();
  const e = map.get(NID.object(a))!;
  assert.equal(e.type, "object");
  assert.equal(e.authority, "cosmos.objects");
  assert.equal(e.sourceId, a);
  assert.deepEqual(types(map, e.id), [`created-from>record:artifact:art_Gearbox`, `located-in>${COSMOS_CORE_NID}`]);
  assert.equal(map.dangling().length, 0);
});

test("integrate → attached-to; extract → extracted-from; duplicate → derived-from; identities never change", () => {
  const { store, map, sync, spawn, cabin } = setup();
  const room = spawn("Cabin", cabin);
  const gear = spawn("Gearbox");
  store.integrate(gear, room);
  sync();
  assert.ok(types(map, NID.object(gear)).includes(`attached-to>${NID.object(room)}`));
  assert.ok(!types(map, NID.object(gear)).some((t) => t.startsWith("located-in")), "inside an assembly it is located in that, not loose in the core");
  assert.ok(types(map, NID.object(room), "in").includes(`attached-to>${NID.object(gear)}`));

  store.extract(gear);
  sync();
  const afterExtract = types(map, NID.object(gear));
  assert.ok(afterExtract.includes(`extracted-from>${NID.object(room)}`));
  assert.ok(afterExtract.includes(`located-in>${COSMOS_CORE_NID}`));
  assert.ok(!afterExtract.some((t) => t.startsWith("attached-to")));

  const copy = store.duplicate(gear);
  assert.ok(copy.ok);
  sync();
  assert.ok(types(map, NID.object(copy.value.id)).includes(`derived-from>${NID.object(gear)}`));
  assert.equal(map.get(NID.object(gear))!.sourceId, gear, "the original keeps its identity");
  // Re-attaching the extracted part: attached again, no stale extracted-from to the same parent.
  store.integrate(gear, room);
  sync();
  const reattached = types(map, NID.object(gear));
  assert.ok(reattached.includes(`attached-to>${NID.object(room)}`));
  assert.ok(!reattached.includes(`extracted-from>${NID.object(room)}`));
  assert.equal(map.dangling().length, 0);
  assert.deepEqual(map.duplicates(), []);
});

test("moving changes spatial metadata only: relations untouched, and only the objects partition updates", () => {
  const { store, map, sync, spawn } = setup();
  const a = spawn("Gearbox");
  const b = spawn("Other");
  store.duplicate(a);
  sync();
  const before = types(map, NID.object(a));
  const navVersion = map.stats().byAuthority["cosmos.navigation"];
  store.transform(a, { position: [9, 1, -3] });
  const update = sync();
  assert.deepEqual(map.get(NID.object(a))!.spatial!.position, [9, 1, -3]);
  assert.deepEqual(types(map, NID.object(a)), before);
  assert.equal(update.authority, "cosmos.objects");
  assert.ok(update.changed.includes(NID.object(a)));
  assert.ok(!update.changed.includes(NID.object(b)), "an untouched object is not reported as changed");
  assert.deepEqual(map.stats().byAuthority["cosmos.navigation"], navVersion);
});

test("remove → trashed with lineage kept and no placement; restore → active again; no orphans either way", () => {
  const { store, map, sync, spawn } = setup();
  const a = spawn("Gearbox");
  const copy = store.duplicate(a);
  assert.ok(copy.ok);
  store.remove(copy.value.id);
  sync();
  const trashed = map.get(NID.object(copy.value.id))!;
  assert.equal(trashed.state, "trashed");
  assert.deepEqual(trashed.operations, ["cosmos.object.restore"]);
  assert.deepEqual(types(map, trashed.id), [`created-from>record:artifact:art_Gearbox`, `derived-from>${NID.object(a)}`]);
  assert.equal(trashed.provenance.at(-1)!.action, "removed");
  store.restore(copy.value.id);
  sync();
  const back = map.get(NID.object(copy.value.id))!;
  assert.equal(back.state, "active");
  assert.equal(back.id, trashed.id, "same identity after restore");
  assert.ok(types(map, back.id).includes(`located-in>${COSMOS_CORE_NID}`));
  // Remove the ORIGINAL: the copy's derived-from still resolves (the original is in the trash).
  store.remove(a);
  sync();
  assert.ok(types(map, back.id).includes(`derived-from>${NID.object(a)}`));
  assert.equal(map.dangling().length, 0);
});

test("groups: member-of, and ungrouping removes the relation", () => {
  const { store, map, sync, spawn } = setup();
  const a = spawn("A");
  const b = spawn("B");
  const g = store.group([a, b], "Pair");
  assert.ok(g.ok);
  sync();
  assert.ok(types(map, NID.object(a)).includes(`member-of>${NID.group(g.value.id)}`));
  assert.equal(map.relations(NID.group(g.value.id), { direction: "in" }).length, 2);
  store.ungroup(g.value.id);
  sync();
  assert.ok(!types(map, NID.object(a)).some((t) => t.startsWith("member-of")));
});

test("reload: re-deriving from the persisted state gives the same ids and relations (nothing duplicated)", () => {
  const { store, map, sync, spawn, cabin } = setup();
  const room = spawn("Cabin", cabin);
  const gear = spawn("Gearbox");
  store.integrate(gear, room);
  store.extract(gear);
  store.duplicate(gear);
  sync();
  const before = JSON.stringify({ e: map.all().map((e) => e.id).sort(), r: map.stats() });
  // What a reload does: the store reloads its JSON, the map re-derives it.
  const persisted = JSON.parse(JSON.stringify(store.getState()));
  map.setPartition(cosmosObjectsPartition(persisted));
  map.setPartition(cosmosObjectsPartition(persisted));
  const after = JSON.stringify({ e: map.all().map((e) => e.id).sort(), r: { ...map.stats(), version: JSON.parse(before).r.version } });
  assert.equal(after, before);
  assert.deepEqual(map.duplicates(), []);
});

test("objects saved before M17.2 (no structured ref) still yield their lineage from the store's own wording", () => {
  const { store, map, spawn } = setup();
  const a = spawn("Old");
  const copy = store.duplicate(a);
  assert.ok(copy.ok);
  const s = JSON.parse(JSON.stringify(store.getState()));
  for (const o of s.objects) for (const p of o.provenance) delete p.ref;
  map.setPartition(cosmosObjectsPartition(s));
  assert.ok(types(map, NID.object(copy.value.id)).includes(`derived-from>${NID.object(a)}`));
});

test("rooms, placed records, Room objects and interfaces are typed and connected", () => {
  const map = new NeuralMapIndex();
  const node = (id: string, level: string, parentId: string | null, ref: unknown = null) => ({ id, level, label: id, parentId, ref, opens: null, position: [0, 0, 0], origin: "system", createdAt: 0, visits: 0, lastVisited: null, removable: level === "room", archived: false }) as never;
  map.setPartition(navigationPartition([node("cosmos-core", "core", null), node("map-galaxy-engineer", "galaxy", "cosmos-core"), node("map-agent-a1", "planet", "map-galaxy-engineer", { kind: "agent", id: "a1" }), node("room-studio", "room", "cosmos-core")]));
  map.setPartition(placementsPartition([{ id: "sp1", kind: "project", title: "Fashion", link: { kind: "project", id: "p9" }, roomId: "room-studio", position: [1, 0, 0], pinned: false, createdAt: 0, updatedAt: 0 }]));
  map.setPartition(roomScenePartition({ objects: [{ id: "s1", name: "Orb", kind: "sphere", transform: { position: { x: 0, y: 1, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } }, material: {} as never, visible: true, provenance: "authored", createdBy: "user", tags: [], createdAt: 0, updatedAt: 0 } as never, { id: "s2", name: "Moon", kind: "sphere", transform: { position: { x: 2, y: 1, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } }, material: {} as never, visible: true, provenance: "agent", createdBy: "lelu", tags: [], createdAt: 0, updatedAt: 0 } as never], relationships: [{ id: "r", from: "s2", to: "s1", kind: "orbits", createdAt: 0 }] }));
  map.setPartition(interfacesPartition(INTERFACES, builtInCompositions()));
  assert.ok(types(map, NID.place("map-agent-a1")).includes(`part-of>${NID.place("map-galaxy-engineer")}`));
  assert.ok(types(map, NID.place("map-agent-a1")).includes(`references>record:agent:a1`));
  assert.deepEqual(types(map, NID.placement("sp1")), [`located-in>${NID.place("room-studio")}`, `references>record:project:p9`]);
  assert.ok(types(map, NID.roomObject("s2")).includes(`orbits>${NID.roomObject("s1")}`), "the Room's own relationship kind, mapped");
  assert.ok(types(map, NID.roomObject("s1")).includes(`located-in>${NID.interface("lelu-room")}`));
  assert.ok(types(map, NID.composition("one-lelu")).includes(`presents>${NID.interface("lelu-system")}`));
  assert.ok(types(map, NID.interface("cosmos")).includes(`presents>${COSMOS_CORE_NID}`));
  assert.equal(map.dangling().length, 0);
});
