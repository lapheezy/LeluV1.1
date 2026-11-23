# Quarantine and human review (WP04)

## What stayed exactly as it was

M22.5's judgement is preserved: a legacy checkpoint the ledger cannot vouch for is
**not** deleted. It is reported for a person to Forget or Keep. The recognisable
shape is unchanged:

> description starts with `Auto-created for `, the checkpoint has a non-empty
> summary, and no pending step, blocker or next action.

That shape is a checkpoint written by the old answered-turn writer, not project
state. Anything else ambiguous is left entirely alone — the migration only ever
acts on tombstone-proven text.

## What changed, and why each change was needed

### 1. The persisted report no longer contains record text

M22.5 stored an 80-character `preview` in `lelu.memory.migration.v1` for every
quarantined record. That is a quote of user text sitting in a maintenance key,
which the mission forbids ("avoid storing deleted plaintext in quarantine
metadata"). It was also useless after the fact: the record still exists.

Now:

- the **live** result keeps `preview`, because the review surface must let a
  person recognise what they are deciding about;
- the **persisted** report stores `preview: ""` plus `tokens` and the location;
- `ResidueMigration.scrubLegacyPreviews()` rewrites a report written by M22.5 or
  by an earlier M22.6 build, removing previews already on disk.

Verified: `verification.json` scenario F asserts the stored report does not
contain the record's text ("tide tables"); test I asserts the same for the
winter-market checkpoint.

### 2. Decisions live in their own store

Before, "keep" was stored as a `dismissed` array inside the report, and "forget"
was a `reviewed` id array in a key derived from it. Any later applied run rewrote
the report — so a decision could be lost by an unrelated migration.

Now `lelu.memory.migration.reviews.v1` holds `{ projectId, action, at }` entries,
appended on every review, never rewritten by a scan. The report's `dismissed`
array is still populated for compatibility, but it is no longer the source of
truth. A review write that fails raises `ResidueStorageError`, so the UI cannot
say "kept" when nothing was stored.

Verified: test I reads the disposition log, and scenario F confirms
`dispositionLogged: true`.

### 3. The record is not asked about twice

`dismissedIds()` is the union of the review store's `keep` entries and the
legacy report array, keyed `<projectId>:checkpoint`. After a Keep, the same
record is excluded from `quarantined` on the next dry run — test I
(`stillAskedAfterKeep: false`), scenario F.

The stable-id trade-off is deliberate: if a project's legacy checkpoint is
replaced by a new one, the Keep still suppresses it. Re-asking about a record the
user already decided about is the worse failure, and the record is in any case
never deleted by Keep.

### 4. Forget removes the checkpoint only

`review(projectId, "forget")` → `ProjectStore.clearCheckpoint(id)`. The project,
its items, notes, tasks, blockers and timestamps are untouched; the reviewed id is
recorded. Verified: test I (`projects.get(forgotten.id)` still exists,
`checkpoint === undefined`), scenario F.

## Neither choice restores recall

This is the acceptance point that matters more than the buttons:

- Quarantined text has **no tombstone**, so it is not provably deleted content.
  It is still user data the user chose to keep or forget.
- **Keep** leaves the checkpoint in place. Its text is not a deleted statement;
  if it later matches a tombstone (because the user deletes the memory it
  quotes), the recall guard drops it immediately and the next healing run cleans
  it.
- **Forget** removes the checkpoint, and the text is gone from the store.

So a choice made here cannot re-open a path to a deleted memory: if the content
is deleted content, the ledger — not the choice — is what blocks it.

## Deliberately not added

No separate quarantine status index, no new table, no per-record state machine.
The existing report plus one disposition log is enough for the requirements
(identify, explain, decide, persist, don't repeat), and the mission explicitly
asks not to add architecture that is not needed.
