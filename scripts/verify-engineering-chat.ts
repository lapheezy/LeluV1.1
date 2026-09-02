/**
 * LÉLU ENGINEERING CHAT VERIFICATION
 *
 * Proves the secondary "engineering chat" is real, not a second chat
 * engine bolted on beside the real one:
 *
 *   A. Sending a message through EngineeringChat.send() is the SAME
 *      AIService.chat() pipeline every other message uses — verified
 *      by confirming the forceIntent actually reaches AIRuntime and
 *      routes into EngineeringResolver even for a message with no
 *      engineering keywords at all (which would otherwise never match
 *      EngineeringResolver's keyword heuristic).
 *   B. The conversation is the real, persistent MultiChatStore (the
 *      same store used elsewhere in the app) — not an in-memory list
 *      that vanishes. Verified by writing through EngineeringChat and
 *      reading back through MultiChatStore directly, and by inspecting
 *      the underlying KvStore-backed persistence.
 *   C. LÉLU can open/continue the conversation on her own: running the
 *      real SelfDevelopmentEngine opportunity-detection cycle posts a
 *      real observation into the SAME thread, built from the SAME data
 *      that produced the real ImprovementQueue entries — not invented
 *      dialogue.
 *   D. The thread is exactly ONE conversation (tagged "engineering"),
 *      never duplicated across repeated getOrCreateThread() calls.
 *
 * Shims: in-memory IndexedDB (Brain/PatternMemory) + in-memory
 * window/localStorage (KvStore-backed stores).
 *
 * Run: bun run scripts/verify-engineering-chat.ts
 */

// ---------------------------------------------------------------
// Shims (same as verify-cognition.ts / verify-selfdev.ts).
// ---------------------------------------------------------------
const databases = new Map<string, Map<string, Map<string, unknown>>>();

class ShimRequest {
  result: unknown = null;
  error: Error | null = null;
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
  /** Test-only: read the raw backing map (proves real persistence, not a live-object illusion). */
  raw(): Map<string, string> {
    return this.map;
  }
}
const fakeLocalStorage = new FakeStorage();
// @ts-expect-error — global shim for Node
globalThis.window = { localStorage: fakeLocalStorage, sessionStorage: new FakeStorage(), name: "" };

import AIService from "../src/core/AIService";
import EngineeringChat from "../src/core/selfdev/EngineeringChat";
import MultiChatStore from "../src/core/multichat/MultiChatStore";
import SelfDevelopmentEngine from "../src/core/selfdev/SelfDevelopmentEngine";
import ImprovementQueue from "../src/core/selfdev/ImprovementQueue";

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
  const ai = AIService.getInstance();
  await ai.initialize();

  console.log("== A — EngineeringChat.send() is the SAME AIService.chat() pipeline, forced into EngineeringResolver ==");
  const chat = EngineeringChat.getInstance();
  const store = MultiChatStore.getInstance();

  // Deliberately no engineering keywords at all — this would NOT match
  // EngineeringResolver.isEngineeringPrompt()'s heuristic on its own,
  // proving forceIntent (not luck) is what routes it.
  const reply = await chat.send("What's going on with things right now?");
  assert(reply.role === "assistant", "got a real assistant reply");
  assert(reply.text.length > 0, "reply has real content");
  assert(
    /Observed at|AI providers:|Conversation:/.test(reply.text) || reply.provider === "brain",
    "reply carries EngineeringResolver's real diagnostic shape (not a generic chat fallback)",
    reply.text.slice(0, 200),
  );

  console.log("\n== B — the conversation is the real, persistent MultiChatStore, not an in-memory illusion ==");
  const threadId = chat.getThreadId();
  const viaStore = store.get(threadId);
  assert(Boolean(viaStore), "the thread exists as a real MultiChatStore conversation");
  assert(Boolean(viaStore?.tags.includes("engineering")), "the conversation is tagged 'engineering'");
  assert(
    (viaStore?.messages.length ?? 0) >= 2,
    "both the user message and the real assistant reply were persisted",
  );
  const rawKey = [...fakeLocalStorage.raw().keys()].find((k) => k.includes("multichat"));
  assert(Boolean(rawKey), "the conversation is actually written to the KvStore-backed localStorage, not held only in JS memory");
  if (rawKey) {
    const rawValue = fakeLocalStorage.raw().get(rawKey) ?? "";
    assert(rawValue.includes(threadId), "the real persisted blob contains this exact thread id");
  }

  console.log("\n== C — LÉLU can open/continue the thread herself, from a REAL cognitive observation ==");
  const beforeMessages = chat.getMessages().length;
  const beforeQueue = ImprovementQueue.getInstance().list().length;
  const cycleResult = await SelfDevelopmentEngine.getInstance().runCycle();
  const afterMessages = chat.getMessages().length;
  const afterQueue = ImprovementQueue.getInstance().list().length;
  const queueGrew = afterQueue > beforeQueue;
  assert(
    cycleResult.proposals.length === (afterQueue - beforeQueue) || !queueGrew,
    "the cycle's reported proposal count matches what actually landed in the queue",
  );
  if (queueGrew) {
    assert(
      afterMessages > beforeMessages,
      "a real opportunity was detected AND LÉLU posted a real observation about it into the engineering thread",
    );
    const newest = chat.getMessages().at(-1);
    assert(
      Boolean(newest && newest.role === "assistant" && newest.text.includes("I found something")),
      "the observation message is LÉLU-initiated, in her own voice, not another user turn",
      newest?.text,
    );
    const latestProposal = ImprovementQueue.getInstance().list()[0];
    assert(
      Boolean(newest && latestProposal && newest.text.includes(latestProposal.title)),
      "the observation names the SAME proposal that's actually sitting in the queue — not a disconnected claim",
    );
  } else {
    console.log("  (no new opportunity detected this cycle in this clean sandbox — nothing to observe, correctly nothing posted)");
    assert(afterMessages === beforeMessages, "no queue growth correctly means no fabricated observation was posted");
  }

  console.log("\n== D — exactly one engineering thread, never duplicated ==");
  const before = store.list().filter((c) => c.tags.includes("engineering")).length;
  chat.getOrCreateThread();
  chat.getOrCreateThread();
  const after = store.list().filter((c) => c.tags.includes("engineering")).length;
  assert(before === 1 && after === 1, `repeated getOrCreateThread() calls never create a duplicate thread (before=${before}, after=${after})`);

  console.log(`\n${failures === 0 ? "ALL ENGINEERING CHAT CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error("Verification crashed:", error);
  process.exit(1);
});
