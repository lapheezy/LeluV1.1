# Supabase production security closure — 2026-11-23

**Production project:** `nrehsldbfxthspikaxvr` ("Lelu", us-east-1, Postgres 17.6, organisation plan **free**).
**Branch:** `integration/lelu-four-workforce-consolidation`, starting at `0dcdbcc2`.
**Follows:** `docs/production/2026-11-23-migration-reconciliation.md`.
**Commits:** `0bfe52b9` (migration, validation suite, playbook) and the commit that adds this document.

**Status: COMPLETE, with two documented exceptions.**

* `lelu_continuity_touch()`: fixed in production and verified.
* `rls_auto_enable()`: deliberately left unchanged. The decision is backed by evidence in §3.
* Leaked-password protection: cannot be enabled on the free plan (§4).

All acceptance criteria are met, and the two exceptions are documented. The limits of what was tested are listed
in §6 and §10.

All times are UTC. Every production statement below was run through the authorised Supabase MCP connection. Every
step except one was read-only. The exception is the single migration in §2.

---

## 1. Initial findings (advisor + catalogue, 13:32–14:12)

| # | Finding | Source |
|---|---|---|
| F1 | `public.lelu_continuity_touch()` ACL `{=X, postgres=X, anon=X, authenticated=X, service_role=X}`: EXECUTE for PUBLIC, anon, authenticated | catalogue (`pg_proc.proacl`); not flagged by the advisor |
| F2 | `public.rls_auto_enable()` SECURITY DEFINER, executable by anon (lint 0028) and authenticated (lint 0029) | advisor |
| F3 | `public.erase_memory(text,text)` SECURITY DEFINER executable by authenticated (lint 0029) | advisor (expected: it is the app's erase RPC) |
| F4 | Leaked-password protection disabled | advisor |

## 2. Work package 1: continuity trigger EXECUTE (resolved)

### Evidence

* **Definition.** `plpgsql`, `RETURNS trigger`, **SECURITY INVOKER** (`prosecdef = false`),
  `search_path = public`, owner `postgres`.
  * On insert the body sets `continuity_revision := 1`.
  * On update it sets `continuity_revision := old + 1`.
  * Both cases set `updated_at := clock_timestamp()`.
  * The body matches `supabase/migrations/20261123094156_continuity_revisions.sql`.
* **Triggers.** There are exactly four: `lelu_continuity_touch BEFORE INSERT OR UPDATE ... FOR EACH ROW` on
  `projects`, `conversations`, `knowledge_items` and `user_preferences`. All are enabled (`tgenabled = 'O'`). No
  other trigger or event trigger uses the function.
* **Trigger-only.** Production refuses a direct call with
  `0A000 trigger functions can only be called as triggers` (anon, before the change). PostgREST cannot invoke it in
  any useful way.
* **No direct callers.** A `git grep` over the whole repository (src, plugins, server.ts, services, agent, studio,
  scripts, tests, migrations, docs) found the name only in:
  * the migration files;
  * a static test that pattern-matches the migration;
  * documentation.

  The only `.rpc(` calls in application code are `erase_memory` (`SupabasePersistence.ts:757`,
  `src/og/lib/memories.functions.ts:108`). No admin tooling references it.
* **Comparison with the locked-down siblings.** `memory_record_tombstone`, `memory_refuse_resurrection` and
  `trim_lelu_events` are trigger functions and SECURITY DEFINER. They already had ACL `{postgres=X, service_role=X}`
  from the same revoke, and their triggers stay attached. `lelu_continuity_touch` is lower-risk than those (it is
  INVOKER), and it was the only trigger function still carrying the default grants.
* **Why revocation is safe.** PostgreSQL checks EXECUTE on a trigger function only when `CREATE TRIGGER` runs, not
  when the trigger fires. This was proven directly in production by the before/after probe below, not inferred.

### Precondition and impact assessment

* Precondition: ACL as F1; four triggers enabled; no writes to the four tables since 2026-11-22 15:59.
* Impact on the application: none. It never calls the function, and trigger firing does not need the grant.
* Impact on data: none. An ACL change rewrites no rows.
* Blast radius: the one function.

### SQL applied

Applied via `apply_migration`. Production recorded version **20261123145445**,
`continuity_touch_execute_lockdown`, applied ≈ 14:54:45 UTC. Verified at 14:54:55.

```sql
revoke all on function public.lelu_continuity_touch() from public, anon, authenticated;
```

Repository file: `supabase/migrations/20261123145445_continuity_touch_execute_lockdown.sql`. Its MD5 is identical to
the statement production recorded (`fcf461c8…`, 403 chars).

### Post-change verification (production)

| Check | Before | After |
|---|---|---|
| ACL | `{=X,postgres=X,anon=X,authenticated=X,service_role=X}` | `{postgres=X/postgres,service_role=X/postgres}` |
| `has_function_privilege` anon / authenticated / service_role | t / t / t | **f / f / t** |
| Direct call as anon | `0A000` trigger-only | `42501 permission denied for function lelu_continuity_touch` |
| Direct call as authenticated | (not run) | `42501 permission denied` |
| Continuity triggers attached and enabled | 4 | **4** (projects, conversations, knowledge_items, user_preferences) |
| Rolled-back probe as `authenticated` (below) | exec_priv **t**; revisions 1 → 2 → 3; timestamp server-set | exec_priv **f**; revisions 1 → 2 → 3; timestamp server-set |

**The rolled-back probe.** It is a single `DO` block, run as `postgres`. It always ends in `RAISE EXCEPTION`, so
PostgreSQL discards everything it did. It does the following:

1. Creates a session-temporary table (`pg_temp`, `ON COMMIT DROP`).
2. Attaches the real `public.lelu_continuity_touch()` as a BEFORE INSERT OR UPDATE trigger.
3. Switches to `SET LOCAL ROLE authenticated`.
4. Inserts with a forged revision of 99 and a timestamp of 2000-01-01.
5. Updates with a forged revision of 500.
6. Updates a second time.
7. Reports the results in the exception text.

No production table was read or written by it.

## 3. Work package 2: `rls_auto_enable()` (unchanged, by decision)

### Evidence

* **Definition.** `plpgsql`, `RETURNS event_trigger`, **SECURITY DEFINER**, `search_path = pg_catalog`, owner
  `postgres`. Its ACL is the default `{=X, postgres, anon, authenticated, service_role}`.
  * For `CREATE TABLE`, `CREATE TABLE AS` and `SELECT INTO` it loops over `pg_event_trigger_ddl_commands()`.
  * For tables in `public` it runs `alter table ... enable row level security`.
  * It logs and swallows errors.
* **Event trigger.** `ensure_rls`:
  * fires on `ddl_command_end` for tags `CREATE TABLE`, `CREATE TABLE AS` and `SELECT INTO`;
  * owner `postgres`, enabled (`O`).

  The platform's own event triggers (`issue_pg_cron_access`, `issue_graphql_placeholder`, `pgrst_ddl_watch`, …) are
  owned by `supabase_admin`. `ensure_rls` is not one of them.
* **Origin.** The function body is character-for-character the snippet in Supabase's documentation, *Row Level
  Security → Auto-enable RLS for new tables*
  (https://supabase.com/docs/guides/database/postgres/row-level-security#auto-enable-rls-for-new-tables).
  * That snippet ships with no REVOKE.
  * The repository contains no SQL that creates it. Its only mentions are in documentation.
  * Conclusion: it was installed outside the repository, by the dashboard or by hand.
* **Execution context is platform-mediated.**
  * `postgres` is not a superuser on this project (`rolsuper = f`). `supabase_admin` is.
  * `supautils` is session-preloaded (`session_preload_libraries = supautils`), and the setting
    `supautils.log_skipped_evtrigs` exists. In other words, Supabase's extension decides when user-owned event
    triggers run. That is how a non-superuser can own one at all.
* **Direct invocation behaves differently on the platform.** Each test below ran in a rolled-back transaction as
  anon:

  | Environment | Direct call (`PERFORM public.rls_auto_enable()`) |
  |---|---|
  | Plain PostgreSQL 16, isolated | `0A000 trigger functions can only be called as triggers` |
  | Production (PG 17 + supautils) | **completed without error** |

  In production, `pg_event_trigger_ddl_commands()` called on its own outside an event trigger still raises
  `39P03`. The call therefore does not reach the DDL loop. supautils (or PG 17) intercepts or short-circuits it.
  The exact mechanism cannot be inspected from here. A matching PG 17 environment could not be installed in this
  workspace, because the action was refused, and no Supabase branch was created (it is a paid feature).
* **Can a direct call do harm?** On the evidence, no.
  * The only data source is the DDL command list of the current event, which is empty outside an event trigger.
  * The only action it can take is to *enable* RLS, which tightens access.
  * The production direct call changed nothing: re-checked state was identical.
  * The advisor finding is real hygiene but has no demonstrated exploit.
* **Would revoking break it?** In isolated PostgreSQL 16, after `REVOKE ALL ... FROM PUBLIC, anon, authenticated`:
  * the event trigger still fired for a role without EXECUTE;
  * that role ran `CREATE TABLE`, and the table came out with `relrowsecurity = t`;
  * a direct call became `42501`.

  That is the expected PostgreSQL behaviour. It was **not** proven under supautils, which is the context that
  matters. supautils decides whether, and as whom, the function runs.

### Decision

**Leave it unchanged.** The mission rule ("do not change it until platform dependencies and execution context are
independently established") is not satisfied. The supautils execution path is the open dependency, and it cannot be
verified from this workspace.

### Recommendation (for a later, approved change)

* **Risk now:** low. The function can only enable RLS, and only during a real DDL event. The cost is two advisor
  WARNs.
* **Safest remediation:**
  1. Ask Supabase support, or check the current supautils documentation, whether user-owned event-trigger
     functions need EXECUTE for the invoking role under supautils.
  2. Test it on a Supabase branch. Branches cost money and need the owner's approval.
  3. On that branch, run `revoke all on function public.rls_auto_enable() from public, anon, authenticated;`.
  4. Prove that `create table public.zz_probe(x int)`, run as `postgres` and as `service_role`, still yields
     `relrowsecurity = t`. Then drop the probe table.
  5. Only then apply the same statement to production as a migration.
* **Compatibility:** the application never calls it. Dashboard table creation runs as `postgres` or `supabase_admin`,
  and both keep EXECUTE as owner or superuser.
* **Rollback:**
  `grant execute on function public.rls_auto_enable() to public, anon, authenticated, service_role;`
  This restores the exact current ACL.
* **Not recommended:** switching to SECURITY INVOKER. `alter table` needs table ownership, so tables created by
  other roles (dashboard, `supabase_admin`) would silently stop getting RLS. The function swallows errors and only
  logs them.

## 4. Work package 3: leaked-password protection (not enabled; not available)

* **Current state:** disabled (advisor lint `auth_leaked_password_protection`).
* **Plan:** organisation `scnijbbeucuxhueosjbz` is on plan **free** (`get_organization`). Supabase's password-security
  documentation states: "Leaked password protection is available on the Pro Plan and above."
  (https://supabase.com/docs/guides/auth/password-security). The setting is therefore not available to this project.
  Enabling it would require a paid upgrade, which this mission prohibits.
* **Administrative controls available here:** the connected MCP tools expose no Auth-configuration read or write.
  The Management API needs a token, which this mission forbids requesting. The rest of the current Auth
  configuration (minimum length, required characters) was therefore **not** read.
* **Behaviour if it is enabled later** (from the documentation):
  * It applies when a password is *set*: `signUp`, `updateUser({ password })` and password reset/recovery. Supabase
    rejects a password found in HaveIBeenPwned with a weak-password error.
  * Existing users are not locked out, and their current passwords keep working for `signInWithPassword`.
  * This was **not** live-tested, because the feature is unavailable on this plan.
* **LÉLU compatibility:**
  * The app calls `signInWithPassword` (`SupabasePersistence.ts:251`) and `signUp` (`:262`).
  * It does not call `updateUser({ password })` or `resetPasswordForEmail`.
  * If the feature is enabled after a Pro upgrade, a signup with a leaked password fails with an Auth error. Check
    that the `signUp` error path shows Supabase's message to the user before enabling it.
* **Recommendation:**
  * If the project moves to Pro, enable it in Dashboard → Authentication → Providers → Email → "Prevent use of
    leaked passwords".
  * Meanwhile, the free-plan control is a minimum password length ≥ 8 with required character classes. Verify it in
    the dashboard, because it could not be read here.

## 5. Work package 5: migration and repository integrity

| Check | Result |
|---|---|
| Canonical 2026-11-23 files in `supabase/migrations/` | 4 reconciled + 1 new (`20261123145445_continuity_touch_execute_lockdown.sql`) |
| Superseded files in `supabase/migrations-superseded/` | 3, unchanged (`202611060001`, `202611160001`, `202611200001`) |
| Production `schema_migrations` | 32 rows, 0 duplicate versions. The four reconciled versions appear exactly once; the new one is the only addition |
| Repo files vs production statements | MD5 identical for all five (`d7db9a3e…`, `a10a5ea0…`, `c1c5b1d7…`, `d0ebc113…`, `fcf461c8…`) |
| Duplicate SQL or duplicate versions in the active directory | none (asserted by `tests/supabase-security-closure.test.ts`) |
| Reconciliation document | still accurate. §6 "Newly observed, not yet actioned" is now closed by this document. The guard is a **schema** `lelu_migration_guard_20261123` with 6 tables (5 data + `snapshot_manifest`), not a table; it was not modified |

Nothing was renamed, recreated or replayed. `supabase db push` was not used.

## 6. Work package 4: non-destructive validation suite

New files:

* `tests/sql/security-closure/00-fixture.sql`
  * Supabase roles, a stub `auth`, and the six tables.
  * Column shapes, owner policies and table grants are read from production.
  * Includes Supabase's default privileges.
* `tests/sql/security-closure/10-assertions.sql`
  * 64 assertions in one transaction that ends in `ROLLBACK`.
  * Synthetic users `1111…` and `2222…` only.
* `scripts/db/verify-supabase-security.ts`
  * Creates a throwaway Postgres cluster in a temp directory, on a unix socket only.
  * Applies the fixture and every `20261123*` migration, runs the assertions, then deletes the cluster.
  * It takes no connection string, so it cannot reach Supabase.
  * Both SQL files refuse to run unless the database name is `lelu_security_closure*`.
* `tests/supabase-security-closure.test.ts`
  * Static integrity checks, plus the isolated run.
  * The isolated run is *skipped*, never passed, when no Postgres binaries exist.
* Playbook `leluverse/self/playbooks/verify-supabase-security.json`.

Coverage (each code is one or more assertions):

* **P1–P10: trigger-function and RPC permissions.**
  * No EXECUTE for anon or authenticated on any of the four trigger functions.
  * PUBLIC holds no EXECUTE on any of them, nor on `erase_memory`.
  * `erase_memory` is executable by authenticated only.
  * Direct calls return `42501`.
  * Four continuity triggers are enabled.
* **C1–C10: continuity revisions.** All run as `authenticated`, which has no EXECUTE.
  * Insert sets 1 even when the client forges 99.
  * Update increments and ignores a forged 500.
  * A stale timestamp is overwritten.
  * Compare-and-swap on a stale revision changes 0 rows; on the current revision it changes 1.
  * All four tables are covered.
* **M1–M5: tombstones and resurrection.**
  * A delete writes its tombstone, with the fingerprint, in the same transaction.
  * Re-insert, upsert and update of a tombstoned id are refused with `P0001`.
  * The tombstone table holds no memory text.
* **E1–E8: `erase_memory`.**
  * Erasing an id with no row returns 0 and still writes a tombstone.
  * Erasing an existing row returns 1; repeating it returns 0, with one tombstone and the fingerprint kept.
  * An empty id returns `22023`.
  * It cannot delete another user's row with the same id.
  * With no session it returns `28000`.
* **R1–R6: RLS owner isolation.** User B:
  * sees none of A's rows in all six tables;
  * cannot update A's project;
  * cannot delete A's tombstones;
  * cannot forge `user_id = A` on insert or update (`42501`).
* **A1–A3: anonymous denial.**
  * 0 rows readable from all six tables.
  * Inserts into `memory_items` and `memory_tombstones` are refused.

**Negative control.** With `20261123145445_continuity_touch_execute_lockdown.sql` temporarily removed, the suite
fails at `P1 public.lelu_continuity_touch() not executable by anon`. It does detect the original exposure.

## 7. Test results

| Where | What | Result |
|---|---|---|
| **Isolated database** (local PostgreSQL 16.15, throwaway cluster) | `scripts/db/verify-supabase-security.ts`, 5 migrations + 64 assertions | **64 / 64 pass** |
| Isolated database | the same, without the new migration (negative control) | fails at P1, as intended |
| Isolated database | `rls_auto_enable` revoke experiment (§3) | trigger still fires and RLS is enabled; direct call `42501` |
| **Local** (unit, node:test) | `supabase-security-closure`, `continuity-migration`, `continuity-sync`, `supabase-continuity-transport`, `memory-cloud-erasure`, `supabase-schema`, `self-awareness` | **61 / 61 pass, 0 skipped** |
| Local | `npm run typecheck` (`tsc -b --force`, covers `src` and `server.ts`) | **pass** |
| Local | strict `tsc --noEmit` on the two new TypeScript files (the project typecheck does not include them) | **pass** |
| Local | full `npm test` (3,215 tests) | **3,202 pass, 3 fail, 10 skipped.** The 3 failures are pre-existing M25 wardrobe/asset tests (`foundry-m25c`, `foundry` — a missing `v005_faceshapes…/lelu.glb` — and `outfit-switching`). They fail identically on a clean checkout of the starting commit `0dcdbcc2`, and the reconciliation document already lists them. None is related to this work |
| **Production** (read-only catalogue) | ACLs, triggers, event triggers, policies, grants, migration history, row counts | see §2, §3, §5, §8 |
| **Production** (rolled-back probe on a temp table) | continuity trigger fires for authenticated without EXECUTE | pass (before and after) |
| **Production** (rolled-back direct-call attempts) | anon and authenticated calling `lelu_continuity_touch` | `42501` after the change |
| **Not run** | memory deletion, resurrection, `erase_memory` and RLS behaviour against production | would need real or synthetic rows in production tables. No approved cleanup procedure exists, so they were run only in the isolated database |
| Not run | any test on PostgreSQL 17 or under supautils | no PG 17 environment available; a Supabase branch is paid |
| Not run | leaked-password behaviour | feature unavailable on the free plan |

## 8. No unintended production data change

| Table | Before (≈14:15, pre-change) | After (14:59:31) |
|---|---|---|
| projects | 224 | 224 |
| conversations | 457 | 457 |
| knowledge_items | 2139 | 2139 |
| user_preferences | 69 | 69 |
| memory_items | 520 | 520 |
| memory_tombstones | 0 | 0 |
| latest `updated_at` (projects / memory_items) | 2026-11-22 15:55:15 / 15:55:40 | unchanged |
| `lelu_migration_guard_20261123` | schema, 6 tables | schema, 6 tables (not touched) |
| `rls_auto_enable` ACL / `ensure_rls` | default / enabled | unchanged / enabled |

The only production change is the ACL of `public.lelu_continuity_touch()`, plus its `schema_migrations` row.

## 9. Security advisor: before and after

| Finding | Before (14:12:07) | After (14:59:27) | Status |
|---|---|---|---|
| `rls_auto_enable()` executable by anon (0028) | WARN | WARN | Open by decision (§3) |
| `rls_auto_enable()` executable by authenticated (0029) | WARN | WARN | Open by decision (§3) |
| `erase_memory(text,text)` executable by authenticated (0029) | WARN | WARN | Accepted: the app's erase RPC, scoped to `auth.uid()` (E6–E8) |
| Leaked-password protection disabled | WARN | WARN | Open: not available on the free plan (§4) |
| `lelu_continuity_touch()` PUBLIC/anon/authenticated EXECUTE | not an advisor lint (catalogue finding F1) | resolved in catalogue | **Closed** |

There are no other security advisor findings, inside or outside this mission's scope.

**Read-only re-verification queries:**

```sql
select p.oid::regprocedure, p.prosecdef, p.proacl from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname in ('lelu_continuity_touch','memory_record_tombstone',
       'memory_refuse_resurrection','trim_lelu_events','rls_auto_enable','erase_memory');
select tgrelid::regclass, tgname, tgenabled from pg_trigger
 where tgfoid = 'public.lelu_continuity_touch()'::regprocedure;
select version, name from supabase_migrations.schema_migrations where version >= '20261123' order by 1;
```

## 10. Remaining risks

1. `rls_auto_enable()` keeps the default EXECUTE grants (two advisor WARNs). Low risk; the decision is in §3.
2. Leaked-password protection is off and unavailable on the free plan. The free-plan password-strength settings were
   not readable here.
3. Production behaviour of the memory triggers and RLS is verified in the catalogue and in an isolated replica, not
   by live writes.
4. The isolated replica is PostgreSQL 16 without supautils. Production is 17.6 with supautils.
5. **Observed, outside scope, not changed.** `anon` and `authenticated` hold `TRUNCATE` and `TRIGGER` on all six
   tables. These are Supabase's default grants. PostgREST exposes neither, and RLS does not apply to `TRUNCATE`.
   Revoking `TRUNCATE, TRIGGER, REFERENCES` from `anon` would be defence in depth, but it needs its own review.
6. The rollback snapshot schema is still in the same database only (see the reconciliation document).
7. The project typecheck does not include `tests/` or `scripts/`. The new files were checked separately.

## 11. Rollback

* **WP1 continuity revoke.** Restore the exact previous ACL:
  ```sql
  grant execute on function public.lelu_continuity_touch() to public, anon, authenticated;
  ```
  Record it as a new migration. Do not delete version `20261123145445` from history. Rolling back is not expected to
  be needed: trigger operation does not depend on the grant.
* **WP2 and WP3.** Nothing was changed, so there is nothing to roll back.
* **Repository.** Revert this branch's commits. The migration file must stay as long as production lists version
  `20261123145445`.

## 12. Completion

| Criterion | Status |
|---|---|
| 1 Continuity trigger EXECUTE resolved | **Met.** Applied and verified (§2) |
| 2 `rls_auto_enable` decision with evidence | **Met.** Unchanged by decision (§3) |
| 3 Leaked-password decision with evidence | **Met.** Unavailable on the free plan (§4) |
| 4 Deletion and resurrection tests pass, non-destructively | **Met.** Isolated database (M1–M5, E1–E8) |
| 5 Continuity tests pass | **Met.** Isolated (C1–C10), production rolled-back probe, unit tests |
| 6 Application compatibility | **Met.** No caller of the revoked function; `erase_memory` unchanged; unit tests pass |
| 7 Migration history intact | **Met.** 32 versions, no duplicates, MD5-matched (§5) |
| 8 No unintended data change | **Met.** §8 |
| 9 Repository tests and typecheck | **Met for this work.** Typecheck passes; every relevant suite passes. The full suite's only 3 failures are pre-existing and unrelated (§7) |
| 10 Production changes independently verified | **Met.** Catalogue, direct-call and rolled-back trigger probes (§2) |
