/**
 * M22.7 — the tombstone migration, executed by a real Postgres.
 *
 * PGlite is Postgres compiled to WASM, so this is not a mock: the triggers,
 * the RLS policies, the security-definer function and the error codes all run
 * for real. It is NOT the Supabase project — `auth.uid()` is stubbed from a
 * session setting and the roles are created here — so the result is labelled
 * "SQL-level verification" and never "live acceptance".
 *
 * What it proves, in order:
 *   A  deleting a row writes its tombstone in the same transaction
 *   B  re-inserting that id is refused by the database (resurrection block)
 *   C  a second user may use the same id (tombstones are per user)
 *   D  erase_memory() tombstones an id that has no row at all
 *   E  erase_memory() is idempotent and keeps one tombstone
 *   F  erase_memory() without a session is refused
 *   G  RLS: a user sees only their own rows, cannot read another's tombstones,
 *      and cannot insert a row claiming another user_id
 *   H  the tombstone table holds no memory text
 *
 * Usage (pglite is installed outside the repo so the lockfile is untouched):
 *   mkdir -p /tmp/pgtest && cd /tmp/pgtest && npm install @electric-sql/pglite
 *   cp <repo>/MISSION-22.7/probe/sql-verify.mjs /tmp/pgtest/
 *   cd /tmp/pgtest && node sql-verify.mjs <repo>/supabase/migrations/202611200001_memory_tombstones.sql
 */

import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const migrationPath = process.argv[2];
if (!migrationPath) {
  console.error("usage: node sql-verify.mjs <path to 202611200001_memory_tombstones.sql>");
  process.exit(2);
}
const migration = readFileSync(migrationPath, "utf8");

const USER_A = "11111111-1111-1111-1111-111111111111";
const USER_B = "22222222-2222-2222-2222-222222222222";

const results = [];
let failures = 0;
const check = (id, name, ok, detail) => {
  if (!ok) failures += 1;
  results.push({ id, name, ok: Boolean(ok), detail: detail ?? null });
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${id}  ${name}${detail ? `  — ${detail}` : ""}`);
};

const db = new PGlite();

/** Supabase's own scaffolding, reduced to what the migration touches. */
await db.exec(`
  create schema if not exists auth;
  create table auth.users (id uuid primary key, email text);
  create or replace function auth.uid() returns uuid
  language sql stable as $fn$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  $fn$;
  insert into auth.users (id, email) values
    ('${USER_A}', 'a@example.test'),
    ('${USER_B}', 'b@example.test')
  on conflict do nothing;
  create role authenticated nologin;
  create role anon nologin;
`);

/** The live `memory_items` shape, from 202608240001_lelu_runtime.sql. */
await db.exec(`
  create table public.memory_items (
    id text not null,
    user_id uuid not null references auth.users(id) on delete cascade,
    category text not null,
    prompt text not null,
    response text not null,
    context jsonb not null default '{}'::jsonb,
    updated_at timestamptz not null default now(),
    primary key (id, user_id)
  );
  alter table public.memory_items enable row level security;
  create policy memory_items_owner on public.memory_items
    for all to authenticated
    using (user_id = auth.uid()) with check (user_id = auth.uid());
  grant usage on schema public to authenticated, anon;
  grant select, insert, update, delete on public.memory_items to authenticated;
`);

// The migration under test, verbatim.
await db.exec(migration);

await db.exec(`
  grant select, insert, delete on public.memory_tombstones to authenticated;
`);

const run = (sql, params) => db.query(sql, params);
/**
 * Run a query as a signed-in user, in a transaction that COMMITS on success.
 *
 * The first version rolled back unconditionally and every write test passed
 * inside its own transaction while the rows it wrote vanished — which made the
 * RLS checks read an empty table and look like policy failures. A statement
 * that is expected to fail aborts the transaction, so that path rolls back.
 */
const asUser = async (userId, fn) => {
  await db.exec("begin");
  try {
    await db.exec(`set local role authenticated`);
    if (userId) {
      await run(`select set_config('request.jwt.claim.sub', $1, true)`, [userId]);
    } else {
      await run(`select set_config('request.jwt.claim.sub', '', true)`);
    }
    const value = await fn();
    await db.exec("commit");
    return value;
  } catch (error) {
    try {
      await db.exec("rollback");
    } catch {
      /* already unwound */
    }
    throw error;
  }
};
const count = async (sql, params) => Number((await run(sql, params)).rows[0].count);
const err = async (fn) => {
  try {
    await fn();
    return null;
  } catch (error) {
    return { message: error.message ?? String(error), code: error.code ?? null };
  }
};

console.log("\n=== M22.7 tombstone migration: real Postgres semantics ===");

/* ---- A. delete writes the tombstone ------------------------------- */

const SECRET = "the vault code phrase is BLUE-HARBOUR-77";
const FP = "fp-deadbeef";

await asUser(USER_A, () => run(
  `insert into public.memory_items (id, user_id, category, prompt, response, context)
   values ('m-a-1', $1, 'fact', $2, 'acknowledged', $3)`,
  [USER_A, SECRET, JSON.stringify({ deletionFingerprint: FP })],
));

const delResult = await asUser(USER_A, () => run(
  `delete from public.memory_items where id = 'm-a-1' and user_id = $1`, [USER_A],
));
check("A1", "a tombstoned user may delete their own row", delResult.affectedRows === 1,
  `${delResult.affectedRows} row(s)`);

const tombA = await asUser(USER_A, () => run(
  `select memory_id, fingerprint, source from public.memory_tombstones where user_id = $1`, [USER_A],
));
check("A2", "the delete left a tombstone in the same transaction",
  tombA.rows.length === 1 && tombA.rows[0].memory_id === "m-a-1",
  JSON.stringify(tombA.rows));
check("A3", "the tombstone carries the fingerprint hash, not the text",
  tombA.rows[0]?.fingerprint === FP, tombA.rows[0]?.fingerprint ?? "none");

/* ---- B. resurrection is refused ----------------------------------- */

const resurrect = await err(() => asUser(USER_A, () => run(
  `insert into public.memory_items (id, user_id, category, prompt, response)
   values ('m-a-1', $1, 'fact', 'restored by a stale client', 'acknowledged')`,
  [USER_A],
)));
check("B1", "a stale upload of a deleted id is refused by the database",
  Boolean(resurrect), resurrect ? `${resurrect.message}` : "the insert was accepted — resurrection is possible");
check("B2", "the refusal names the reason",
  /memory_deleted/.test(resurrect?.message ?? ""), resurrect?.message ?? "");

const rowsAfter = await asUser(USER_A, () => count(
  `select count(*) from public.memory_items where id = 'm-a-1' and user_id = $1`, [USER_A],
));
check("B3", "the refused row did not come into existence", rowsAfter === 0, `${rowsAfter} row(s)`);

/* ---- C. tombstones are per user ----------------------------------- */

const otherUserInsert = await err(() => asUser(USER_B, () => run(
  `insert into public.memory_items (id, user_id, category, prompt, response)
   values ('m-a-1', $1, 'fact', 'an unrelated statement that happens to share an id', 'ok')`,
  [USER_B],
)));
check("C1", "another user may use the same id (no cross-user deletion)",
  otherUserInsert === null, otherUserInsert?.message ?? "accepted");

/* ---- D. erase_memory with no row ---------------------------------- */

const eraseAbsent = await asUser(USER_A, async () => {
  const first = await run(`select public.erase_memory('never-synced-id', $1) as removed`, ["fp-2"]);
  const tomb = await count(
    `select count(*) from public.memory_tombstones where user_id = $1 and memory_id = 'never-synced-id'`, [USER_A],
  );
  return { removed: Number(first.rows[0].removed), tomb };
});
check("D1", "erase_memory tombstones an id that has no row at all", eraseAbsent.tomb === 1, `${eraseAbsent.tomb} tombstone(s)`);
check("D2", "it reports 0 rows removed rather than claiming a delete", eraseAbsent.removed === 0, `${eraseAbsent.removed}`);

const blockedNeverSynced = await err(() => asUser(USER_A, () => run(
  `insert into public.memory_items (id, user_id, category, prompt, response)
   values ('never-synced-id', $1, 'fact', 'a later upload', 'ok')`, [USER_A],
)));
check("D3", "a memory deleted before it ever synced cannot be uploaded later",
  Boolean(blockedNeverSynced), blockedNeverSynced?.message ?? "accepted");

/* ---- E. idempotent ------------------------------------------------ */

const twice = await asUser(USER_A, async () => {
  const again = await run(`select public.erase_memory('never-synced-id', '') as removed`);
  const tomb = await count(
    `select count(*) from public.memory_tombstones where user_id = $1 and memory_id = 'never-synced-id'`, [USER_A],
  );
  const fp = (await run(
    `select fingerprint from public.memory_tombstones where user_id = $1 and memory_id = 'never-synced-id'`, [USER_A],
  )).rows[0].fingerprint;
  return { removed: Number(again.rows[0].removed), tomb, fp };
});
check("E1", "a repeated erase returns 0", twice.removed === 0, `${twice.removed}`);
check("E2", "a repeated erase keeps exactly one tombstone", twice.tomb === 1, `${twice.tomb}`);
check("E3", "a repeat with no fingerprint does not erase the one already stored",
  twice.fp === "fp-2", twice.fp);

/* ---- F. no session ------------------------------------------------- */

const noSession = await err(() => asUser(null, () => run(`select public.erase_memory('anything', '')`)));
check("F1", "erase_memory without a session is refused", Boolean(noSession), noSession?.message ?? "accepted");

/* ---- G. RLS -------------------------------------------------------- */

await asUser(USER_B, () => run(
  `insert into public.memory_items (id, user_id, category, prompt, response)
   values ('m-b-1', $1, 'fact', 'B private statement', 'ok')`, [USER_B],
));
await asUser(USER_A, () => run(
  `insert into public.memory_items (id, user_id, category, prompt, response)
   values ('m-a-2', $1, 'fact', 'A private statement', 'ok')`, [USER_A],
));

const seenByA = await asUser(USER_A, () => run(`select id from public.memory_items order by id`));
check("G1", "user A sees only their own memory rows",
  seenByA.rows.length === 1 && seenByA.rows[0].id === "m-a-2",
  JSON.stringify(seenByA.rows.map((row) => row.id)));

// Give B a tombstone of its own, so the check has something to hide.
await asUser(USER_B, () => run(`select public.erase_memory('m-b-tomb', 'fp-b')`));
const tombstonesSeenByA = await asUser(USER_A, () =>
  run(`select memory_id from public.memory_tombstones order by memory_id`));
const idsSeenByA = tombstonesSeenByA.rows.map((row) => row.memory_id);
check("G2", "user A cannot see another user's tombstones",
  !idsSeenByA.includes("m-b-tomb") && idsSeenByA.length === 2,
  `A sees ${JSON.stringify(idsSeenByA)}; B holds m-b-tomb`);

const forged = await err(() => asUser(USER_A, () => run(
  `insert into public.memory_items (id, user_id, category, prompt, response)
   values ('forged', $1, 'fact', 'forged owner', 'ok')`, [USER_B],
)));
check("G3", "user A cannot insert a row owned by user B", Boolean(forged), forged?.message ?? "accepted");

const eraseOthers = await asUser(USER_A, async () => {
  const res = await run(`select public.erase_memory('m-b-1', '') as removed`);
  return Number(res.rows[0].removed);
});
const bStillThere = await asUser(USER_B, () => count(
  `select count(*) from public.memory_items where id = 'm-b-1' and user_id = $1`, [USER_B],
));
check("G4", "erase_memory cannot delete another user's row by id", eraseOthers === 0 && bStillThere === 1,
  `removed ${eraseOthers}, B still has ${bStillThere}`);

/* ---- H. no plaintext ---------------------------------------------- */

const dump = await asUser(USER_A, () => run(`select * from public.memory_tombstones`));
const dumpText = JSON.stringify(dump.rows);
check("H1", "no tombstone anywhere holds the deleted statement",
  !dumpText.includes("BLUE-HARBOUR-77") && !dumpText.toLowerCase().includes("vault code"),
  `${dumpText.length} bytes inspected`);
check("H2", "the deleted statement is gone from memory_items",
  (await asUser(USER_A, () => count(
    `select count(*) from public.memory_items where prompt like '%BLUE-HARBOUR%'`, [],
  ))) === 0, "no matching row");

const summary = {
  kind: "sql-level verification (PGlite = real Postgres, stubbed auth.uid())",
  migration: migrationPath.split("/").pop(),
  at: new Date().toISOString(),
  checks: results.length,
  passed: results.filter((r) => r.ok).length,
  failed: failures,
  results,
};
console.log(`\n${summary.passed}/${summary.checks} checks passed, ${failures} failed`);
console.log(JSON.stringify(summary, null, 2));
await db.close();
process.exit(failures === 0 ? 0 : 1);
