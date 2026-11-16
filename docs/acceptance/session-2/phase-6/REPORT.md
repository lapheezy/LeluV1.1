# Session 2 · Phase 6 — Self-engineering repair: acceptance report

**Phase 6 gate: NOT PASSED — 7 of 9 criteria runtime-verified; 2 BLOCKED on an identity
for the apply step (a dedicated test Supabase project).** Phase 7 has not been started.

## Coordination

| | |
|---|---|
| Branch | `claude/cosmos-chat-experience-z6xja0` (Session 3's branch; Session 1's branch was not written to) |
| Base | `fb6e7a8` — Session 1's newest commit (Phase 0 report only), fast-forwarded. Contains `665f849`, the audited commit. |
| Session 1 overlap | None. Session 1's Phase 1–5 plan targets `homeStore`, `chat/universe/*`, `GenesisModuleHost`, `GenesisWindowFrame`, `ExplorationController`, the browser. Phase 6 changed none of them. |
| Session 1 status | **Not complete** (Phase 0 passed; Phases 1–5 open). Not declared complete here. |
| Audit preserved | `audit/PHASE_6_AUDIT.md` + its two screenshots, committed unchanged in substance. |

Phase 6 commits, in order: `66c86cd` audit · `77e1146` runtime apply backup/rollback + targeted
checks · `a24cb81` generated development, states, no stuck runs · `40b8862` panels ·
`c9eac25` tests · `c10b898` record while apply blocked · `eeab2ce` syntax check in copies +
concurrent listing · `e3adda4` keep test summary · `b996a05` interrupted-run recovery ·
`ea8c11c` evidence shows the change with apply attempts under it.

## What was wrong, and what changed

| Audit | Defect | Fix | Status |
|---|---|---|---|
| D1 | Updates **INTEGRATE** called `approve()` → a Ready change went back to development forever | Ready offers **APPLY TO PROJECT** / **RECORD ONLY** / REJECT. `approve()` acts only on pending (or queued, not started) proposals and never re-runs Ready/applied/recorded work. | IMPLEMENTED AND RUNTIME VERIFIED |
| D2 | **Develop never produced code** — checks ran on an unchanged sandbox, then "Ready" | `ProposalEngineer` (new) + `developProposal()`: copy → select real files → read → plan + search/replace edits (model via `AIService.reason`) → validate → stage in the copy → syntax (changed files) → relevant tests → typecheck (the copy) → diff. No change or a failed check → **Failed** with the reason. | IMPLEMENTED AND RUNTIME VERIFIED |
| D3 | Apply only wrote hand-edited Source-tab copies, via `/api/engineer/write` — which is **copy-only**, so it could never succeed | `applyCandidate()` applies the proposal's own generated diff through `workspace:apply`: explicit click + L5 + signed-in identity + per-file conflict check → Applying → real typecheck (auto-rollback) → relevant tests on the project (rollback on failure) → Integrated / Rolled Back. Source-tab copies are no longer involved. | IMPLEMENTED BUT NOT RUNTIME VERIFIED past the identity gate (see Blocked) |
| D4 | Recorded and applied shared **Integrated** | `integrate()` → **Recorded (not applied)**; **Integrated** only after a verified apply. | IMPLEMENTED AND RUNTIME VERIFIED (Recorded); Integrated not reachable without identity |
| D5 | Gate-blocked run left "In progress — approved" | Every early exit sets a state. **Blocked** stores reason, required autonomy, unblock action, and which action to retry. A run interrupted by a closed page becomes **Failed** on reload. | IMPLEMENTED AND RUNTIME VERIFIED (Blocked); interrupted-run recovery unit-tested only |
| D6 | Implement unreachable from the notification | APPLY TO PROJECT is on the proposal card in Updates (and in Self Development). | IMPLEMENTED AND RUNTIME VERIFIED (control present; outcome Blocked) |
| D7 | L5 requirement invisible | The requirement and current level are shown beside APPROVE and APPLY; Blocked names the level. Autonomy is never raised by the system. | IMPLEMENTED AND RUNTIME VERIFIED |
| new | Failed post-apply verification left the project broken (no backup) | Server keeps a backup before writing; `workspace:rollback-apply` (identity-gated) restores modified files and removes created ones; `EngineeringWorkspace.apply` rolls back automatically on a failed typecheck. | IMPLEMENTED; rollback **mechanics verified** against the real Node adapter (unit/integration test); end-to-end NOT RUNTIME VERIFIED |
| new | Only a 15-minute whole-suite test op | `syntax-files` (TypeScript parser, syntax only) and `test-files` (named node:test files) over strictly validated project paths. | IMPLEMENTED AND RUNTIME VERIFIED |

### Lifecycle states (stored values unchanged, new ones added; `jsonb` column — no migration)

| Requested | Stored value | Shown as |
|---|---|---|
| Proposed / Pending approval | `Detected`, `Analyzing`, `Proposed` | Pending approval |
| Approved | `Approved` | Approved — queued |
| Developing | `In Development`, `Testing`, `Evaluation` | Developing (— checks running) |
| Ready for review | `Ready` | Ready for review |
| Applying | `Applying` (new) | Applying |
| Integrated | `Integrated` | Integrated (applied) |
| (recording only) | `Recorded` (new) | Recorded (not applied) |
| Failed | `Failed` (new) | Failed |
| Blocked | `Blocked` (new) | Blocked |
| Rolled back | `Rolled Back` | Rolled back |

Each transition is written by the loop at the moment the backend step happens; the panels only render the record.

## Controlled test setup (isolation)

- **Runtime:** a disposable git worktree of this branch (`/home/user/lelu-p6-test`), dev server on
  :5175 with every `SUPABASE*` variable removed. "Apply" can only ever write into that worktree.
- **Supabase:** every browser request to `*.supabase.co` was intercepted and aborted.
  **Count: 0** — no request was even attempted, none reached the production project. No
  Supabase record was read or written.
- **Proposal:** one dedicated test proposal, `[TEST] Add isTerminalStatus() to the improvement
  queue`, created in the test browser's local queue only.
- **Model:** reached through LÉLU's own broker. The harness's own `ANTHROPIC_BASE_URL` (a
  variable of this container, not LÉLU's) was removed from the test server; with it present
  the key bridge pointed LÉLU's Anthropic provider at the harness proxy and the chain fell
  back to OpenRouter (observed in run 1).
- **Autonomy:** changed only by the test acting as the owner (2 → 3 → 5 → 3), in the browser's
  local setting; never by LÉLU.
- **Legibility:** the chat window draws over the expanded Updates window (a Phase 7 layout
  defect) and its ✕ closes both, so the captures hide it with an injected style. Nothing else
  in the page was altered.
- **Code under test:** run 4 ran `e3adda4` (served by HMR; the footer shows the server's start
  build stamp `eeab2ce`). Phone captures 17–18 render run 4's stored proposal record with
  `ea8c11c` (the evidence-panel fix), loaded into a fresh phone-size profile.

## Execution evidence — final run (run 4)

| | |
|---|---|
| Proposal ID | `13d0e925-b4f2-4d84-a9f0-7ca02e9990c5` |
| Blocked develop (L2) | `exec-mw3yet1w-olu0` → Blocked: "needs autonomy level 3; the current level is 2" |
| **Development** | **`exec-mw3yf604-1skl`** — Approved → In Development (+7 s) → Testing (+63 s) → **Ready for review (+112 s)** |
| Agent | `Anthropic/claude-opus-5-5` (from the response, not assumed) |
| Workspace copy | `ws-13d0e925-b4f2-4d84-a9f0--mw3yf9z2` (1,732 files) |
| Files inspected | `src/core/selfdev/ImprovementQueue.ts`, `src/app/scene/genesis/GenesisNotificationsPanel.tsx`, `src/core/selfdev/ProposalEngineer.ts`, `src/core/selfdev/SelfDevelopmentLoop.ts` |
| Files changed (in the copy) | `src/core/selfdev/ImprovementQueue.ts`, `tests/terminal-status.test.ts` (new) |
| Generated diff | `TERMINAL_STATUSES` + `isTerminalStatus()` exported; a node:test file checks every status (`records/proposal-final.json` → `executions[].diff`; `screenshots/13-diff-review.jpg`) |
| Syntax | ✓ `syntax ok: 2 file(s)` (exit 0) |
| Tests (relevant, in the copy) | ✓ `proposal-engineering`, `development-loop`, `live-notifications`, `terminal-status` — **56 passed, 0 failed** |
| Typecheck (whole copy) | ✓ exit 0 in 40 s |
| Apply at L3 | `exec-mw3yht5j-y2te` → **Blocked**: "needs autonomy level 5 (Production); the current level is 3" |
| Apply at L5 | `exec-mw3yi0a7-ycmt` → **Blocked**: "No authenticated session. Applying changes to the real project requires a signed-in Supabase identity" |
| Record only | → **Recorded (not applied)**, `Recorded v1.1.0 (not applied)` |
| Real tree of the test runtime | unchanged (`git status` empty) — nothing escaped the copy |
| Rollback | not reached (nothing was applied) |
| Events | 32 on the proposal's task id, in `records/events.json` |
| Page errors | none |

Earlier runs, kept because they found real defects:
- **Run 1** — the syntax check failed every change (`No files found to lint`: oxlint applies the
  repo `.gitignore`, which excludes `.lelu-sandbox`). Proposal ended **Failed** with that
  reason, not Ready. Fixed in `eeab2ce`. The model also came from the OpenRouter fallback
  (environment artifact above).
- **Run 2** — `exec-mw3xt6sw-l4et`, Anthropic, 3 files changed (incl. a new test), all checks
  green → Ready; L5 block; identity block; Recorded. The test detail lost its summary to
  truncation; fixed in `e3adda4`.

## Screenshots (`screenshots/`)

| Required | File |
|---|---|
| Engineering proposal | `10-proposal-pending.jpg` |
| Blocked state with requirement + retry | `10b-develop-blocked-autonomy.jpg` |
| Execute action → live execution | `11-developing-live.jpg`, `11b-checks-running.jpg` |
| Actual code changes + test results | `12-ready-for-review-checks.jpg`, `13-diff-review.jpg` |
| Implement action | `14-apply-blocked-autonomy.jpg`, `15-apply-blocked-identity.jpg` |
| Completed engineering report (recorded) | `16-recorded.jpg` |
| Phone | `17-mobile-updates.jpg`, `18-mobile-evidence.jpg` |

## Acceptance gate

| Criterion | Status | Evidence |
|---|---|---|
| A proposal can be approved | IMPLEMENTED AND RUNTIME VERIFIED | run 4 log, `10b`, `11` |
| Actual code generation occurs | IMPLEMENTED AND RUNTIME VERIFIED | `exec-mw3yf604-1skl`, `13` |
| Generated changes can be reviewed | IMPLEMENTED AND RUNTIME VERIFIED | `13`, `18` |
| Authorized changes can be applied | **BLOCKED** | needs a signed-in identity on a server that verifies it; only the production Supabase project exists |
| Tests execute | IMPLEMENTED AND RUNTIME VERIFIED | 56/56 relevant tests in the copy |
| Implementation distinguishable from recording | IMPLEMENTED AND RUNTIME VERIFIED for Recorded; Integrated only reachable after apply | `16`, state table |
| Failed implementation rolls back | **BLOCKED** end-to-end; mechanics verified (`tests/proposal-engineering.test.ts`, real Node adapter) | |
| Blocked proposals display accurate states | IMPLEMENTED AND RUNTIME VERIFIED | `10b`, `14`, `15` |
| Execution evidence is available | IMPLEMENTED AND RUNTIME VERIFIED | `records/`, `12`, `18` |

**To unblock the two criteria:** a dedicated test Supabase project (or branch), a test user, and
the test server started with that project's URL and anon key. Then: sign in as the test user,
APPLY a Ready change (expect Integrated), and APPLY a change whose relevant test fails on the
project (expect Rolled Back with the files restored). Creating a project has a cost and needs
the owner's decision.

## Tests

`tests/proposal-engineering.test.ts` (new, 6): edit validation, file selection from real paths
only, no-change is a failure, apply backup + rollback on the real Node adapter, strict check
paths, interrupted-run recovery. Related suites re-run on the final code: see
`records/test-results.txt`.

## Known issues found, not in Phase 6 scope

- **Security:** `runtimeKeyBridge` publishes several provider API keys (geocoding, news) into
  the HTML the dev server serves. Values are kept out of all evidence. Needs its own fix.
- Phase 7: the chat window overlaps the expanded Updates window, and closing the chat closes the
  Updates window; on phones the companion "Lélu" window covers the card's right side; the
  Updates panel is still the older panel style.
- A run executes in the page that started it; closing the page stops it (now recovered as
  Failed on reload rather than shown as running).
