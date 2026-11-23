# M22.7 — acceptance matrix

Labels: **VERIFIED** · **PARTIALLY VERIFIED** · **BLOCKED** · **FAILED** · **NOT TESTED**.
"VERIFIED" here always names *what* it was verified against; no live cloud gate
is marked VERIFIED, because the live sequence did not run (`WP07`).

| Gate | Requirement | Result | Evidence |
|---|---|---|---|
| G1 | M22.6 baseline independently verified | **VERIFIED** | `WP01`: HEAD `21cb99d`, clean tree, remote identical, M22.5/M22.6 evidence read |
| G2 | All persistence authorities inventoried | **PARTIALLY VERIFIED** | `WP01`: 20 authorities from code + `supabase/migrations` + types. The remote schema could not be enumerated because sign-in failed |
| G3 | Authenticated Supabase session verified | **BLOCKED** | `evidence/live-acceptance.json`: `400 invalid_credentials`; endpoint health and key validity proven separately |
| G4 | Cloud deletion verified with real authenticated requests | **BLOCKED** | implementation + tests A–C, G; no live call possible |
| G5 | Server-side tombstone is durable | **PARTIALLY VERIFIED** | real Postgres 20/20 (`evidence/sql-tombstones.json`); not applied to the project |
| G6 | Stale upload cannot resurrect | **PARTIALLY VERIFIED** | SQL `B1–B3`, `D3`; client filter test `G`; live race not run |
| G7 | Stale hydration cannot resurrect | **PARTIALLY VERIFIED** | test `F` (adopt-before-merge) + M22.6 id refusal; live hydration not observed |
| G8 | OG server-side memory deletion verified | **PARTIALLY VERIFIED** | `deleteMemory` → `erase_memory` + fallback; live screen not exercised |
| G9 | Telemetry/activity/profile coverage established | **VERIFIED** | `WP05` audit, `scrubDeep` at the write seam, test `L` |
| G10 | Transcript and derived-memory behaviour verified | **PARTIALLY VERIFIED** | derived stores tested (L); transcripts: policy + read gate, no live payload run this mission |
| G11 | Cross-session deletion verified | **BLOCKED** | test B of the live sequence did not run |
| G12 | Cross-device sync verified or explicitly blocked | **BLOCKED** | test D did not run |
| G13 | Ownership and RLS isolation verified | **PARTIALLY VERIFIED** | live: anon read `[]`, wrong key `401`; SQL `G1–G4`; no live second identity |
| G14 | User restatement treated as new input | **PARTIALLY VERIFIED** | M22.6 unit coverage still passes; live test F did not run |
| G15 | Interrupted deletion recovers safely | **PARTIALLY VERIFIED** | tests `C` (durable queue, retry) and `D` (bounded); no live network cut |
| G16 | No plaintext deleted content in tombstones or logs | **VERIFIED** | SQL `H1` (462 bytes of tombstone rows scanned, no match); tests `J`, `L` |
| G17 | Existing M22.5/M22.6 behaviour preserved | **VERIFIED** | residue and integrity suites pass inside the full run |
| G18 | Full regression suite and build verified | **VERIFIED** | 2,410 tests / 2,400 pass / 2 known failures / 8 skipped; build 8.18 s; lint 0/0 |
| G19 | Candidate commit and remote branch independently verified | **VERIFIED** | `commit.txt`: local HEAD = remote ref = `9700a44…`; M22.6 = `21cb99d…` and `main` = `44bdd93…` unchanged |
| G20 | No unauthorized production changes or canonical promotion | **VERIFIED** | only `lelu-v11-test` contacted, read-only; no merge, PR or deploy |

## Tally

VERIFIED 7 · PARTIALLY VERIFIED 9 · BLOCKED 4 · FAILED 0 · NOT TESTED 0

The four BLOCKED gates are all the same cause: one rejected credential and one
unapplied migration. Neither is a code defect, and neither can be worked around
honestly — creating an account or using a service-role key is explicitly out of
bounds.
