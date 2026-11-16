/**
 * Mission 17 — the interface ecosystem: catalog, composition rules, the
 * store that owns saved compositions, and the tools LÉLU uses on them.
 *
 * These prove the RULES (sources never change, built-ins fork, clones are
 * independent, at most one WebGL region is live). They are not evidence that
 * the user-facing experience works — scripts/cosmos/verify-interfaces.mjs is.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { INTERFACES, interfaceById, resolveInterface, searchInterfaces } from "../src/core/interface/InterfaceCatalog";
import {
  applyEdit,
  builtInCompositions,
  cloneComposition,
  liveRegions,
  mergeCompositions,
  sanitize,
  splitComposition,
  variantOf,
  VARIANT_STYLES,
} from "../src/core/interface/interfaceComposition";
import Store, { compositionCoversWorld } from "../src/core/interface/InterfaceCompositionStore";
import { INTERFACE_EXECUTORS, INTERFACE_TOOLS } from "../src/core/interface/InterfaceCompositionTools";
import { attachInterfaceLauncher, launchFromQuery, type LaunchRequest } from "../src/core/interface/interfaceLaunch";

const run = (id: string, args: Record<string, unknown>) => INTERFACE_EXECUTORS.find((e) => e.id === id)!.run(args, undefined);

test("the catalog lists the real interfaces, with Legacy UIs holding the System UI and the original LÉLU", () => {
  assert.deepEqual(INTERFACES.map((i) => i.id), ["cosmos", "lelu-room", "neural-map", "lelu-system", "og-inner-sky", "og-core"]);
  assert.equal(interfaceById("neural-map")!.category, "Neural Map");
  const legacy = INTERFACES.filter((i) => i.category === "Legacy UIs").map((i) => i.id);
  assert.deepEqual(legacy, ["lelu-system", "og-inner-sky", "og-core"]);
  assert.equal(interfaceById("lelu-room")!.name, "LÉLU's Room");
  for (const entry of INTERFACES) {
    assert.ok(entry.href, `${entry.id} has a standalone entry`);
    assert.ok(entry.source.startsWith("src/"), `${entry.id} names its real source`);
  }
});

test("phrases resolve to one interface or are refused", () => {
  assert.equal(resolveInterface("Genesis V2")!.id, "lelu-room");
  assert.equal(resolveInterface("the old system ui")!.id, "lelu-system");
  assert.equal(resolveInterface("original lélu")!.id, "og-inner-sky");
  assert.equal(resolveInterface("original core")!.id, "og-core");
  assert.equal(resolveInterface("the cosmos")!.id, "cosmos");
  assert.equal(resolveInterface("a toaster"), null);
  assert.equal(resolveInterface("the neural map")!.id, "neural-map");
  assert.ok(searchInterfaces("heartbeat").some((i) => i.id === "lelu-system"));
});

test("cloning makes an independent copy with lineage; the source is unchanged", () => {
  const [source] = builtInCompositions();
  const snapshot = JSON.stringify(source);
  const copy = cloneComposition(source, 1000);
  assert.notEqual(copy.id, source.id);
  assert.equal(copy.builtIn, false);
  assert.equal(copy.parentId, source.id);
  assert.deepEqual(copy.lineage.map((l) => l.how), ["clone"]);
  assert.deepEqual(copy.regions.map((r) => r.interfaceId), source.regions.map((r) => r.interfaceId));
  assert.ok(copy.regions.every((r) => !source.regions.some((s) => s.key === r.key)), "fresh region keys");
  const edited = applyEdit(copy, { op: "remove", key: copy.regions[0].key });
  assert.equal(edited.regions.length, source.regions.length - 1);
  assert.equal(JSON.stringify(source), snapshot);
});

test("merge, split and variants each produce new compositions and can be composed again", () => {
  const [a, b] = builtInCompositions();
  const merged = mergeCompositions(a, b, 1);
  assert.equal(merged.regions.length, a.regions.length + b.regions.length);
  assert.deepEqual(merged.lineage.map((l) => l.id), [a.id, b.id]);
  const parts = splitComposition(merged, 2, 2)!;
  assert.equal(parts[0].regions.length, 2);
  assert.equal(parts[1].regions.length, merged.regions.length - 2);
  assert.equal(splitComposition(merged, 0), null);
  // Recursive: a merge of a split part still knows its whole ancestry.
  const again = mergeCompositions(parts[1], a, 3);
  assert.ok(again.lineage.some((l) => l.id === merged.id));

  const variants = VARIANT_STYLES.map((s, i) => variantOf(a, s, 10 + i));
  assert.equal(new Set(variants.map((v) => v.id)).size, 4);
  const cinematic = variants[1];
  assert.equal(cinematic.flow, "horizontal");
  assert.ok(interfaceById(cinematic.regions[0].interfaceId)!.webgl, "cinematic opens on a 3D world");
  const minimal = variants[2];
  assert.ok(minimal.regions.length <= 2 && minimal.regions.length >= 1);
  for (const v of variants) {
    const sourceSet = new Set(a.regions.map((r) => r.interfaceId));
    assert.ok(v.regions.every((r) => sourceSet.has(r.interfaceId)), `${v.name} uses only the source's interfaces`);
  }
});

test("sanitize drops regions that are not real interfaces", () => {
  const [a] = builtInCompositions();
  const bad = sanitize({ ...a, regions: [...a.regions, { key: "x", interfaceId: "fake-ui" as never, size: "screen" }] });
  assert.equal(bad.regions.length, a.regions.length);
});

test("at most one WebGL region is live; DOM regions in view stay live", () => {
  const regions = builtInCompositions()[0].regions; // og-inner-sky, lelu-room, cosmos, lelu-system, og-core
  const [inner, room, cosmos] = regions;
  const scrollingIntoRoom = liveRegions(regions, { [inner.key]: 0.45, [room.key]: 0.55 });
  assert.equal(scrollingIntoRoom.current, room.key);
  assert.deepEqual([...scrollingIntoRoom.live].sort(), [inner.key, room.key].sort());
  const twoWorlds = liveRegions(regions, { [room.key]: 0.4, [cosmos.key]: 0.6 });
  assert.deepEqual([...twoWorlds.live], [cosmos.key], "the room's canvas is not kept while the Cosmos is current");
});

test("the store: built-ins are never edited — an edit forks; undo, trash and restore work", () => {
  Store.resetForTests();
  const builtIn = Store.list()[0];
  const before = JSON.stringify(Store.get(builtIn.id));
  const result = Store.edit(builtIn.id, { op: "remove", key: builtIn.regions[0].key })!;
  assert.equal(result.forked, true);
  assert.notEqual(result.id, builtIn.id);
  assert.equal(JSON.stringify(Store.get(builtIn.id)), before);
  const fork = Store.get(result.id)!;
  assert.equal(fork.regions.length, builtIn.regions.length - 1);
  assert.equal(fork.regions[0].interfaceId, builtIn.regions[1].interfaceId, "the edit carried by position");

  Store.edit(fork.id, { op: "rename", name: "Mine" });
  assert.equal(Store.get(fork.id)!.name, "Mine");
  assert.ok(Store.undo(fork.id));
  assert.notEqual(Store.get(fork.id)!.name, "Mine");

  assert.equal(Store.remove(builtIn.id), false, "built-ins cannot be removed");
  assert.ok(Store.remove(fork.id));
  assert.equal(Store.get(fork.id), undefined);
  assert.ok(Store.restore(fork.id));
  assert.ok(Store.get(fork.id));
});

test("the store tracks the open composition and whether it covers the world", () => {
  Store.resetForTests();
  const c = Store.list()[0];
  assert.equal(compositionCoversWorld(Store.getState()), false);
  Store.open(c.id);
  assert.equal(Store.getState().open!.currentInterface, "og-inner-sky");
  assert.equal(compositionCoversWorld(Store.getState()), true);
  const cosmosKey = c.regions.find((r) => r.interfaceId === "cosmos")!.key;
  Store.setCurrent(cosmosKey);
  assert.equal(compositionCoversWorld(Store.getState()), false, "the Cosmos region shows the real world through");
  Store.close();
  assert.equal(Store.getState().open, null);
});

test("tools: list, compose and open go through the registry contract and never fake a launch", async () => {
  Store.resetForTests();
  assert.deepEqual(INTERFACE_TOOLS.map((t) => t.id), ["interface.list", "interface.open", "interface.compose"]);
  const listed = await run("interface.list", {});
  assert.ok(listed.ok && /LÉLU System UI/.test(listed.content) && /One LÉLU/.test(listed.content));

  const created = await run("interface.compose", { action: "create", name: "Room then System", interfaces: ["genesis v2", "system ui"] });
  assert.ok(created.ok, created.content);
  const id = (created.data as { id: string }).id;
  assert.deepEqual(Store.get(id)!.regions.map((r) => r.interfaceId), ["lelu-room", "lelu-system"]);
  const refused = await run("interface.compose", { action: "create", interfaces: ["nothing real"] });
  assert.equal(refused.ok, false);

  const variants = await run("interface.compose", { action: "variants", source: id, styles: ["cinematic", "minimal"] });
  assert.ok(variants.ok);
  assert.equal((variants.data as { ids: string[] }).ids.length, 2);

  // No shell attached: opening fails honestly.
  const noShell = await run("interface.open", { interface: "lelu-room" });
  assert.equal(noShell.ok, false);
  assert.match(noShell.content, /not mounted/);

  const seen: LaunchRequest[] = [];
  const detach = attachInterfaceLauncher((r) => {
    seen.push(r);
    return { ok: true, detail: "opened" };
  });
  const opened = await run("interface.open", { interface: "LÉLU System UI" });
  assert.ok(opened.ok);
  assert.deepEqual(seen.at(-1), { kind: "interface", id: "lelu-system" });
  detach();
});

test("standalone deep links", () => {
  assert.deepEqual(launchFromQuery("?interface=lelu-room"), { kind: "interface", id: "lelu-room" });
  assert.deepEqual(launchFromQuery("?composition=one-lelu&region=r1"), { kind: "composition", id: "one-lelu", regionKey: "r1" });
  assert.equal(launchFromQuery("?interface=evil"), null);
  assert.deepEqual(launchFromQuery("?interface=neural-map&entity=cosmos.object:obj_1"), { kind: "interface", id: "neural-map", entity: "cosmos.object:obj_1" });
});

test("M17.1: redo restores what undo took back; a new edit clears redo", () => {
  Store.resetForTests();
  const c = Store.create("R", ["cosmos", "lelu-room"]);
  Store.edit(c.id, { op: "rename", name: "One" });
  Store.edit(c.id, { op: "rename", name: "Two" });
  assert.ok(Store.undo(c.id));
  assert.equal(Store.get(c.id)!.name, "One");
  assert.ok(Store.canRedo(c.id));
  assert.ok(Store.redo(c.id));
  assert.equal(Store.get(c.id)!.name, "Two");
  assert.ok(Store.undo(c.id));
  Store.edit(c.id, { op: "rename", name: "Three" });
  assert.equal(Store.canRedo(c.id), false, "a new edit starts a new future");
  assert.equal(Store.redo(c.id), false);
});

test("M17.1: interface slash commands compile to the real interface.* tools", async () => {
  const { interfacePlan, directPlanFor } = await import("../src/core/router/DirectResolver");
  assert.deepEqual(interfacePlan("/interfaces")!.steps.map((s) => s.tool), ["interface.list"]);
  assert.deepEqual(interfacePlan("/open genesis v2")!.steps[0].args, { interface: "genesis v2" });
  assert.deepEqual(interfacePlan("/open composition one-lelu")!.steps[0].args, { composition: "one-lelu" });
  assert.deepEqual(interfacePlan("/close composition")!.steps[0].args, { close: true });
  assert.deepEqual(interfacePlan("/compose original lélu + LÉLU's Room")!.steps[0].args, { action: "create", interfaces: ["original lélu", "LÉLU's Room"], open: true });
  assert.equal(interfacePlan("open her room please"), null, "words are the model's to interpret");
  assert.ok(directPlanFor("/interfaces")!.explicit);
});

test("M17.1: compose with open:true reports a saved-but-not-opened composition honestly", async () => {
  Store.resetForTests();
  const r = await run("interface.compose", { action: "create", interfaces: ["cosmos"], open: true });
  assert.equal(r.ok, false);
  assert.match(r.content, /saved but not opened/);
  assert.ok(Store.get((r.data as { id: string }).id), "it was still created");
});
