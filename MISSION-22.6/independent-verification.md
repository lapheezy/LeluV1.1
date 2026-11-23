# Independent verification (WP07)

## How this is independent

The harness (`verify-integrity.ts`) does not trust any component's report. It
reads the storage shims directly — the JSON in `localStorage` and the rows in the
IndexedDB map — and asserts about **what is stored**, not about counters. It
imports the real modules (Brain, ProjectStore, ResidueMigration, MemoryHealing,
DeletionGuard, DeletionLedger, PatternMemory) with no mocks of those systems.

Run:

```
npx tsx --tsconfig tsconfig.test.json --import ./tests/support/ignore-css.mjs \
  MISSION-22.6/verify-integrity.ts > MISSION-22.6/verification.json
```

Exit status 0, `pass: true`, all ten scenarios complete.

## Results

| Scenario | What was demanded | Observed | Verdict |
|---|---|---|---|
| **A** Ordinary deletion | create → delete → inspect IndexedDB → inspect ledger | `removed: true`, `ledgerRecorded: true`, `indexedDbRows: 0` for the deleted id, `ledgerHoldsText: false` | PASS |
| **B** Historical residue | memory → delete → persist checkpoint → restart → inspect project storage | before healing the stored summary was the quote (`droppedSummaryWasQuote: true`); after: `cleanedFields: 1`, summary `""`, stored copy absent, unrelated pending step kept | PASS |
| **C** Automatic migration | seed residue → launch → automatic removal, ambiguous kept | `state: complete`, `batches: 1`, `cleanedFields: 1`, `quarantined: 1`, residue absent, ambiguous checkpoint kept, healing record present and holds no text | PASS |
| **D** Interrupted migration | seed 4 projects → begin → interrupt → resume | first bounded batch left a cursor; 4 quotes remained; resume (`resumed: true`) cleaned all four; progress cleared | PASS |
| **E** Recall protection | delete → retrieve through multiple context paths | carrier recallable before, not after; context scrub removed the quoted sentence and kept the unrelated one | PASS |
| **F** Ambiguous historical data | ambiguous checkpoint → restart → quarantine not deletion | checkpoint not deleted, summary byte-identical, appears in dry run, stored report holds no record text, not re-asked after Keep, disposition logged | PASS |
| **G** Concurrency | deletion + migration + retrieval interleaved | deletion recorded, migration persisted, recall returned 0, store no longer quotes, checkpoint emptied, nothing left needing the guard | PASS |
| **H** Persistence restart | delete → restart (read storage only) → fresh payload | ledger survives with the id, IndexedDB still lacks the record, payload would contain the phrase without the guard and does not contain it with it | PASS |
| **I** Regression | unrelated memories, projects, notes, tasks, blockers survive | project JSON **byte-for-byte identical**, note survives, blockers and next action intact, migration added no memories | PASS |
| **J** Repeated lifecycle | create → retrieve → delete → restart → migrate, ×3 | each cycle cleaned 1, no residue after any cycle, tombstones grew 8 → 9 → 10 | PASS |

Storage-wide privacy check across every persisted key at the end of the run:
`deletedTokensPersisted: []`.

## What the harness cannot prove

- It runs with **storage shims**, not a real browser. Real-browser storage and
  provider payload evidence come from `browser-evidence.json` (steps 1–5), which
  used the actual app, actual IndexedDB and an actual provider request.
- It does not exercise the **cloud mirror** (no account) — see P14 and L6.
- It does not test **quota exhaustion** beyond the forced progress-write failure.
- Scenario F's Keep/Forget were invoked through the API, not clicked in the
  browser; the panel's wiring to those calls is unchanged from M22.5 apart from
  the added healing line.

## Evidence index

| File | Contents |
|---|---|
| `verification.json` | every scenario's real values, performance, full storage dump |
| `browser-evidence.json` | boot healing on two restarts, real 28 KB provider payload, storage enumeration |
| `regression.json` | suite counts, failures, typecheck, build, lint |
| `screenshots/01-payload-guard-live-chat.png` | the live chat whose provider payload was inspected |
| `screenshots/02-after-restart-healed.png` | the app after the second restart, healed |
| `persistence-inventory.json` | 18 pathways with status and verification |
