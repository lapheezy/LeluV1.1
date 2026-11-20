/**
 * ==========================================================
 * LÉLU 2.2.7 — CLOUD DELETION AND RESURRECTION PROTECTION
 *
 * M22.6 could prove a deletion locally and block the id from
 * coming back on the device that held the ledger. It could not
 * stop the same record returning through the cloud mirror:
 * the row was deleted with no evidence, so any client that had
 * not seen the deletion could upload it again.
 *
 * These tests cover the application half of the fix (the
 * database half is the M22.7 migration, exercised against real
 * Postgres in MISSION-22.7/probe/sql-verify.mjs):
 *
 *   - erasure goes through the tombstoning RPC, not a bare DELETE;
 *   - a deployment without the RPC still deletes, and says the
 *     weaker thing it can actually claim;
 *   - an unconfirmed deletion is queued durably, retried a bounded
 *     number of times, and never silently dropped;
 *   - server tombstones are adopted BEFORE hydration merges, so a
 *     fresh browser refuses the deleted record;
 *   - an upload never carries a deleted id;
 *   - the read-only OG archive cannot inject a deleted quote.
 *
 * No network: the Supabase client is a fake at the seam the real
 * code calls. Live acceptance needs the real project and is
 * reported separately.
 * ==========================================================
 */

import assert from "node:assert/strict";
import test from "node:test";

/* ------------------------- browser shims (Node) ------------------------- */
if (typeof globalThis.window === "undefined") {
  (globalThis as Record<string, unknown>).window = globalThis;
}
/**
 * KvStore writes to localStorage first and READS THROUGH BOTH backends, so a
 * stale queue parked in sessionStorage survives clearing localStorage — which
 * is exactly what happened: Node 26 ships its own sessionStorage, so the
 * "define it only if missing" shim left the real one in place and a previous
 * test's unconfirmed deletion was still readable. Both are replaced here.
 */
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
const localShim = memoryStorage();
const sessionShim = memoryStorage();
for (const [name, shim] of [["localStorage", localShim], ["sessionStorage", sessionShim]] as const) {
  Object.defineProperty(globalThis, name, { value: shim, configurable: true, writable: true });
}

const USER = "11111111-1111-1111-1111-111111111111";

const { default: DeletionLedger, MAX_REMOTE_ATTEMPTS, DELETION_OUTBOX_KEY, DELETION_LEDGER_KEY } =
  await import("../src/core/memory/DeletionLedger");
const { default: SupabasePersistence } = await import("../src/core/persistence/SupabasePersistence");
const { default: KvStore } = await import("../src/core/storage/KvStore");
void KvStore;

const ledger = DeletionLedger.getInstance();

/** Keys as they are actually persisted (KvStore prefixes them). */
const storedRaw = (key: string): string =>
  String(globalThis.localStorage.getItem(`lelu.${key}`) ?? "");

const resetStorage = (): void => {
  localShim.clear();
  sessionShim.clear();
};

/* ------------------------------ fake client ------------------------------ */

interface FakeOptions {
  /** Per-table rows returned by select(). */
  rows?: Record<string, Array<Record<string, unknown>>>;
  /** Result of the RPC. */
  rpc?: (fn: string, args: Record<string, unknown>) => { data?: unknown; error?: { message: string; code?: string } | null };
  /** Whether the plain delete() succeeds. */
  deleteError?: string | null;
}

function fakeClient(options: FakeOptions = {}) {
  const calls: Array<{ kind: string; table?: string; fn?: string; args?: unknown; rows?: unknown }> = [];
  const client = {
    calls,
    rpc(fn: string, args: Record<string, unknown>) {
      calls.push({ kind: "rpc", fn, args });
      const result = options.rpc ? options.rpc(fn, args) : { data: 1, error: null };
      return Promise.resolve({ data: result.data ?? null, error: result.error ?? null });
    },
    from(table: string) {
      const rows = options.rows?.[table] ?? [];
      const api: Record<string, unknown> = {
        select: () => api,
        order: () => api,
        eq: () => api,
        range: (from: number, to: number) =>
          Promise.resolve({ data: rows.slice(from, to + 1), error: null, count: rows.length }),
        delete: () => {
          calls.push({ kind: "delete", table });
          return {
            eq: () => ({
              eq: () => Promise.resolve({ error: options.deleteError ? { message: options.deleteError } : null }),
              then: (resolve: (value: unknown) => unknown) =>
                Promise.resolve({ error: options.deleteError ? { message: options.deleteError } : null }).then(resolve),
            }),
          };
        },
        upsert: (payload: unknown) => {
          calls.push({ kind: "upsert", table, rows: payload });
          return Promise.resolve({ error: null });
        },
        insert: (payload: unknown) => {
          calls.push({ kind: "insert", table, rows: payload });
          return Promise.resolve({ error: null });
        },
      };
      return api;
    },
    auth: {
      getSession: async () => ({ data: { session: null } }),
      onAuthStateChange: () => ({ unsubscribe: () => undefined }),
    },
  };
  return client;
}

/** Point the singleton at a fake signed-in session. */
function connect(client: ReturnType<typeof fakeClient>): SupabasePersistence {
  const instance = SupabasePersistence.getInstance();
  const internal = instance as unknown as Record<string, unknown>;
  internal.client = client;
  internal.userId = USER;
  internal.status = "connected";
  internal.hydrated = false;
  return instance;
}

const disconnect = (): void => {
  const internal = SupabasePersistence.getInstance() as unknown as Record<string, unknown>;
  internal.client = null;
  internal.userId = null;
  internal.status = "signed_out";
  internal.hydrated = false;
};

/* ----------------------------------- A ----------------------------------- */

test("A: erasure goes through the tombstoning RPC", async () => {
  resetStorage();
  const client = fakeClient({ rpc: () => ({ data: 3, error: null }) });
  const supa = connect(client);

  const result = await supa.forgetMemory("mem-1", "fp-abc");

  assert.deepEqual(result, { ok: true, removed: 3, tombstoned: true, reason: null });
  const call = client.calls.find((entry) => entry.kind === "rpc");
  assert.equal(call?.fn, "erase_memory");
  assert.deepEqual(call?.args, { p_id: "mem-1", p_fingerprint: "fp-abc" });
  assert.equal(
    client.calls.some((entry) => entry.kind === "delete"),
    false,
    "a bare DELETE leaves no server-side evidence; it must not be the primary path",
  );
});

/* ----------------------------------- B ----------------------------------- */

test("B: a deployment without the function deletes, and says so", async () => {
  resetStorage();
  const client = fakeClient({
    rpc: () => ({ error: { message: "Could not find the function public.erase_memory", code: "PGRST202" } }),
  });
  const supa = connect(client);

  const result = await supa.forgetMemory("mem-2", "fp");

  assert.equal(result.ok, true, "the row is still removed");
  assert.equal(result.tombstoned, false, "but the stronger claim is refused");
  assert.equal(result.reason, "no_tombstone_function");
  assert.equal(client.calls.some((entry) => entry.kind === "delete"), true);
});

/* ----------------------------------- C ----------------------------------- */

test("C: an unconfirmed deletion is queued and retried, not dropped", async () => {
  resetStorage();
  connect(fakeClient({
    rpc: () => ({ error: { message: "Failed to fetch", code: "NETWORK" } }),
  }));

  const failed = await SupabasePersistence.getInstance().forgetMemory("mem-3", "fp-3");
  assert.equal(failed.ok, false);
  ledger.queueRemote("mem-3", "fp-3");

  assert.equal(ledger.remoteQueue().length, 1);
  assert.equal(ledger.remoteSummary().pending, 1);
  // Persisted, not just in memory: a reload must still know to retry.
  assert.match(storedRaw(DELETION_OUTBOX_KEY), /mem-3/);

  // The network comes back.
  connect(fakeClient({ rpc: () => ({ data: 1, error: null }) }));
  const flushed = await SupabasePersistence.getInstance().flushDeletionOutbox();

  assert.equal(flushed.cleared, 1);
  assert.equal(flushed.remaining, 0);
  assert.equal(ledger.remoteQueue().length, 0);
});

/* ----------------------------------- D ----------------------------------- */

test("D: retries are bounded, and an exhausted entry stays visible", async () => {
  resetStorage();
  connect(fakeClient({ rpc: () => ({ error: { message: "denied", code: "42501" } }) }));
  ledger.queueRemote("mem-4", "fp");

  for (let attempt = 0; attempt < MAX_REMOTE_ATTEMPTS; attempt += 1) {
    await SupabasePersistence.getInstance().flushDeletionOutbox();
  }
  const queue = ledger.remoteQueue();
  assert.equal(queue.length, 1, "it is not silently forgotten");
  assert.equal(queue[0].attempts, MAX_REMOTE_ATTEMPTS);
  assert.equal(ledger.remoteSummary().exhausted, 1);

  const extra = await SupabasePersistence.getInstance().flushDeletionOutbox();
  assert.equal(extra.attempted, 0, "no ninth attempt: retries cannot loop forever");
  assert.equal(extra.remaining, 1);
});

/* ----------------------------------- E ----------------------------------- */

test("E: queueing the same id twice keeps one entry", async () => {
  resetStorage();
  ledger.queueRemote("mem-5", "fp-a");
  ledger.queueRemote("mem-5", "");
  ledger.queueRemote("mem-5", "fp-b");

  const queue = ledger.remoteQueue();
  assert.equal(queue.length, 1);
  assert.equal(queue[0].fingerprint, "fp-b", "a later fingerprint replaces an empty one");
});

/* ----------------------------------- F ----------------------------------- */

test("F: server tombstones are adopted before hydration merges", async () => {
  resetStorage();
  const merged: string[] = [];
  const client = fakeClient({
    rows: {
      memory_items: [
        { id: "live-1", response: "a memory that was never deleted", category: "fact" },
        { id: "gone-1", response: "the deleted statement", category: "fact" },
      ],
      memory_tombstones: [{ memory_id: "gone-1" }],
    },
  });
  const supa = connect(client);

  const brain = {
    mergeMemories: async (patterns: Array<{ id: string }>) => {
      merged.push(...patterns.map((pattern) => pattern.id));
    },
  };
  await supa.hydrateRuntime(brain as never);

  assert.deepEqual(merged, ["live-1"], "the deleted id is not merged back in");
  assert.equal(ledger.has("gone-1"), true, "and the reason is recorded locally");
  assert.equal(supa.hasServerTombstones(), true);
  // A fresh browser adopts ids only — there is no text in the tombstone to leak.
  const tombstone = ledger.entries().find((entry) => entry.id === "gone-1");
  assert.deepEqual(tombstone?.windows, []);
});

/* ----------------------------------- G ----------------------------------- */

test("G: a deleted id is withheld from an upload", async () => {
  resetStorage();
  ledger.record({ id: "gone-2", text: "the deleted statement must never be uploaded again", conversationId: null });
  const client = fakeClient();
  const supa = connect(client);

  await supa.persistMemories([
    { id: "gone-2", category: "fact", prompt: "x", response: "the deleted statement", keywords: [], createdAt: Date.now(), updatedAt: Date.now() },
    { id: "live-2", category: "fact", prompt: "y", response: "still wanted", keywords: [], createdAt: Date.now(), updatedAt: Date.now() },
  ] as never);

  const upsert = client.calls.find((entry) => entry.kind === "upsert");
  const rows = upsert?.rows as Array<{ id: string }>;
  assert.deepEqual(rows.map((row) => row.id), ["live-2"]);
  assert.equal(storedRaw(DELETION_LEDGER_KEY).includes("deleted statement"), false, "no text in the ledger");
});

/* ----------------------------------- H ----------------------------------- */

test("H: the read-only archive cannot inject a deleted quote", async () => {
  resetStorage();
  const statement = "the vault code phrase is amber lantern nineteen";
  ledger.record({ id: "gone-3", text: statement, conversationId: null });

  const { OgArchiveProvider } = await import("../src/core/memory/providers");
  const rows = [
    { id: "a", key: "archive", value: statement, created_at: new Date().toISOString() },
    { id: "b", key: "unrelated", value: "the launch is on tuesday", created_at: new Date().toISOString() },
  ];
  const client = {
    from: () => ({
      select: () => ({
        order: () => ({
          limit: () => Promise.resolve({ data: rows, error: null }),
        }),
        or: () => ({
          order: () => ({
            limit: () => Promise.resolve({ data: rows, error: null }),
          }),
        }),
      }),
    }),
    auth: {
      getSession: async () => ({ data: { session: { user: { id: USER } } } }),
      onAuthStateChange: () => undefined,
    },
  };
  const provider = new OgArchiveProvider(() => client as never);
  const items = await provider.context("vault launch tuesday", 10);

  const content = items.map((item) => item.content).join("\n");
  assert.equal(content.includes("amber lantern"), false, "the archived quote is filtered at the source");
  assert.equal(content.includes("tuesday"), true, "unrelated archive content still reaches context");
});

/* ----------------------------------- I ----------------------------------- */

test("I: adopting a remote tombstone twice is idempotent", async () => {
  resetStorage();
  const first = ledger.adoptRemote(["remote-1", "remote-2"]);
  const second = ledger.adoptRemote(["remote-2", "remote-3"]);

  assert.equal(first, 2);
  assert.equal(second, 1);
  assert.equal(ledger.entries().filter((entry) => entry.id === "remote-2").length, 1);
  assert.equal(ledger.has("remote-3"), true);
});

/* ----------------------------------- J ----------------------------------- */

test("J: the outbox holds no deleted text, only ids and hashes", async () => {
  resetStorage();
  const statement = "the safeword is crimson badger forty two";
  const tombstone = ledger.record({ id: "gone-4", text: statement, conversationId: null });
  const fingerprint = ledger.fingerprintFor("gone-4");
  ledger.queueRemote("gone-4", fingerprint);
  ledger.noteRemoteAttempt("gone-4", "NETWORK");

  const outbox = storedRaw(DELETION_OUTBOX_KEY);
  const tombstones = storedRaw(DELETION_LEDGER_KEY);
  assert.equal(outbox.includes("crimson"), false);
  assert.equal(tombstones.includes("crimson"), false);
  assert.equal(outbox.includes("gone-4"), true);
  assert.ok(tombstone, "the tombstone exists, so the deletion is provable");
});

/* ----------------------------------- K ----------------------------------- */

test("K: signed out is not queued — there is no user to act for", async () => {
  resetStorage();
  disconnect();
  const result = await SupabasePersistence.getInstance().forgetMemory("mem-6", "fp");
  assert.equal(result.ok, false);
  assert.equal(result.reason, "signed_out");
  assert.equal(ledger.remoteQueue().length, 0);
});

/* ----------------------------------- L ----------------------------------- */

test("L: derived writes are scrubbed before they leave the device", async () => {
  resetStorage();
  const statement = "the recovery phrase is violet heron fifty nine";
  ledger.record({ id: "gone-5", text: statement, conversationId: null });

  const client = fakeClient();
  const supa = connect(client);

  await supa.persistKnowledge([
    {
      id: "k-1",
      title: "note",
      domain: "general",
      detail: `Learned this: ${statement}. Also: the launch is on tuesday.`,
      source: "session",
      status: "active",
      updatedAt: Date.now(),
    },
  ] as never);

  await (supa as unknown as {
    persistCognitiveEvent: (event: Record<string, unknown>) => Promise<void>;
  }).persistCognitiveEvent({
    type: "TASK",
    taskId: "t-1",
    summary: `the user told me ${statement}`,
    detail: "unrelated progress",
  });

  const knowledge = client.calls.find((entry) => entry.kind === "upsert" && entry.table === "knowledge_items");
  const knowledgeRows = knowledge?.rows as Array<{ detail: string }>;
  assert.equal(knowledgeRows[0].detail.includes("violet heron"), false, "the derived knowledge copy is scrubbed");
  assert.equal(knowledgeRows[0].detail.includes("tuesday"), true, "unrelated content survives");

  const event = client.calls.find((entry) => entry.kind === "insert" && entry.table === "cognitive_events");
  const eventRows = event?.rows as Array<{ payload: Record<string, string> }>;
  assert.equal(String(eventRows[0].payload.summary).includes("violet heron"), false, "the event payload is scrubbed");
  assert.equal(String(eventRows[0].payload.detail), "unrelated progress", "operational fields are untouched");
});
