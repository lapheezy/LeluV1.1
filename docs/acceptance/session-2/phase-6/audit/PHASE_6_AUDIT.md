# Session 2 · Phase 6 — Self-engineering audit (read-only)

**Status of Phase 6: NOT STARTED as implementation. This is the read-only audit only.**
No code was changed, nothing was committed, and no proposal was approved, executed
or applied. The owner chose "read-only audit first" because the Session 1
acceptance report the brief requires does not exist (see *Prerequisite*).

- Audited commit: `665f849` (`origin/claude/avatar-3d-world`, 2026-11-04), the newest
  commit in `lapheezy/LeluV1.1`. It already contains Session 2's cognition work
  (`d3e6e75`) and the Cosmos/chat work (`d1e21c4`).
- Checkout: a detached worktree with its own `bun install --frozen-lockfile`; dev server
  `vite` on port 5174; Chromium (Playwright) at 1440×900.

## Prerequisite — not met

The brief says Session 1 must have completed its acceptance report. No branch contains
`docs/acceptance/session-1/` or any document that calls itself the Session 1 acceptance
report. The session "LÉLU: Anthropic chat live + avatar 3D generation" is still
**running** and committing to `claude/avatar-3d-world` (latest 2026-11-04 19:40Z).

## A naming fact that changes the brief

**No button labelled "Execute" or "Implement" exists in this commit or in any commit of
any branch.** Searched with `grep` over `src`, `plugins`, `server.ts` and with
`git log --all -S` for the label strings. The actions that do exist, and what they map to:

| Brief's word | Real control | Where | Calls |
|---|---|---|---|
| Execute | **APPROVE** | Updates panel (`GenesisNotificationsPanel.tsx:254`), opened by the home bell | `SelfDevelopmentLoop.approve()` → `develop()` |
| Execute | **Develop — run + test** | Self-development panel (`GenesisSelfDevPanel.tsx:963`) | `develop(id, { runWorkspaceTypecheck })` |
| Implement | **Apply to workspace — write + verify + rollback** | Self-development panel (`:971`) | `applyCandidate(id, { approved: true })` |
| (record) | **INTEGRATE** | Updates panel (`:310`) | `approve()` — **wrong, see D1** |
| (record) | **Integrate (record result)** | Self-development panel (`:977`) | `integrate(id)` |

## The pipeline as it actually runs (traced in code)

```
proposal created   ← DailyReflection / EngineeringResolver / CapabilityRegistry gaps
  ImprovementQueue (KvStore "lelu.improvements.v1", synced to Supabase: SupabasePersistence.ts:426/529)
notification       ← Updates panel lists the queue; home card shows LÉLU questions
"Execute"          → SelfDevelopmentLoop.develop(id, options)
                     AutonomyGate ≥ L2 (default L3)
                     snapshot sandbox (VersionHistory)                    real
                     status → In Development                              real
                     apply options.edits to SandboxFS                     ← only if edits passed
                     syntax check, tests (isolated worker)                real
                     [typecheck via /api/engineer/command, L3+]           real
                     candidate snapshot + patch → status Ready            real
                     AgentEventBus events, taskId = proposal id           real
"Implement"        → applyCandidate(id, {approved}) — needs AutonomyGate L5
                     writes SelfCode working copies → /api/engineer/write  real
                     workspace typecheck → rollback on failure            real
                     status → Integrated
```

The backend is live in this checkout: `GET /api/engineer/status` →
`{"available":true,"runtime":"vite-dev","operations":["typecheck","build","test","inspect"]}`.

## Root causes (each traced to a line)

| # | Defect | Evidence | Effect |
|---|---|---|---|
| **D1** | **INTEGRATE in the Updates panel calls `handleApprove`** | `GenesisNotificationsPanel.tsx:310` → `handleApprove` → `queue.setStatus("Approved")` + `SelfDevelopmentLoop.approve()` | A Ready candidate is sent back to Approved and developed again. It can never reach Integrated from this panel: Ready → INTEGRATE → Approved → … → Ready, forever. |
| **D2** | **"Execute" never produces a change for the proposal** | `approve()` calls `develop(id)` with no `edits` (`SelfDevelopmentLoop.ts:106`). The panel's Develop does the same (`GenesisSelfDevPanel.tsx:223`). The only caller that passes edits is a self-test probe (`SelfTestRunner.ts:436`). No agent is dispatched to write the change. | The loop records `edit: skipped — continuing with the existing working copy`, runs syntax and tests on whatever is already in the sandbox, and marks the proposal **Ready** with a "verified candidate" that may contain nothing for that proposal. This is a real run, but it is not the proposal's work. |
| **D3** | **"Implement" has nothing to write unless a human edited a working copy by hand** | `applyCandidate` writes only `selfCode.workingCopies()` that differ from source (`:505-531`). These come from the panel's *Source* tab (`openWorkingCopy`), not from the proposal. | With D2, Apply normally returns `Nothing to apply — working copy matched production`. |
| **D4** | **Execution and implementation share one end state** | `integrate()` (records only, no source write: `:337`) and `applyCandidate()` (writes source) both set **Integrated** (`:445`, `:554`). | "Integrated" cannot tell "recorded" apart from "applied to the code". The brief requires separate states. |
| **D5** | **A gate-blocked run leaves the proposal stuck** | `approve()` sets Approved (`:104`); `develop()` returns early when `AutonomyGate < 2` without updating the queue (`:200-205`). | The Updates panel shows "In progress — approved" with nothing running. Only reachable if autonomy is lowered below L2. |
| **D6** | **"Implement" is not reachable from where proposals are shown** | `applyCandidate` is wired only in the Self-development panel. That panel is hidden from the dock by default (`GenesisDock.tsx:141`, `DEFAULT_HIDDEN`) and reachable from the home's App Library → Development → Self Development (`home/homeCatalog.ts:38`). The Updates panel, which the bell opens, has no apply action. | From a notification, a user can approve but cannot implement without finding a second panel. |
| **D7** | **L5 is needed for Implement, and nothing explains it at the button** | `applyCandidate` → `AutonomyGate.can(5)` (`:498`); the default is L3 (`AutonomyGate.ts:53`). | Apply fails with "requires autonomy level 5" until the owner raises the level elsewhere in the panel. This is the correct boundary, but it reads as "broken". |

What is **not** broken: snapshot, sandbox syntax and tests, the workspace typecheck and
write endpoints, rollback, the event stream, and the L5 + explicit-approval boundary.
These are real. The faults are in how the UI drives them (D1, D6), in the missing
code-writing step (D2, D3), and in status modelling (D4, D5).

## Live observations (read-only)

- `00`/`01-home`: the new Cosmos home with a Notifications card ("LÉLU has a question").
- `02-notifications`: the bell opens the **old** "LÉLU Updates" panel in a window. It has
  9 active proposals (status Detected, "Complete capability …") with APPROVE / REJECT / DEFER.
  The card text is clipped on the right, and the chat window overlaps the panel. This is
  input for Phase 7.
- Autonomy level 3 in a fresh profile.

## What was not done, and why

- **No proposal was approved, executed, integrated or applied.** The attempt was blocked by
  this session's permission check. Approving changes the proposal queue, which syncs to the
  owner's Supabase project, and starts a development run, so it is not read-only.
  Consequently there are **no execution IDs, no live-execution screenshot, no code-change
  screenshot and no test-result screenshot**. Every Phase 6 acceptance test is **NOT RUN**.
- Phases 7, 8 and 9: **NOT STARTED**.

## Proposed fix (for when implementation is authorized)

Minimal, using the existing pipeline. Nothing is rebuilt.
1. **D1:** INTEGRATE → `loop.integrate(id)`; add an "Apply to code" action beside it (D6).
2. **D2/D3:** Execute dispatches the existing engineering agent (`EngineeringResolver` /
   agentic `task.start`) to turn the proposal into sandbox `edits`, then calls
   `develop(id, { edits })`. With no edits produced, the run stops as **Testing** with
   "no change was generated", not Ready.
3. **D4:** a distinct status for applied-to-source (e.g. `Applied`), separate from the
   recorded `Integrated`.
4. **D5:** a gate-blocked run sets the proposal back to Proposed with the reason.
5. **D7:** show the required level and a one-step "raise to L5 for this apply" approval at the
   Apply button. The boundary itself stays as it is.

## Evidence files

`01-home.jpg`, `02-notifications.jpg` (in this folder; converted to JPEG).
