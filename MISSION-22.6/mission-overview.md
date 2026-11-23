# M22.6 — Autonomous Memory Integrity & Deletion Propagation

## What this mission had to prove

M22.5 made a deletion *provable* and gave a person a button that removed the
copies a proof could reach. That is not the same as a system that forgets.
M22.6 asks the harder question:

> After the user deletes a memory, is there any path left by which LÉLU can
> still retrieve it, quote it, or learn it again — and if so, is that path
> closed without anyone having to open a panel?

The answer after this mission is: **no path found in the audited inventory can
serve a tombstoned statement to a model**, and **the remediation no longer needs
a person**.

## The nine links of the lifecycle

| Link | Before M22.6 | After M22.6 | Evidence |
|---|---|---|---|
| CREATE | user turn → MemoryEngine | unchanged | tests A–L |
| STORE | IndexedDB `lelu-memory` | unchanged; a tombstoned id can never be re-added | test L |
| RETRIEVE | recall returned any matching record | recall drops records that quote a deletion | test C |
| DELETE | `Brain.forgetMemory`, conversation purge, reset | all three record a tombstone before removal | tests A, B |
| RECORD | single-memory only | single, conversation and reset; bulk is one ledger write | tests A, B |
| PROPAGATE | project checkpoints, cognitive graph | + cloud mirror row, + machine-written memory refusal | test D, L; P14 |
| MIGRATE | on demand, from the panel | automatically at boot, bounded, resumable | browser evidence steps 2, 4 |
| VERIFY | migration counters | independent storage inspection, 10 scenarios | verification.json |
| PREVENT RECALL | store only | recall + checkpoints + self-model + dialogue + final payload | browser step 3 (28,752-byte payload, 0 occurrences) |

## What was built (and what was deliberately not)

**Extended, not replaced.** The deletion ledger, the six-token fingerprints,
the migration, the quarantine and the Memory panel are M22.5's. M22.6 adds:

- `DeletionGuard` — the one authority that *consults* the ledger on read paths.
- A tombstone index built once per run (9.26× faster matching on 1,000 projects).
- `MemoryHealing` — boot-time scheduling with a cross-tab lease and bounded batches.
- Tombstones for the bulk pathways (conversation purge, reset) and a cloud-mirror
  delete; a tombstoned id cannot be restored by hydration.
- Report v2: cursor validation, per-project failure isolation, write-failure
  honesty, persisted previews stripped, dispositions kept in their own store.
- 12 regression tests and an independent 10-scenario verification harness.

**Not built.** No second memory store, no new scheduler, no new UI surface, no
schema migration, no background daemon thread. The healer runs on the existing
boot path and the existing migration.

## Where the mission stops short

Three persistence pathways are named as **uncovered** rather than declared safe:
telemetry/activity keys that may echo user text (P09), the user profile store
(P10), and the OG surface's server-side memory deletion (P15). Derived stores
(self-model, knowledge, identity) are *filtered at context* but not rewritten.
These are listed in `known-limitations.md` with their risk, and they are the
reason the promotion recommendation is **conditional**, not unconditional.

## Reading order

1. `source-integrity.md` — where the work started and why the branch is isolated.
2. `complete-persistence-inventory.md` — every pathway, with status.
3. `boot-time-memory-healing.md` — WP01.
4. `deletion-propagation.md` — WP02.
5. `quarantine-governance.md` — WP04.
6. `recall-integrity.md` — WP05, the functional core.
7. `migration-reliability-performance.md` — WP06.
8. `independent-verification.md` — WP07.
9. `M22.6-verification-report.md` — the gate table and the final answer.
10. `release-qualification.md`, `known-limitations.md` — what may and may not be claimed.
