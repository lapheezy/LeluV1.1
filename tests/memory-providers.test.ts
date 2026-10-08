/**
 * ==========================================================
 * LÉLU — MEMORY PROVIDER ISOLATION
 *
 * CATEGORY: unit. The real MemoryOrchestrator with stand-in
 * providers, because what is being tested is the orchestrator's
 * behaviour when a provider misbehaves — which is hard to
 * arrange with the real Supabase and is the entire point.
 *
 * Why this exists: brief §5 says LÉLU must render, chat, think
 * and remember when Supabase is unavailable, and §21 asks that
 * "Supabase failure is isolated" be verified rather than
 * assumed. A provider that throws, hangs, or returns nothing
 * must cost only its own results.
 * ==========================================================
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  MemoryOrchestrator,
  type ContextItem,
  type MemoryProvider,
} from "../src/core/memory/MemoryProvider";

function fresh(): MemoryOrchestrator {
  MemoryOrchestrator.reset();
  return MemoryOrchestrator.getInstance();
}

const localProvider = (items: ContextItem[]): MemoryProvider => ({
  id: "local",
  isAvailable: () => true,
  async context() {
    return items;
  },
  async persist() {},
});

test("context comes back ordered by the brief's priority bands", async () => {
  const orchestrator = fresh();
  orchestrator.register({
    id: "archive",
    isAvailable: () => true,
    async context() {
      return [{ source: "archive", band: 6, content: "old history" }];
    },
  });
  orchestrator.register(
    localProvider([{ source: "local", band: 3, content: "what she just heard" }]),
  );

  const items = await orchestrator.gather("anything");

  assert.equal(items.length, 2);
  assert.equal(items[0].band, 3, "nearer context must come first");
  assert.equal(items[1].band, 6, "historical context ranks below it");
});

test("a throwing provider costs only its own results", async () => {
  const orchestrator = fresh();
  orchestrator.register({
    id: "supabase",
    isAvailable: () => true,
    async context() {
      throw new Error("supabase is on fire");
    },
  });
  orchestrator.register(localProvider([{ source: "local", band: 4, content: "still here" }]));

  const items = await orchestrator.gather("anything");

  assert.equal(items.length, 1, "the healthy provider must still be heard");
  assert.equal(items[0].content, "still here");
});

test("a hanging provider is skipped instead of stalling the turn", async () => {
  const orchestrator = fresh();
  orchestrator.register({
    id: "slow",
    isAvailable: () => true,
    context() {
      return new Promise<ContextItem[]>(() => {}); // never settles
    },
  });
  orchestrator.register(localProvider([{ source: "local", band: 4, content: "prompt enough" }]));

  const started = Date.now();
  const items = await orchestrator.gather("anything", { timeoutMs: 150 });
  const elapsed = Date.now() - started;

  assert.ok(elapsed < 2_000, `gather should not wait on a dead provider (took ${elapsed}ms)`);
  assert.equal(items.length, 1);
  assert.equal(items[0].source, "local");
});

test("unavailable providers are not consulted at all", async () => {
  const orchestrator = fresh();
  let consulted = false;
  orchestrator.register({
    id: "supabase",
    isAvailable: () => false,
    async context() {
      consulted = true;
      return [{ source: "supabase", band: 6, content: "should never appear" }];
    },
  });

  const items = await orchestrator.gather("anything");

  assert.equal(consulted, false, "an unconfigured provider must not be queried");
  assert.deepEqual(items, []);
});

test("no providers at all is an empty result, not a failure", async () => {
  const orchestrator = fresh();
  const items = await orchestrator.gather("anything");
  assert.deepEqual(items, [], "LÉLU thinks with no context rather than not thinking");
});

test("a failing write does not prevent a succeeding one", async () => {
  const orchestrator = fresh();
  let localWrote = false;

  orchestrator.register({
    id: "supabase",
    isAvailable: () => true,
    async persist() {
      throw new Error("archive unreachable");
    },
  });
  orchestrator.register({
    id: "local",
    isAvailable: () => true,
    async persist() {
      localWrote = true;
    },
  });

  const result = await orchestrator.persist({ prompt: "p", response: "r" });

  assert.equal(localWrote, true, "local memory must still take the write");
  assert.deepEqual(result.accepted, ["local"]);
  assert.deepEqual(result.failed, ["supabase"]);
});

test("providers can be filtered to specific bands", async () => {
  const orchestrator = fresh();
  orchestrator.register({
    id: "archive",
    isAvailable: () => true,
    async context() {
      return [{ source: "archive", band: 6, content: "history" }];
    },
  });
  orchestrator.register(localProvider([{ source: "local", band: 4, content: "recent" }]));

  const items = await orchestrator.gather("anything", { bands: [4] });

  assert.equal(items.length, 1);
  assert.equal(items[0].content, "recent");
});
