# WP04 — OG server-side memory deletion

## Every writer, reader and deleter found

`memory_items` (server side), by file:

| Role | Location |
|---|---|
| Reader (list panel) | `src/og/lib/memories.functions.ts` → `listMemories` (limit 500, importance/updated order) |
| Reader (update path) | `memories.functions.ts` → `updateMemory` (reads `context` before patching) |
| Reader (universe view) | `src/og/lib/universes.functions.ts:102` |
| Reader (context band) | `src/core/memory/providers.ts` → `SupabaseMemoryProvider` (mirror) |
| Writer (mirror) | `SupabasePersistence.persistMemories` (upsert by `(id,user_id)`) |
| Writer (panel edit) | `memories.functions.ts` → `updateMemory` |
| Writer (universe attach) | `memory_universes` upsert (separate table) |
| Deleter | `memories.functions.ts` → `deleteMemory` |
| Background sync | `attachRuntime` → `persistMemories` after `recallAll()` |

Nothing else writes memory rows: the OG archive table `legacy_memories` is
written by nothing in v1.1 (verified by search) — it is the migrated OG
`memories` table, kept as history.

## What changed

`deleteMemory` now calls `erase_memory` instead of a bare `DELETE`, so the OG
screen produces the same server-side evidence as the main app, atomically. The
signed-in server client carries the user's JWT, and the function scopes to
`auth.uid()` — RLS is not relied on as the only guard. On a deployment without
the migration it falls back to the delete and returns `tombstoned: false`
instead of implying protection it does not have.

`legacy_memories` cannot be deleted from (no write path, and deleting frozen
history would be a destructive change nobody asked for). Instead the one place
it becomes context — `OgArchiveProvider.context()` — filters items that quote a
deleted memory through `DeletionGuard.quotes`. Test `H` covers it: the archived
quote is excluded, unrelated archive content still reaches context.

## Acceptance

| Requirement | Result |
|---|---|
| Authenticated deletion removes the user's record | implemented (RPC + fallback); live **BLOCKED** |
| Other users untouched | SQL `G4`: PASS |
| Stale records cannot be rehydrated | SQL `B1–B3`, `D3` + client adoption: PASS |
| Deleted records excluded from provider payloads | test `H` + M22.6 payload gate: PASS |
| Failures surfaced | `tombstoned:false`, `ok:false` + panel copy: PASS |
| New session cannot recall it | **BLOCKED** with the live sequence |

The OG *screen* was not clicked through in a browser this mission: it requires a
signed-in session, which is the same blocker.
