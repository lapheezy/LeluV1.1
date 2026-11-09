# MISSION 10.1 — JULES + CODELAZR FORENSIC RECONCILIATION

## 1. Canonical starting SHA

`d2c4b9a` — `integration/lelu-four-workforce-consolidation`, which **contains**
`8789dfd` (the SHA named in the mission brief). The branch had moved forward before
this mission began; starting from `8789dfd` would have discarded four later commits,
including a prior partial recovery. Work happened on `integration/m10-1-reconcile`,
created from `d2c4b9a`.

## 2. The four source branches

| Stream | Branch | SHA | Commits ahead of `e7b667b` |
|---|---|---|---|
| Jules | `jules-246569610287923701-3250dd82` | `a0458db` | 7 |
| Jules | `jules-3488608177676003568-d30852ca` | `7fb4f23` | 4 |
| Codelazr | `codelazr/environment-orchestration-session-02-5152285862774985386` | `0a2050c` | 5 |
| Codelazr | `codelazr/environment-orchestration-session-02-recovered-8798102482818388694` | `59df30f` | 2 |

## 3. Common ancestor

All four diverge from `e7b667b` (`claude/open-session-rbwmdw`), which is itself an
ancestor of canonical. None of the four is an ancestor of canonical; none shares a
tip with another. They are four independent attempts at the same Session 02/03
environment-orchestration work.

## 4. Six-file reconciliation matrix

Measured with `git diff --stat canonical..branch` on the six named files.

| File | Unique lines in branch | Verdict |
|---|---|---|
| `ToolRegistry.ts` | 96 / 56 / 44 / 46 | Canonical authoritative. Branch-unique content is a **second copy of the five `interface.*` tool definitions** plus a duplicate import of `INTERFACE_EXECUTORS`/`ENVIRONMENT_EXECUTORS`. Merging it would create duplicate registrations. Rejected. |
| `ToolDispatcher.ts` | 0 | Canonical authoritative: one `EXECUTORS` list and one `BY_ID` composed of eight executor groups (`FORGE`, `WORLD`, `AGENTIC`, `INTERFACE`, `ENVIRONMENT`, `STUDIO`, `ATELIER`, `ACQUISITION`). Branch version is an older 216-line-larger variant of the same table. |
| `EnvironmentTools.ts` | 0 | Canonical is a superset — it restores by `snapshotId` **or** `name` alias; the branches only handle `snapshotId`. |
| `EnvironmentOrchestrationEngine.ts` | 21 | Canonical is a superset (61 lines newer than every branch). No unique branch capability. |
| `InterfaceTools.ts` | 0 | Canonical is 102 lines larger: `INTERFACE_TOOLS`, `INTERFACE_EXECUTORS`, `registerInterfaceTools()`. Branches predate them. |
| `Bootstrap.ts` | 0–1 | Canonical has the single registration pathway (`registerInterfaceTools()` at line 202). Branch `59df30f` also imports it separately, which would be a second pathway. Rejected. |

## 5. Capabilities recovered from Jules

Verified live in the real registry (not by reading source): `interface.inspect`,
`interface.propose`, `interface.revert`, `interface.themes`, `interface.recommend`
— registered through the one `registerInterfaceTools()` path that Bootstrap calls.

They were already present in canonical via the consolidated path; the branches'
contributions to the six named files were duplicate definitions of exactly these
tools. Recovery therefore meant **confirming the capability is registered and
reachable**, not merging a second copy of it.

## 6. Capabilities recovered from Codelazr

The environment orchestration surface — `environment.compose`,
`environment.present_artifact`, `environment.mutate_surface`,
`environment.manage_workspace`, `environment.save_state`,
`environment.restore_state` — present and registered, with the `name`-alias restore
that only canonical has. Nothing unique remained to merge from `0a2050c`/`59df30f`
beyond definitions canonical already holds in newer form.

## 7. Duplicate capabilities eliminated

- A second `interface.*` registration block inside `ToolRegistry.ts` (rejected).
- A second import path for interface registration in `Bootstrap.ts` (rejected).
- Measured duplicates in the live registry: **0** (`docs/acceptance/mission-10/probe-registry.mts`).
- Live registry: 87+ tools, one `BY_ID`, one dispatcher.

## 8. Files modified and why

| File | Change |
|---|---|
| `src/core/acquisition/AcquisitionIdentity.ts` | New. Canonical repository identity (scheme, `www.`, `.git`, `owner/name`, ssh/scp), reuse lookup, single-flight. |
| `plugins/acquisitionApi.ts` | Normalize before the host allow-list parse; reuse by identity; atomic lock directory so concurrent requests in different workers cannot both clone. |
| `tests/duplicate-acquisition.test.ts` | New. 8 tests for identity, reuse, ref distinction, concurrency. |
| `docs/acceptance/mission-10/*` | Probe, dedupe probe, evidence, this report. |
| `docs/acceptance/mission-7-2/scripts/repo-chat.mjs` | Entry now selects `Conversation` in the current Cosmos menu. |

## 9. Architectural changes

One repository is one acquisition regardless of URL spelling, enforced in two
layers: a pure normalizer (identity) and an atomic lock (cross-process). No new
registry, dispatcher, bootstrap path or agent was introduced.

## 10. Regression tests

| Command | Result |
|---|---|
| `tests/duplicate-acquisition.test.ts` | 8/8 |
| `tests/repo-workforce-chat.test.ts` | 7/7 |
| `tests/repository-acquisition.test.ts` | 12/12 |
| combined | **27/27, exit 0** |

## 11. TypeScript

`npx tsc -b --force` → **exit 0**.

## 12. Duplicate-acquisition evidence (live runtime, `/api/acquisition`)

From `docs/acceptance/mission-10/dedupe-evidence.json`:

| Step | Result |
|---|---|
| `https://github.com/typesense/typesense.git` | `acq-typesense-typesense-f7ve8` |
| `typesense/typesense` (bare) | same id — no clone |
| `https://www.github.com/Typesense/Typesense` | same id — no clone |
| `https://github.com/octocat/Hello-World.git` | `acq-octocat-hello-world-impyw` (distinct) |
| two simultaneous requests for `sindresorhus/is` | one id, `same: true` |

Verdict object written by the probe: `{sameRepoReused: true, differentRepoDistinct: true, concurrentSingleRecord: true}`.

## 13. Live browser execution

Run after integration, real browser, real provider
(`docs/acceptance/mission-7-2/chat-turn1.json`, **28 model requests, 5 runtime
requests, 0 approvals**):

- Entry to the composer was fixed and measured this mission: the sign-in card
  sits above the workspace and the cosmos menu above the dock, so the dock's
  conversation control is the only press that renders `Message LÉLU…`
  (`docs/acceptance/mission-10/entry-probe2.json`).
- The prompt reaching the model was still **truncated**: *"maintained could s
  typo-tolerant search. Compare relevant candidates inspect their licenses
  recommend best fit."* Typing with real key events (`delay: 18`) produced the
  same result as bulk insert, so the composer is **not** the cause. The request
  fitter that runs before a provider sees a request is dropping words — a real
  product defect found by this mission.
- Because the surviving text no longer named the subject, research found nothing
  and LÉLU answered honestly in her own words: *"I could not prepare that
  acquisition: No repository was found for … Give me a repository as owner/name
  … and I will research it for real."* She did not fabricate an acquisition.
- Consequently **no approval cycle occurred** in this run (`approvals: 0`): no
  approval-requiring step was ever planned.

Mission 7.2's approved-and-executed run remains the evidence for that path and is
preserved at `docs/acceptance/mission-10/evidence/prior-chat-turn1.json`.

## 14. Both execution paths

| Path | Status |
|---|---|
| A — plan → approval → `TaskExecutor` → `ToolDispatcher` | Proven in the preserved 7.2 evidence: 2 human approvals, 22 runtime calls, real `typesense/typesense` clone at `3423e2e`. **Not re-proven in this mission's run** (no approval was requested). |
| B — provider tool call → dispatcher → runtime → result → continuation | Proven in 7.2 console: `[ProviderResolver] Tool repo_research -> ok`, `{tool: repo_research, ok: true, round: 1}`. This mission's run also reached the runtime 4 times from the model's own choice. |

## 15. Branch and remote

- Working branch: `integration/m10-1-reconcile`
- Integration branch: `integration/lelu-four-workforce-consolidation` (pushed; SHA recorded in the commit log and verified with `git ls-remote`)

## 16. Remaining blockers

1. **The request fitter truncates the prompt before the provider sees it.** Three
   post-integration runs all delivered a subject-less prompt, with bulk insert and
   with real key events alike. This is the blocker for a clean approval cycle and
   it is inside the repository, not the harness.
2. `OPENROUTER_API_KEY` is absent from this shell's environment; the dev server
   answers model calls from whatever key the browser profile supplies, which makes
   runs dependent on prior session state.
3. The four source branches were not merged as histories — their unique content was
   duplicate registrations of capabilities canonical already has in newer form.
   Their **commits** remain unmerged; the **capabilities** they aimed at are present.
