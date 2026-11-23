/**
 * M22.4 — what deletion costs.
 *
 * Measures the real authoritative path (Brain.learn → Brain.forgetMemory)
 * and the context assembly deletion has to keep clean
 * (buildCognitiveContext + formatCognitiveContext). No mocks: the same
 * modules the browser runs, with the same in-memory browser shims the
 * mission tests use, because Node has neither localStorage nor IndexedDB.
 *
 * Run: npx tsx --tsconfig tsconfig.test.json --import ./tests/support/ignore-css.mjs MISSION-22.4/perf-deletion.ts
 */

/* ------------------------- browser shims (Node) ------------------------- */
const databases = new Map<string, Map<string, Map<string, unknown>>>();
class ShimRequest {
  result: unknown = null;
  onsuccess: (() => void) | null = null;
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
  addEventListener: () => {},
  removeEventListener: () => {},
  dispatchEvent: () => true,
};
// @ts-expect-error — global shim for Node
globalThis.localStorage = globalThis.window.localStorage;
// @ts-expect-error — global shim for Node
globalThis.sessionStorage = globalThis.window.sessionStorage;

const { default: Brain } = await import("../src/brain/Brain");
const { buildCognitiveContext, formatCognitiveContext } = await import("../src/core/cognition/CognitiveContext");

const iterations = 20;
const scope = { userId: "perf-user", conversationId: "perf-chat", sessionId: "perf-session" } as never;
const times: number[] = [];
const contextTimes: number[] = [];

const brain = new Brain();
for (let i = 0; i < iterations; i += 1) {
  const learned = await brain.learn(
    `Perf memory ${i}: my access phrase is PERF-${i}.`,
    "Noted.",
    "conversation",
    [],
    {
      source: "lelu-chat",
      originSeed: { userId: "perf-user", conversationId: "perf-chat", sessionId: "perf-session", sourceType: "user-said" },
    } as never,
  );
  if (!learned) continue;
  const start = performance.now();
  await brain.forgetMemory(learned.id);
  times.push(performance.now() - start);
}

for (let i = 0; i < 10; i += 1) {
  const start = performance.now();
  formatCognitiveContext(buildCognitiveContext(scope));
  contextTimes.push(performance.now() - start);
}

const median = (list: number[]) => list.slice().sort((a, b) => a - b)[Math.floor(list.length / 2)] ?? 0;
const mean = (list: number[]) => (list.length ? list.reduce((sum, value) => sum + value, 0) / list.length : 0);
const round = (value: number) => Math.round(value * 100) / 100;

console.log(JSON.stringify({
  mission: "LÉLU 22.4 — deletion propagation and context-construction overhead",
  iterations,
  environment: "Node + tsx, the real Brain/CognitiveContext modules, in-memory IndexedDB + localStorage shims",
  delete_ms: { mean: round(mean(times)), median: round(median(times)), max: round(Math.max(...times)), samples: times.map(round) },
  context_build_ms: { mean: round(mean(contextTimes)), median: round(median(contextTimes)), max: round(Math.max(...contextTimes)) },
}, null, 2));
