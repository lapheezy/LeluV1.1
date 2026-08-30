/**
 * LÉLU TOOL REGISTRY — REAL DISPATCH VERIFICATION (Priority 6)
 *
 * ToolRegistry was confirmed (turn 2) as a decorative catalog with NO
 * execute path at all — `executionRoute` was a documentation string
 * nobody ever parsed or called. A prior turn made `available` honest
 * (computed from real state); this turn adds an actual execute() for
 * a concrete subset of tools, dispatching through the SAME real
 * implementations their `executionRoute` already names — never a
 * second, competing implementation.
 *
 * Classification for every check below (see the turn's final report
 * for the full REGISTERED/IMPLEMENTED/DISPATCHABLE/EXECUTABLE/
 * VISIBLY-VERIFIED table across all ~30 registered tools):
 *
 *  - cosmos.openInterface, sandbox.read, sandbox.write: EXECUTABLE
 *    and VISIBLY VERIFIED (the UI action is additionally confirmed
 *    live in a real browser — see this turn's report).
 *  - memory.recall: EXECUTABLE, verified here against the real
 *    AIService singleton (dynamic import, no new coupling).
 *  - A tool with NO dispatch entry: still REGISTERED (queryable,
 *    honest `available` flag) but execute() must say so plainly,
 *    never claim success.
 *
 * Run: bun run scripts/verify-tool-execute.ts
 */

// -- localStorage shim (SandboxFS/AutonomyGate → KvStore) --
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
// -- IndexedDB shim (memory.recall → AIService → Brain) --
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
// @ts-expect-error — global shim for Node
globalThis.window = { localStorage: new FakeStorage(), sessionStorage: new FakeStorage(), name: "" };

import ToolRegistry from "../src/core/tools/ToolRegistry";
import UIActionBus from "../src/core/cognition/UIActionBus";
import AIService from "../src/core/AIService";

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
  const registry = ToolRegistry.getInstance();

  console.log("== A registered tool with NO dispatch entry reports so honestly ==");
  const undispatched = await registry.execute("ai.generate", {});
  assert(undispatched.ok === false, "execute() on a tool with no wired dispatch fails");
  assert(
    undispatched.detail.includes("no real dispatch"),
    "the failure explicitly says it has no real dispatch (never a fake success)",
    undispatched.detail,
  );

  console.log("\n== An unknown tool id fails honestly, never throws ==");
  const unknown = await registry.execute("not.a.real.tool", {});
  assert(unknown.ok === false && unknown.detail.includes("No such tool"), "unknown tool id reported plainly");

  console.log("\n== sandbox.write / sandbox.read: real dispatch to the real SandboxFS ==");
  const writeResult = await registry.execute("sandbox.write", { path: "/tool-registry-test.txt", content: "hello from ToolRegistry.execute" });
  assert(writeResult.ok, "sandbox.write executed successfully", writeResult.detail);
  const readResult = await registry.execute("sandbox.read", { path: "/tool-registry-test.txt" });
  assert(readResult.ok, "sandbox.read executed successfully", readResult.detail);
  assert(readResult.output === "hello from ToolRegistry.execute", "the content read back is EXACTLY what was written through the same dispatch — not a fabricated echo", String(readResult.output));

  console.log("\n== cosmos.openInterface: real dispatch through UIActionBus (no UI mounted here) ==");
  const beforeMount = await registry.execute("cosmos.openInterface", { panel: "memory", reason: "test" });
  assert(beforeMount.ok === false, "with no UI mounted, dispatch fails honestly rather than claiming a panel opened", beforeMount.detail);

  let openedPanel: string | null = null;
  const unregister = UIActionBus.getInstance().registerHandlers({
    supportedPanels: ["memory", "chat", "none"],
    openPanel: (panel) => { openedPanel = panel; },
    openModule: () => {},
    minimizeModule: () => {},
    closeModule: () => {},
    getActivePanel: () => "chat",
  });
  const afterMount = await registry.execute("cosmos.openInterface", { panel: "memory", reason: "test" });
  assert(afterMount.ok, "once a UI is registered, the SAME tool call actually dispatches", afterMount.detail);
  assert(openedPanel === "memory", "the real openPanel('memory') handler was actually invoked by ToolRegistry.execute(), not just claimed");
  unregister();

  console.log("\n== memory.recall: real dispatch to the real AIService singleton ==");
  const ai = AIService.getInstance();
  await ai.initialize();
  await ai.chat("My favorite color is teal.");
  const recallResult = await registry.execute("memory.recall", { count: 20 });
  assert(recallResult.ok, "memory.recall executed successfully", recallResult.detail);
  const memories = recallResult.output as Array<{ response: string }>;
  assert(Array.isArray(memories) && memories.some((m) => /teal/i.test(m.response)), "the recalled memories include the fact just stored through real chat()");

  console.log(`\n${failures === 0 ? "ALL TOOL EXECUTE CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error("Verification crashed:", error);
  process.exit(1);
});
