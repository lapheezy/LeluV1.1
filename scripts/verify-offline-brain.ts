/**
 * End-to-end offline LÉLU verification.
 *
 * Exercises the REAL Brain → PatternMemory → IndexedDBStore →
 * MemoryEngine → OfflineComposer path in Node, with a minimal
 * in-memory IndexedDB shim standing in for the browser store.
 * The shim keeps its data in a module-level Map, so creating a
 * NEW Brain afterwards simulates an application restart.
 *
 * Run: bun run scripts/verify-offline-brain.ts
 */

// ---------------------------------------------------------------
// Minimal in-memory IndexedDB shim (subset used by the app).
// ---------------------------------------------------------------
const databases = new Map<string, Map<string, Map<string, unknown>>>();

class ShimRequest {
  result: unknown = null;
  error: Error | null = null;
  onsuccess: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onupgradeneeded: (() => void) | null = null;
  /** Fire the app-attached handler on a microtask (browser behavior). */
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
    if (!db.has(storeName)) {
      db.set(storeName, new Map());
    }
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
  close(): void {
    /* no-op */
  }
}

// @ts-expect-error — global shim for Node
globalThis.indexedDB = {
  open(name: string, _version?: number): ShimRequest {
    if (!databases.has(name)) {
      databases.set(name, new Map());
    }
    const req = new ShimRequest();
    const db = new ShimDatabase(name);
    req.result = db;
    // Browser fires onupgradeneeded (once) then onsuccess — both after
    // the app attaches its handlers.
    queueMicrotask(() => {
      if (!db.objectStoreNames.contains("memories")) {
        req.onupgradeneeded?.();
      }
      req.onsuccess?.();
    });
    return req;
  },
};

// ---------------------------------------------------------------
// Now the REAL app code.
// ---------------------------------------------------------------
import Brain from "../src/brain/Brain";
import AIService from "../src/core/AIService";

let failures = 0;

function assert(condition: boolean, label: string): void {
  if (condition) {
    console.log(`  ✓ ${label}`);
  } else {
    failures += 1;
    console.error(`  ✗ ${label}`);
  }
}

async function run(): Promise<void> {
  console.log("== SESSION 1 (providers effectively offline) ==");

  const ai = AIService.getInstance();
  await ai.initialize();

  // No API keys configured anywhere in this sandbox, so every
  // provider reports unavailable → the runtime must land in
  // offline mode while memory still works.
  const providers = ai.getProviders();
  assert(providers.ai.length === 8, `8 AI providers registered (${providers.ai.map((p) => p.name).join(", ")})`);
  const health = await ai.getProviderHealth();
  assert(health.every((h) => h.health.available === false), "no provider available without keys (honest status)");

  console.log("\n-- TEST: Who are you? (offline identity) --");
  const who = await ai.chat("Who are you?");
  assert(who.text.startsWith("My name is Lélu"), `answers from persistent identity ("${who.text.slice(0, 40)}…")`);
  assert(who.provider === "brain", "resolved by the existing brain/memory path, not a fake success");
  console.log(`    → ${who.text.split("\n")[0]}`);

  console.log("\n-- TEST: give a meaningful new fact offline --");
  const learn1 = await ai.chat("My name is Alex and I am building a space exploration app");
  assert(learn1.text.length > 0, "offline response received (no white screen)");
  const memories1 = await ai.getMemories();
  assert(
    memories1.some((m) => m.category === "identity" && m.prompt.includes("My name is Alex")),
    "identity memory persisted locally",
  );
  assert(
    memories1.some((m) => m.category === "project"),
    "project memory persisted locally",
  );

  console.log("\n-- TEST: Who am I? (offline profile retrieval) --");
  const whoAmI = await ai.chat("Who am I?");
  assert(/Alex/.test(whoAmI.text), `recalls the user identity ("${whoAmI.text.slice(0, 60)}…")`);
  assert(whoAmI.provider === "brain", "answered from local memory");

  console.log("\n-- TEST: unknown question offline degrades gracefully --");
  // Note: knowledge/fact queries now route to the LIVE knowledge
  // providers even when no AI provider is configured, so the
  // "graceful offline" case is exercised with a non-research prompt.
  const unknown = await ai.chat("Tell me a story about a dragon");
  assert(unknown.provider === "offline", "falls to offline mode after provider exhaustion");
  assert(unknown.text.length > 0, "offline notice is real text, not an error");

  // Second meaningful fact (Tests: memory keeps building).
  await ai.chat("I love retro space games");
  const memories2 = await ai.getMemories();
  assert(
    memories2.some((m) => m.category === "preference"),
    "preference memory persisted while offline",
  );

  console.log("\n== SIMULATED RESTART (new Brain, same store) ==");
  const restarted = AIService.getInstance();
  // Force re-init against the same in-memory store.
  await restarted.shutdown();
  await restarted.initialize();

  const who2 = await restarted.chat("Who are you?");
  assert(who2.text.startsWith("My name is Lélu"), "identity survives restart");
  const whoAmI2 = await restarted.chat("Who am I?");
  assert(/Alex/.test(whoAmI2.text), "user identity survives restart");
  const memories3 = await restarted.getMemories();
  assert(
    memories3.some((m) => m.category === "project" && m.prompt.includes("My name is Alex")),
    "project memory survives restart",
  );
  assert(
    memories3.some((m) => m.category === "preference"),
    "preference memory survives restart",
  );

  console.log("\n" + (failures === 0 ? "ALL OFFLINE BRAIN CHECKS PASSED" : `${failures} CHECK(S) FAILED`));
  process.exit(failures === 0 ? 0 : 1);
}

run().catch((error) => {
  console.error("Verification crashed:", error);
  process.exit(1);
});
