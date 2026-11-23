# MISSION 22.5 — HISTORICAL MEMORY RESIDUE ELIMINATION

**Mission type:** memory lifecycle integrity, historical migration, independent verification
**Priority:** P0
**Branch:** `freebuff/m22-5-historical-memory-residue`
**Canonical base:** `363312b` (M22.4 implementation). Branch created at `e7521b9`, which contains `363312b` and adds only display copies of the M22.4 screenshots.
**No merge, no pull request.**

---

## 1. The guarantee this mission establishes

> When a user deletes a memory, every subsystem must respect that deletion — including historical derived artifacts — without destroying information the user did not ask to delete.

That guarantee now has a mechanism and proof:

- every deletion leaves a **tombstone** (hashed token windows, provenance ids, never the text);
- a **migration** removes project text that a tombstone proves quotes a deleted memory, and nothing else;
- a copy it cannot prove is **quarantined for the user** — Forget or Keep — never guessed at or blanket-deleted;
- the migration is **dry-run first, idempotent, resumable**, and records what it did;
- a **fresh prompt after reload and after an application restart** carries none of it, verified in a real browser against real provider requests.

## 2. Repository audit — what can hold memory-derived text

Full inventory with provenance, persistence, ownership, deletion pathway and risk: `MISSION-22.5/residue-inventory.json`. Data-flow diagram: `MISSION-22.5/data-flow.md`.

| Carrier | Persistence | Deletion pathway | Verdict |
| --- | --- | --- | --- |
| IndexedDB `lelu-memory/memories` | reload + restart | `PatternMemory.remove` | handled (M22.4) |
| `lelu.projects.v1` checkpoints | reload + restart | `forgetText` (M22.4), migration (M22.5) | **the defect site** |
| `lelu.projects.v1` project text + items | reload + restart | migration matches only tombstoned text | handled |
| workspace observations | in-memory | `WorkspaceManager.forgetMemory` | handled |
| knowledge graph | in-memory | `CognitiveCore.forgetMemory` | handled |
| cognitive trace | in-memory, dev | not injected | no carrier |
| synthesizer output / reflection | rebuilt per turn | no cache exists | no stale copy |
| conversation transcript + activity | reload + restart | conversation deletion only | **intentionally preserved** |
| tasks / background / tool ledgers | reload (bounded) | user work records, not memory copies | out of scope, documented |
| deletion ledger (new) | reload + restart | append-only, not readable | proof, not a copy |
| migration report (new) | reload | overwritten per run | audit |

**The gap M22.5 exists to close:** before this build, nothing durable recorded *that* a memory had been deleted. `Brain.forgetMemory` wrote a dev-only, in-memory trace entry with a truncated id and no text. So for a deletion that happened earlier, no stored artifact can prove which text belonged to the deleted record. M22.4 could clean only what existed at the moment of deletion; it said so, and left the residue.

## 3. Implementation

### 3.1 Deletion ledger — `src/core/memory/DeletionLedger.ts`

`Brain.forgetMemory` reads the record before removal, then records:

- the memory id, timestamp and originating conversation id (provenance for audit);
- hashes of overlapping 6-token windows of the statement (bounded to 48 windows, 400 entries).

No statement, token, or reversible form is stored. Statements shorter than 4 tokens are not fingerprinted at all: they identify nothing and would match half the language (`tests/memory-residue.test.ts` H).

### 3.2 Residue migration — `src/core/memory/ResidueMigration.ts`

`run({ dryRun = true, limit })` scans every project's text fields and checkpoint fields, plus item titles/text/refs:

- **tombstone match** → the field quotes a deleted memory → redact it (summary emptied, entry filtered, optional project field dropped, quoting item removed, checkpoint dropped if emptied);
- **legacy auto-checkpoint with no match** → `quarantined` for the user, listed with an 80-character preview;
- everything else is untouched, byte for byte.

Guarantees:

- **dry run writes nothing** (tested by comparing the raw store string before/after);
- **targeted**: no project, name, timestamp, unrelated field or item is touched;
- **idempotent**: a second executed run writes the identical store;
- **resumable**: with `limit`, projects are processed in id order and a cursor is stored in `lelu.memory.migration.progress.v1`; the next call continues and accumulates, and only clears the cursor when the last project is reached;
- **auditable**: the executed report (counts, per-tombstone removals, quarantine previews, dismissed ids) is stored in `lelu.memory.migration.v1`.

### 3.3 Explicit review

`ProjectStore.clearCheckpoint(id)` clears one checkpoint and nothing else. The Memory panel surfaces quarantined checkpoints with **Forget** and **Keep**; Keep records a dismissed id so it stops being reported. The migration never calls this itself.

### 3.4 Memory panel

A single compact block under the memory list, refreshed on open and after every deletion:

```
Historical residue · N project(s) scanned · X quote(s) of deleted memories · Y checkpoint(s) to review
[preview]                                    [Forget] [Keep]
[Remove X provable quote(s)]
```

No redesign: same frame, same list, same delete controls.

## 4. Independent verification

Executable evidence, not the migration's own claims: `MISSION-22.5/verify-residue.ts` (run command in its header) asserts against the **serialized persisted store**; output in `MISSION-22.5/verification.json`. Unit suite: `tests/memory-residue.test.ts` (8 tests). Browser evidence: `MISSION-22.5/browser-evidence.json` plus five screenshots.

| Scenario | Result |
| --- | --- |
| **A** create memory → legacy checkpoint quotes it → delete → migrate → inspect persisted checkpoint | PASS — dry run found 1, wrote nothing; execution removed 1 field; `lelu.projects.v1` no longer contains the phrase; an unrelated checkpoint and its pending work still do |
| **B** restart persistence | PASS — after deleting the dev server and reloading, the persisted store still has no phrase; a fresh chat's 4 provider requests contained 0 occurrences, and the transcript still holds the user's own words (by design) |
| **C** partial migration | PASS — `limit:1` stopped with a cursor and 1 cleaned; next call resumed, total 2; final call completed at 3; every project kept its own pending step and next action |
| **D** unrelated information | PASS — pending, completed, blockers, next action, a note and a second checkpoint survived unchanged while the quoted summary was emptied |
| **E** deletion + migration + recall concurrently | PASS — the copy that raced the deletion did not survive; recall returns nothing |
| **F** cross-chat integrity | PASS — the M22.4 boundary fix and own-turn exclusion still hold; a similar title sharing one word is not attribution; the migration touched no conversation |
| **G** idempotency | PASS — second executed run cleaned 0 and left the store string identical |
| **H** short statements | PASS — under 4 tokens no fingerprint is recorded |

Additional unit tests: quarantine is never auto-deleted (E); Keep dismisses without deleting, Forget clears only the checkpoint and preserves the project; the ledger contains neither the phrase nor words from the statement.

## 5. Browser proof (the real application)

Origin `pv-…f58f9974….style.dev/?scene=off`, real Chat Universe + Memory module, same-origin provider broker (OpenRouter `nvidia/nemotron-3-ultra-550b-a55b:free`, HTTP 200).

1. Created the memory through chat (`COPPER-LANTERN-77`); panel showed it (`Memory · 7 stored`).
2. Deleted it through the panel: “Memory deleted…”, listing empty, tombstone written.
3. A pre-M22.4-shaped checkpoint quoting it was present in `lelu.projects.v1` (see limitation below), the store contained the phrase.
4. Reload → panel dry run: **4 projects scanned · 1 quote · 1 checkpoint to review**; storage unchanged.
5. Panel **Remove 1 provable quote(s)** → notice; persisted store **no longer contains the phrase**; the unrelated legacy checkpoint is still there and still quarantined.
6. **Forget** on the quarantined checkpoint → residue 0/0; project and name preserved.
7. Dev server stopped and restarted, page reloaded → still absent; fresh conversation → **0 occurrences in 4 requests**, no `RESEARCH FROM OTHER CHATS` block; reply: “I don't have that in this chat's memory. There's a related chat … but it's not authorized for use here. Want me to bring that chat in?”

Screenshots:

- `01-before-migration-memory-panel.png`
- `02-identified-residue-dry-run.png`
- `03-migration-executed.png`
- `04-after-migration-and-review.png`
- `05-after-restart-fresh-chat.png`

**Limitation, stated plainly:** the legacy checkpoint here was written into the store in the old writer's exact shape by the verification harness, because the M22.4 browser profile belonged to an older preview origin and a new runner assigned a new origin. The migration, the storage inspection, the restart and the payloads are the unmodified application; only the historical copy was reconstructed.

## 6. Performance

Measured on the real modules with an in-memory browser (`MISSION-22.5/verification.json`):

| Measurement | M22.4 | M22.5 |
| --- | --- | --- |
| deletion overhead (mean) | 0.10 ms | not re-measured this mission: the path is unchanged plus one bounded ledger write; a separate measurement would be needed to claim a number |
| context assembly (mean) | 1.14 ms | 1.62 ms (10 runs, 60 more checkpoints in the store; within noise of store size) |
| migration, 60 projects / 180 fields, dry run | — | **7.19 ms** |
| migration, same store, executed (20 removals) | — | **10.43 ms** |
| migration, 4 projects (browser) | — | **1 ms** |
| resume granularity | — | one project per `limit` step, cursor persisted |

## 7. Acceptance

| Criterion | Status |
| --- | --- |
| Historical memory-bearing persistence pathways inventoried | **PASS** (`residue-inventory.json`, data-flow) |
| Existing deleted-memory records reliably identified | **PARTIAL** — every deletion from this build on is provable via the ledger; deletions from before it have no durable record, so their copies are quarantined, not guessed |
| Historical residue safely migrated where provenance permits | **PASS** (tombstone-proven only; browser + script) |
| Unrelated project information preserved | **PASS** (D; browser checkpoints/notes/names) |
| Migration repeatable and idempotent | **PASS** (G; byte-identical store) |
| Interrupted migration recovery verified | **PASS** (C with `limit` and cursor) |
| Deleted content cannot reappear in fresh prompts | **PASS** (post-reload and post-restart requests, 0/4) |
| Reload and restart tests pass | **PASS** |
| Cross-chat attribution remains accurate | **PASS** (F + M22.4 suites; related chat offered, never injected) |
| Concurrent deletion and retrieval verified | **PASS** (E) |
| Actual persistent storage inspected | **PASS** (`lelu.projects.v1` before/after, bytes 1526 → 1459; migration report) |
| Visual evidence captured | **PASS** (5 screenshots) |
| Focused regression tests pass | **PASS** (8/8 new; M22.4 suites green) |
| Full regression documented | **PASS** — 2,386 tests, 2,376 pass, 2 fail (same two known failures) |
| Performance overhead measured | **PASS** |
| Unresolved limitations documented | **PASS** (section 8) |

## 8. Residual risk register

| # | Risk | Severity | Mitigation / status |
| --- | --- | --- | --- |
| R1 | Copies of memories deleted **before** M22.5 cannot be proven and are not auto-removed | medium | quarantined auto-checkpoints with explicit Forget/Keep; documented; never guessed |
| R2 | A checkpoint or note that rephrases a deleted statement (no shared 6-token window) is not matched | medium | falls outside proof; remains, is visible to the user as project content |
| R3 | Ledger is bounded at 400 entries; older tombstones are dropped | low | deletion residue is normally cleaned at deletion time; bound is deliberate |
| R4 | Task/job/tool ledgers may quote a forgotten statement | low | they are the user's own work records, same policy as the transcript; not memory copies |
| R5 | Quarantine previews store 80 characters of the reported text | low | deliberate, local, needed for the user to decide; the text is already in the project store |
| R6 | `ProjectStore` is a process singleton; a migration running while another tab writes can lag one write | low | idempotent re-run cleans it; no stale content is injected in between |
| R7 | Fingerprint hashing is FNV-1a 32-bit (collision probability negligible for 6-token windows, not cryptographic) | low | used only to compare windows; no security property relies on it |
| R8 | The migration runs on demand (panel open / button), not automatically | low | deleting always purges (M22.4); migration is for history; report shows outstanding counts |

## 9. Files changed

| File | Change | Why |
| --- | --- | --- |
| `src/core/memory/DeletionLedger.ts` | new | prove deletions without keeping text |
| `src/core/memory/ResidueMigration.ts` | new | dry-run/executed, resumable, targeted migration + quarantine + review |
| `src/core/projects/ProjectStore.ts` | `clearCheckpoint(id)` | explicit review without deleting the project |
| `src/brain/Brain.ts` | record tombstone at deletion | the proof source |
| `src/core/AIService.ts` | `residueReport`, `reviewMemoryResidue` | existing service surface for the panel |
| `src/app/scene/genesis/GenesisMemoryPanel.tsx` | residue block, dry run on open, clean button, Forget/Keep | make lifecycle state visible and reviewable |
| `tests/memory-residue.test.ts` | new, 8 tests | regression coverage A–H |
| `MISSION-22.5/verify-residue.ts` | new | independent, persisted-store assertions |
| `MISSION-22.5/*.json`, `data-flow.md`, `screenshots/` | new | evidence |

## 10. Not verified / honest gaps

- **Native mobile**: no device or emulator; web build only.
- **Pre-ledger deletions**: cannot be enumerated (see R1). The browser demonstrates the quarantine path on a reconstructed pre-fix checkpoint, which is labelled as such.
- **Automatic background migration**: intentionally not run at boot; the panel reports and the user executes. A future mission could schedule it.
- **Other origins/profiles**: one Chromium profile on one preview origin.
- **Storage quotas / private mode**: not exercised; `KvStore` already degrades by design.

Tests: focused **8/8**; full suite **2,386 / 2,376 pass / 2 fail** — the same `genesis-interface` CSS-export and `sandbox-security` network failures as M22.4. Typecheck: 0 new errors (2 pre-existing `FeatureUnderstanding.ts:455`). Commit and remote hash: `MISSION-22.5/commit.txt`.
