/**
 * M16.3 WP05 — verification, honest failure and bounded correction on the
 * Cosmos object tools.
 *
 * The real path runs: tool → CosmosObjectStore → read back → verdict. A store
 * call returning ok is not enough; the object is checked on its target, its
 * change, the value asked for, the fields it must not touch, and persistence.
 *
 * One injected fault proves the retry: a dropped write recovers on the second
 * attempt; a permanent fault ends at exactly two attempts and reports ok:false.
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
import { verifyObjectOperation, snapshotOf, persistedObject } from "../src/core/cosmos/objects/verification";
import { clearCosmosReferents, rememberCosmosReferent } from "../src/core/cosmos/objects/continuity";
import { buildGearbox } from "../src/core/creative/kit/build";
import { registerCosmosObjectTools } from "../src/core/cosmos/objects/CosmosObjectTools";
import { dispatchToolCall, toolNameForModel, type ToolExecutionResult } from "../src/core/tools/ToolDispatcher";

const sceneOf = (program: { scene: unknown }) => program.scene as never;

registerCosmosObjectTools();
const store = CosmosObjectStore.getInstance();

function spawn(name = "Gearbox"): string {
  const built = buildGearbox({ teethIn: 12, teethOut: 24 }).program!;
  const result = store.spawn({ name, scene: sceneOf(built), domain: built.domain, builder: built.builder, partCount: built.parts.length, source: { artifactId: `art_${name}`, rev: 1 } });
  assert.ok(result.ok, result.ok ? "" : result.reason);
  return result.value.id;
}

const contextFor = (conversationId: string, messages: Array<{ role: string; content: string }>, id: string) =>
  ({
    request: {
      prompt: "",
      conversationId,
      timestamp: Date.now(),
      messages: messages.map((m) => ({ ...m, content: m.content.replace("$ID", id) })),
    },
    started: Date.now(),
  }) as never;

const run = async (tool: string, args: Record<string, unknown>, context: unknown): Promise<ToolExecutionResult> =>
  (await dispatchToolCall(
    { id: `t-${Math.random()}`, name: toolNameForModel(tool), arguments: args },
    `task-${Math.random()}`,
    context as never,
    { path: "direct" },
  )) as ToolExecutionResult;

const verdictOf = (result: ToolExecutionResult) =>
  (result.data as { verification?: { result?: { status?: string; note?: string }; correction?: { attempted?: boolean; tries?: number }; persisted?: boolean } } | undefined)?.verification;

test("a transform on a remembered object is VERIFIED and persisted", async () => {
  clearCosmosReferents();
  const id = spawn("Chair");
  const context = contextFor("chat-1", [{ role: "assistant", content: "Selected it ($ID)." }], id);
  rememberCosmosReferent("chat-1", id);

  const result = await run("cosmos.object.transform", { rotation: [0, 90, 0], relative: false }, context);
  const verdict = verdictOf(result);
  assert.equal(result.ok, true, result.content);
  assert.equal(verdict?.result?.status, "VERIFIED", JSON.stringify(verdict));
  assert.equal(verdict?.persisted, true, "the state was written through the store's own storage");
  assert.deepEqual(store.get(id)?.frame.rotation, [0, 90, 0]);
});

test("with no referent the tool refuses and names the objects instead of guessing", async () => {
  clearCosmosReferents();
  spawn("Loose");
  const store2 = store;
  store2.select(null);
  const context = contextFor("chat-empty", [{ role: "user", content: "hello" }], "obj_none");
  const result = await run("cosmos.object.transform", { rotation: [0, 45, 0] }, context);
  assert.equal(result.ok, false);
  assert.match(result.content, /could not tell which object|nothing in the Cosmos/i);
});

test("a transform that fails once is retried exactly once and then VERIFIED", async () => {
  clearCosmosReferents();
  const id = spawn("Retry");
  rememberCosmosReferent("chat-retry", id);
  const context = contextFor("chat-retry", [{ role: "assistant", content: "Working on $ID." }], id);

  const original = store.transform.bind(store);
  let dropped = 0;
  (store as unknown as { transform: unknown }).transform = (...args: unknown[]) => {
    if (dropped === 0) {
      dropped += 1;
      return { ok: true, value: store.get(id)! }; // the write is silently dropped
    }
    return (original as (...a: unknown[]) => unknown)(...args);
  };

  const result = await run("cosmos.object.transform", { rotation: [0, 30, 0], relative: false }, context);
  (store as unknown as { transform: unknown }).transform = original;

  const verdict = verdictOf(result);
  assert.equal(dropped, 1, "the injected fault fired once");
  assert.equal(verdict?.correction?.attempted, true);
  assert.equal(verdict?.correction?.tries, 2);
  assert.equal(verdict?.result?.status, "VERIFIED");
  assert.equal(result.ok, true);
  assert.deepEqual(store.get(id)?.frame.rotation, [0, 30, 0]);
});

test("a transform that never lands is a failure, not a success", async () => {
  clearCosmosReferents();
  const id = spawn("Stuck");
  rememberCosmosReferent("chat-stuck", id);
  const context = contextFor("chat-stuck", [{ role: "assistant", content: "Working on $ID." }], id);

  const original = store.transform.bind(store);
  let attempts = 0;
  (store as unknown as { transform: unknown }).transform = () => {
    attempts += 1;
    return { ok: true, value: store.get(id)! };
  };

  const result = await run("cosmos.object.transform", { rotation: [0, 10, 0], relative: false }, context);
  (store as unknown as { transform: unknown }).transform = original;

  const verdict = verdictOf(result);
  assert.equal(result.ok, false, "a failed verification is a failed operation");
  assert.match(result.content, /verification failed/);
  assert.equal(verdict?.result?.status, "FAILED");
  assert.equal(attempts, 2, "one attempt and one retry, then it stops");
  assert.deepEqual(store.get(id)?.frame.rotation, [0, 0, 0], "the object was never rotated");
});

test("selection is verified as a change that must NOT happen", async () => {
  clearCosmosReferents();
  const id = spawn("Pick");
  const before = snapshotOf(store.get(id)!);
  rememberCosmosReferent("chat-select", id);
  const context = contextFor("chat-select", [{ role: "assistant", content: "Working on $ID." }], id);

  const result = await run("cosmos.object.select", {}, context);
  const verdict = verdictOf(result);
  assert.equal(result.ok, true, result.content);
  assert.equal(verdict?.result?.status, "VERIFIED");
  assert.deepEqual(snapshotOf(store.get(id)!), before, "selecting changed nothing on the object");
  assert.equal(store.selectedId(), id);
});

test("a direction move is checked against the position it should reach", async () => {
  clearCosmosReferents();
  const id = spawn("Walker");
  rememberCosmosReferent("chat-move", id);
  const context = contextFor("chat-move", [{ role: "assistant", content: "Working on $ID." }], id);
  const before = store.get(id)!.frame.position[0];

  const result = await run("cosmos.object.position", { direction: "left" }, context);
  const verdict = verdictOf(result);
  assert.equal(result.ok, true, result.content);
  assert.equal(verdict?.result?.status, "VERIFIED", JSON.stringify(verdict));
  assert.ok(store.get(id)!.frame.position[0] < before, "it moved left in world metres");
});

test("persistence reads the same storage the store writes", async () => {
  const id = spawn("Saved");
  const object = store.get(id)!;
  assert.ok(persistedObject(id), "the object is in storage");
  assert.equal(persistedObject(id)?.updatedAt, object.updatedAt);
});

/* ------------------------- the verdict itself ---------------------------- */

const snap = (over: Partial<ReturnType<typeof snapshotOf>> = {}) => ({ ...snapshotOf({ id: "obj_x", frame: { position: [0, 0, 0], rotation: [0, 0, 0], scale: 1 }, updatedAt: 1, provenance: [], visible: true, locked: false } as never), ...over });

test("a rotation that landed is VERIFIED; one that did not is FAILED", () => {
  const before = snap({ updatedAt: 1 });
  const good = verifyObjectOperation({ action: "transform", objectId: "obj_x", expect: { rotation: [0, 90, 0] } }, before, { ...before, updatedAt: 2, rotation: [0, 90, 0] }, true);
  assert.equal(good.status, "VERIFIED");
  const bad = verifyObjectOperation({ action: "transform", objectId: "obj_x", expect: { rotation: [0, 90, 0] } }, before, before, true);
  assert.equal(bad.status, "FAILED");
});

test("an untouched field that moved makes the verdict PARTIAL, and the wrong object is FAILED", () => {
  const before = snap({ updatedAt: 1 });
  const partial = verifyObjectOperation(
    { action: "transform", objectId: "obj_x", expect: { rotation: [0, 90, 0] }, preserve: ["position"] },
    before,
    { ...before, updatedAt: 2, rotation: [0, 90, 0], position: [9, 0, 0] },
    true,
  );
  assert.equal(partial.status, "PARTIAL");
  const wrong = verifyObjectOperation({ action: "transform", objectId: "obj_x" }, before, { ...before, id: "obj_y", updatedAt: 2 }, true);
  assert.equal(wrong.status, "FAILED");
});

test("an unpersisted change is never VERIFIED", () => {
  const before = snap({ updatedAt: 1 });
  const result = verifyObjectOperation({ action: "transform", objectId: "obj_x" }, before, { ...before, updatedAt: 2 }, false);
  assert.notEqual(result.status, "VERIFIED");
});

test("a dependent step is skipped after a failed prerequisite, an independent one still runs", async () => {
  const DirectResolver = (await import("../src/core/router/DirectResolver")).default;
  const resolver = new DirectResolver();
  const plan = {
    explicit: false,
    summary: "three steps",
    steps: [
      { tool: "cosmos.object.transform", label: "turn the missing object", args: { object: "obj_missing", rotation: [0, 45, 0] } },
      { tool: "cosmos.object.position", label: "move the missing object", args: { object: "obj_missing", direction: "left" } },
      { tool: "cosmos.object.list", label: "list", args: {} },
    ],
  };
  const result = await resolver.execute(
    { request: { prompt: "compound", timestamp: 3, conversationId: "chat-compound" }, started: Date.now(), aiProviders: { available: async () => [] } } as never,
    plan as never,
    "construction",
  );
  const steps = (result.response?.metadata as { steps?: Array<{ ok: boolean; skipped?: boolean }> } | undefined)?.steps ?? [];
  assert.equal(steps.length, 3);
  assert.equal(steps[0].ok, false, "the prerequisite failed");
  assert.equal(steps[1].skipped, true, "the dependent step was not attempted");
  assert.equal(steps[2].ok, true, "an independent step still ran");
  assert.match(result.response?.text ?? "", /not attempted/);
});
