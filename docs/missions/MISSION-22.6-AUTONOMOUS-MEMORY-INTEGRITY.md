# MISSION 22.6 — Autonomous Memory Integrity & Deletion Propagation

**Status:** implemented, independently verified, committed on an isolated branch.
**Classification:** P0 data integrity / memory governance.
**Parent mission:** M22.5 historical memory residue.
**Implementation baseline:** `42a3606` (M22.5 implementation), start commit `12d2407`.
**Working branch:** `m22.6/memory-integrity-deletion-propagation` (`3882c41…`).
**Canonical branch at start:** `main` = `44bdd936892bc989b6b59fd5ecfb9502747e6a58`.
No merge, no pull request, no canonical push was performed.

Full evidence: `MISSION-22.6/` (12 documents + verification, browser, regression
and inventory JSON + two screenshots).

---

## 1. The result in one paragraph

Forgetting used to be a UI event: a person had to open the Memory panel and press
a button for M22.5's proven remediation to run, and a deleted statement could
still reach the model from a project checkpoint, a conversation turn or a
different memory record. M22.6 makes forgetting a system-wide data-integrity
operation. Every client deletion pathway records a durable fingerprint before the
record leaves memory; a single authority (`DeletionGuard`) filters recall,
cognitive context, self-study sources, dialogue turns and the final provider
payload; a boot-time healer removes provable historical copies automatically, in
bounded idle batches, resumably and exactly once; ambiguous records remain
quarantined for the user. A real browser run captured a 28,752-byte provider
request that contained the project-checkpoint section and the project's name but
**zero** occurrences of a phrase that was still present in storage — the gate, not
the cleanup, kept it out.

## 2. What was implemented

### WP01 — Automatic boot-time healing

`src/core/memory/MemoryHealing.ts`, wired as a new `memory-integrity` step in
`src/core/Bootstrap.ts` after the runtime step (stores up, before services).

- Schedules on `requestIdleCallback` (1.5 s fallback); never awaited by startup.
- Batches of 25 projects; a batch measures 1.65–2.24 ms on a 1,000-project store.
- Dry run first per window; applies only what the dry run just proved.
- Cursor lives in the migration's durable progress key; resumes after a restart.
- Cross-tab lease (60 s, stale takeover) prevents concurrent healing.
- Idempotent per page load and under StrictMode double-mount.
- Failures recorded as `state: "failed"` with a reason, never thrown at boot.

Observed: two real restarts, `complete`, 1 field cleaned each, 2 ms and 1 ms.

### WP02 — Universal deletion propagation

- `Brain.forgetMemory`: tombstone written **before** removal, no await in between;
  withdrawn if the removal fails (compensation, not a stuck tombstone).
- `Brain.forgetConversation`: records a tombstone for every removed record in one
  ledger write (`DeletionLedger.recordMany`).
- `Brain.reset`: same, before `PatternMemory.clear`.
- `SupabasePersistence.forgetMemory(id)`: deletes the cloud mirror row, contained
  and best-effort, called from `AIService` for single and conversation deletion.
- `PatternMemory.add`: refuses machine-written records that quote a tombstone, and
  refuses any record whose id is tombstoned (hydration cannot resurrect a delete).
- Ledger writes that fail raise; the panel tells the user the deletion cannot be
  proven instead of claiming a clean forget.
- Supersession/merge and project/checkpoint lifecycle are documented as ordinary
  lifecycle, not deletions.

### WP03 — Persistence inventory

18 pathways documented in `MISSION-22.6/persistence-inventory.json`, combining a
static sweep with a runtime enumeration of 44 localStorage keys, 3 IndexedDB
databases, 0 Cache Storage entries and 0 service workers. 7 covered, 5 partial, 3
explicitly unaudited, 3 not memory-derived. Notable negatives verified: the
service worker never caches non-GET responses, and the model broker log carries no
prompt text.

### WP04 — Quarantine

Unchanged judgement (never auto-delete ambiguity). Improvements: persisted
quarantine metadata no longer contains record text (`scrubLegacyPreviews()`
upgrades old reports), review dispositions live in their own durable store, a Keep
is not asked about again, Forget clears only the checkpoint, and neither choice can
re-open recall.

### WP05 — Recall and context integrity

`src/core/memory/DeletionGuard.ts` is consulted at: recall, checkpoint assembly,
project names/queries, self-model knows/goals, `ProjectIntent`, `CognitiveLoop`,
`OutcomeDerivation`, `CosmosInspector`, `formatCognitiveContext` (final backstop),
`MemoryBridge` merged context (all providers including the external archive) and
`MemoryBridge` dialogue turns. Removal is sentence-granular and never rewrites
storage. Cost: 0.154 ms per 40-line assembly.

### WP06 — Reliability and performance

Report v2 (scanned / removed / quarantined / skipped / persisted), cursor
validation with restart-on-corruption, per-project failure isolation, write-failure
honesty, preview stripping, disposition store, `advanceCursor`, one tombstone index
per run, and removal of an O(projects²) re-read. Measured on 1,000 projects /
3,000 fields: dry run 1,585.66 ms → 8.25–10.67 ms; apply 1,637.55 ms → 60.5–65.2 ms;
boot sweep 1,726 ms → 134–135 ms; matcher 8.99–9.26× faster with identical answers.

### WP07 — Independent verification

`MISSION-22.6/verify-integrity.ts` runs the real modules against in-memory storage
and asserts on persisted bytes, not counters. Ten scenarios (A–J) all pass.

## 3. Acceptance gates

| Gate | Status |
|---|---|
| G1 Source / branch integrity | VERIFIED |
| G2 Complete persistence inventory | PARTIALLY VERIFIED (3 paths unaudited by design of scope) |
| G3 Boot-time migration | VERIFIED |
| G4 Universal deletion tracking | PARTIALLY VERIFIED (cloud implemented/unproven; OG uncovered) |
| G5 Durable tombstone persistence | VERIFIED |
| G6 Safe quarantine | VERIFIED |
| G7 Recall / context protection | VERIFIED |
| G8 Provider payload verification | VERIFIED (real 28,752-byte payload, 0 occurrences) |
| G9 Resumability | VERIFIED |
| G10 Idempotence | VERIFIED |
| G11 Concurrency safety | VERIFIED |
| G12 Storage failure recovery | PARTIALLY VERIFIED |
| G13 Performance | VERIFIED |
| G14 Independent verification | VERIFIED |
| G15 Regression | VERIFIED (2,398 / 2,388 / 2 pre-existing) |
| G16 Evidence package | VERIFIED |
| G17 Commit / remote | VERIFIED (see `MISSION-22.6/commit.txt`) |

## 4. Risk register

| id | Risk | Severity | Mitigation / status |
|---|---|---|---|
| R1 | Pre-ledger deletions (before M22.5) cannot be proven | Medium | unchanged from M22.5; quarantine only for the recognisable legacy shape |
| R2 | Fingerprint collision causes over-removal of an unrelated sentence | Low | documented (L8); failure direction is over-removal, never under-removal |
| R3 | Cloud mirror row survives when offline | Medium | id un-restorable + text filtered; delete is best-effort (L6) |
| R4 | Conversation transcript retains the statement | Medium | recall blocked by the payload gate; transcript not rewritten (L2) |
| R5 | Derived stores retain text on disk | Medium | filtered at read (L3) |
| R6 | Telemetry/profile keys may echo user text | Medium | unaudited (L4) |
| R7 | OG server-side deletion has no tombstone | Medium | documented (L7) |
| R8 | Retyping the fact re-creates a memory | Low | deliberate (L1) |
| R9 | Sentence-granular removal takes a neighbouring fact | Low | deliberate (L9) |
| R10 | M22 lineage cannot fast-forward into the integration branch | Process | owner decision required (L12) |

## 5. Recommendation

Conditional pass: promote the branch for review and merge decision. Do not claim
universal memory deletion while three pathways remain uncovered and the cloud path
is unproven. No merge or promotion was performed.
