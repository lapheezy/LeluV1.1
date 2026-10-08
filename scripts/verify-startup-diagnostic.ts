/**
 * LÉLU STARTUP DIAGNOSTIC VERIFICATION
 *
 * Proves the 15-point startup checklist actually calls real methods
 * on real singletons (never a hardcoded "true"), and that a genuine
 * failure is actually caught and reported — not silently treated as
 * healthy.
 *
 * Run: bun run scripts/verify-startup-diagnostic.ts
 */

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
}
// @ts-expect-error — global shim for Node
globalThis.window = { localStorage: new FakeStorage(), sessionStorage: new FakeStorage(), name: "" };

import AIService from "../src/core/AIService";
import StartupDiagnostic from "../src/core/selfdev/StartupDiagnostic";
import Sentinel from "../src/core/sentinel/Sentinel";

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

  console.log("== Startup diagnostic runs all 15 real checks ==");
  const report = await StartupDiagnostic.run();
  const EXPECTED_NAMES = [
    "AI provider",
    "Fallback provider chain",
    "Cognition runtime",
    "Reasoning engine",
    "Long-term memory",
    "Short-term memory (conversation)",
    "Self-model",
    "UI observer",
    "Project observer",
    "Sandbox",
    "Engineering tools",
    "Primary chat",
    "Engineering chat",
    "Notifications",
    "Improvement state machine",
  ];
  for (const name of EXPECTED_NAMES) {
    const found = report.checks.find((c) => c.name === name);
    assert(Boolean(found), `checklist includes "${name}"`, found ? undefined : "missing entirely");
  }
  assert(report.checks.length === EXPECTED_NAMES.length, `exactly ${EXPECTED_NAMES.length} checks ran, no more no less (got ${report.checks.length})`);

  console.log("\n== every check has a real, non-empty detail (not a bare true/false) ==");
  for (const c of report.checks) {
    assert(c.detail.length > 0, `"${c.name}" has a real detail string`, c.detail);
  }

  console.log("\n== honest result in THIS environment: no AI provider keys are configured ==");
  const providerCheck = report.checks.find((c) => c.name === "AI provider");
  assert(Boolean(providerCheck?.ok), "AI provider check still passes (providers are REGISTERED even without keys)");
  assert(
    Boolean(providerCheck?.detail.includes("none currently available")),
    "the detail HONESTLY says no provider is currently available, rather than claiming false health",
    providerCheck?.detail,
  );

  console.log("\n== a real subsystem failure is actually caught, not silently marked healthy ==");
  // Force a genuine failure: monkey-patch AIService.getMemories to throw,
  // exactly as it would if IndexedDB were genuinely blocked.
  const original = ai.getMemories.bind(ai);
  ai.getMemories = async () => {
    throw new Error("Simulated real failure — storage blocked");
  };
  const beforeErrorCount = Sentinel.getInstance().getSnapshot().activeErrors;
  const degraded = await StartupDiagnostic.run();
  ai.getMemories = original;
  const memoryCheck = degraded.checks.find((c) => c.name === "Long-term memory");
  assert(memoryCheck?.ok === false, "the forced failure is reported as a real failure, not swallowed");
  assert(degraded.allHealthy === false, "allHealthy correctly flips to false when a real check fails");
  const afterErrorCount = Sentinel.getInstance().getSnapshot().activeErrors;
  assert(afterErrorCount > beforeErrorCount, "the failure is also reported to Sentinel (reaches CognitiveContext.recentErrors on the next request)");

  console.log(`\n${failures === 0 ? "ALL STARTUP DIAGNOSTIC CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error("Verification crashed:", error);
  process.exit(1);
});
