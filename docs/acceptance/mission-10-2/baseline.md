# Mission 10.2 — Baseline

Recorded before any edit, from `git ls-remote` and the local branch.

| Item | Value |
|---|---|
| Repository | `lapheezy/LeluV1.1` |
| Integration branch | `integration/lelu-four-workforce-consolidation` |
| Remote HEAD at mission start | `9558b7c` (Mission 11: "Document Mission 11 evidence and reconcile surface regression") |
| Previous mission tip | `4ce7fca` (Mission 10.1), an ancestor of `9558b7c` |
| Mission 10.1 changes present | yes — `4ce7fca` is an ancestor of the tip |
| Working branch | `integration/m10-2-request-integrity` |
| Branch HEAD | `5af7bd9` (request-integrity commit replayed onto `9558b7c`) |
| Production branches | untouched (`main` = `44bdd93`, `claude/master-integration` = `fd649b9`) |
| Working tree | 12 tracked modifications + untracked `RespanGateway` work that are **not** this mission's and were never staged |

## What the branch contains

`git merge-base --is-ancestor` confirms both `4ce7fca` (Mission 10.1) and
`9558b7c` (Mission 11) are ancestors of the mission branch, so no verified
capability from either mission was discarded by working here.

The first attempt cut the branch from `8789dfd`, which predates Mission 10.1.
That was caught by the same ancestry check and corrected by replaying the
mission commit onto `9558b7c`; the branch above is the corrected one.

## Files this mission touched

| File | Why |
|---|---|
| `src/core/router/RequestQuery.ts` | new — non-destructive subject extraction |
| `src/core/observability/RequestIntegrity.ts` | new — per-turn integrity record |
| `src/core/router/ResearchResolver.ts` | `buildQuery` now delegates instead of deleting words and slicing at 120 |
| `src/core/router/ProviderResolver.ts` | states when the prompt is missing from the payload |
| `tests/request-integrity.test.ts` | new — the Phase 2 matrix |
