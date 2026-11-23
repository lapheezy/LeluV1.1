# MISSION 22.7 — Universal memory erasure and cloud deletion integrity

**Branch:** `m22.7/universal-memory-erasure` · **Started at:** `21cb99d` (M22.6)
**Candidate:** `9700a44` — remote ref identical (`commit.txt`) · **Canonical:** untouched (`main` = `44bdd93…`)

## What this mission was for

M22.6 could prove a deletion locally and stop the same id coming back on the
device that held the ledger. It could not stop the statement returning through
the cloud mirror, which deleted rows and left no evidence behind. This mission
closes that, plus the server-side OG path and the derived stores that used to
keep a cleaned-up copy of a deleted sentence.

## Headline result, stated honestly

* The database mechanism that makes resurrection impossible was **executed by a
  real Postgres** and passed 20/20 checks (`evidence/sql-tombstones.json`).
* The application half — RPC erasure, durable retry outbox, tombstone adoption
  before hydration, upload filtering, derived-write scrubbing — passes 12 new
  tests and the full suite (`WP09-REGRESSION.md`).
* **The live authenticated acceptance did not run.** The supplied
  `SUPABASE_TEST_USER_PASSWORD` is rejected by the project
  (`invalid_credentials`), and the project answers health, anonymous reads and a
  deliberately wrong key exactly as expected. Applying the migration also needs
  a credential this session does not have. Both are reported in
  `WP07-AUTH-ACCEPTANCE.md`; no live cloud claim is made anywhere in this
  package.

## Reproduce

```bash
# 1. SQL mechanism, in real Postgres (pglite installed OUTSIDE the repo)
mkdir -p /tmp/pgtest && cd /tmp/pgtest && npm install @electric-sql/pglite
cp <repo>/MISSION-22.7/probe/sql-verify.mjs /tmp/pgtest/
cd /tmp/pgtest && node sql-verify.mjs <repo>/supabase/migrations/202611200001_memory_tombstones.sql

# 2. Application behaviour (12 tests, no network)
npx tsx --tsconfig tsconfig.test.json --import ./tests/support/ignore-css.mjs \
  --test tests/memory-cloud-erasure.test.ts

# 3. Cost of the new work
npx tsx --tsconfig tsconfig.test.json --import ./tests/support/ignore-css.mjs \
  MISSION-22.7/probe/perf.ts

# 4. Live probe (stops at sign-in while the credential is rejected)
node MISSION-22.7/probe/live-probe.mjs
```

## Evidence index

| File | What it holds |
|---|---|
| `WP01-BASELINE.md` | the state M22.6 left, and every authority found this time |
| `WP02-CLOUD-DELETION.md` | erasure path, outbox, idempotency, ownership |
| `WP03-TOMBSTONE-HYDRATION.md` | server tombstones, adoption order, stale upload/hydration |
| `WP04-OG-MEMORY.md` | every `memory_items` writer/reader/deleter; the frozen archive |
| `WP05-PERSISTENCE-COVERAGE.md` | telemetry, activity and profile: what each store holds |
| `WP06-DERIVED-DATA.md` | transcripts, knowledge, identity, journal, proposals |
| `WP07-AUTH-ACCEPTANCE.md` | the live sequence, and exactly where it stopped |
| `WP08-RECOVERY-PERFORMANCE.md` | failure cases and measured cost |
| `WP09-REGRESSION.md` | suite, typecheck, build, lint, security review |
| `ACCEPTANCE-MATRIX.md` | G1–G20, each with a label and a pointer |
| `SECURITY-REVIEW.md` | secrets, RLS, definer functions, retry bounds |
| `FINAL-REPORT.md` | the 15 questions, the gate matrix, the recommendation |
| `evidence/` | raw JSON: SQL verification, live probe, endpoint behaviour, perf |
| `probe/` | the scripts that produced them |
