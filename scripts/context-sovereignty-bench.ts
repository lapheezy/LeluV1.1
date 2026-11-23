/**
 * LÉLU 2.2.2 — CONTEXT ASSEMBLY PERFORMANCE
 *
 * M22.1 baseline: authorization 0.0094 ms/record, project decision
 * 0.0001 ms, 500-node cognitive filter 0.046 ms, clean enrich 1.20 ms
 * mean / 1.54 p95. This measures what universal authorization added.
 *
 * Run: npx tsx scripts/context-sovereignty-bench.ts
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

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
  constructor(db: ShimDatabase, name: string) {
    this.stores = new Map([[name, new ShimObjectStore(db.store(name))]]);
    queueMicrotask(() => this.oncomplete?.());
  }
  objectStore(name: string): ShimObjectStore {
    return this.stores.get(name)!;
  }
}
class ShimDatabase {
  onversionchange: (() => void) | null = null;
  constructor(private readonly name: string) {}
  store(name: string): Map<string, unknown> {
    const db = databases.get(this.name)!;
    if (!db.has(name)) db.set(name, new Map());
    return db.get(name)!;
  }
  get objectStoreNames() {
    return { contains: (name: string) => databases.get(this.name)!.has(name) };
  }
  createObjectStore(name: string): void {
    databases.get(this.name)!.set(name, new Map());
  }
  transaction(name: string): ShimTransaction {
    return new ShimTransaction(this, name);
  }
  close(): void {}
}
// @ts-expect-error — node shim
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
    return this.map.get(key) ?? null;
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
// @ts-expect-error — node shim
globalThis.window = { localStorage: new FakeStorage(), sessionStorage: new FakeStorage(), name: "", location: { origin: "http://localhost:3000" } };

function stats(samples: number[]) {
  const sorted = [...samples].sort((a, b) => a - b);
  const at = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
  return {
    runs: sorted.length,
    meanMs: Number((sorted.reduce((a, b) => a + b, 0) / sorted.length).toFixed(4)),
    p95Ms: Number(at(0.95).toFixed(4)),
  };
}

async function main(): Promise<void> {
  mkdirSync(join(process.cwd(), "MISSION-22.2"), { recursive: true });

  const { authorizeContextSections } = await import("../src/core/cognition/ContextAuthorization");
  const WorkspaceManager = (await import("../src/core/cognition/WorkspaceManager")).default;
  const { buildCognitiveContext } = await import("../src/core/cognition/CognitiveContext");
  const CognitiveCore = (await import("../src/core/cognition/CognitiveCore")).default;
  const AIService = (await import("../src/core/AIService")).default;
  const MemoryBridge = (await import("../src/core/MemoryBridge")).default;
  const MultiChatStore = (await import("../src/core/multichat/MultiChatStore")).default;
  const { currentSessionId } = await import("../src/core/memory/MemorySovereignty");

  const session = currentSessionId();
  const access = { userId: "bench-user", conversationId: "bench-chat", sessionId: session };

  /* ---------------------- section authorization ---------------------- */
  const sections = Array.from({ length: 8 }, (_, index) => ({
    id: `s-${index}`,
    kind: index % 3 === 0 ? ("memory" as const) : ("project" as const),
    text: `section ${index} text`,
    labelled: index % 2 === 0,
    provenance: {
      userId: "bench-user",
      conversationId: index % 2 === 0 ? "bench-chat" : "other-chat",
      sessionId: session,
      scope: "persistent-user",
    },
  }));
  const authSamples: number[] = [];
  for (let i = 0; i < 2_000; i += 1) {
    const started = performance.now();
    authorizeContextSections(sections, access);
    authSamples.push(performance.now() - started);
  }

  /* ---------------------- workspace observations ---------------------- */
  const workspaces = new WorkspaceManager();
  workspaces.create("core", "Lélu Core");
  for (let i = 0; i < 300; i += 1) {
    workspaces.add("core", `observation ${i} in ${i % 4 === 0 ? "bench-chat" : "other-chat"}`, {
      conversationId: i % 4 === 0 ? "bench-chat" : "other-chat",
      scope: "conversation-local",
      sourceType: "lelu-observed",
    });
  }
  const workspaceSamples: number[] = [];
  for (let i = 0; i < 2_000; i += 1) {
    const started = performance.now();
    workspaces.itemsFor("core", access);
    workspaceSamples.push(performance.now() - started);
  }

  /* ---------------------- snapshot assembly ---------------------- */
  const core = new CognitiveCore();
  for (let i = 0; i < 500; i += 1) core.observe(`node ${i}`, `chat-${i % 5}`);
  const coreSamples: number[] = [];
  for (let i = 0; i < 200; i += 1) {
    const started = performance.now();
    core.state("chat-1");
    coreSamples.push(performance.now() - started);
  }

  const snapshotSamples: number[] = [];
  for (let i = 0; i < 30; i += 1) {
    const started = performance.now();
    buildCognitiveContext(access);
    if (i >= 3) snapshotSamples.push(performance.now() - started);
  }
  const anonymousSamples: number[] = [];
  for (let i = 0; i < 10; i += 1) {
    const started = performance.now();
    buildCognitiveContext();
    anonymousSamples.push(performance.now() - started);
  }

  /* ---------------------- enrich end-to-end ---------------------- */
  const ai = AIService.getInstance();
  await ai.initialize();
  const brain = (ai as any).runtime.brain;
  const chats = MultiChatStore.getInstance();
  const chatA = chats.createBackground("bench A");
  const chatB = chats.createBackground("bench B");
  await brain.learn("My studio is called Aurelia and its metal is rose gold.", "Noted.", "conversation", [], {
    originSeed: { userId: "bench-user", conversationId: chatA.id, sessionId: session, sourceType: "user-said", scope: "persistent-user" },
  });
  const bridge = new MemoryBridge(brain, { get: () => ({ id: "bench-user" }), context: () => "" } as any);
  const enrichSamples: number[] = [];
  let contextChars = 0;
  for (let i = 0; i < 18; i += 1) {
    const started = performance.now();
    const enriched = await bridge.enrich({ prompt: "What is my studio metal?", messages: [], timestamp: Date.now(), conversationId: chatB.id } as any);
    if (i >= 3) enrichSamples.push(performance.now() - started);
    contextChars = String(enriched.request.context ?? "").length;
  }

  const report = {
    mission: "LÉLU 2.2.2 — performance",
    executedAt: new Date().toISOString(),
    method: "in-process, Node 22, performance.now(); no provider time",
    baselineM221: {
      authorizationPerRecordMs: 0.0094,
      projectDecisionMs: 0.0001,
      cognitiveFilter500NodesMs: 0.046,
      cleanEnrichMeanMs: 1.20,
      cleanEnrichP95Ms: 1.54,
    },
    measured: {
      sectionAuthorization8Sections: stats(authSamples),
      workspaceItems300Observations: stats(workspaceSamples),
      cognitiveState500Nodes: stats(coreSamples),
      snapshotScoped: stats(snapshotSamples),
      snapshotAnonymous: stats(anonymousSamples),
      enrichWithHistorical: { ...stats(enrichSamples), contextChars },
    },
    thresholds: {
      sectionAuthorizationMs: { limit: 0.2, pass: stats(authSamples).meanMs <= 0.2 },
      workspaceItemsMs: { limit: 0.2, pass: stats(workspaceSamples).meanMs <= 0.2 },
      snapshotMs: { limit: 5, pass: stats(snapshotSamples).meanMs <= 5 },
      enrichP95Ms: { limit: 5, pass: stats(enrichSamples).p95Ms <= 5 },
    },
  } as any;
  report.pass = Object.values(report.thresholds).every((threshold: any) => threshold.pass);
  writeFileSync(join(process.cwd(), "MISSION-22.2", "performance-report.json"), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report.measured, null, 2));
  console.log("thresholds:", JSON.stringify(report.thresholds));
  console.log("pass:", report.pass);
  for (const chat of [chatA, chatB]) chats.remove(chat.id);
}

main().catch((error) => {
  console.error("[context-bench] failed:", error);
  process.exitCode = 1;
});
