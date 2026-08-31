/**
 * LÉLU ATTENTION BOUNDS — VERIFICATION
 *
 * "Do not send the entire database/history to the model. Build an
 * appropriate cognitive context from relevant state and memory."
 *
 * Two different questions hide behind that, and they had two different
 * answers before this script existed:
 *
 *   A. Is the context INJECTED into the model bounded?
 *      Yes — MemorySynthesizer already caps at 6-14 memories. That half
 *      was fine, and this script pins it so it stays fine.
 *
 *   B. Is RETRIEVAL itself bounded?
 *      No. `PatternMemory.search()` scored, filtered and sorted, then
 *      returned EVERY match with no cap. With a handful of memories
 *      that is invisible; with hundreds about one topic, a single
 *      recall returns hundreds — and `AIService.chat()` then awaited
 *      `user.learn()` once per returned memory, sequentially, on every
 *      single turn.
 *
 * Attention is exactly this: selecting what is RELEVANT rather than
 * everything that matches. This measures both halves against a memory
 * store deliberately loaded with many matching entries.
 *
 * Run: bun run scripts/verify-attention-bounds.ts
 */



// In-memory IndexedDB, same shim the other verify scripts use.
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
    this.rows.set((value as { id: string }).id, structuredClone(value));
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

const { default: PatternMemory } = await import("../src/brain/PatternMemory");
const { default: MemorySynthesizer } = await import("../src/brain/MemorySynthesizer");
type Pattern = import("../src/brain/ResponsePattern").default;

let failures = 0;
function assert(condition: boolean, label: string, detail?: string): void {
  if (condition) {
    console.log(`  ✓ ${label}`);
  } else {
    failures += 1;
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

/** Build a complete ResponsePattern from the few fields a test cares about. */
function pattern(input: {
  id: string;
  prompt: string;
  response: string;
  keywords: string[];
  importance: number;
}): Pattern {
  const now = Date.now();
  return {
    id: input.id,
    category: "general",
    prompt: input.prompt,
    response: input.response,
    intent: "statement",
    keywords: input.keywords,
    context: {},
    memoryType: "user",
    importance: input.importance,
    confidence: 0.9,
    successfulUses: 0,
    failedUses: 0,
    createdAt: now,
    updatedAt: now,
  } as Pattern;
}

/** Deliberately many memories that ALL match one topic. */
const SEEDED = 220;

async function main(): Promise<void> {
  const memory = new PatternMemory();
  await memory.initialize();

  console.log(`== Seeding ${SEEDED} memories that all match the same topic ==`);
  for (let index = 0; index < SEEDED; index += 1) {
    await memory.add(pattern({
      id: `seed-${index}`,
      prompt: `telescope observation ${index}`,
      response: `Observation ${index}: the telescope resolved a nebula filament.`,
      keywords: ["telescope", "observation", "nebula"],
      importance: 0.6,
    }));
  }
  assert(memory.getAll().length >= SEEDED, `the store really holds them (${memory.getAll().length})`);

  console.log("\n== RETRIEVAL is bounded — attention selects, it does not dump ==");
  const recalled = await memory.search("what did the telescope observation show");
  assert(
    recalled.length > 0,
    `the query still finds relevant memories (${recalled.length})`,
  );
  assert(
    recalled.length < SEEDED,
    `retrieval is CAPPED rather than returning all ${SEEDED} matches (got ${recalled.length})`,
    "search() returned every match — unbounded retrieval",
  );
  assert(
    recalled.length <= 50,
    `and the cap is a working-set size, not a database dump (${recalled.length} ≤ 50)`,
  );

  console.log("\n== The cap keeps the MOST RELEVANT, not an arbitrary slice ==");
  {
    // One memory made unmistakably stronger than the 220 filler entries.
    await memory.add(pattern({
      id: "seed-strongest",
      prompt: "the most important telescope fact",
      response: "The telescope's primary mirror is 2.4 metres across.",
      keywords: ["telescope", "mirror", "primary"],
      importance: 1,
    }));
    const ranked = await memory.search("telescope primary mirror");
    assert(
      ranked.some((entry) => entry.response.includes("2.4 metres")),
      "the strongest match survives the cap",
      ranked.slice(0, 3).map((entry) => entry.response.slice(0, 40)).join(" | "),
    );
    assert(
      ranked[0]?.response.includes("2.4 metres"),
      "and ranks first — the cap is applied AFTER scoring, not before",
      ranked[0]?.response.slice(0, 60),
    );
  }

  console.log("\n== INJECTED context stays small regardless of store size ==");
  {
    const synthesizer = new MemorySynthesizer();
    const synthesized = synthesizer.synthesize({
      prompt: "what did the telescope observation show",
      memories: await memory.search("what did the telescope observation show"),
    });
    assert(
      synthesized.used.length <= 14,
      `the model receives a bounded working set (${synthesized.used.length} ≤ 14)`,
    );
    assert(
      synthesized.used.length > 0,
      "but not an empty one — relevance still reaches the model",
    );
  }

  console.log(`\n${failures === 0 ? "ALL ATTENTION BOUND CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error("Verification crashed:", error);
  process.exit(1);
});
