# WP09 — Independent regression and security audit

## Suite

```bash
npm test
```

| Metric | Result |
|---|---|
| Tests | **2,410** |
| Pass | **2,400** |
| Fail | **2** (both pre-existing, below) |
| Skipped | 8 |
| Duration | 237,063 ms |

The two failures are the known ones from M22.5/M22.6 and are unrelated to memory:

* `tests/genesis-interface.test.tsx` — a CSS-module export assertion.
* `network: TCP, UDP, DNS and fetch all fail` — the sandbox blocks egress.

Targeted suites:

```bash
npx tsx --tsconfig tsconfig.test.json --import ./tests/support/ignore-css.mjs \
  --test tests/memory-cloud-erasure.test.ts     # 12/12 PASS (A–L)
npx tsx … --test tests/memory-integrity.test.ts # M22.6, still PASS
npx tsx … --test tests/memory-residue.test.ts   # M22.5, still PASS
```

## Static checks

| Check | Result |
|---|---|
| `npx tsc -p tsconfig.app.json --noEmit` | 2 errors, both pre-existing in `src/core/perception/FeatureUnderstanding.ts(455)` |
| `npx vite build` | **passes** (8.54 s) |
| `npx oxlint` on 7 touched files | **0 warnings, 0 errors** |

## Security review (summary — detail in `SECURITY-REVIEW.md`)

| Concern | Finding |
|---|---|
| Secret exposure | No key, password or JWT is logged, committed or echoed. Probes print presence, lengths and public identifiers only; response bodies are captured with JWT-shaped strings redacted. |
| Cross-user access | `erase_memory` uses `auth.uid()` only; RLS policy on both tables; SQL `G1–G4` pass. |
| Broken RLS | Anonymous read returns `[]` live; forged `user_id` insert refused (SQL `G3`). |
| Unauthorized deletion | An id alone cannot delete another user's row (SQL `G4`). |
| Resurrection via background agents | Machine-written records quoting a tombstone are refused (M22.6), uploads of tombstoned ids are withheld, and the DB refuses the insert. |
| Plaintext in tombstones/logs | Server tombstones store id + hash; SQL `H1` scans the table for the statement and finds none. Tests `J` and `L` cover the client records. |
| Unbounded retry | 8 attempts, 200 ids, one pass per flush, no timer. |
| Duplicate authorities | The outbox and the tombstones live in the existing ledger; no second memory store was created. |
| Destructive migrations | The new migration only adds a table, triggers and a function. No `drop`, no data rewrite. |
| Production data | No production project was touched; only `lelu-v11-test` was contacted, read-only. |

## Existing behaviour preserved

M22.5 residue tests and M22.6 integrity tests still pass, the payload gate is
unchanged, and the quarantine path was not modified.
