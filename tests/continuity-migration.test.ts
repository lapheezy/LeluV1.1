/**
 * Mission 14.5 — the migration that makes conditional writes atomic.
 *
 * CATEGORY: unit. Reads the migration and the real adapter source; no
 * database and no network are involved. Real application of the migration
 * is part of the BLOCKED authenticated Supabase acceptance.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const migration = readFileSync(
  "supabase/migrations/20261123094156_continuity_revisions.sql",
  "utf8",
);
const transport = readFileSync(
  "src/core/sync/SupabaseContinuityTransport.ts",
  "utf8",
);

test("every continuity row authority gets a strict revision column", () => {
  for (const table of ["projects", "conversations", "knowledge_items", "user_preferences"]) {
    assert.match(
      migration,
      new RegExp(`alter table public\\.${table}\\s+add column if not exists continuity_revision bigint not null default 1`),
      `${table} needs a strict revision token`,
    );
    assert.match(
      migration,
      new RegExp(`create trigger lelu_continuity_touch\\s+before insert or update on public\\.${table}`),
      `${table} needs the server-owned revision trigger`,
    );
  }
});

test("the trigger owns both the revision and the timestamp", () => {
  assert.match(migration, /new\.continuity_revision := 1/);
  assert.match(migration, /new\.continuity_revision := coalesce\(old\.continuity_revision, 1\) \+ 1/);
  assert.match(migration, /new\.updated_at := clock_timestamp\(\)/);
  assert.match(migration, /set search_path = public/);
});

test("the adapter conditions on the strict revision before the timestamp fallback", () => {
  assert.match(transport, /\.eq\("continuity_revision", Number\(existing\.continuity_revision\)\)/);
  assert.match(transport, /return query\.eq\("updated_at", existing\.updated_at\)/);
});

test("the adapter recognises a repeated delivery instead of calling it a conflict", () => {
  assert.match(transport, /remoteHash === localHash/);
  assert.match(transport, /lost-acknowledgement|already-applied/i);
});
