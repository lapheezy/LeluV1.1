# Mission 10.2 — final acceptance matrix

A gate is only PASS when the evidence named here exists in this directory.

| Gate | Status | Evidence |
|---|---|---|
| A — canonical baseline verified | **PASS** | `baseline.md`: tip `9558b7c`, mission branch `5af7bd9`, `4ce7fca` and `9558b7c` both ancestors, production branches untouched |
| B — request fitter defect fixed | **PASS** | `request-integrity-report.md`; the measured 120-character mid-word cut is replaced by `querySubject` |
| C — full prompt reaches provider | **PASS (module level)** | 11 integrity tests assert `providerPayload.promptPresent` and `semanticPreservation.ok`; live payload capture blocked by L |
| D — provider configuration verified | **PASS** | `provider-status.json`, `provider-verification.md` (OpenRouter 200, Groq 429, GitHub Models contract violation, rest unconfigured) |
| E — approval workflow completed live | **NOT RE-PROVEN THIS BUILD** | `execution-path-a.json` holds a live record with 0 approvals; the browser step could not be repeated (see L) |
| F — tool execution completed live | **NOT RE-PROVEN THIS BUILD** | same record: 0 runtime requests including clone, tree, read, write, exec |
| G — runtime result returned to model | **NOT RE-PROVEN THIS BUILD** | same record's continuation; no fresh turn captured |
| H — model continues and completes | **NOT RE-PROVEN THIS BUILD** | assistant tail recorded in `execution-path-a.json` |
| I — real repository acquired and verified | **PASS** | `live-acquisition-evidence.json`: `acq-typesense-typesense-f7ve8`, commit `3423e2e0daf335a38135aaf20032ce5664497908`; identity verdict `{"threeSpellingsOneRecord": true, "concurrentSingleRecord": true, "differentRepoDistinct": true}` |
| J — regression suite passes | **PASS** | `regression-results.md`: 47/47 |
| K — TypeScript passes | **PASS (isolated)** | branch checked out alone: `tsc -b --force` exit 0. In the shared worktree it exits 2 on untracked `RespanGateway` files that are not on this branch |
| L — browser/Cosmos stability verified | **FAIL** | `browser-stability-report.md`: composer entry is racy; harness reported "composer not found after guest entry" |
| M — integration branch pushed and verified | **PASS after push** | SHA recorded in the mission summary and verified with `git ls-remote` |

Four gates remain explicitly failed or not re-proven. Mission 10.2 is therefore
**not** complete, and this matrix says so rather than relabelling a partial
result.
