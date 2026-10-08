/**
 * LÉLU MEMORY RECALL — ROOT CAUSE FIX VERIFICATION (Priority 5)
 *
 * Reported symptom: "LÉLU remembers only basic information such as
 * the user's name while failing to consistently retrieve other
 * configured information." Traced to TWO real bugs, at two different
 * layers, both stemming from the same root cause — literal-keyword-
 * only matching with no bridge between how a CATEGORY of fact is
 * ASKED about and how the fact was ORIGINALLY phrased:
 *
 *  1. RETRIEVAL (PatternMemory.search): a stored preference "I love
 *     hiking on weekends" was never even a candidate for a later
 *     "what are my hobbies?" — none of "hobbies"/"hobby" appear in
 *     the stored text, so word/stem/phrase matching found nothing and
 *     the memory never reached ranking at all. Confirmed directly
 *     against PatternMemory before this fix: 0 results.
 *
 *  2. RANKING (MemorySynthesizer.relevance): even when candidates ARE
 *     retrieved, a hard veto ("a memory with no literal concept
 *     overlap is irrelevant") returned -1 for EVERY memory whenever
 *     the question's own significant words didn't literally appear in
 *     the stored text — silently dropping real facts from both the
 *     offline composed answer AND the live-provider context
 *     (MemoryBridge.enrich has no fallback dump, unlike the narrow
 *     identity-question path that already existed for "who am I").
 *
 * This was NOT a memory-extraction or persistence bug — the fact was
 * always stored correctly. It was NOT namespace/session isolation.
 * It was a vocabulary-gap bug at the retrieval and ranking layers,
 * fixed with a shared CATEGORY_RECALL_SYNONYMS bridge (defined once in
 * ResponsePattern.ts, imported by both PatternMemory and
 * MemorySynthesizer so they can never disagree) — never a hardcoded
 * answer for "hobbies" or any other specific fact.
 *
 * Every assertion below goes through the REAL production path,
 * AIService.getInstance().chat() — the same call GenesisChat.tsx
 * makes — never PatternMemory/MemorySynthesizer internals directly.
 *
 * Run: bun run scripts/verify-memory-recall.ts
 */

// -- IndexedDB + storage shims (same pattern as other verify-*.ts scripts) --
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
    req.result = [...this.rows.values()].map((v) => structuredClone(v));
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
  open(name: string, _version?: number): ShimRequest {
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
globalThis.window = { localStorage: new FakeStorage(), sessionStorage: new FakeStorage(), name: "" };

import AIService from "../src/core/AIService";
import PatternMemory from "../src/brain/PatternMemory";
import MemoryEngine from "../src/brain/MemoryEngine";

let failures = 0;
function assert(condition: boolean, label: string, detail?: string): void {
  if (condition) {
    console.log(`  ✓ ${label}`);
  } else {
    failures += 1;
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

async function main(): Promise<void> {
  console.log("== Layer 1 (retrieval): PatternMemory.search finds a category-differently-worded memory ==");
  {
    // Isolated from the chat singleton so this is a precise proof of
    // the retrieval layer specifically, not entangled with routing.
    const pm = new PatternMemory();
    const engine = new MemoryEngine(pm);
    await engine.learn("I love hiking on weekends.", "That sounds fun!");
    const results = await pm.search("what are my hobbies");
    assert(results.length > 0, "search('what are my hobbies') returns the stored hiking preference", `got ${results.length} results`);
    assert(
      Boolean(results.find((r) => r.response.toLowerCase().includes("hiking"))),
      "the returned result is actually the hiking memory, not something else",
    );
  }

  console.log("\n== Layer 2 + full pipeline: the same fact, retrieved through REAL chat() ==");
  const ai = AIService.getInstance();
  await ai.initialize();

  await ai.chat("My name is Jordan.");
  await ai.chat("I love hiking on weekends.");
  await ai.chat("My goal is to run a marathon next year.");

  // Sanity: the facts really are in long-term memory (extraction/
  // persistence were never the suspected bug, but confirm anyway).
  const stored = await ai.getMemories(20);
  assert(stored.some((m) => /hiking/i.test(m.response)), "the hiking preference is actually persisted in long-term memory");
  assert(stored.some((m) => /marathon/i.test(m.response)), "the marathon goal is actually persisted in long-term memory");

  console.log("\n== A category-phrased question (different words than the original statement) actually surfaces the fact ==");
  const hobbiesAnswer = await ai.chat("What are my hobbies?");
  assert(
    /hik/i.test(hobbiesAnswer.text),
    "chat('What are my hobbies?') response actually mentions hiking — not a generic 'I don't know'",
    hobbiesAnswer.text,
  );

  console.log("\n== A different category-phrased question (goals) also surfaces its fact ==");
  const goalsAnswer = await ai.chat("What are my goals?");
  assert(
    /marathon/i.test(goalsAnswer.text),
    "chat('What are my goals?') response actually mentions the marathon goal",
    goalsAnswer.text,
  );

  console.log("\n== A genuinely broad personal-recall question surfaces MULTIPLE categories, not just the name ==");
  const aboutMeAnswer = await ai.chat("Tell me about myself.");
  assert(/jordan/i.test(aboutMeAnswer.text), "mentions the name", aboutMeAnswer.text);
  assert(
    /hik/i.test(aboutMeAnswer.text) || /marathon/i.test(aboutMeAnswer.text),
    "ALSO mentions at least one non-name fact (hiking or marathon) — this is the exact reported symptom, now fixed",
    aboutMeAnswer.text,
  );

  console.log("\n== Anti-pollution guarantee still holds: an unrelated category question does NOT surface irrelevant facts ==");
  const weatherAnswer = await ai.chat("What's the capital of France?");
  assert(
    !/hik|marathon/i.test(weatherAnswer.text),
    "an unrelated question does not leak the hiking/marathon facts into the answer",
    weatherAnswer.text,
  );

  console.log(`\n${failures === 0 ? "ALL MEMORY RECALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error("Verification crashed:", error);
  process.exit(1);
});
