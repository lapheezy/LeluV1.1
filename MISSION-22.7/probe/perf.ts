/**
 * M22.7 — what the new work costs.
 *
 * Everything measured here runs in-process against the real modules with a fake
 * Supabase client, so it measures OUR overhead (ledger work, filtering,
 * scrubbing, bookkeeping) and explicitly NOT network latency, which only the
 * real project can show.
 *
 * Run:
 *   npx tsx --tsconfig tsconfig.test.json --import ./tests/support/ignore-css.mjs \
 *     MISSION-22.7/probe/perf.ts > MISSION-22.7/evidence/perf.json
 */

if (typeof (globalThis as Record<string, unknown>).window === "undefined") {
  (globalThis as Record<string, unknown>).window = globalThis;
}
function memoryStorage() {
  const store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = value; },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { for (const key of Object.keys(store)) delete store[key]; },
    get length() { return Object.keys(store).length; },
    key: (index: number) => Object.keys(store)[index] ?? null,
  };
}
const local = memoryStorage();
const session = memoryStorage();
for (const [name, shim] of [["localStorage", local], ["sessionStorage", session]] as const) {
  Object.defineProperty(globalThis, name, { value: shim, configurable: true, writable: true });
}

const { default: DeletionLedger } = await import("../../src/core/memory/DeletionLedger");
const { default: DeletionGuard } = await import("../../src/core/memory/DeletionGuard");
const { default: SupabasePersistence } = await import("../../src/core/persistence/SupabasePersistence");

const ledger = DeletionLedger.getInstance();
const guard = DeletionGuard.getInstance();

/** Median of `runs` timings, in milliseconds. */
function time(label: string, runs: number, fn: () => unknown): number {
  for (let i = 0; i < 3; i += 1) fn(); // warm-up
  const samples: number[] = [];
  for (let i = 0; i < runs; i += 1) {
    const start = performance.now();
    fn();
    samples.push(performance.now() - start);
  }
  samples.sort((a, b) => a - b);
  const median = samples[Math.floor(samples.length / 2)];
  console.log(`  ${label}: ${median.toFixed(3)} ms (median of ${runs})`);
  return Number(median.toFixed(3));
}

const results: Record<string, number> = {};

/* ---------------------------------------------------------------- ledger */

console.log("\n=== deletion ledger ===");
results.adoptRemote_1000ids_ms = time("adoptRemote(1000 ids)", 20, () => {
  local.clear();
  session.clear();
  ledger.adoptRemote(Array.from({ length: 1000 }, (_, index) => `remote-${index}`));
});

results.record_1000_tombstones_ms = time("record 1000 tombstones (bulk wipe)", 5, () => {
  local.clear();
  session.clear();
  ledger.recordMany(
    Array.from({ length: 1000 }, (_, index) => ({
      id: `bulk-${index}`,
      text: `this is deleted statement number ${index} with enough tokens to fingerprint`,
      conversationId: "c-1",
    })),
  );
});

results.fingerprintFor_ms = time("fingerprintFor() lookup", 2000, () => ledger.fingerprintFor("bulk-500"));

/* ---------------------------------------------------------------- outbox */

console.log("\n=== deletion outbox ===");
local.clear();
session.clear();
results.queueRemote_200_ms = time("queueRemote x200", 10, () => {
  local.clear();
  session.clear();
  for (let index = 0; index < 200; index += 1) ledger.queueRemote(`q-${index}`, `fp-${index}`);
});

// 200 unique ids at the cap: queueing a 201st must not grow the queue.
for (let index = 0; index < 200; index += 1) ledger.queueRemote(`q-${index}`, `fp-${index}`);
ledger.queueRemote("q-overflow", "fp");
results.outbox_cap = ledger.remoteQueue().length;

/* ---------------------------------------------------------------- guard */

console.log("\n=== deletion guard ===");
const statement = "the vault code phrase is BLUE-HARBOUR-77 and it must stay forgotten";
guard.scrub("");
ledger.record({ id: "perf-1", text: statement, conversationId: null });

const assembly = [
  "## PROJECT CHECKPOINTS",
  "late residue probe: the vault code phrase is BLUE-HARBOUR-77 and it must stay forgotten",
  "unrelated pending step: publish the release notes",
  "another checkpoint with no deleted content at all, just project state",
].join("\n");

results.guard_scrub_4line_ms = time("scrub a 4-line assembly", 1000, () => guard.scrub(assembly));

const bigContext = Array.from({ length: 200 }, (_, index) =>
  `line ${index}: a perfectly ordinary context line with several words in it`,
).join("\n");
results.guard_scrub_200line_ms = time("scrub a 200-line context", 100, () => guard.scrub(bigContext));

const payload = {
  type: "TASK",
  taskId: "t-1",
  steps: Array.from({ length: 20 }, (_, index) => ({ id: `s-${index}`, summary: `step ${index} of the plan` })),
  meta: { note: statement, nested: { deeper: { deepest: [statement, "keep me"] } } },
};
results.guard_scrubDeep_payload_ms = time("scrubDeep a 20-step payload", 200, () => guard.scrubDeep(payload));

resultCleanCheck();
function resultCleanCheck(): void {
  const scrubbed = guard.scrubDeep(payload);
  results.scrubDeep_quoteStillPresent = JSON.stringify(scrubbed).includes("BLUE-HARBOUR") ? 1 : 0;
}

/* ------------------------------------------------------- hydration filter */

console.log("\n=== hydration ===");
const rows = Array.from({ length: 5000 }, (_, index) => ({
  id: `mem-${index}`,
  category: "fact",
  prompt: `prompt ${index}`,
  response: `response ${index}`,
  keywords: [],
  createdAt: Date.now(),
  updatedAt: Date.now(),
}));
const deleted = new Set(Array.from({ length: 50 }, (_, index) => `mem-${index * 7}`));

results.hydration_filter_5000rows_ms = time("filter 5,000 rows against 50 tombstones", 50, () => {
  rows.filter((row) => !deleted.has(row.id)).map((row) => ({ ...row }));
});

/* ------------------------------------------------------- remote erasure */

console.log("\n=== remote erase bookkeeping ===");
function fakeClient(handler: () => { data?: unknown; error?: { message: string; code?: string } | null }) {
  return {
    rpc: () => Promise.resolve({ data: null, ...handler() }),
    from: () => ({
      select: () => ({ order: () => ({ range: () => Promise.resolve({ data: [], error: null, count: 0 }) }) }),
      upsert: () => Promise.resolve({ error: null }),
      insert: () => Promise.resolve({ error: null }),
      delete: () => ({ eq: () => ({ eq: () => Promise.resolve({ error: null }) }) }),
    }),
    auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => undefined },
  };
}

const instance = SupabasePersistence.getInstance() as unknown as Record<string, unknown>;
local.clear();
session.clear();
for (let index = 0; index < 50; index += 1) ledger.queueRemote(`flush-${index}`, "fp");

const flushFail = async () => {
  instance.client = fakeClient(() => ({ error: { message: "offline", code: "NETWORK" } }));
  instance.userId = "11111111-1111-1111-1111-111111111111";
  instance.status = "connected";
  await SupabasePersistence.getInstance().flushDeletionOutbox();
};
instance.userId = "11111111-1111-1111-1111-111111111111";
instance.status = "connected";
const flushStart = performance.now();
await flushFail();
results.flush_50_failing_entries_ms = Number((performance.now() - flushStart).toFixed(3));
console.log(`  flush 50 failing entries: ${results.flush_50_failing_entries_ms} ms`);

instance.client = fakeClient(() => ({ data: 1, error: null }));
const okStart = performance.now();
const flushed = await SupabasePersistence.getInstance().flushDeletionOutbox();
results.flush_50_clearing_entries_ms = Number((performance.now() - okStart).toFixed(3));
console.log(`  flush 50 clearing entries: ${results.flush_50_clearing_entries_ms} ms (cleared ${flushed.cleared})`);

console.log("\n=== summary ===");
console.log(JSON.stringify({
  kind: "in-process measurement, fake Supabase client (no network)",
  at: new Date().toISOString(),
  results,
}, null, 2));
