# Improvement 3: Development record, Gate 2, and self-study runs her own self-tests

Status: **implemented; awaiting your Gate 2 acceptance.** Nothing is deployed or merged. Branch `claude/lelu-improvement-3-finish-lexgtc`. It carries `claude/cool-mccarthy-dliwu9` (Improvements 1–3) merged onto the latest M15.3 work.

**Supabase validation boundary.** Nothing in this work touched the production Supabase project:
- No SQL.
- No migration.
- No test user and no test record.
- No auth, storage, policy, function or configuration change.

Every test, harness and dev-server process ran under `tests/support/block-supabase.mjs`. That guard refuses every request to `*.supabase.co` / `*.supabase.in` before it is sent. It counted the attempts and logged method, host and path only. All of them were read-only `GET /rest/v1/legacy_memories`, which the archive provider makes at boot, and all were refused. The browser runs aborted the same hosts at the browser's router. Section 6 lists what this means you still have to validate.

---

## 1. What Improvement 3 is

| Part | Where | State |
|---|---|---|
| **Development record**: study → conclusion → proposal → implementation → your decision, read from the stores that already hold them | `src/core/selfdev/DevelopmentRecord.ts`; new **Development** tab in Self-Development (`DevelopmentRecordTab.tsx`); her chat context (`CognitiveContext.ts`) | Done; two gaps fixed in this session (2a, 2b) |
| **Gate 2**: you accept, or return with feedback, an implemented proposal. No further self-study proposal advances until the current one is accepted or rejected. | `ImprovementQueue.recordOwnerDecision`, `isSettledByOwner`; `SelfStudyEngine.pendingProposal` | Done; three gaps fixed in this session (2b–2d) |
| **Standing self-test check**: every 6 hours she asks "Do my own self-tests still pass?" | `SelfStudyEngine` (objective e2), `StudyAgentRouter.investigateTesting` | **Did not work in a real run until this session**; fixed (2e) |

## 2. Defects found and fixed in this session

These were found by me (Claude) while finishing the improvement. **None of them is LÉLU's finding.** Section 4 covers hers.

| | Defect | Evidence | Fix |
|---|---|---|---|
| a | **A proposal awaiting you could vanish from the record.** The record was built only from study objectives. Those are device-local and capped at 400 resolved entries. Once a proposal's study had been made, the study was no longer protected from the cap. Proposals sync across devices; studies do not. | Code reading (`StudyObjectives.persist`, `HISTORY_CAP`) | Every self-study proposal without its study on this device is shown from the proposal itself, at its real stage, with its Gate buttons. |
| b | **"Return with feedback" led nowhere.** Your feedback never reached the engineering agent. A re-developed proposal kept the stale `returned` decision, so its new implementation never showed as awaiting your acceptance. | Code reading (`ProposalEngineer.describeProposal`, `stageOf`) | Developing a returned proposal moves your decision into `ownerFeedbackHistory` and puts the feedback into the engineering brief. The new implementation then awaits acceptance afresh. A **Develop again with your feedback** button was added to returned entries. |
| c | **Gate 2 could be outlived.** `retry()` / "DEVELOP AGAIN" (Notifications panel) on an *accepted* proposal would replace the accepted diff with a new, unreviewed one that still read "Accepted by you". | Code reading; reproduced in the browser test before the fix | `develop()` refuses a proposal you accepted, and Rejected or Rolled Back ones. The accepted diff and decision are untouched. |
| d | **Accepting a returned proposal erased your earlier feedback.** | Found by the browser run of the Development tab | The earlier `returned` decision is kept in the feedback history. |
| e | **The standing self-test check never produced evidence, and spent quota off-budget.** At L3 with the runtime reachable, the testing study also ran the project's **entire** suite (`npm test`, about 430 s here) inside a study step with a 60 s deadline. The step was abandoned and the suite kept running on the server. The in-browser results were discarded with it. The suite's live-provider tests spent model quota from the server's keys, outside the background allowance. | Real run 1: both self-test studies concluded "insufficient: did not finish within its time budget". Two orphaned `npm test` processes were found on the runtime (165 s and 105 s old) and stopped. | Background study runs only the in-browser self-test suite (about 50 ms) and says why the full suite is not run there. A change's relevant tests still run in the development loop. Regression test fails on the old code and passes on the new. |

## 3. Gate 1, Gate 2 and the production boundary: verification

**Unit / integration** (`tests/development-gates.test.ts`, new, 7/7; `tests/development-record.test.ts`, 3/3):
- Gate 2 refused while a proposal is Proposed, Approved, In Development, Testing, Failed, Blocked or Rejected.
- Gate 1 refused for a Ready proposal.
- Record built with zero studies on the device still shows each proposal at its real stage.
- Returned → feedback in the brief → awaits acceptance afresh.
- Accepted → `retry()` and `develop()` refused, diff untouched.
- Decisions survive the JSON round-trip the remote sync uses (`mergeRemote`), and an older remote copy never overwrites a newer local decision.
- The standing self-test study runs no project command and stays inside a study step.

**Real browser** (`evidence/development-tab-browser.mjs`; screenshots and `result.json` in `evidence/improvement-3/development-tab-browser/`). The real component and the real `ImprovementQueue` were loaded from the dev runtime into Chromium. The browser could reach only 127.0.0.1; Supabase and the model broker were aborted.
- "Return with feedback" is disabled until feedback is written.
- Return stores the note; "Develop again with your feedback" is offered.
- Accept keeps the earlier note in history.
- No gate buttons remain once accepted, and a retry is refused.
- "Approve (Gate 1)" moves Proposed → Approved.
- 0 page errors.

**Isolated workspace and production boundary** (`evidence/isolated-workspace-check.mjs` → `evidence/improvement-3/isolated-workspace-check.json`, **14/14**). Run against the live local runtime, with no model involved. The edit is a labelled probe, not a correction.
- Copy: 6,697 files in `.lelu-sandbox/`.
- Edit, diff, syntax, relevant test (7/7) and typecheck all run **in the copy**.
- The real tree's file hash and `git status` are identical before and after.
- **request-apply, apply, git commit and git push are all refused.** A request with no token is refused (401).
- The copy is removed afterwards.

**Who can approve.** Approve, accept, return, apply and record are called only from owner-facing panels (`DevelopmentRecordTab`, `GenesisNotificationsPanel`, `GenesisSelfDevPanel`). No model-callable tool sets a proposal's status. The loop itself moves a proposal only to In Development, Testing, Ready, Failed or Blocked.

## 4. The self-development experiment (LÉLU's own work)

**Setup:**
- Her real `SelfStudyEngine`, `StudyAgentRouter`, `ImprovementQueue` and `SelfDevelopmentLoop`, against her real source tree, through a local development runtime (`vite`, token authority, 127.0.0.1 only).
- Nothing in her reasoning was stubbed or prompted. I gave her no subject, hint or defect.
- Autonomy: L3, her local default, unchanged.
- Gate 1 for the experiment was gated behind an explicit flag (`OWNER_GATE1=1`) that was **never needed**.

**Model use:** her own background allowance (10/day, paced), plus a hard harness backstop. The backstop counts every provider request per UTC day, fallback attempts included, and refuses the 11th before sending. Anthropic is refused outright and its keys were removed from the harness environment.

| Run | Where | Cycles | Source files she read | Verdicts | Model requests | Proposals |
|---|---|---|---|---|---|---|
| 1 | Node, real runtime | 40 | 10 | 37 no-change, 3 insufficient | 1 (Groq, self-study) | 0 |
| 2 | Chromium, real runtime | 40 | 10 | 34 no-change, 6 insufficient | 1 (OpenRouter free, self-study) | 0 |
| 3 | Chromium, continuing run 2's state | 60 | 34 | 57 no-change, 3 insufficient | 0 (paced until 02:30 UTC) | 0 |

Evidence: `evidence/improvement-3/run-1-node-40-cycles.json`, `run-2-browser-40-cycles.json`, `run-3-browser-60-cycles.json`. These hold every cycle, conclusion, usage event and the development record as she reads it.

**Result: in 140 cycles LÉLU did not independently identify a defect.** Steps 2–7 of the experiment (her evidence and root cause, her proposed correction, her loop implementing it in an isolated copy, her test results, your approval) **did not happen**. I did not manufacture a defect, prompt her toward one, or substitute a correction of my own.

Why she found none, from the traces:
1. **Most conclusions are deterministic.** A deterministic conclusion proposes a change only when the evidence itself says so: a FAILING self-test or an unfinished marker in a file she read. In her real environment all 23 self-tests pass, and the files she read gave no such marker.
2. **Judgement is scarce by design.** Her 10-call allowance is paced across the day (about one call per 2.4 h after the first). So 138 of 140 conclusions were reached without a model.

**Why run 2 had to be in a browser.** Under Node, 4 of her 23 self-tests fail only because Node has no Web Worker. Once the standing check worked (2e), a Node run would have turned those environment failures into a proposal: a defect the harness created, not one in her code. In Chromium all 23 pass.

### An observation of mine, deliberately not fixed

`SelfStudyEngine.ts` (the "Evidence of a failure" block, around line 1913) treats **any** evidence line containing *fail/failed/error/missing/cannot* as a failure, including success lines. Each one raises a priority-85 "What is causing this failure" study:
- "Self-test suite: 23/23 passed, **0 failed**" became "What is causing this failure: Self-test suite: / passed, failed?" (run 2, cycle 13)
- "Self-diagnostics: … 0 warning(s), **0 error(s)**" (runs 1 and 2)
- "Public methods: log, info, **error**, …" from a file she read (run 3)

With the standing check now reporting a pass every 6 hours, this fires every window. She studied the self-test instance herself (run 2, cycle 13) and concluded no-change, which is a reasonable conclusion for that study but did not reach the cause. **I left it unfixed** because you asked that defects in her code be hers to find. It is yours to decide: leave it for her, or approve it as a direct fix.

## 5. Gates and test totals (final code)

| Check | Result |
|---|---|
| Full suite (`npm test`, model keys removed from the environment, Supabase guard on) | **2,333 tests: 2,327 pass, 0 fail, 6 skipped** (the same 6 as before; they need LiveKit, OPA, gitleaks or VoxCPM). Details: `evidence/improvement-3/GATES.md` |
| Typecheck (`npm run typecheck`, `tsc -b --force`) | exit 0 |
| Lint (`npm run lint`) | 0 errors, 179 warnings (all in pre-existing files; every changed file is clean) |
| Build (`npm run build`) | exit 0 |
| Production bundle has no test files (`scripts/verify-no-tests-in-bundle.mjs dist`) | PASS, 1,520 files |
| Development tab in Chromium | all steps pass, 0 page errors |
| Isolated workspace and production boundary | 14/14 |

**Provider connectivity**, checked without spending any model quota. Only metadata endpoints were called; only status codes were recorded.
- Groq keys 1–3: authenticate. Key 4: rejected (401).
- OpenRouter keys 1–3: authenticate. Key 1 has free-tier credit left; keys 2–3 report 0 remaining. Key 4: rejected (401).
- Cerebras: rejected (401).
- Anthropic: not used. It stays disabled by policy.

**Model calls spent in this session:**
- 2026-11-16 UTC: **8 Groq requests**. 7 came from a first full-suite run that still had provider keys in its environment (this project's suite makes real calls when keys are present; I stopped that run and ran every later suite with keys removed). 1 came from a harness dry run, before I found that under Node providers bypass the broker; the backstop was then fixed to count them.
- 2026-11-17 UTC: **2 counted** (one Groq, one OpenRouter, both self-study), **plus an estimated 1, at most 2,** from the orphaned server-side `npm test` described in 2e. That estimate is not measured: the server's output for those runs was not captured.

## 6. Supabase validations skipped, and what you need to validate

Nothing below was run against any Supabase project.

**A local stack was attempted, then stopped.** A Docker daemon could be started in this environment, and the local Postgres image could be pulled. Installing the Supabase CLI to run `supabase start` (local-only) was refused by this session's permission policy, so I stopped there. The daemon was then shut down and the image removed. A Supabase branch was not used either: it would have meant operating on the production project's account.

| Not validated | Why Supabase is needed | Done independently | You validate |
|---|---|---|---|
| A proposal's `ownerDecision` / `ownerFeedbackHistory` reaching `improvement_items` and back on a second device | The sync writes the proposal as JSON `state` to `improvement_items` | JSON round-trip through the same `mergeRemote` path, unit-tested. No schema or migration change is needed: the new fields live inside `state`. | Sign in on device A, return a proposal with feedback, then open device B and see the same stage and note. |
| Production apply / commit / push with a real verified identity | `verifyRequestIdentity` asks Supabase `/auth/v1/user` | Confirmed refusal when no identity can be established; apply still needs L5 and a one-time grant (unchanged code) | On your deployment, confirm apply is refused for a non-owner and for an owner below L5. |
| Account-wide budget check (`reserve_usage`) alongside the device background allowance | Runs in Postgres | Device allowance and pacing verified locally | Confirm a signed-in background call still records under `usage_records`. |
| The Development tab inside the full signed-in app | Real session | Component tested in Chromium in isolation | Open Self-Development → Development, signed in. |

**Outstanding migration or deployment steps: none required by this work.** It adds no table, column, policy or function. Deployment remains your step.

## 7. Files changed in this session

- `src/core/selfdev/DevelopmentRecord.ts`: proposals shown without their study; feedback history
- `src/core/selfdev/ImprovementQueue.ts`: `ownerFeedbackHistory`, `canRedevelop`, `beginRedevelopment`; Gate 2 keeps earlier feedback
- `src/core/selfdev/SelfDevelopmentLoop.ts`: refuses re-development after acceptance; carries returned feedback
- `src/core/selfdev/ProposalEngineer.ts`: feedback in the engineering brief
- `src/core/cognition/StudyAgentRouter.ts`: the standing self-test study no longer launches the full project suite
- `src/app/scene/genesis/DevelopmentRecordTab.tsx`: "Develop again with your feedback"; feedback history
- `tests/development-gates.test.ts` (new): 7 tests
- `tests/support/block-supabase.mjs` (new): Supabase network guard for development validation
- `scripts/selfdev-experiment.ts`, `scripts/selfdev-experiment-browser.mjs` (new): the experiment harnesses
- `docs/missions/self-study-applied/05-IMPROVEMENT-3-DEVELOPMENT-RECORD.md` (this file), `evidence/development-tab-browser.mjs`, `evidence/isolated-workspace-check.mjs`, `evidence/improvement-3/**`

## 8. How to continue the experiment

Her state from run 3 is not in the repository; it was a local browser profile.

To resume, use a development runtime that is **not** connected to production Supabase:

```bash
T=$(openssl rand -hex 24)
LELU_ENGINEER_TOKEN=$T NODE_OPTIONS="--import $PWD/tests/support/block-supabase.mjs" \
  npx vite --host 127.0.0.1 --port 5173 --strictPort &
LELU_ENGINEER_TOKEN_FOR_PAGE=$T PROFILE=./selfdev-profile COUNTS=./selfdev-counts.json \
  OUT=./run.json CYCLES=40 MODEL_BUDGET=10 LELU_CHROMIUM_PATH=/opt/pw-browsers/chromium \
  node scripts/selfdev-experiment-browser.mjs
```

Add `OWNER_GATE1=1` only when you have read her proposal and want her loop to implement it. The loop stops at Ready, which is Gate 2, for you.
