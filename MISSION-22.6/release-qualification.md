# Release qualification

## Verdict

**CONDITIONAL PASS — qualify for review and merge decision, not for an
unqualified "memory deletion is solved" claim.**

What qualifies: the client-side lifecycle CREATE → STORE → RETRIEVE → DELETE →
RECORD → PROPAGATE → MIGRATE → VERIFY → PREVENT RECALL is implemented, measured,
and independently verified, including a real provider payload.

What does not qualify: three audited persistence pathways (telemetry/profile
content, OG server-side deletion) and one implemented-but-unproven path (cloud
mirror delete).

## Qualifying checks

| Check | Result |
|---|---|
| Typecheck (`tsc -p tsconfig.app.json --noEmit`) | 2 errors, both pre-existing in `FeatureUnderstanding.ts`; 0 new |
| Production build (`vite build`) | success (5.82 s), only pre-existing dynamic-import notices |
| Lint (`oxlint`, touched files) | 0 errors, 0 warnings |
| Full suite (`npm test`) | 2,398 tests · 2,388 pass · 2 fail (both pre-existing) · 8 skipped · 249 s |
| New memory tests | 12/12 |
| M22.5 residue tests | 8/8 (unchanged) |
| Adjacent memory/context suites | exit 0 |
| Independent verification | 10/10 scenarios, storage-level |
| Browser boot healing | 2 restarts, automatic, 2 ms and 1 ms |
| Provider payload | 28,752 bytes, 0 occurrences, stored copy still present |
| Privacy sweep | no deleted token in any persisted key or the ledger |

## What may be said to a user

- "Deleting a memory removes it from LÉLU's recall immediately, and cleans the
  historical copies that can be proven to quote it — automatically, at the next
  start, without opening a panel."
- "A deleted statement is not sent to the model again, even if a copy still exists
  in a project checkpoint or an older conversation."
- "The deletion is recorded as a fingerprint (never the text), so it remains
  provable after a restart."

## What may not be said

- "Every copy is gone everywhere." Not true: transcripts, derived stores and
  unaudited telemetry keys may still hold text, and the OG surface has no ledger.
- "The cloud copy is verified deleted." Implemented and contained, not tested
  against an account.
- "Fingerprint matching is cryptographic proof." It is evidence, with a
  documented over-removal failure mode.

## Rollback

- The branch is isolated at `12d2407`; `freebuff/m22-5-historical-memory-residue`
  and `main` are untouched.
- No schema migration, no destructive rewrite, no data format change: the new
  keys (`memory.healing.v1`, `memory.migrations.reviews.v1`, guard counters) are
  additive, and the ledger key is unchanged from M22.5.
- The migration's own report is versioned (`version: 2`); an M22.5 report remains
  readable, and `scrubLegacyPreviews()` upgrades it in place.
- Reverting the branch restores M22.5 behaviour exactly (panel-triggered
  migration), with no orphaned data that would break the app.

## Pre-merge actions recommended

1. Run the cloud mirror delete against a real account (closes L6).
2. Decide the OG deletion policy (closes L7).
3. Audit telemetry/profile keys for user text (closes L4).
4. Owner decision on how M22.6 reaches `integration/m16-3-wp05-reconciliation`
   given the divergent histories (L12).
