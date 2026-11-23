# Universal deletion propagation (WP02)

## The pathways that existed, and what each one did

| Pathway | Entry point | Records a tombstone before M22.6? | After |
|---|---|---|---|
| Single memory from the panel | `AIService.forgetMemory` → `Brain.forgetMemory` | yes (M22.5) | yes, **before** removal |
| Conversation deletion | `AIService.forgetConversation` → `Brain.forgetConversation` | **no** | yes, one bulk ledger write |
| Full memory reset | `Brain.reset` → `PatternMemory.clear` | **no** | yes, one bulk ledger write |
| Supersession / merge | `MemoryEngine.supersede` / `merge` | n/a — lifecycle | still lifecycle: the record survives, the correction wins, the old text is kept as labelled history |
| Project deletion / checkpoint clear | `ProjectStore.remove` / `clearCheckpoint` | n/a — container lifecycle | unchanged; deleting a project is not forgetting a memory |
| Cloud mirror | `SupabasePersistence.persistMemories` | **no** | `forgetMemory(id)` deletes the row |
| OG server-side delete | `src/og/lib/memories.functions.ts` | **no** | still no — outside this store (L7) |
| IndexedDB bulk clear | `PatternMemory.clear` (only caller: `Brain.reset`) | **no** | covered by the reset tombstone |

## The semantics, stated once

1. **Fingerprint before removal.** `Brain.forgetMemory` now records the tombstone
   *before* `memory.remove(id)`, with no `await` between them. Without this there
   was a window — one index-delete wide — in which a checkpoint quoting the
   statement could be read by a context assembly that had no tombstone to match.
2. **Compensation, not a stuck tombstone.** If the removal itself throws, the
   tombstone is withdrawn (`DeletionLedger.discard`). A tombstone for a record
   that still exists would make a live memory unrecallable.
3. **Bulk is one write, not N.** `recordMany` fingerprints every doomed record,
   then writes the ledger once. A 200-memory conversation purge is one storage
   write, not 200 full-ledger rewrites, and cannot leave a half-recorded ledger.
4. **A failed ledger write is visible.** `record`/`recordMany` raise when
   `KvStore.set` returns false. `Brain.forgetMemory` catches it and returns
   `ledgerRecorded: false`; the panel then says the deletion cannot be proven
   later, instead of claiming a clean forget. The record is still removed — the
   deletion is honoured; only its provability is degraded, and the user is told.
5. **No plaintext, ever.** The ledger stores an id, a timestamp, a conversation
   id, hashed six-token windows, the window size and a token count. Tests assert
   that neither the token nor the rest of the statement appears in the stored
   ledger (tests A, B, C).
6. **Deletion is sticky for machine-written memory.** `PatternMemory.add` refuses
   a record that quotes a tombstone when its origin is not `user-said`. Background
   learning and self-study read already-scrubbed context, but a paraphrase could
   still carry a window; this closes that door. A user restating the fact is
   allowed — that is new information, not a leak (test D).
7. **A deleted id is never restored.** Hydration merges `memory_items` back into
   the store. `add` refuses any record whose id is tombstoned, so another device's
   stale row cannot undo a deletion (test L). This was a genuine resurrection path
   found during the persistence audit, not a hypothetical one.

## Cloud mirror

`SupabasePersistence.forgetMemory(id)` deletes `memory_items` row(s) for the id
and the current user, with a timeout and containment. It is called from
`AIService.forgetMemory` (single) and per-id from `forgetConversation`. It is
deliberately `void`-ed: a signed-out or offline device must not turn a completed
local deletion into a failure, and a surviving row is still unrecallable because
the id cannot be restored and the context guard filters its text.

**This path is implemented but not exercised** — there is no Supabase account in
this environment. Recorded as PARTIALLY VERIFIED, not as done.

## Failure semantics summary

| Failure | Behaviour |
|---|---|
| Ledger write fails during delete | record still removed; `ledgerRecorded: false`; UI states the deletion cannot be proven |
| Record removal throws | tombstone withdrawn; error propagates; nothing is half-forgotten |
| Cloud delete fails / offline | contained; local deletion stands; tombstone blocks restoration |
| Migration progress write fails | `ResidueStorageError` raised; no report claims completion |
| One project cannot be read during scan | skipped and counted (`skippedProjects`), never counted as clean |
