/**
 * ==========================================================
 * LÉLU — LEARNING PROVENANCE
 *
 * CATEGORY: unit. The real MemoryEngine, with the IndexedDB store
 * replaced by an in-process one that implements the same interface.
 *
 * Why this exists: `Brain.learn` accepted the intent, keywords and
 * provenance context that MemoryBridge, agent delegation and knowledge
 * ingestion compute — and discarded all three before the one memory
 * engine that owns persistence ever saw them. The existing provenance
 * test stubbed the brain, so it proved the bridge *computed* the fields
 * and never that anything stored them.
 *
 * These assertions are about persistence, not about a log line:
 *   - a caller's source, attribution and executionVerified survive
 *   - supplied keywords are stored with the fact and match it later
 *   - a correction supersedes, keeps its history, and records the
 *     provenance of the correction
 *
 * No second memory system is constructed: MemoryEngine and PatternMemory
 * shapes are the real ones, and only the disk is substituted.
 */

import assert from "node:assert/strict";
import test from "node:test";

import MemoryEngine, { type LearnProvenance } from "../src/brain/MemoryEngine";
import type PatternMemory from "../src/brain/PatternMemory";
import type ResponsePattern from "../src/brain/ResponsePattern";

/** The subset of PatternMemory MemoryEngine actually calls, in memory. */
class InMemoryPatterns {
  readonly patterns = new Map<string, ResponsePattern>();

  async add(pattern: ResponsePattern): Promise<void> {
    this.patterns.set(pattern.id, structuredClone(pattern));
  }

  async update(pattern: ResponsePattern): Promise<void> {
    this.patterns.set(pattern.id, structuredClone(pattern));
  }

  async search(query: string): Promise<ResponsePattern[]> {
    // Deliberately generous: this substitutes for PatternMemory's scoring,
    // not for the behaviour under test (which fact is written, and what
    // provenance travels with it). A real recall ranking is covered by the
    // browser acceptance run.
    const words = query.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length > 2);
    return [...this.patterns.values()].filter((pattern) => {
      const haystack = `${pattern.prompt} ${pattern.response} ${pattern.keywords.join(" ")}`.toLowerCase();
      return words.some((word) => haystack.includes(word));
    });
  }

  all(): ResponsePattern[] {
    return [...this.patterns.values()];
  }
}

function engine(): { engine: MemoryEngine; store: InMemoryPatterns } {
  const store = new InMemoryPatterns();
  const engine = new MemoryEngine(store as unknown as PatternMemory);
  return { engine, store };
}

test("a caller's provenance is stored with the fact, not dropped", async () => {
  const { engine: memory, store } = engine();

  await memory.learn(
    "For the shared project record, the verification marker is discovery code ORCHID-7742, found while auditing the voice pipeline.",
    "Noted.",
    {
      source: "lelu-chat",
      attribution: "user statement during M22.5 audit",
      context: { executionVerified: false },
    } satisfies LearnProvenance,
  );

  const stored = store.all();
  assert.equal(stored.length, 1, "the discovery was persisted");
  assert.equal(stored[0].context?.source, "lelu-chat", "the caller's source survived");
  assert.equal(
    stored[0].context?.attribution,
    "user statement during M22.5 audit",
    "attribution survived",
  );
  assert.equal(
    stored[0].context?.executionVerified,
    false,
    "an unverified statement is stored as unverified, not as fact",
  );
});

test("supplied keywords are stored and can carry a later recall", async () => {
  const { engine: memory, store } = engine();

  await memory.learn(
    "My project codename is FIELDNOTE and the archive migration depends on it.",
    "Understood.",
    { source: "lelu-chat", keywords: ["archivemigration"] },
  );

  const stored = store.all();
  assert.ok(
    stored[0].keywords.includes("archivemigration"),
    "the caller's keyword is part of the memory",
  );

  // The keyword alone reaches it, even though the fact never uses the word.
  const recalled = await store.search("archivemigration");
  assert.equal(recalled.length, 1, "the keyword matches the fact it was attached to");
});

test("a correction supersedes, keeps history, and records its own provenance", async () => {
  const { engine: memory, store } = engine();

  await memory.learn(
    "My studio is called Aurelia and I work exclusively in 18k rose gold.",
    "Noted.",
    { source: "lelu-chat" },
  );
  await memory.learn(
    "Actually, correct that: I work in platinum now, not rose gold.",
    "Updated.",
    { source: "lelu-chat-correction", context: { correctedFrom: "rose gold" } },
  );

  assert.equal(store.all().length, 1, "a correction updates the fact instead of duplicating it");

  const updated = store.all()[0];
  assert.match(updated.response, /^Actually, correct that: I work in platinum now/i);
  assert.ok(Array.isArray(updated.context?.history), "the superseded statement is kept in history");
  assert.equal(updated.context?.source, "lelu-chat-correction", "the correction's provenance is current");
  assert.equal(updated.context?.correctedFrom, "rose gold");
  assert.ok(
    !/^I work exclusively in 18k rose gold/.test(updated.response),
    "the obsolete value is never the stored answer",
  );
  assert.match(
    updated.response,
    /Aurelia/i,
    "facts the correction said nothing about survive it",
  );
});
