# WP02 — Universal cloud deletion

## The gap, precisely

`SupabasePersistence.forgetMemory` (M22.6) issued
`delete().eq("id", id).eq("user_id", userId)`. The row went; nothing recorded
that it had existed. `persistMemories` upserts by id, so any client that still
had the record — another device, a delayed retry, a tab that never saw the
deletion — re-created it on its next sync. Hydration on a third device then
merged it back as ordinary memory.

## What was implemented

**1. One atomic server operation** (`supabase/migrations/202611200001_memory_tombstones.sql`):

```sql
create or replace function public.erase_memory(p_id text, p_fingerprint text default '')
returns integer language plpgsql security definer set search_path = public as $$
declare removed integer := 0; uid uuid := auth.uid();
begin
  if uid is null then raise exception 'authentication required' using errcode = '28000'; end if;
  insert into public.memory_tombstones (user_id, memory_id, fingerprint, source, deleted_at)
  values (uid, p_id, coalesce(p_fingerprint, ''), 'rpc', now())
  on conflict (user_id, memory_id) do update set deleted_at = now(), fingerprint = ...;
  delete from public.memory_items where id = p_id and user_id = uid;
  get diagnostics removed = row_count;
  return removed;
end $$;
```

Tombstone first, then delete: it holds even when the row never reached the
server. `auth.uid()` is the only owner used, so the function cannot reach
another user's rows (verified: G4).

**2. Client path** — `SupabasePersistence.forgetMemory(id, fingerprint)` calls
the RPC and returns `{ ok, removed, tombstoned, reason }`. A bare `DELETE`
remains only as a fallback for a deployment without the migration, and reports
`tombstoned: false` so the caller cannot claim the stronger guarantee.

**3. Durable retry** — `DeletionLedger` gained an outbox in the same storage
namespace (`lelu.memory.deletions.outbox.v1`), bounded at 200 ids, idempotent per
id, with at most 8 attempts each. It is flushed after hydration (`void`, so
sign-in does not wait) and on demand via `AIService.flushUnconfirmedDeletions()`.
There is no timer and no unbounded loop.

**4. Honest reporting** — `AIService.forgetMemory` returns `cloud`, and the
Memory panel says one of four things: cloud copy removed and cannot be restored;
removed but this deployment cannot block a stale re-upload; still there and
queued; no cloud copy (not signed in). It never reports a local delete as a
universal one.

**5. Local first** — the local deletion completes regardless of the cloud. A
failure changes a sentence in the panel, never the outcome of the deletion.

## Verification

| Claim | How | Result |
|---|---|---|
| Erasure goes through the RPC, not a bare delete | test `A` | PASS |
| Missing function → row deleted, `tombstoned:false` | test `B` | PASS |
| Failure queues, persists, retries after reconnect | test `C` | PASS |
| Retries bounded at 8, exhausted entry stays visible | test `D` | PASS |
| Queueing twice keeps one entry | test `E` | PASS |
| Deleted id withheld from upload | test `G` | PASS |
| Signed out is not queued | test `K` | PASS |
| Idempotent server side | SQL `E1–E3` | PASS |
| Ownership | SQL `G3`, `G4` | PASS |
| **Live, against the project** | `probe/live-probe.mjs` | **BLOCKED** — sign-in rejected |

The live half is blocked by the credential, described in `WP07`. Nothing here
claims the cloud path works in the project; it claims the code path is
implemented, unit-tested and its SQL is executed by a real Postgres.
