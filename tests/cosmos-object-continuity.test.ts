/**
 * M16.3 WP05 — conversation referent continuity on the Cosmos object line.
 *
 * The live gap this closes: "rotate it 90 degrees" needs to know which object
 * "it" is. The referent comes from THIS conversation (its messages, then the
 * id its last successful tool result touched, then the visible selection) and
 * is validated against the object store on every read. Nothing here falls back
 * to the newest object, and two conversations cannot share a referent.
 */

/* Node has no window; KvStore reads and writes through it. Give the store the
 * same two backends the app uses so "persisted" means what it says. */
const memory = new Map<string, string>();
const makeStorage = (): Storage => ({
  getItem: (key: string) => memory.get(key) ?? null,
  setItem: (key: string, value: string) => void memory.set(key, String(value)),
  removeItem: (key: string) => void memory.delete(key),
  clear: () => memory.clear(),
  key: (index: number) => [...memory.keys()][index] ?? null,
  get length() {
    return memory.size;
  },
}) as Storage;
(globalThis as unknown as { window: unknown }).window = { localStorage: makeStorage(), sessionStorage: makeStorage(), name: "" };
(globalThis as unknown as { localStorage: Storage }).localStorage = makeStorage();

import assert from "node:assert/strict";
import test from "node:test";
import CosmosObjectStore from "../src/core/cosmos/objects/CosmosObjectStore";
import { buildGearbox, buildCabin } from "../src/core/creative/kit/build";
import {
  clearCosmosReferents,
  isImplicitReference,
  referentFromConversation,
  rememberCosmosReferent,
  resolveCosmosReferent,
  resolveCosmosTarget,
} from "../src/core/cosmos/objects/continuity";
import { compileDirect } from "../src/core/creative/kit/DirectCompiler";

const sceneOf = (program: { scene: unknown }) => program.scene as never;

function seeded(): { store: CosmosObjectStore; gearbox: string; cabin: string } {
  const store = CosmosObjectStore.createIsolated();
  const g = buildGearbox({ teethIn: 12, teethOut: 24 }).program!;
  const c = buildCabin({ width: 6, depth: 4, storeys: 1 }).program!;
  const gearbox = store.spawn({ name: "Gearbox", scene: sceneOf(g), domain: g.domain, builder: g.builder, partCount: g.parts.length, source: { artifactId: "art_1", rev: 1 } });
  const cabin = store.spawn({ name: "Cabin", scene: sceneOf(c), domain: c.domain, builder: c.builder, partCount: c.parts.length, source: { artifactId: "art_2", rev: 1 } });
  assert.ok(gearbox.ok && cabin.ok);
  return { store, gearbox: gearbox.value.id, cabin: cabin.value.id };
}

test("the newest valid id in the conversation is the referent", () => {
  const { store, gearbox, cabin } = seeded();
  const referent = referentFromConversation(
    [
      { role: "user", content: "select the gearbox" },
      { role: "assistant", content: `Selected Gearbox (${gearbox}).` },
      { role: "user", content: "now the cabin" },
      { role: "assistant", content: `Selected Cabin (${cabin}).` },
    ],
    store,
  );
  assert.equal(referent?.object.id, cabin, "the later mention wins");
  assert.equal(referent?.source, "conversation");
});

test("a removed object is not a referent, and a live earlier mention is used instead", () => {
  const { store, gearbox, cabin } = seeded();
  store.remove(cabin, true);
  const referent = referentFromConversation(
    [
      { role: "assistant", content: `Selected Gearbox (${gearbox}).` },
      { role: "assistant", content: `Removed it (${cabin}).` },
    ],
    store,
  );
  assert.equal(referent?.object.id, gearbox, "the trashed id no longer resolves");
});

test("two conversations do not share a referent", () => {
  clearCosmosReferents();
  const { store, gearbox } = seeded();
  rememberCosmosReferent("chat-a", gearbox);
  assert.equal(resolveCosmosReferent({ store, conversationId: "chat-a" })?.object.id, gearbox);
  assert.equal(resolveCosmosReferent({ store, conversationId: "chat-b" }), null, "chat B inherits nothing");
});

test("a remembered id that no longer exists is dropped, not acted on", () => {
  clearCosmosReferents();
  const { store, cabin } = seeded();
  rememberCosmosReferent("chat-a", cabin);
  store.remove(cabin, true);
  assert.equal(resolveCosmosReferent({ store, conversationId: "chat-a" }), null);
});

test("explicit names still resolve by name", () => {
  const { store, gearbox } = seeded();
  const lookup = resolveCosmosTarget(store, "gearbox");
  assert.ok("object" in lookup && lookup.object.id === gearbox);
});

test("an implicit reference never falls back to the newest object", () => {
  clearCosmosReferents();
  const { store } = seeded();
  const lookup = resolveCosmosTarget(store, "it");
  assert.ok("reason" in lookup, "no referent means a refusal, not the newest object");
  assert.match(lookup.reason, /could not tell which object/i);
});

test("the selection answers only when this conversation has nothing better", () => {
  clearCosmosReferents();
  const { store, gearbox } = seeded();
  store.select(gearbox);
  const lookup = resolveCosmosTarget(store, "it", { conversationId: "fresh-chat" });
  assert.ok("object" in lookup && lookup.object.id === gearbox);
});

test("an empty store refuses instead of inventing an object", () => {
  const store = CosmosObjectStore.createIsolated();
  const lookup = resolveCosmosTarget(store, "");
  assert.ok("reason" in lookup);
  assert.match(lookup.reason, /nothing in the Cosmos/i);
});

test("implicit references are recognised", () => {
  for (const phrase of ["it", "that", "the same object", "the selected object", "the one you just moved"]) {
    assert.equal(isImplicitReference(phrase), true, phrase);
  }
  assert.equal(isImplicitReference("the gearbox"), false);
});

test("the compiler turns the follow-up sentences into determinate steps", () => {
  const store = CosmosObjectStore.getInstance();
  const g = buildGearbox({ teethIn: 12, teethOut: 24 }).program!;
  const c = buildCabin({ width: 6, depth: 4, storeys: 1 }).program!;
  store.spawn({ name: "Gearbox", scene: sceneOf(g), domain: g.domain, builder: g.builder, partCount: g.parts.length, source: { artifactId: "art_c1", rev: 1 } });
  const cabin = store.spawn({ name: "Cabin", scene: sceneOf(c), domain: c.domain, builder: c.builder, partCount: c.parts.length, source: { artifactId: "art_c2", rev: 1 } });
  store.select(cabin.value.id);
  const turn = compileDirect("rotate it 90 degrees");
  assert.equal(turn?.steps[0].tool, "cosmos.object.transform");
  assert.equal(turn?.steps[0].args.rotation?.[1], 90);

  const twice = compileDirect("make it twice as large");
  assert.equal(twice?.steps[0].tool, "cosmos.object.transform");
  assert.equal(twice?.steps[0].args.scale, 2);
  assert.equal(twice?.steps[0].args.relative, true);

  const left = compileDirect("move it to the left");
  assert.equal(left?.steps[0].tool, "cosmos.object.position");
  assert.equal(left?.steps[0].args.direction, "left");

  const choose = compileDirect("select the cabin");
  assert.equal(choose?.steps[0].tool, "cosmos.object.select");
  assert.equal(choose?.steps[0].args.object, "cabin");
});

test("a name that is two objects is refused, not resolved to one of them", () => {
  const store = CosmosObjectStore.createIsolated();
  const g = buildGearbox({ teethIn: 12, teethOut: 24 }).program!;
  store.spawn({ name: "Oak chair", scene: sceneOf(g), domain: g.domain, builder: g.builder, partCount: g.parts.length, source: { artifactId: "a1", rev: 1 } });
  store.spawn({ name: "Oak chair", scene: sceneOf(g), domain: g.domain, builder: g.builder, partCount: g.parts.length, source: { artifactId: "a2", rev: 1 } });
  const lookup = resolveCosmosTarget(store, "oak chair");
  assert.ok("reason" in lookup);
  assert.match(lookup.reason, /matches 2 objects/);
});
