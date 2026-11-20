# M22.7 — final report

## 1. What was broken at the start

`memory_items` rows were deleted with no evidence, so any client that had not seen
the deletion re-created them on its next upsert, and the next device to hydrate
merged the statement back in as memory. The OG server-side delete had the same
hole. Telemetry payloads, derived knowledge, the self-model/journal/curiosity
documents and agent proposals kept copies of a deleted sentence and re-uploaded
them on every sync. The OG archive could inject an archived quote into context.

## 2. What was actually implemented

* `supabase/migrations/202611200001_memory_tombstones.sql`: `memory_tombstones`
  table + RLS, an `after delete` trigger that writes the tombstone in the same
  transaction, a `before insert or update` trigger that refuses a tombstoned id,
  and `erase_memory(id, fingerprint)` — atomic, idempotent, scoped to
  `auth.uid()`.
* `SupabasePersistence`: RPC-based erasure with an honest `tombstoned` flag and a
  fallback; concurrent tombstone read at hydrate; adoption before merge; row
  filtering; upload withholding; outbox flush after hydration;
  `memoryCloudStatus()`.
* `DeletionLedger`: remote outbox (bounded, idempotent, 8 attempts), id-only
  adoption of server tombstones, `fingerprintFor`, `remoteSummary`.
* `DeletionGuard.scrubDeep`: removes quoted sentences from derived records at the
  outbound seam (telemetry, knowledge, development documents, proposals).
* `AIService`: cloud outcome returned to the panel; `flushUnconfirmedDeletions`;
  cloud state in `memoryIntegrityStatus`.
* OG `deleteMemory` → `erase_memory`; `OgArchiveProvider` excludes deleted quotes.
* Memory panel: four distinct, truthful messages about the cloud copy.

## 3. Which persistence authorities are covered

20 enumerated. Completed this mission: cloud mirror, cross-device hydration, OG
server-side delete, telemetry payloads, derived knowledge, improvement proposals,
development documents, the archive read path. Already covered by M22.6: local
projects, IndexedDB memory, ledger, checkpoints, multi-provider context. Audited
and deliberately unchanged: profile, `ui_state`, `api_health`,
`news_preferences`, `proactive_questions`, `agents`.

## 4. Which deletion pathways are live and verified

None end to end. **Implementation**: memory panel, conversation delete, reset, OG
screen — all route through the tombstoning path, and 12 tests plus 20 SQL checks
cover them. **Live**: blocked at sign-in.

## 5. Did real authenticated Supabase testing succeed?

**No.** `POST /auth/v1/token?grant_type=password` → `400 invalid_credentials` for
the supplied test user. The project itself answers as expected (health 200, anon
read `[]`, wrong key 401), so the failure is the credential, not the setup. The
migration is also unapplied, which needs a credential this session does not have.

## 6. Can a deleted memory return through stale synchronization?

On the evidence available: **no, by three independent gates** — the database
refuses the insert (`memory_deleted`, SQL `B1–B3`), the client withholds the id
from uploads (test `G`), and hydration adopts the tombstone before merging
(test `F`). What is **not** proven is that these fire against the real project,
because that requires a session. This is the single most important unverified
claim in the mission.

## 7. Can another authenticated user access the test user's records?

No evidence of it, and the mechanism is sound: RLS owner policy on every table,
`auth.uid()` in the function, forged `user_id` refused (SQL `G3`), foreign row id
removes nothing (SQL `G4`), anonymous reads empty (live). A second real identity
was not available, so cross-user *live* testing is **BLOCKED**.

## 8. What happens when the network goes down?

The local deletion completes and is provable. The cloud erase fails, is queued in
persistent storage (bounded, idempotent), and is retried once after the next
hydration. The panel says the cloud copy is still there and queued. It never
reports universal completion early. Covered by tests `C`, `D`, `K`.

## 9. What remains blocked or incomplete

* Live authenticated acceptance (tests A–G) — one rejected credential.
* Migration not applied to `lelu-v11-test`; until then the app reports
  `tombstoned: false`.
* Cross-device and cross-session verification, and an expired-refresh-token case.
* `legacy_memories` cannot be deleted from (no write path); excluded instead.
* Transcripts keep text on disk by policy; the read gate is the protection.
* Profile is intentionally not erased by a memory deletion.
* Remote deletion latency and propagation latency are unmeasured (no session).

## 10. Measured performance cost

Adopt 1,000 tombstones 0.48 ms · record 1,000 tombstones 8.04 ms · outbox 200 ids
10.73 ms (capped at 200) · scrub 4-line assembly 0.016 ms · scrub 200-line context
1.01 ms · `scrubDeep` 20-step payload 0.11 ms · hydration filter 5,000 rows
0.31 ms · flush 50 entries 1.4–4.4 ms. Startup gains one concurrent read; the
flush is not awaited.

## 11. Tests

2,410 ran, 2,400 passed, **2 failed** (pre-existing: a CSS-module assertion and
the sandbox-egress test), 8 skipped. New: 12/12 (`tests/memory-cloud-erasure.test.ts`,
A–L). SQL: 20/20 in real Postgres. Typecheck: 2 pre-existing errors. Build: passes.
Lint: 0/0 on 7 touched files.

## 12–13. Commits

Implementation `3882c41…`-style detail is in `commit.txt`, with the hash-record
commit that follows it. This document ships in the hash-record commit.

## 14. Does the remote branch match?

Yes — `git ls-remote --heads origin` equals local HEAD after the push; recorded in
`commit.txt`.

## 15. Are M22.6 and canonical branches unchanged?

Yes: `refs/heads/m22.6/memory-integrity-deletion-propagation` =
`21cb99dfe693…` and `refs/heads/main` = `44bdd936892…`, both re-checked after the
push.

## Gate matrix

| VERIFIED | PARTIALLY VERIFIED | BLOCKED |
|---|---|---|
| G1, G9, G16, G17, G18, G19, G20 | G2, G5, G6, G7, G8, G10, G13, G14, G15 | G3, G4, G11, G12 |

No gate is FAILED; nothing is NOT TESTED without being named above.

## Recommendation

**NOT APPROVED — BLOCKED.** I am not recommending approval: the central claim of
this mission is that an authenticated cloud deletion stays deleted, and that
claim has not been observed against the project. Nothing failed — every gate that
could be evaluated passed — but "could not be tested" is not "passed".

This is a blocker on credentials and one migration, not on the design. Given a
working test-user password and the migration applied to `lelu-v11-test`,
`MISSION-22.7/probe/live-acceptance.mjs` runs tests A–G and the four BLOCKED gates
become decidable in one pass.
