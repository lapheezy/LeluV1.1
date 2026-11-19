/**
 * LÉLU 2.2 — MEMORY SOVEREIGNTY PERFORMANCE
 *
 * Measures what the boundary costs, deterministically and without a model:
 * eligibility filtering inside recall, authorization decisions, provenance
 * labelling, and the token cost of the instruction note. Mean and p95, over
 * a store large enough that the numbers mean something.
 *
 * Run: npx tsx scripts/memory-bench.ts
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const databases = new Map<string, Map<string, Map<string, unknown>>>();
class ShimRequest {
  result: unknown = null;
  onsuccess: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onupgradeneeded: (() => void) | null = null;
  settle(): void {
    queueMicrotask(() => this.onsuccess?.());
  }
}
class ShimObjectStore {
  constructor(private readonly rows: Map<string, unknown>) {}
  put(value: unknown): void {
    const record = value as { id: string };
    this.rows.set(record.id, structuredClone(value));
  }
  delete(id: string): void {
    this.rows.delete(id);
  }
  clear(): void {
    this.rows.clear();
  }
  get(id: string): ShimRequest {
    const req = new ShimRequest();
    req.result = this.rows.has(id) ? structuredClone(this.rows.get(id)) : null;
    req.settle();
    return req;
  }
  getAll(): ShimRequest {
    const req = new ShimRequest();
    req.result = [...this.rows.values()].map((value) => structuredClone(value));
    req.settle();
    return req;
  }
}
class ShimTransaction {
  oncomplete: (() => void) | null = null;
  onerror: (() => void) | null = null;
  private readonly stores: Map<string, ShimObjectStore>;
  constructor(db: ShimDatabase, storeName: string) {
    this.stores = new Map([[storeName, new ShimObjectStore(db.store(storeName))]]);
    queueMicrotask(() => this.oncomplete?.());
  }
  objectStore(name: string): ShimObjectStore {
    return this.stores.get(name)!;
  }
}
class ShimDatabase {
  onversionchange: (() => void) | null = null;
  constructor(private readonly name: string) {}
  store(storeName: string): Map<string, unknown> {
    const db = databases.get(this.name)!;
    if (!db.has(storeName)) db.set(storeName, new Map());
    return db.get(storeName)!;
  }
  get objectStoreNames() {
    return { contains: (name: string) => databases.get(this.name)!.has(name) };
  }
  createObjectStore(storeName: string): void {
    databases.get(this.name)!.set(storeName, new Map());
  }
  transaction(storeName: string): ShimTransaction {
    return new ShimTransaction(this, storeName);
  }
  close(): void {}
}
// @ts-expect-error — global shim for Node
globalThis.indexedDB = {
  open(name: string): ShimRequest {
    if (!databases.has(name)) databases.set(name, new Map());
    const req = new ShimRequest();
    const db = new ShimDatabase(name);
    req.result = db;
    queueMicrotask(() => {
      if (!db.objectStoreNames.contains("memories")) req.onupgradeneeded?.();
      req.onsuccess?.();
    });
    return req;
  },
};
class FakeStorage {
  private map = new Map<string, string>();
  getItem(key: string) {
    return this.map.has(key) ? this.map.get(key)! : null;
  }
  setItem(key: string, value: string) {
    this.map.set(key, value);
  }
  removeItem(key: string) {
    this.map.delete(key);
  }
  get length() {
    return this.map.size;
  }
  key(i: number) {
    return [...this.map.keys()][i] ?? null;
  }
}
// @ts-expect-error — global shim for Node
globalThis.window = {
  localStorage: new FakeStorage(),
  sessionStorage: new FakeStorage(),
  name: "",
  location: { origin: "http://localhost:3000" },
};

import { performance } from "node:perf_hooks";
import Brain from "../src/brain/Brain";
import MemorySynthesizer from "../src/brain/MemorySynthesizer";
import {
  authorize,
  currentSessionId,
  isEligible,
  memoryContextNote,
  readOrigin,
  type MemoryScopeContext,
} from "../src/core/memory/MemorySovereignty";

function percentile(sorted: number[], fraction: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1));
  return sorted[index];
}

function stats(samples: number[]) {
  const sorted = [...samples].sort((a, b) => a - b);
  const mean = samples.reduce((sum, value) => sum + value, 0) / Math.max(1, samples.length);
  return {
    samples: samples.length,
    meanMs: Math.round(mean * 1000) / 1000,
    p95Ms: Math.round(percentile(sorted, 0.95) * 1000) / 1000,
    maxMs: Math.round((sorted.at(-1) ?? 0) * 1000) / 1000,
  };
}

async function main(): Promise<void> {
  const brain = new Brain();
  const sessionId = currentSessionId();
  const conversations = Array.from({ length: 20 }, (_, i) => `bench-chat-${i}`);

  const topics = [
    "My studio is called Aurelia and I work in rose gold.",
    "I'm building a telescope mount in the workshop.",
    "I prefer working in the morning, before the house wakes.",
    "My father died last month and I can't focus on anything.",
    "The Groq provider returns a 429 when the budget is low.",
    "I want to ship the smaller version first.",
    "My daughter is called Mira and she likes the colour teal.",
    "We decided to use platinum for the second collection.",
    "The deploy window is Tuesday night.",
    "I hate filler openings in replies.",
  ];

  const seeded = 500;
  for (let index = 0; index < seeded; index += 1) {
    const conversationId = conversations[index % conversations.length];
    await brain.learn(topics[index % topics.length], "Noted.", "conversation", [], {
      source: "lelu-chat",
      originSeed: {
        userId: "primary-user",
        conversationId,
        sessionId,
        conversationTitle: conversationId,
        sourceType: "user-said",
      },
    });
  }

  const prompts = [
    "Can you fix it?",
    "What's the status of the Aurelia project?",
    "How do I configure the Groq provider?",
    "What metal do I prefer for the studio?",
    "How am I handling my father's death now?",
    "What was I building in the workshop?",
  ];

  const scopes: MemoryScopeContext[] = prompts.map((prompt, index) => ({
    userId: "primary-user",
    conversationId: index % 2 === 0 ? "bench-chat-0" : "bench-chat-1",
    sessionId,
    prompt,
  }));

  // Warm up so the first measurement is not JIT noise.
  for (const scope of scopes) await brain.recall(scope.prompt, "bench", scope);

  const scoped: number[] = [];
  const unscoped: number[] = [];
  const authorizeSamples: number[] = [];
  const readOriginSamples: number[] = [];
  const eligibilitySamples: number[] = [];
  const synthesisSamples: number[] = [];
  const noteSamples: number[] = [];

  for (let round = 0; round < 30; round += 1) {
    for (const scope of scopes) {
      let clock = performance.now();
      const recalled = await brain.recall(scope.prompt, "bench", scope);
      scoped.push(performance.now() - clock);

      clock = performance.now();
      await brain.recall(scope.prompt, "bench");
      unscoped.push(performance.now() - clock);

      clock = performance.now();
      const authorization = authorize(recalled, scope);
      authorizeSamples.push(performance.now() - clock);

      clock = performance.now();
      for (const memory of recalled) readOrigin(memory);
      readOriginSamples.push(performance.now() - clock);

      clock = performance.now();
      for (const memory of recalled) isEligible(memory, scope);
      eligibilitySamples.push(performance.now() - clock);

      clock = performance.now();
      const synthesized = new MemorySynthesizer().synthesize({
        prompt: scope.prompt,
        memories: authorization.allowed,
        conversationId: scope.conversationId,
      });
      synthesisSamples.push(performance.now() - clock);

      clock = performance.now();
      memoryContextNote(authorization.decisions);
      noteSamples.push(performance.now() - clock);

      if (round === 0 && authorization.allowed.length > 0) {
        void synthesized;
      }
    }
  }

  const labelOverhead = readOriginSamples.map((value, index) => value + (noteSamples[index] ?? 0));
  const output = {
    mission: "LÉLU 2.2 — memory sovereignty performance",
    measuredAt: new Date().toISOString(),
    environment: "Node (same tsx runtime as tests), synthetic store, no model calls",
    corpus: { memories: seeded, conversations: conversations.length, prompts: prompts.length },
    results: {
      recallScoped: stats(scoped),
      recallUnscoped: stats(unscoped),
      scopeFilterOverheadMeanMs:
        Math.round((stats(scoped).meanMs - stats(unscoped).meanMs) * 1000) / 1000,
      authorize: stats(authorizeSamples),
      readProvenance: stats(readOriginSamples),
      eligibility: stats(eligibilitySamples),
      synthesis: stats(synthesisSamples),
      provenanceNote: stats(noteSamples),
      labellingPlusNote: stats(labelOverhead),
    },
    tokenOverhead: {
      noteOnlyWhenLabelled: true,
      noteChars: memoryContextNote([
        {
          memoryId: "m",
          decision: "RETRIEVE_WITH_CONTEXT",
          reason: "history",
          scope: "persistent-user",
          sourceType: "user-said",
          relevance: 0.8,
          relation: "other-conversation",
          originatingConversationId: "chat-a",
        },
      ]).length,
      noteCharsWhenClean: memoryContextNote([]).length,
      labelCharsHistorical: "[earlier conversation] ".length,
      labelCharsInferred: "[inferred] ".length,
    },
    notes: [
      "The scoped recall includes the eligibility filter; the unscoped recall is the pre-2.2 behaviour and is measured only to quantify the filter's cost.",
      "All figures are microseconds-to-milliseconds on a 500-memory store; none of them is a provider-latency contributor.",
    ],
  };

  mkdirSync(join(process.cwd(), "MISSION-22"), { recursive: true });
  const file = join(process.cwd(), "MISSION-22", "performance-report.json");
  writeFileSync(file, JSON.stringify(output, null, 2));
  console.log(JSON.stringify({ file, results: output.results, tokenOverhead: output.tokenOverhead }, null, 2));
}

main().catch((error) => {
  console.error("[memory-bench] fatal", error);
  process.exitCode = 1;
});
