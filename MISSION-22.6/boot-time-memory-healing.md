# Boot-time memory healing (WP01)

## The problem with M22.5's trigger

M22.5's migration was correct and safe, but it ran when a person opened the
Memory panel and pressed "Remove N provable quote(s)". A user who deleted a
memory and never opened that panel left every historical copy in place. That is
a UI action standing in for a data-integrity guarantee.

## Ordering, and why each step is where it is

`Bootstrap.start()` is the one startup path (`runtimeKernel.ts` calls it once,
idempotent under StrictMode). The new `memory-integrity` step sits **after** the
`runtime` step and **before** services:

```
1 environment → 2 providers → 3 runtime (stores, IndexedDB, memory engine)
             → 4 memory-integrity (SCHEDULE ONLY)
             → 5 services → 6 cognition → 7 world → 8 verification
```

- **The ledger needs no initialisation.** It is localStorage-backed and readable
  the moment the window exists, so it is available before any recall can happen.
  This satisfies "initialize the deletion ledger before memory retrieval".
- **The migration needs the runtime step,** because it reads `ProjectStore`,
  which is part of the runtime the step before it starts.
- **It must not be awaited.** Step 4 calls `schedule()` and returns; the work runs
  on `requestIdleCallback` (or a 1.5 s timeout when idle callbacks are absent).

## What `schedule()` does

1. If this page load already booted, scheduled, or is running the healer, it
   returns the existing status — StrictMode's double mount and a second caller in
   the same tick both hit this guard.
2. Writes `lelu.memory.healing.v1` with `state: "scheduled"`.
3. Schedules `heal()` off the critical path.

## What `heal()` does

```
acquire cross-tab lease (lelu.memory.healing.lock.v1, 60 s, stale takeover allowed)
for at most 400 batches:
    plan  = migration.run({ dryRun: true, limit: 25 })     ← detect first
    if plan.findings == 0:
        if nothing remains        → stop
        advanceCursor(limit 25)   ← a window with no residue must still advance
        continue
    apply = migration.run({ dryRun: false, limit: 25 })    ← remove exactly what was proven
    accumulate counts
write final status (complete / failed, with counts and reason)
release lease
```

- **Batch size 25 projects.** One batch costs ~1.7 ms on a 1,000-project store
  (measured), so even a large collection never blocks a frame.
- **Detect, then apply, per window.** No path applies a change that a dry run in
  the same window did not just prove.
- **Resumable.** The cursor lives in `lelu.memory.migration.progress.v1` and is
  written by the migration, not by the healer. A closed tab resumes.
- **The cursor is validated on read.** A corrupt value is discarded and the scan
  restarts (`recoveredCursor: true`) instead of silently filtering every project
  out and reporting "done".
- **One healer at a time.** A lease in storage prevents two tabs from double-
  counting removals. A stale lease is taken over after 60 s.
- **Failure is recorded, not fatal.** A storage write failure produces
  `state: "failed"` with the reason; Bootstrap's step still reports DONE because
  the *scheduling* succeeded, and the failure is visible in the status record.

## Recall does not wait for healing

This is the design point that makes asynchronous healing safe. `DeletionGuard`
filters reads independently of storage state, so a checkpoint that still quotes a
deleted memory is dropped from context even while the migration is mid-scan, or
if it never runs at all. Healing is what makes the *stored* copy match; the guard
is what makes the *read* correct.

## What was observed

Browser, real app, restart with residue seeded after a deletion
(`browser-evidence.json`, step 2):

```
state: complete, batches: 1, scannedProjects: 3, cleanedFields: 1,
quarantined: 0, tombstones: 1, durationMs: 2
deleted phrase still stored: false
unrelated pending step kept: true
memory panel opened: false
```

Second restart with a fresh copy (step 4): `cleanedFields: 1`, 1 ms, project
count unchanged at 4.

Verification scenario C and E, and tests E/F, exercise the same path headlessly,
including idempotence (`again.cleanedFields === 0`, `again.batches === 0`) and
the lease (`state: "skipped"`).

## What this does not do

- It does not scan on every write. Healing is a boot-time sweep plus the
  read-time guard; a copy written after boot is caught by the next boot or by the
  panel's dry run, and is already unreadable to the model in the meantime.
- It does not delete ambiguous checkpoints. Quarantine behaviour is unchanged
  (`quarantine-governance.md`).
