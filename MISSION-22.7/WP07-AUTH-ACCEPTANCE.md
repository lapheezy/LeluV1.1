# WP07 — Authenticated cross-session and cross-device verification

## Result: BLOCKED at sign-in

The mission's live sequence (tests A–G) could not run. The supplied credential is
rejected by the project before any test begins.

### What was verified live (real requests, real project)

`evidence/auth-endpoint.json`, captured 2026-11-20:

| Check | Request | Result |
|---|---|---|
| Auth service up | `GET /auth/v1/health` | **200** `{"version":"v2.198.0","name":"GoTrue"}` |
| Project + key are a matched pair | `GET /rest/v1/memory_items` with the supplied key | **200** `[]` |
| A wrong key is distinguishable | same request, deliberately invalid key | **401** `Invalid API key` |
| Anonymous access is denied by RLS | the 200 above returned **no rows**, not an error | RLS is on |
| Test-user sign-in | `POST /auth/v1/token?grant_type=password` | **400** `invalid_credentials` |

The 401 on a wrong key is the important control: it proves the supplied key is
issued for `ugshflwlyakipeduifkd`, so the failure is the credential, not the
configuration. Anonymous reads returning `[]` rather than rows is live evidence
that the owner policy is active.

### Why the sequence cannot continue

`signInWithPassword` returns `Invalid login credentials` — the password is wrong
for that address, or the account does not exist in this project (Supabase returns
the same message for both, deliberately). That is as far as any probe can go
without the real password, and creating an account is explicitly forbidden.

A second, independent blocker: **applying the migration needs a credential this
session does not have.** `memory_tombstones`, the triggers and `erase_memory`
exist only as a file in the repository. A publishable key cannot run DDL, and a
service-role key is prohibited by the brief. Until that migration is applied,
`erase_memory` does not exist on the project and the app correctly falls back to
a plain delete and reports `tombstoned: false`.

### What would have to happen for the live sequence to run

1. A working `SUPABASE_TEST_USER_PASSWORD` (or a corrected email) in the
   session's secret configuration.
2. The migration applied to `lelu-v11-test` — via the dashboard SQL editor,
   pasting `supabase/migrations/202611200001_memory_tombstones.sql`, or via the
   CLI with a database password.

Then:

```bash
node MISSION-22.7/probe/live-probe.mjs        # session, schema discovery, RLS
node MISSION-22.7/probe/live-acceptance.mjs   # tests A–G (not run; written, see below)
```

## Status of each test

| Test | What it would prove | Status |
|---|---|---|
| A authenticated deletion | local delete, remote tombstone, query finds nothing | **NOT RUN** (blocked) |
| B new session | hydration does not return it | **NOT RUN** (blocked) |
| C stale upload race | captured pre-deletion payload cannot resurrect | **NOT RUN** (blocked) |
| D cross-device | client B cannot regain it | **NOT RUN** (blocked) |
| E ownership isolation | A cannot read/update/delete B's rows | **PARTIAL** — SQL-level `G3`/`G4` pass; live needs a second identity |
| F user restatement | new statement processed, old not recalled | **NOT RUN** (blocked) |
| G interrupted deletion | local durable, cloud retried, no false "complete" | **PARTIAL** — retry/bounded/exhausted covered by tests `C`/`D`; live network cut not possible without a session |

No live claim is made anywhere in this package. Implementation-level and
SQL-level evidence is labelled as such.
