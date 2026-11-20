# M22.7 — security review

Scope: the M22.7 diff (1 migration, 1 new test file, 6 touched source files,
3 probe scripts, this evidence package). Reviewed against the mission's list.

## Secrets

* Credentials are read from `process.env` only. Nothing is hardcoded, printed,
  committed or exposed through a `VITE_` variable.
* Probes print presence and length (name lengths, never values), a public
  project host, the user's UUID, and response bodies with JWT-shaped strings
  redacted (`/eyJ…/ → <jwt>`). `evidence/auth-endpoint.json` contains no
  credential material.
* The migration contains no secret. `SUPABASE_ANON_KEY` is a publishable key by
  design (verified: `sb_publishable`, 46 chars) and was used exactly as a browser
  would use it.
* `git status` was checked before commit; `.env.local` is ignored and untouched.

## Authorization

| Path | Guard |
|---|---|
| `erase_memory` | `auth.uid()` is the only owner used; `delete … and user_id = uid`; raises 28000 with no session. `revoke … from public, anon`; `grant … to authenticated`. |
| `memory_items` delete → tombstone trigger | `security definer`, writes only `OLD.user_id`/`OLD.id` from the row being deleted. |
| `memory_items` insert/update → resurrection trigger | reads `NEW.user_id`; cannot be spoofed into refusing another user's insert. |
| `memory_tombstones` | RLS owner policy for `all` with `using` and `with check`. |
| OG `deleteMemory` | `requireSupabaseAuth` middleware, user-scoped client, RPC scoped by `auth.uid()`. |
| Client outbox | per-device storage, contains ids and hashes only. |

A `security definer` function is the main new attack surface, so it was written
to take no owner parameter: the only identity it can act as is `auth.uid()`. SQL
`G4` proves that calling it with another user's row id removes nothing.

## RLS

Live: anonymous read of `memory_items` returns `200 []`, and a deliberately wrong
key returns `401 Invalid API key` — so the empty result is policy, not a broken
request. SQL: `G1` (A sees only A), `G2` (A cannot see B's tombstones), `G3`
(forged `user_id` insert refused by the with-check).

## Resurrection surfaces

1. **Direct re-upload** → trigger raises `memory_deleted` (SQL `B1`).
2. **Upload of a never-synced id** → tombstone exists anyway (SQL `D1–D3`).
3. **Hydration merge** → ids adopted before merge; store refuses tombstoned ids
   (test `F`, M22.6 `PatternMemory.add`).
4. **Derived stores** → scrubbed at the outbound seam (test `L`, `scrubDeep`).
5. **Archive provider** → filtered at the seam (test `H`).
6. **Background agents** → machine-written records quoting a tombstone are
   refused (M22.6, unchanged).

## Bounds

Outbox 200 ids, 8 attempts each, one pass per flush, no timer. Tombstone index
cached and invalidated on change. `scrubDeep` bounded to depth 6 / 2,000 nodes.
`read()` already caps pages per table (200) and per-table hydration time (15 s).

## Destructive operations

None. The migration adds a table, two triggers and one function — no `drop`, no
column removal, no data rewrite. No production project, table or row was touched;
the only writes in this mission were to the harness's own in-memory Postgres and
to synthetic test rows in the dev project's *scripted* sequence, which never ran.

## Residual risks

* The client can still be offline forever: the queue then never drains. It stays
  visible in `memoryIntegrityStatus().cloud.pendingDeletions` rather than being
  reported as finished.
* Transcripts keep the text on disk by policy (WP06) and rely on the read gate.
* `legacy_memories` cannot be deleted from; it is excluded, not erased.
* If the migration is applied to a deployment that already has tombstoned ids in
  flight, those ids cannot be re-created — intended, but worth announcing.
