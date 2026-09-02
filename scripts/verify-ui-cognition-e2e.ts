/**
 * LÉLU UI WORLD MODEL — END-TO-END COGNITIVE INTEGRATION
 *
 * Proves the CRITICAL ADDITION's live loop through the SAME production
 * entry point real chat uses — AIService.getInstance().chat(message) —
 * not by calling SurfaceResolver or UIActionBus directly. If this
 * script passes, a real chat message typed into the real LÉLU UI takes
 * this exact path:
 *
 *   user message → AIRuntime → SurfaceResolver.execute()
 *     → SURFACE_TARGETS match → UIActionBus.dispatch("open_panel")
 *     → the REAL GenesisInterface handler (simulated here the same way
 *       GenesisInterface registers it on mount) → UIStateStore updated
 *     → response text describing the REAL result, not a blind "Done"
 *
 * SurfaceResolver already existed as LÉLU's real user-driven navigation
 * system (chat commands like "open the browser"/"show me your memory")
 * — this proves it now goes through UIActionBus's validation/result/
 * world-model layer instead of firing a CustomEvent and unconditionally
 * claiming success.
 *
 * Run: bun run scripts/verify-ui-cognition-e2e.ts
 */

// -- IndexedDB + storage shims (same pattern as verify-startup-diagnostic.ts) --
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
import UIActionBus from "../src/core/cognition/UIActionBus";
import UIStateStore from "../src/core/cognition/UIStateStore";

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

  console.log("== A real chat message, before any UI is mounted, is answered honestly ==");
  const beforeMount = await ai.chat("show me the memory architecture");
  assert(
    /couldn't|could not|no lélu interface/i.test(beforeMount.text),
    "with no mounted UI, chat reports it could NOT open the panel — never a fake 'I opened it'",
    beforeMount.text,
  );

  console.log("\n== Simulate GenesisInterface mounting (its real registration call) ==");
  const calls: Array<{ fn: string; arg: string }> = [];
  let fakeActivePanel: string | null = "chat";
  UIActionBus.getInstance().registerHandlers({
    supportedPanels: ["memory", "engineering", "reasoning", "cognition", "diagnostics", "chat", "none"],
    openPanel: (panel) => {
      calls.push({ fn: "openPanel", arg: panel });
      fakeActivePanel = panel === "none" ? null : panel;
    },
    openModule: (id) => calls.push({ fn: "openModule", arg: id }),
    minimizeModule: (id) => calls.push({ fn: "minimizeModule", arg: id }),
    closeModule: (id) => calls.push({ fn: "closeModule", arg: id }),
    getActivePanel: () => fakeActivePanel,
  });

  console.log("\n== The SAME chat message, through the SAME production path, now actually navigates ==");
  const afterMount = await ai.chat("show me the memory architecture");
  assert(/memory/i.test(afterMount.text), "response references the memory panel", afterMount.text);
  assert(
    calls.some((c) => c.fn === "openPanel" && c.arg === "memory"),
    "the real openPanel('memory') handler was actually invoked by a chat() call, not a direct test call",
  );
  assert(fakeActivePanel === "memory", "the (simulated real) UI's active panel actually changed");

  const uiSnapshot = UIStateStore.getInstance().get();
  assert(
    uiSnapshot.lastAction?.type === "open_panel" && uiSnapshot.lastAction.ok === true,
    "UIStateStore world model reflects the successful action from the chat path",
    JSON.stringify(uiSnapshot.lastAction),
  );

  console.log("\n== A follow-up message ('go back') reverses LÉLU's own navigation ==");
  const back = await ai.chat("go back");
  assert(/back|previous/i.test(back.text), "response confirms the return", back.text);
  assert(fakeActivePanel === "chat", "the UI was actually returned to the panel active before LÉLU navigated");

  console.log("\n== An ordinary question about memory is NOT hijacked into a UI action ==");
  const ordinary = await ai.chat("how does your memory system work?");
  assert(
    !/opened the "memory" panel/i.test(ordinary.text),
    "a plain question is answered in text, not treated as a navigation command",
    ordinary.text,
  );

  console.log(`\n${failures === 0 ? "ALL UI COGNITION E2E CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error("Verification crashed:", error);
  process.exit(1);
});
