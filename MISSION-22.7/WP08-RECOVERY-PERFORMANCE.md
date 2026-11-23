# WP08 — Failure, recovery and performance

## Failure cases

Exercised at the level the credential allows: the module seam, not the network.

| Case | Behaviour | Evidence |
|---|---|---|
| Supabase unavailable | `forgetMemory` returns `ok:false` with a code; the id is queued; local deletion unaffected | test `C` |
| Invalid session / signed out | `reason:"signed_out"`, **not** queued (no user to act for) | test `K` |
| Permission denied / RLS rejection | queued with the upstream code, retried later | test `D` (`42501`) |
| Missing remote record | `erase_memory` returns 0 and still tombstones | SQL `D1`,`D2` |
| Duplicate deletion | second call returns 0, one tombstone | SQL `E1–E3` |
| Stale upload | refused by trigger `memory_deleted`, and filtered client-side | SQL `B1–B3`, test `G` |
| Stale hydration | row filtered before merge; id adopted first | test `F` |
| Corrupted / absent tombstone table | read is contained, `tombstones:false` reported, hydration proceeds | code path `readRemoteDeletions` (no degradation storm) |
| Restart during deletion | queue and ledger are in persistent storage | test `C` asserts the outbox is on disk |
| Retry after recovery | flushed once after hydration, cleared on success | test `C` |
| Unbounded retries | capped at 8 attempts per id, 200 ids; exhausted entries stay visible | test `D` |
| Startup blocking | tombstone read is concurrent with the store reads; flush is `void` | code + perf below |
| Missing `erase_memory` function | falls back to delete, reports `tombstoned:false` | test `B` |

Not exercised: a real network cut, an expired refresh token, and a mid-batch
partial failure against the real project — all need the live session.

## Cost of the new work

`probe/perf.ts` → `evidence/perf.json`. In-process, fake client, **no network**,
median of repeated runs:

| Operation | Cost |
|---|---|
| Adopt 1,000 server tombstones | **0.48 ms** |
| Record 1,000 tombstones (bulk wipe) | 8.04 ms |
| One `fingerprintFor` lookup | 0.32 ms |
| Queue 200 deletions (outbox at cap) | 10.73 ms |
| Scrub a 4-line assembly | **0.016 ms** |
| Scrub a 200-line context | 1.01 ms |
| `scrubDeep` a 20-step event payload | 0.11 ms |
| Hydration filter, 5,000 rows vs 50 tombstones | 0.31 ms |
| Flush 50 entries, all failing | 4.42 ms |
| Flush 50 entries, all clearing | 1.43 ms |
| Outbox cap enforced | 200 |

The scrub used in the last three rows removed the planted quote
(`quoteStillPresent: 0`).

## What is deliberately not measured here

**Remote deletion latency** and **tombstone propagation latency** are network
properties of the project. They cannot be measured without a session, and I did
not invent numbers for them. The startup addition is one extra concurrent read
(`memory_tombstones`), which adds one round trip's worth of latency only if it is
the slowest of ten parallel reads.

Memory: the outbox is bounded at 200 ids (~40 bytes each); adopted tombstones are
ids only and bounded by the ledger's 400-entry cap.
