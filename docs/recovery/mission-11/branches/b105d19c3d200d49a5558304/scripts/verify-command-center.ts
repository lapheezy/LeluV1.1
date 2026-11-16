/**
 * ==========================================================
 * LÉLU — MISSION 8 LIVE DEMONSTRATION
 *
 * One additional capability acquired THROUGH CHAT, using the same
 * production entry point a user's message takes:
 *
 *   AIService.getInstance().chat(objective)
 *     → AcquisitionResolver.prepare()  (real research + council)
 *   AIService.getInstance().chat("approve cmd-…")
 *     → AcquisitionResolver approve  (real pipeline + approval)
 *     → selftest evidence → register → USE memory.cache
 *
 * The runtime must be running:
 *   npm run dev
 *   npx tsx scripts/verify-command-center.ts
 *
 * Every claim below is asserted against real state (registry,
 * marketplace, store, run events). A failure exits non-zero.
 * ==========================================================
 */

const RUNTIME_URL = process.env.LELU_RUNTIME_URL ?? "http://127.0.0.1:5173";
process.env.VITE_LELU_ENGINEER_URL = RUNTIME_URL;
process.env.__LELU_ENGINEER_URL__ = RUNTIME_URL;

if (typeof globalThis.window === "undefined") {
  (globalThis as Record<string, unknown>).window = globalThis;
}
if (typeof localStorage === "undefined") {
  const store: Record<string, string> = {};
  (globalThis as Record<string, unknown>).localStorage = {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      for (const key of Object.keys(store)) delete store[key];
    },
    get length() {
      return Object.keys(store).length;
    },
    key: (index: number) => Object.keys(store)[index] ?? null,
  };
}

// The brain uses IndexedDB; the acquisition path does not, but AIService's
// initialize() mounts it, so give Node the minimal surface it opens.
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

let failures = 0;
function assert(condition: boolean, label: string, detail?: string): void {
  if (condition) {
    console.log(`  ✓ ${label}`);
  } else {
    failures += 1;
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

const OBJECTIVE =
  "Find an open-source memory system that improves your long-term recall: sindresorhus/quick-lru. " +
  "Research it, acquire it, adapt it to your existing memory architecture, test it and integrate it.";

async function main(): Promise<void> {
  const { default: AIService } = await import("../src/core/AIService");
  const { default: AutonomyGate } = await import("../src/core/cognition/AutonomyGate");
  const { default: EngineeringCommandCenter } = await import("../src/core/acquisition/EngineeringCommandCenter");
  const { default: CapabilityActivation } = await import("../src/core/acquisition/CapabilityActivation");
  const { default: CapabilityMarketplace } = await import("../src/core/acquisition/CapabilityMarketplace");
  const { default: CapabilityManifest } = await import("../src/core/capabilities/CapabilityManifest");
  const { default: CapabilityRegistry } = await import("../src/core/selfdev/CapabilityRegistry");
  const { default: ToolRegistry } = await import("../src/core/tools/ToolRegistry");

  AutonomyGate.getInstance().setLevel(5);
  CapabilityActivation.getInstance().reset();

  const ai = AIService.getInstance();
  await ai.initialize();

  console.log("== Turn 1 — a real chat message, no repository narration ==");
  const first = await ai.chat(OBJECTIVE);
  console.log(first.text);
  const center = EngineeringCommandCenter.getInstance();
  const pending = center.getPending();
  assert(/researched sindresorhus\/quick-lru/i.test(first.text), "chat reports the repository it actually researched");
  assert(first.text.includes("Prepared as cmd-"), "chat prepared a real acquisition id");
  assert(/Nothing has been cloned/i.test(first.text), "the prepare turn does not claim any acquisition happened");
  assert(pending !== null, "the command center holds the prepared proposal");
  if (!pending) {
    console.error("no pending proposal; cannot continue");
    process.exit(1);
  }
  console.log(`\n[prepared] ${pending.id} · ${pending.proposal.candidate.identifier} · licence ${pending.proposal.findings.license.spdx}`);

  console.log("\n== Turn 2 — the explicit approval through chat ==");
  const second = await ai.chat(`approve ${pending.id}`);
  console.log(second.text);

  // The capability id is derived from the capability the chat asked for
  // ("memory system…"), so it is read from the marketplace rather than
  // hard-coded — the assertion follows the real registration.
  const entry = CapabilityMarketplace.getInstance()
    .inventory("quick-lru")
    .find((item) => item.source.identifier === "sindresorhus/quick-lru");
  const capabilityId = entry?.id ?? "";
  const record = capabilityId ? CapabilityRegistry.getInstance().get(capabilityId) : undefined;
  const manifest = capabilityId ? CapabilityManifest.getInstance().get(capabilityId) : undefined;

  assert(/Approved and integrated sindresorhus\/quick-lru/i.test(second.text), "chat reports the real integration");
  assert(entry !== undefined, "the capability appears in the marketplace inventory");
  assert(record !== undefined, `the capability ${capabilityId} is in CapabilityRegistry`);
  assert(manifest?.status === "available", "the capability is available in CapabilityManifest");
  assert(entry?.tools.includes("memory.cache") === true, "marketplace reports its real tool");
  assert(/self-test/i.test(second.text) && /passed/i.test(second.text), "the USE stage ran the capability's self-test");

  const run = center.snapshot().runs[0];
  assert(run?.complete === true, "the pipeline run completed", run?.failure ?? "no run");
  assert(run?.events.every((event) => event.ok) === true, "every pipeline stage reports success");

  console.log("\n== The capability is usable, not merely listed ==");
  const executed = await ToolRegistry.getInstance().execute("memory.cache", {
    action: "put",
    key: "mission-8-demo",
    value: "acquired quick-lru cache is live",
  });
  assert(executed.ok, "memory.cache put executes through the real dispatcher", executed.detail);
  const read = await ToolRegistry.getInstance().execute("memory.cache", { action: "get", key: "mission-8-demo" });
  assert(/live/.test(read.detail), "memory.cache get returns the stored value", read.detail);

  console.log("\n== Deactivation reaches the tool gate (not UI-only) ==");
  const marketplace = CapabilityMarketplace.getInstance();
  const deactivated = marketplace.deactivate(capabilityId);
  assert(deactivated.ok, "the marketplace deactivated it");
  const afterDeactivate = await ToolRegistry.getInstance().execute("memory.cache", { action: "stats" });
  assert(!afterDeactivate.ok, "the tool is refused once deactivated", afterDeactivate.detail);
  marketplace.activate(capabilityId);
  const afterActivate = await ToolRegistry.getInstance().execute("memory.cache", { action: "stats" });
  assert(afterActivate.ok, "reactivation restores the real tool");

  console.log(`\n${failures === 0 ? "[PASS] The acquisition was completed through chat and the capability is live." : `${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

void main().catch((error: unknown) => {
  console.error(`[FAIL] ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
  process.exit(1);
});
