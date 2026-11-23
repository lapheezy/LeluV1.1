/**
 * 2026-11-23 Supabase security closure.
 *
 * CATEGORY: unit + isolated database. The static checks read repository files.
 * The database check starts a private, throwaway Postgres (scripts/db/
 * verify-supabase-security.ts) and is SKIPPED, not passed, when no Postgres
 * server binaries are installed. Nothing here connects to Supabase.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { findPgBin, runIsolatedValidation } from "../scripts/db/verify-supabase-security.ts";

const MIGRATIONS = "supabase/migrations";
const SUPERSEDED = "supabase/migrations-superseded";
const read = (p: string) => readFileSync(p, "utf8");
const sha = (s: string) => createHash("sha256").update(s.trim()).digest("hex");

test("the reconciled migrations and the continuity lockdown are the active 2026-11-23 set", () => {
  const active = readdirSync(MIGRATIONS).filter((f) => f.startsWith("20261123")).sort();
  assert.deepEqual(active, [
    "20261123094147_revoke_trim_lelu_events_execute.sql",
    "20261123094156_continuity_revisions.sql",
    "20261123094212_memory_tombstones.sql",
    "20261123094258_memory_trigger_functions_execute_lockdown.sql",
    "20261123145445_continuity_touch_execute_lockdown.sql",
  ]);
});

test("the three superseded files stay preserved outside the active directory", () => {
  assert.deepEqual(readdirSync(SUPERSEDED).sort(), [
    "202611060001_revoke_trim_lelu_events_execute.sql",
    "202611160001_continuity_revisions.sql",
    "202611200001_memory_tombstones.sql",
  ]);
});

test("no migration SQL is duplicated inside the active directory", () => {
  const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql"));
  const hashes = files.map((f) => sha(read(`${MIGRATIONS}/${f}`)));
  assert.equal(new Set(hashes).size, files.length);
  const versions = files.map((f) => f.split("_")[0]);
  assert.equal(new Set(versions).size, files.length, "every version is unique");
});

test("the continuity lockdown revokes exactly the trigger function and nothing else", () => {
  const sql = read(`${MIGRATIONS}/20261123145445_continuity_touch_execute_lockdown.sql`);
  const statements = sql.split("\n").filter((l) => l.trim() && !l.trim().startsWith("--"));
  assert.deepEqual(statements, [
    "revoke all on function public.lelu_continuity_touch() from public, anon, authenticated;",
  ]);
});

test("no application code calls a trigger function or rls_auto_enable as an RPC", () => {
  const sources = [
    "src/core/persistence/SupabasePersistence.ts",
    "src/og/lib/memories.functions.ts",
    "src/core/sync/SupabaseContinuityTransport.ts",
  ].map(read).join("\n");
  for (const fn of ["lelu_continuity_touch", "memory_record_tombstone", "memory_refuse_resurrection", "trim_lelu_events", "rls_auto_enable"]) {
    assert.doesNotMatch(sources, new RegExp(`rpc\\(\\s*["'\`]${fn}`), fn);
  }
  assert.match(sources, /rpc\("erase_memory", \{ p_id: id, p_fingerprint: fingerprint \}\)/);
});

test("the validation SQL refuses to run anywhere but its own isolated database", () => {
  for (const f of ["00-fixture.sql", "10-assertions.sql"]) {
    assert.match(read(`tests/sql/security-closure/${f}`), /current_database\(\) not like 'lelu_security_closure%'/);
  }
  assert.match(read("tests/sql/security-closure/10-assertions.sql"), /\nrollback;\s*$/);
});

test("isolated Postgres: continuity, tombstones, erase_memory, permissions, RLS, anon", { skip: findPgBin() ? false : "no PostgreSQL server binaries installed (set PG_BIN)" }, () => {
  const result = runIsolatedValidation();
  assert.equal(result.failure, null, result.failure ?? "");
  assert.ok(result.ok);
  for (const group of ["P1", "P7", "C1", "C3", "C5", "M1", "M2", "E2", "E6", "E8", "R1", "R5", "A1", "A2"]) {
    assert.ok(result.passed.some((p) => p.startsWith(`PASS ${group} `)), `missing ${group}`);
  }
  assert.ok(result.passed.length >= 60, `only ${result.passed.length} assertions ran`);
});
