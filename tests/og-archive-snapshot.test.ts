/**
 * The OG archive is a frozen snapshot: fetched once per user session and
 * filtered locally with the server query's exact semantics.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { OgArchiveProvider, archiveTerms, filterArchive, type ArchiveRow } from "../src/core/memory/providers";

const ROWS: ArchiveRow[] = [
  { id: 1, key: "pet", value: "Her axolotl is called Mochi", created_at: "2026-01-01T00:00:00Z" },
  { id: 2, key: "city", value: "Lives near Canberra", created_at: "2026-03-01T00:00:00Z" },
  { id: 3, key: "Favourite FOOD", value: "ramen", created_at: "2026-02-01T00:00:00Z" },
];

function fakeClient(rows: ArchiveRow[], user = "u1") {
  const calls: string[] = [];
  let authCb: (() => void) | null = null;
  let currentUser = user;
  const builder = () => {
    const q: any = { _or: null as string | null, _limit: 0 };
    q.select = () => q;
    q.or = (f: string) => ((q._or = f), q);
    q.order = () => q;
    q.limit = async (n: number) => {
      calls.push(q._or ? `query:${q._or}` : `snapshot:${n}`);
      return { data: rows.slice(0, n), error: null };
    };
    return q;
  };
  return {
    calls,
    switchUser(next: string) { currentUser = next; authCb?.(); },
    client: {
      from: () => builder(),
      auth: {
        getSession: async () => ({ data: { session: { user: { id: currentUser } } } }),
        onAuthStateChange: (cb: () => void) => { authCb = cb; },
      },
    },
  };
}

test("terms and local filter match the server's ILIKE semantics", () => {
  assert.deepEqual(archiveTerms("What's my axolotl called, and my favourite food?"), ["what", "axolotl", "called", "favourite"]);
  const hit = filterArchive(ROWS, ["favourite"], 5);
  assert.deepEqual(hit.map((r) => r.id), [3], "matches the key, case-insensitively");
  assert.deepEqual(filterArchive(ROWS, ["called", "canberra"], 5).map((r) => r.id), [2, 1], "any term; newest first");
  assert.deepEqual(filterArchive(ROWS, ["called", "canberra"], 1).map((r) => r.id), [2], "limit applies after ordering");
});

test("one snapshot request serves every later turn for the same user", async () => {
  const fake = fakeClient(ROWS);
  const archive = new OgArchiveProvider(() => fake.client);
  archive.prefetch();
  const a = await archive.context("what is my axolotl called", 4);
  const b = await archive.context("where do I live, canberra?", 4);
  assert.equal(a[0]?.content, "pet: Her axolotl is called Mochi");
  assert.equal(b[0]?.content, "city: Lives near Canberra");
  assert.deepEqual(fake.calls, [`snapshot:${OgArchiveProvider.SNAPSHOT_MAX_ROWS + 1}`], "no per-turn query");
});

test("a sign-in change drops the snapshot", async () => {
  const fake = fakeClient(ROWS);
  const archive = new OgArchiveProvider(() => fake.client);
  await archive.context("axolotl", 4);
  fake.switchUser("u2");
  await archive.context("axolotl", 4);
  assert.equal(fake.calls.filter((c) => c.startsWith("snapshot")).length, 2);
});

test("an archive too large to cache falls back to the per-turn server query", async () => {
  const many = Array.from({ length: OgArchiveProvider.SNAPSHOT_MAX_ROWS + 5 }, (_, i) => ({ id: i, key: "k", value: `v${i}`, created_at: "2026-01-01T00:00:00Z" }));
  const fake = fakeClient(many);
  const archive = new OgArchiveProvider(() => fake.client);
  await archive.context("axolotl named mochi", 4);
  await archive.context("axolotl named mochi", 4);
  assert.equal(fake.calls.filter((c) => c.startsWith("snapshot")).length, 1, "the snapshot is tried once");
  assert.equal(fake.calls.filter((c) => c.startsWith("query:")).length, 2, "then the server query, every turn");
});
