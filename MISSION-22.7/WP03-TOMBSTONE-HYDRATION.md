# WP03 — Server-side tombstones and hydration protection

## Server-side evidence

`public.memory_tombstones (user_id, memory_id, fingerprint, source, deleted_at)`,
primary key `(user_id, memory_id)`, RLS owner policy on `user_id = auth.uid()`.
It stores the id, an optional fingerprint hash and a timestamp — **never the
statement**. Two triggers make it automatic:

* `memory_items_record_tombstone` — `after delete`, writes the tombstone in the
  same transaction, so a delete cannot commit without its evidence.
* `memory_items_refuse_resurrection` — `before insert or update`, raises
  `memory_deleted` for a tombstoned `(user_id, id)`.

## Proven by execution, in real Postgres

`probe/sql-verify.mjs` boots PGlite (Postgres in WASM), recreates the live
`memory_items` shape, applies the migration verbatim with a stubbed `auth.uid()`,
and runs 20 checks — `evidence/sql-tombstones.json`, **20/20 passed**:

| id | what it proves |
|---|---|
| A1–A3 | a delete writes its tombstone in the same transaction, with the hash and not the text |
| B1–B3 | re-inserting the deleted id is refused (`memory_deleted`) and the row does not appear |
| C1 | another user may use the same id — deletion is per user |
| D1–D3 | `erase_memory` tombstones an id that has **no row**, so a later upload of a never-synced memory is refused |
| E1–E3 | idempotent; a repeat keeps one tombstone and does not erase the stored fingerprint |
| F1 | no session → `authentication required` (28000) |
| G1–G4 | RLS: own rows only, other users' tombstones invisible, cannot insert under another `user_id`, cannot erase another user's row |
| H1–H2 | no tombstone holds the statement, and the row is gone |

This is **SQL-level** verification, not live Supabase: `auth.uid()` is stubbed,
and the roles are created by the harness. It is labelled that way everywhere.

## Hydration protection, in the application

`hydrateCoreStores` now reads `memory_tombstones` **concurrently** with the nine
data stores, then:

1. `DeletionLedger.adoptRemote(ids)` — a fresh browser learns deletions it never
   performed (ids only, no text, no windows).
2. Filters `memory_items` rows against adopted + local tombstoned ids before
   mapping, so a row that survived an older schema cannot be merged.
3. `brain.mergeMemories` → `PatternMemory.add`, which already refuses a
   tombstoned id (M22.6).

Order matters and is covered by test `F`: adoption lands before the merge, so
the deleted id never enters the store even for one turn.

## Conflict and versioning

Deletion wins unconditionally: there is no timestamp comparison to get wrong.
A tombstoned id can be inserted by nobody, including the owning user, which is
the property that makes an out-of-order or delayed upload harmless. A stale
hydration simply never sees the row.

## Cross-device consistency

The mechanism is complete on the server, and the client adopts it on sign-in.
Whether it holds for a second real device is part of `WP07` and is **BLOCKED**
with the rest of the live sequence.
