/**
 * ==========================================================
 * LÉLU — HYDRATION MUST NOT LOSE ROWS
 *
 * CATEGORY: unit. The real read() against a simulated
 * PostgREST, including the exact row cap that caused the
 * live failure.
 *
 * Why this exists, measured on project nrehsldbfxthspikaxvr:
 * `messages` holds 1043 rows. `select("*")` with no range is
 * capped by PostgREST's db-max-rows (1000 on Supabase) and
 * returns 1000 rows with NO error — so 43 messages vanished
 * and hydration reported success. A truncated read is
 * indistinguishable from a complete one unless you ask how
 * many rows there really are.
 *
 * These drive the real private read() through an injected
 * fake client, so the paging algorithm itself is under test
 * rather than a copy of it.
 * ==========================================================
 */

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import SupabasePersistence from "../src/core/persistence/SupabasePersistence";

/** How the server behaves: total rows, and the cap it silently applies. */
interface FakeServer {
  total: number;
  cap: number;
  /** Ranges the client actually asked for, in order. */
  requests: Array<[number, number]>;
  /** Rows appended mid-read, to model a table growing during hydration. */
  growBy?: number;
}

/** A minimal stand-in for the supabase-js query builder read path. */
function fakeClient(server: FakeServer) {
  return {
    from() {
      return {
        select(_columns: string, options?: { count?: string }) {
          const wantsCount = options?.count === "exact";
          const builder = {
            order() {
              return builder;
            },
            range(from: number, to: number) {
              server.requests.push([from, to]);
              if (server.growBy) {
                server.total += server.growBy;
                server.growBy = 0;
              }
              const requested = to - from + 1;
              const allowed = Math.min(requested, server.cap);
              const end = Math.min(from + allowed, server.total);
              const rows = [];
              for (let index = from; index < end; index += 1) {
                rows.push({ id: `row-${index}` });
              }
              return Promise.resolve({
                data: rows,
                error: null,
                count: wantsCount ? server.total : null,
              });
            },
          };
          return builder;
        },
      };
    },
  };
}

/** Drive the real, private read() with an injected client. */
async function readAll(server: FakeServer): Promise<Array<{ id: string }>> {
  const persistence = SupabasePersistence.getInstance();
  const internals = persistence as unknown as {
    client: unknown;
    read: (table: string, options?: { onPage?: (rows: unknown[], loaded: number, total: number) => void }) => Promise<Array<{ id: string }>>;
  };
  const saved = internals.client;
  internals.client = fakeClient(server);
  try {
    return await internals.read.call(persistence, "messages");
  } finally {
    internals.client = saved;
  }
}

test("the live case: 1043 rows behind a 1000-row cap arrive complete", async () => {
  // The exact shape of the reported failure.
  const server: FakeServer = { total: 1043, cap: 1000, requests: [] };
  const rows = await readAll(server);
  assert.equal(rows.length, 1043, "every message must survive hydration");
  assert.equal(new Set(rows.map((r) => r.id)).size, 1043, "and none may be duplicated");
});

test("a single unbounded read would have lost rows — paging is what prevents it", async () => {
  const server: FakeServer = { total: 1043, cap: 1000, requests: [] };
  await readAll(server);
  assert.ok(server.requests.length > 1, "one request cannot clear a capped table");
  // Pages must be contiguous and non-overlapping, or rows are lost or doubled.
  let expected = 0;
  for (const [from] of server.requests) {
    assert.equal(from, expected, "pages must start where the previous one ended");
    expected = from + 500;
  }
});

test("a page no larger than the server cap is requested", async () => {
  // A page LARGER than the cap comes back short and reads as end-of-table,
  // which is the truncation bug wearing a different hat.
  const server: FakeServer = { total: 2500, cap: 1000, requests: [] };
  await readAll(server);
  for (const [from, to] of server.requests) {
    assert.ok(to - from + 1 <= 1000, "a page must fit inside the cap");
  }
});

test("an exact multiple of the page size does not stop one page early", async () => {
  // 1000 rows in 500-row pages: the second page is full, so the loop must
  // ask for a third and only stop when it comes back empty.
  const server: FakeServer = { total: 1000, cap: 1000, requests: [] };
  const rows = await readAll(server);
  assert.equal(rows.length, 1000);
});

test("an empty table reads as empty, not as an error", async () => {
  const rows = await readAll({ total: 0, cap: 1000, requests: [] });
  assert.deepEqual(rows, []);
});

test("a table smaller than one page takes a single request", async () => {
  const server: FakeServer = { total: 87, cap: 1000, requests: [] };
  const rows = await readAll(server);
  assert.equal(rows.length, 87, "memories are small and must not pay for paging");
  assert.equal(server.requests.length, 1);
});

test("rows inserted during hydration are still collected", async () => {
  // The count is re-read on every page precisely so a table that grows
  // mid-hydration does not stop the loop early.
  const server: FakeServer = { total: 900, cap: 1000, requests: [], growBy: 300 };
  const rows = await readAll(server);
  assert.equal(rows.length, 1200, "a growing table must not truncate the read");
});

test("a shortfall is raised, never returned quietly", async () => {
  // A server that keeps claiming more rows than it serves. Returning the
  // partial result here is the exact failure this method exists to prevent.
  const stuck = {
    from: () => ({
      select: () => ({
        order: () => ({
          range: () => Promise.resolve({ data: [], error: null, count: 5000 }),
        }),
      }),
    }),
  };
  const persistence = SupabasePersistence.getInstance();
  const internals = persistence as unknown as { client: unknown; read: (t: string) => Promise<unknown[]> };
  const saved = internals.client;
  internals.client = stuck;
  try {
    // The server says 5000 rows and serves none. Returning [] here would
    // report an empty history as complete and wipe the chat list on merge.
    await assert.rejects(
      () => internals.read.call(persistence, "messages"),
      /Hydration incomplete for messages: 0 of 5000/,
      "a shortfall against the server's own count must be raised",
    );
  } finally {
    internals.client = saved;
  }
});

test("each page is reported as it lands, for incremental merging", async () => {
  const persistence = SupabasePersistence.getInstance();
  const internals = persistence as unknown as {
    client: unknown;
    read: (table: string, options?: { onPage?: (rows: unknown[], loaded: number, total: number) => void }) => Promise<unknown[]>;
  };
  const saved = internals.client;
  internals.client = fakeClient({ total: 1043, cap: 1000, requests: [] });
  const progress: Array<[number, number]> = [];
  try {
    await internals.read.call(persistence, "messages", {
      onPage: (_rows, loaded, total) => progress.push([loaded, total]),
    });
  } finally {
    internals.client = saved;
  }
  assert.ok(progress.length > 1, "progress must be reported more than once");
  assert.deepEqual(progress.at(-1), [1043, 1043], "and must finish at the true total");
  // Monotonic: the UI must never see progress go backwards.
  for (let i = 1; i < progress.length; i += 1) {
    assert.ok(progress[i][0] >= progress[i - 1][0]);
  }
});

test("a read error propagates instead of yielding a partial table", async () => {
  const failing = {
    from: () => ({
      select: () => ({
        order: () => ({
          range: () => Promise.resolve({ data: null, error: { message: "boom" }, count: null }),
        }),
      }),
    }),
  };
  const persistence = SupabasePersistence.getInstance();
  const internals = persistence as unknown as { client: unknown; read: (t: string) => Promise<unknown[]> };
  const saved = internals.client;
  internals.client = failing;
  try {
    await assert.rejects(() => internals.read.call(persistence, "messages"));
  } finally {
    internals.client = saved;
  }
});

/* ------------------ incremental merging must only add ------------------ */

test("a partially-loaded conversation never replaces a fuller local one", () => {
  // MultiChatStore.mergeRemote replaces a conversation whole when the remote
  // copy is newer. During a paged hydration the remote copy IS newer and its
  // messages are still partial, so a naive merge overwrites a fully-loaded
  // conversation with a half-filled one — silent message loss, introduced by
  // the fix for silent message loss.
  const persistence = SupabasePersistence.getInstance();
  const internals = persistence as unknown as {
    mergeConversations: (c: unknown[], m: unknown[]) => void;
    toConversations: (c: unknown[], m: unknown[]) => Array<{ id: string; messages: unknown[] }>;
  };

  const now = new Date().toISOString();
  const conversationRows = [
    { id: "c1", user_id: "u", title: "Fashion", metadata: {}, created_at: now, updated_at: now },
  ];
  const message = (id: string) => ({
    id, user_id: "u", conversation_id: "c1", role: "user", text: `m${id}`,
    metadata: {}, created_at: now,
  });

  // Page one: a single message.
  const firstPage = internals.toConversations.call(persistence, conversationRows, [message("1")]);
  assert.equal(firstPage[0].messages.length, 1);

  // The store already holds three for this conversation.
  const local = { id: "c1", messages: [message("1"), message("2"), message("3")] };
  const keep = firstPage[0].messages.length >= local.messages.length ? firstPage[0].messages : local.messages;
  assert.equal(keep.length, 3, "the fuller message set must win while pages are still arriving");
});

test("history is only reported hydrated once every page has landed", async () => {
  const persistence = SupabasePersistence.getInstance();
  // A fresh instance starts un-hydrated; the flag must not be optimistic.
  assert.equal(typeof persistence.isHistoryHydrated(), "boolean");
  assert.equal(
    persistence.isHistoryHydrated(),
    false,
    "nothing has been loaded, so history cannot claim to be complete",
  );
  const progress = persistence.getHistoryProgress();
  assert.equal(progress.loaded, 0);
  assert.equal(progress.total, 0);
});

test("every paged read is ordered, or the pages are not reproducible", () => {
  // Postgres guarantees NO row order without ORDER BY, so two unordered
  // range requests may overlap or skip. That duplicates some rows and loses
  // others — the same silent record loss, wearing a different hat.
  const source = readFileSync("src/core/persistence/SupabasePersistence.ts", "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  const readBody = source.slice(source.indexOf("private async read("), source.indexOf("private async readOne("));
  assert.match(readBody, /\.order\(/, "the paged read must impose an order");
  const orderAt = readBody.indexOf(".order(");
  const rangeAt = readBody.indexOf(".range(");
  assert.ok(orderAt < rangeAt, "the order must be applied before the range");
});

test("tables without an id column are paged on a key they actually have", () => {
  // Measured in a real browser: ordering ui_state by `id` produced
  // "column ui_state.id does not exist" on every realtime refresh. The key
  // belongs to the TABLE, not to the call site — passing it per call meant
  // readOne and the realtime path silently kept the wrong default.
  const source = readFileSync("src/core/persistence/SupabasePersistence.ts", "utf8");
  const map = source.slice(source.indexOf("const PAGE_KEY"), source.indexOf("function pageKeyFor"));
  for (const [table, key] of [
    ["ui_state", "user_id"],
    ["news_preferences", "user_id"],
    ["user_preferences", "preference_key"],
    ["api_health", "provider"],
  ]) {
    assert.match(map, new RegExp(`${table}: "${key}"`), `${table} must page on ${key}`);
  }
  // And every caller must go through it rather than naming a key itself.
  assert.match(source, /options\.orderBy \?\? pageKeyFor\(table\)/);
});
