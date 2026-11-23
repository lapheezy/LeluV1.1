# Production migration reconciliation — 2026-11-23

**Production project:** `nrehsldbfxthspikaxvr` ("Lelu", us-east-1, Postgres 17).
**Repository branch:** `integration/lelu-four-workforce-consolidation`.
**Status: PARTIALLY COMPLETE.** The repository and production now agree, and every
verification I could run without changing production passed. The GitHub API
connector cannot write to the repository (403), so the change is delivered by git
push from the workspace instead, and that push is the step that closes it.

## 1. Four production migrations

| Version | Name | Repo file | Historical file (kept, not replayed) |
|---|---|---|---|
| 20261123094147 | revoke_trim_lelu_events_execute | `supabase/migrations/20261123094147_revoke_trim_lelu_events_execute.sql` | `supabase/migrations-superseded/202611060001_revoke_trim_lelu_events_execute.sql` |
| 20261123094156 | continuity_revisions | `supabase/migrations/20261123094156_continuity_revisions.sql` | `supabase/migrations-superseded/202611160001_continuity_revisions.sql` |
| 20261123094212 | memory_tombstones | `supabase/migrations/20261123094212_memory_tombstones.sql` | `supabase/migrations-superseded/202611200001_memory_tombstones.sql` |
| 20261123094258 | memory_trigger_functions_execute_lockdown | `supabase/migrations/20261123094258_memory_trigger_functions_execute_lockdown.sql` | — (added by the production deployment; no earlier file) |

**Content.** Each canonical file was written from the statement text recorded in
production's `supabase_migrations.schema_migrations`. Character counts match production
exactly (435, 3398, 5967, 334) once the trailing newline is ignored. Each superseded
historical file has content identical to its canonical counterpart.

**Why the historical files moved, not deleted.** Keeping both sets in
`supabase/migrations/` would make a fresh deployment run the same change twice under
two version numbers. The historical files are preserved byte-for-byte in
`supabase/migrations-superseded/`, which the Supabase CLI does not read.

**Migration history.** Production lists all 30 versions with no duplicates. The four
new entries are the only ones added in this change.

## 2. Schema changes (applied to production by the deployment, verified read-only)

* `public.projects`, `conversations`, `knowledge_items`, `user_preferences`: column
  `continuity_revision bigint NOT NULL DEFAULT 1`.
* `public.lelu_continuity_touch()` trigger function; one BEFORE INSERT OR UPDATE trigger
  per table. Insert sets revision 1; update sets revision + 1 and `updated_at = clock_timestamp()`.
* `public.memory_tombstones` (user_id, memory_id, fingerprint, source, deleted_at), primary key
  (user_id, memory_id), RLS enabled, owner policy `user_id = auth.uid()`.
* Triggers on `public.memory_items`: `memory_items_record_tombstone` (AFTER DELETE) and
  `memory_items_refuse_resurrection` (BEFORE INSERT OR UPDATE).
* `public.erase_memory(p_id text, p_fingerprint text)` — SECURITY DEFINER, scoped to `auth.uid()`.
* `public.trim_lelu_events()` — trigger function; EXECUTE revoked from PUBLIC, anon, authenticated.

## 3. Permission changes

| Function | Before | After |
|---|---|---|
| `trim_lelu_events()` | PUBLIC / anon / authenticated | postgres, service_role only |
| `memory_record_tombstone()` | PUBLIC / anon / authenticated | postgres, service_role only |
| `memory_refuse_resurrection()` | PUBLIC / anon / authenticated | postgres, service_role only |
| `erase_memory(text,text)` | — | authenticated only (anon and PUBLIC revoked) |

## 4. Verification (read-only SQL, production; no rows changed)

| Check | Result |
|---|---|
| `continuity_revision` on four tables | 4 × bigint, NOT NULL, default 1 |
| Continuity triggers | BEFORE INSERT and BEFORE UPDATE on each of the four tables |
| `memory_tombstones` RLS | enabled |
| Owner policy | `user_id = auth.uid()` for USING and WITH CHECK |
| Memory triggers | `memory_items_record_tombstone`, `memory_items_refuse_resurrection` present |
| `trim_lelu_events` anon / authenticated | denied / denied |
| `erase_memory` authenticated / anon | granted / denied |
| Trigger functions anon / authenticated | denied / denied |
| Row counts | `memory_tombstones` 0; `memory_items` 520 (unchanged; no test rows written) |

Rollback-safe resurrection and deletion tests were **not** executed in this run: they
need a transaction-scoped database session, which the available connector does not provide
(it runs each statement autocommitted). The logic is covered by `tests/memory-cloud-erasure.test.ts`
and the migration SQL was verified by the earlier M22.7 harness
(`MISSION-22.7/probe/sql-verify.mjs`). Treat the live resurrection check as not performed.

## 5. Application compatibility

Audited `src/`, `plugins/`, `server.ts`, `src/og/` and `tests/` for every name in scope.

* Continuity adapter (`src/core/sync/SupabaseContinuityTransport.ts`) reads
  `continuity_revision`, conditions updates with `.eq("continuity_revision", …)`, does not
  send the column on insert/update, and falls back to `updated_at` for rows without it.
* Deletion calls `rpc("erase_memory", { p_id, p_fingerprint })` (`SupabasePersistence.ts`,
  `src/og/lib/memories.functions.ts`). Parameter names and types match the function.
* Hydration reads `memory_tombstones` on `memory_id` (`SupabasePersistence.ts`), matching the table.
* A PGRST202 "function not found" from `erase_memory` is handled as a fallback path
  (`SupabasePersistence.ts`, tested in `memory-cloud-erasure.test.ts`).

One code change came out of this audit: `tests/continuity-migration.test.ts` read the
historical path, which the move removes. It now reads
`20261123094156_continuity_revisions.sql`. The 25 related tests pass (3 files, 0 failures).

## 6. Security advisor (production, `get_advisors` type=security)

| Finding | Level | Classification | Action |
|---|---|---|---|
| `rls_auto_enable()` executable by anon (SECURITY DEFINER) | WARN | Pre-existing; platform event trigger | **Not changed.** Only repo reference is a documentation note; restricting it needs Supabase tooling checked first |
| `rls_auto_enable()` executable by authenticated | WARN | Pre-existing; same function | Not changed (as above) |
| `erase_memory(text,text)` executable by authenticated | WARN | Expected application functionality | Retained by design |
| Leaked-password protection disabled | WARN | Pre-existing auth configuration | Not changed; outside this mission's authority |
| `trim_lelu_events` / trigger functions exposed | — | Resolved by this change | Not listed by the advisor any more |

**Newly observed, not yet actioned:** `lelu_continuity_touch()` still shows PUBLIC/anon/authenticated
EXECUTE in the catalogue. It is a trigger function, like the two the lockdown revoked. The advisor
does not flag it, so it is recorded here as a candidate for the same lockdown, not as a confirmed
exposure. Revoking it is a one-line follow-up that needs approval.

## 7. Rollback snapshot

Name from the mission: `lelu_migration_guard_20261123`. **Not inspected or modified in this run**;
its existence and row count (3,409 across projects, conversations, knowledge_items,
user_preferences and memory_items) come from the mission brief, not from a query made here.
It must not be deleted.

**Limitations.** It lives in the same database it protects, so it does not survive loss of the
project, and it covers only the five tables above, not auth, storage or other tables. It is not a
point-in-time backup and not a full disaster-recovery backup. Export it off-site before any
further destructive work.

## 8. Recovery procedures

* **Revert the schema change:** do not replay. Restore the affected tables from
  `lelu_migration_guard_20261123` only after confirming row counts with the owner; re-grant
  EXECUTE only where the application needs it.
* **Restore the historical revoke state** (not recommended): `grant execute` on the
  trigger functions to PUBLIC, but that re-exposes the advisor findings.
* **Fresh deployment:** apply `supabase/migrations/` in version order. The four files are the
  complete canonical set; the superseded directory is not read.

## 9. Repository synchronisation status

* Local workspace: the four canonical files, three `git mv` renames, the test path change,
  one comment update and this document are in the working tree of
  `integration/lelu-four-workforce-consolidation`.
* The GitHub connector write returned HTTP 403 earlier in the mission. A git push from the workspace
  is what delivers the change; its result is recorded in the commit log, not claimed here.

## 10. Remaining risks

1. `lelu_continuity_touch` EXECUTE exposure (above).
2. `rls_auto_enable` executable by anon and authenticated.
3. Leaked-password protection off.
4. The rollback snapshot is in-database only.
5. Live resurrection tests not executed against production.
6. Three M25 wardrobe tests fail on their source branch (unchanged by this work).
