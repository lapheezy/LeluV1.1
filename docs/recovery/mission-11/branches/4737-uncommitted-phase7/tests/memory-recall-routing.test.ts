/**
 * ==========================================================
 * LÉLU — RECALL ROUTING AND MEMORY FIELD INTEGRITY
 *
 * CATEGORY: unit. Real BrainResolver, real MemorySynthesizer, real
 * OfflineComposer; only the transport (providers) and the log sink are
 * stands-in.
 *
 * Why this exists: a plain recall question ("what do you remember about
 * me, where did we leave off") was answered deterministically from the
 * local store even when a provider was reachable, so the API was never
 * used and the reply was spliced stored sentences. And a memory record
 * missing a field — which older local rows are — crashed recall with a
 * bare TypeError instead of simply being an imperfect memory.
 * ==========================================================
 */

import assert from "node:assert/strict";
import test from "node:test";

import BrainResolver from "../src/core/router/BrainResolver";
import MemorySynthesizer from "../src/brain/MemorySynthesizer";
import OfflineComposer from "../src/brain/OfflineComposer";
import type RouterContext from "../src/core/router/RouterContext";
import type ResponsePattern from "../src/brain/ResponsePattern";

const FACT: ResponsePattern = {
  id: "fact-1",
  category: "identity",
  prompt: "What is my name?",
  response: "My name is Zephyrine Vale.",
  intent: "general",
  keywords: ["name", "zephyrine"],
  context: {},
  importance: 0.9,
  confidence: 0.9,
  memoryType: "user",
  successfulUses: 1,
  failedUses: 0,
  createdAt: Date.now(),
  updatedAt: Date.now(),
};

/** A context with exactly the surface BrainResolver touches. */
function context(prompt: string, providers: number): RouterContext {
  return {
    request: { prompt, timestamp: Date.now() },
    started: Date.now(),
    brain: {
      recall: async () => [FACT],
      composeFromMemory: async () => "composed from memory",
      compose: async () => "composed locally",
    },
    knowledgeProviders: {},
    aiProviders: { available: async () => Array.from({ length: providers }, (_, i) => ({ name: `p${i}` })) },
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    recalledMemories: [FACT],
  } as unknown as RouterContext;
}

test("a recall question reaches the provider when one is available", async () => {
  const result = await new BrainResolver().execute(
    context("Lélu, what do you remember about me? Where did we leave off?", 2),
  );
  assert.equal(result.handled, false, "the provider must answer, with the facts as context");
});

test("a recall question is answered locally only when no provider exists", async () => {
  const result = await new BrainResolver().execute(context("What do you remember about me?", 0));
  assert.equal(result.handled, true);
  assert.equal(result.response?.text, "composed locally");
});

test("Lélu's own identity stays deterministic even with providers up", async () => {
  const result = await new BrainResolver().execute(context("Who are you?", 3));
  assert.equal(result.handled, true, "her identity record answers, not a model");
  assert.equal(result.response?.text, "composed locally");
});

test("a memory record missing fields cannot throw during synthesis", () => {
  const sparse = [
    { id: "legacy-1", category: "identity", confidence: 0.9, importance: 0.9 },
    { id: "legacy-2", category: "project", response: "Halo Array", keywords: null },
    { id: "legacy-3" },
  ] as unknown as ResponsePattern[];

  const synthesized = new MemorySynthesizer().synthesize({
    prompt: "Lélu, what do you remember about me?",
    memories: sparse,
  });
  assert.equal(typeof synthesized.context, "string");
  assert.doesNotThrow(() => new MemorySynthesizer().summarizeFacts("what do you remember", sparse));
});

test("offline identity phrasing does not splice a stored self-introduction", async () => {
  const memory = {
    getAll: () => [FACT],
    search: () => [FACT],
    recall: async () => [FACT],
  };
  const composer = new OfflineComposer(memory as never);
  const text = await composer.compose("What do you remember about me?");
  assert.ok(typeof text === "string");
  assert.ok(
    !/your name is my name is/i.test(text),
    `spliced phrasing leaked: ${text.slice(0, 120)}`,
  );
});
