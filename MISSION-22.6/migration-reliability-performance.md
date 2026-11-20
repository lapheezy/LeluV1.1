# Migration reliability and performance (WP06)

All numbers below were measured on this machine with
`MISSION-22.6/verify-integrity.ts` (Node, in-memory localStorage/IndexedDB
shims). They are measurements, not estimates, and three consecutive runs are
reported where run-to-run variance matters.

## Baseline, for honesty

M22.5 measured **60 projects / 180 fields**: dry run 7.19 ms, apply 10.43 ms,
context assembly 1.62 ms mean. Those numbers are not comparable to a 1,000-project
run, so the table below also gives **per-project** cost.

## What changed

| Change | Why |
|---|---|
| Tombstone index built once per run (`buildTombstoneIndex` + `matchTombstoneIndex`) | `matchTombstone` rebuilt a size→tombstone map for every field. 3,000 fields × 11 tombstones meant thousands of redundant maps. |
| `redact()` returns the updated project instead of re-reading it | the quarantine step called `projects.get(id)` per project, which lists and re-parses the whole store — O(projects²) per scan. |
| Report `version: 2` with `skippedProjects`, `recoveredCursor`, `persisted` | the report now distinguishes scanned / removed / quarantined / skipped / not-recorded. |
| Cursor validation (`readProgress`) | a corrupt cursor used to filter every project out and report "done" without scanning. It is now discarded and the scan restarts (`recoveredCursor: true`). |
| Per-project `try/catch` | one unreadable project no longer aborts the scan, and is not counted as clean. |
| Progress/report write failure raises `ResidueStorageError` | a caller could report a clean migration that was never recorded. |
| Previews stripped from the persisted report | quarantine metadata no longer stores record text. |
| `advanceCursor()` | a window with no residue but more projects remaining must move forward, or the boot healer re-reads it forever. |

## Measured results — 1,000 projects, 3,000 text fields, 11 tombstones

| Measurement | Before the hot-loop fix | Final (3 runs) | Per project (final) | M22.5 per project |
|---|---|---|---|---|
| Dry run | 1,585.66 ms | **8.25 / 10.67 / 9.39 ms** | 0.008–0.011 ms | 0.120 ms |
| Apply (20 removals) | 1,637.55 ms | **60.47 / 63.02 / 65.23 ms** | 0.060–0.065 ms | 0.174 ms |
| Bounded batch (25 projects) | — | **1.65–2.24 ms** | — | — |
| Boot healing, whole store (39 batches) | 1,726 ms | **134–135 ms** | — | — |
| Context guard, per 40-line assembly | — | **0.154 ms** | — | — |
| Matcher: reference vs indexed, 3,000 texts | 10.99 ms vs 1.22 ms | **8.99–9.26× faster, identical answers** | — | — |

The "before" column is a real measurement of the code before the fix in this
mission (same harness, same data); it is not an estimate.

Two things dominate apply time: 20 project-store rewrites (the store is a whole
JSON array per project, ~500 KB at 1,000 projects) and one report write. That is
storage write volume, not matching. The dry run — which is what boot does first —
is free of it, which is why the boot sweep is cheap.

## Reliability scenarios exercised

| Requirement | How it was tested | Result |
|---|---|---|
| 60 projects | M22.5 scenario retained (tests A–H) | 8/8 pass |
| 1,000 projects | generated fixture in the verification harness | 20 findings, 20 cleaned, identical answers |
| Interrupted migration | bounded run leaves a cursor, then boot healing resumes | `quotesLeftAfterInterruption: 4` → `0`, `resumed: true`, progress cleared |
| Corrupted cursor | progress set to `{cursor: 42, cleanedFields: -3, scannedProjects: "many"}` | `recoveredCursor: true`, residue still cleaned |
| Storage write failure | progress key made to throw | `ResidueStorageError` raised; previous report unchanged |
| Repeated migration | second heal after a clean run | `cleanedFields: 0`, `batches: 0` |
| Concurrent migration | lease held by "another tab" | `state: "skipped"`, reason names the lease |
| Repeated lifecycle ×3 | create → checkpoint → delete → heal, three times | 1 cleaned per cycle, 0 residue each time |
| Storage quota / partial persistence | progress failure path above; no other quota path is simulated | documented as a limitation (only the progress/report writes were exercised) |
| Schema changes / legacy formats | legacy checkpoint shape (M22.5) and legacy report with previews (`scrubLegacyPreviews`) | covered structurally; the preview scrub was not run against a real M22.5 report in the browser |

## Transactional guarantees (documented, not claimed atomic)

`ProjectStore.update` rewrites the whole project list in one `localStorage.setItem`.
There is no transaction across projects. The guarantee is therefore:

1. **Per project**, a clean is one write: either the project array is written or
   it is not.
2. **Across projects**, a run is not atomic. If a batch is partly applied and the
   progress write then fails, the applied cleans stay applied and the cursor is
   not advanced. The next run re-scans those projects, finds nothing (the text is
   gone), and continues — the operation is idempotent, so re-scanning is safe.
3. **The caller is never told otherwise**: a failed progress or report write
   raises, and `persisted: false` is never returned as a success.
