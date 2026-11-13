# MISSION 6.1.7 — UNIFIED EXECUTION EVIDENCE AND RECOVERY

Date: 2026-11-13
Branch: `mission/6.1.7-unified-execution-evidence` (work left **uncommitted** — see §11)
Base: `890c2b9` (Mission 6.1.6)
Verdict: **Both orchestration paths now produce one correlated, server-visible lifecycle per real
tool invocation, emitted only by the code that observed the outcome. Duplicates, refusals,
timeouts and cancelled turns are distinguishable from executions, and none of them can be reported
as success.**

---

## 1. Phase 0 — reconciliation (before any edit)

| item | value |
|---|---|
| canonical remote | `integration/lelu-four-workforce-consolidation`, fetched |
| canonical tip | `098dd3e` — **0** new commits since 6.1.5's base, nothing to reconcile |
| mission branch at start | `mission/6.1.6-multi-step-orchestration` |
| HEAD at start | `890c2b9…` — matches the reported SHA |
| working tree | clean |
| `21b3279` / `e3172d9` / `098dd3e` ancestors | yes / yes / yes |
| 6.1.6 diff (inspected) | 8 files, +536/−4: report, `plugins/modelApi.ts`, `AgentEvents.ts`, `TurnActivity.ts`, `ProviderResolver.ts`, `ToolDeadline.ts` (new), `ToolDispatcher.ts`, `tests/multi-step-orchestration.test.ts` (new) |

**Ownership / overlap with the voice workstream:** the 6.1.6 change set touches no voice file.
The protected files named in the brief — `TaskPlanner.ts` and `Orchestrator.ts` — were **read only**
(their routing heuristic explains which path a prompt takes) and are not modified here. No
LiveKit / VoxCPM / voice worker / voice configuration file is in this change set. **No ownership
conflict, so work proceeded.**

## 2. Phase 1 — one execution identity

`src/core/tools/ExecutionEvidence.ts` (new) owns identity and lifecycle. The dispatcher creates it,
because the dispatcher is the only place where an invocation becomes real.

```
identity = `${path}-${time36}-${seq}-${hash(taskId)}`
```

Fields: `executionId`, `taskId`, `path` (`chat` | `task` | `unknown`), `stepId?`, `tool` (registry id),
`requestedName?` (when the model used a different name), `approval`, `stage`, `outcome?`,
`startedAt?`, `finishedAt?`, `durationMs?`, `reason?` (redacted, ≤200 chars).

Distinctions the brief demanded, enforced by construction:

| concept | how it is represented |
|---|---|
| planned step | a `TaskEngine` step — no execution record exists until `perform()` dispatches |
| model request | broker line / `messages=` — never an execution record |
| retry | a **new** identity; the task engine's call id already includes an attempt timestamp |
| real execution | one identity, `started` measured in the dispatcher |
| suppressed duplicate | its own identity with `stage: "suppressed"` — never a second `succeeded` |

Path is supplied by the caller (`{ path: "chat" }` in `ProviderResolver`, `{ path: "task" }` in
`TaskExecutor`), and defaults to `"unknown"` — an unlabelled caller is recorded honestly rather
than guessed. The live run caught exactly such a caller: the background curiosity loop
(`memory.recall`, task `curiosity-…`) records `path=unknown`.

## 3. Execution lifecycle diagram

```
                 ┌──────────────────────── one real invocation ────────────────────────┐
 dispatchToolCall│                                                                     │
   entry         │  stage=requested        (always; even if the tool does not exist)    │
                 │                                                                     │
   resolve name ─┼─ not found ───────────► stage=failed   outcome=failed   reason=…     │
                 │                                                                     │
   permission    ├─ approval gate ───────► stage=authorized  approval=approved          │
   + activation  └─ refused ────────────► stage=refused    outcome=refused  reason=…    │
                 │                                                                     │
   executor.run  │  stage=started         startedAt = dispatch clock                   │
                 │      │                                                              │
                 │      ├─ ok ───────────► stage=succeeded  outcome=succeeded          │
                 │      ├─ threw ────────► stage=failed     outcome=failed             │
                 │      └─ deadline ─────► stage=timed-out  outcome=timed-out          │
                 │            durationMs = finishedAt - startedAt (execution layer)    │
                 └─────────────────────────────────────────────────────────────────────┘

 duplicate call in the same round (ProviderResolver):
        stage=suppressed  outcome=suppressed  (own identity, no dispatch)

 transport: AgentEventBus (existing) ──► ExecutionTelemetry (batch, 400 ms) ──► POST
            /api/execution/events ──► sanitize + re-redact ──► one `[execution]` log line
            └──► TurnActivity (existing card) shows the same steps and durations
```

## 4. Phase 2 — event schema and examples

Event added to the existing union (no second bus): `{ type: "execution_evidence", taskId, record }`.

Server line format (`formatExecutionLine`):

```
[execution] id=chat-mwf2hvh1-1-i46w37 stage=requested   path=chat tool=system.config task=1794579820487
[execution] id=chat-mwf2hvh1-1-i46w37 stage=authorized  path=chat tool=system.config task=1794579820487
[execution] id=chat-mwf2hvh1-1-i46w37 stage=started     path=chat tool=system.config task=1794579820487
[execution] id=chat-mwf2hvh1-1-i46w37 stage=succeeded   path=chat tool=system.config task=1794579820487 outcome=succeeded durationMs=0
[execution] id=chat-mwf2vhh4-2-i46w37 stage=succeeded   path=chat tool=workflow.list   task=1794579820487 outcome=succeeded durationMs=1
```

Endpoint: `POST /api/execution/events` with `{ events: ExecutionRecord[] }` →
`{ ok, recorded, dropped }`. Guards: POST only, same-origin (`Origin` host must match `Host`),
64 KiB body cap, ≤100 records per batch, shape validation, per-`(executionId, stage)` dedupe so a
retried POST cannot inflate a count, re-redaction server-side, and **no arguments accepted at all**.

Verified live: `{"ok":true,"recorded":1,"dropped":2}` for a batch of [valid, duplicate, malformed].

## 5. Phase 3 — live Path A multi-round acceptance

Prompt sent through the real UI, chosen to avoid the orchestrator's multi-step triggers (which would
route to Path B): *"Use system_config to see which providers are unconfigured. Then use
workflow_list. Report each tool's own output."*

**Server-side execution evidence (real, from the browser):**

```
[execution] id=chat-mwf2hvh1-1-i46w37 stage=succeeded path=chat tool=system.config outcome=succeeded durationMs=0
[execution] id=chat-mwf2hvh4-2-i46w37 stage=succeeded path=chat tool=workflow.list  outcome=succeeded durationMs=1
```
— two distinct identities, each with requested → authorized → started → succeeded.

**Model-round evidence (broker log, server's own view of the requests):**

```
bytes=36203 messages=10 toolResults=0 prompt≈6318tok tools≈2644tok max_tokens=2048 stream=1
bytes=37234 messages=13 toolResults=2 prompt≈6575tok tools≈2644tok max_tokens=2048 stream=1
```

`toolResults` counts `role: "tool"` messages the request carried. The second round carried **2** —
both dispatcher results reached the model before the final answer. The answer then quoted each
tool's own words:

> System Config Output: *Configured: nothing. Not configured: provider.groq, … persistence.supabase.*
> Workflow List Output: *No workflows are defined yet.*

and the UI card read "Working with tools — 3 tools used — Done" across the session.

**Why this is model feedback and not two planned steps:** the second request is a *model round*
(13 messages, 2 tool results, tools still offered) and its answer reproduces both outputs, while
`workflow.list` is not derivable from `system.config`'s text — the model had to read result 1 to
decide the second call, exactly as the scripted-turn test asserts in `tests/multi-step-orchestration.test.ts`.
This was **Path A** (`path=chat` on every record), not TaskExecutor.

![Path A evidence](artifacts/perf/6.1.7-path-a-evidence.png)

## 6. Path B server-observable acceptance

Path B now passes `{ path: "task", stepId }`, so its steps are recorded with the plan step and are
indistinguishable in *shape* from Path A while remaining distinguishable in `path`.

- Live (6.1.6 run, same code path): two TaskExecutor steps executed through `dispatchToolCall` with
  real results.
- This mission: the wiring is asserted (`tests/execution-evidence.test.ts` — "the task-engine path
  is recorded as its own path, with its step": every record carries `path=task` and `stepId=step-1`),
  and the source-level binding test now asserts the path option is passed.

**Gap, stated plainly:** the live Path B run of *this* mission was refused by providers (OpenRouter
402 "prompt tokens limit exceeded 43348 > 35193" and Groq 413 on a 47k-token planner request, then
githubModels answered), so the turn ended in the honest offline notice. Path B's live evidence is
therefore inherited from 6.1.6 plus this mission's tests, not re-observed server-side today.

## 7. Phase 4 — recovery and interruption

| case | result |
|---|---|
| tool timeout | **VERIFIED** — deadline fires, `stage=timed-out`, `outcome=timed-out`, never `succeeded` (unit test on the mechanism; the dispatcher mapping is covered by the same code path) |
| user cancellation | **VERIFIED** — an aborted signal rejects the turn and records **zero** `started`/`succeeded` records (test) |
| provider failure between rounds | **VERIFIED** — the tool that ran keeps its `succeeded` record; the model-round failure produces no fabricated execution (test) |
| duplicate invocation | **VERIFIED** — one execution, one `suppressed` record with its **own** identity |
| invalid tool result | **VERIFIED** — failure recorded with reason; a tool cannot forge success (records only come from `dispatchToolCall`) |
| partial failure | **VERIFIED** (6.1.6 test, still passing) |
| reload during execution | **NOT TESTED** — no browser reload was driven mid-tool |
| interrupted execution recovery | **PARTIAL** — `TaskExecutor.recoverInterrupted()` was read (marks `running` steps `pending`, task `paused`, progress "Interrupted before it finished — resumable"); not exercised |
| retry after interruption | **PARTIAL** — `maxAttempts` retry exists and each attempt gets a fresh identity; no test drives a resumed task |

Unknown-outcome honesty: a `started` record with no terminal stage is exactly what an interrupted
execution leaves behind — it is never upgraded to success anywhere in the code or the log.

## 8. Phase 5 — execution integrity

| check | result |
|---|---|
| duplicate prevention scoped correctly | same round only; the key is `name + JSON.stringify(args)`; separate later executions get separate identities (**tested**) |
| legitimate executions not suppressed | two identical calls in *different* rounds both execute (**tested**: distinct ids) |
| timeouts leave no orphaned state | terminal record written; `withDeadline` clears its timer in `finally` |
| approval decisions preserved | `approval` recorded as `not-required` / `approved` / `refused`; the gate itself is untouched |
| disabled capabilities inaccessible | refusal recorded, no executor output (**tested** in 6.1.6 and again here) |
| a tool cannot forge success | records are produced only by the dispatcher after it observed the result |
| results tied to identity | one `executionId` across all stages (**tested**) |
| partial failures preserve successes | per-call outcomes, not per-round (**tested**) |

## 9. Phase 6 — acceptance numbers

| check | result |
|---|---|
| `tsc -b --force` | **exit 0** |
| `vite build` | **exit 0** |
| full suite | **2,045 tests / 2,038 pass / 1 fail / 6 skipped** |
| baseline (6.1.6) | 2,035 / 2,028 / 1 / 6 — **+10 tests, same single failure** |
| pre-existing failure | `tests/voice-continuity.test.ts` "a streamed reply ends in 'listening'/'idle'…" — untouched voice-owned code, still separately identified |

Two existing tests needed updating because this mission deliberately changed what they assert:

1. `tests/creation-studio-tools.test.ts` — asserted the **exact source text** of the dispatch call;
   updated to the new call that passes `path: "task"`.
2. `tests/live-agent.test.ts` — asserted the exact event sequence of a failed page read. Evidence
   stages now ride the same bus, so the browser-event assertion filters them and **new, stricter
   assertions** were added (one identity, a `failed` stage present). Not a weakening.

One real bug was found by the suite and fixed: `newExecutionId` crashed when a caller passed no
`taskId` (`hash(undefined)`), which `tests/live-agent.test.ts` triggers. Identity now tolerates a
missing owner instead of throwing during dispatch.

## 10. Known limitations

1. **Path B live evidence is not re-observed this session** (provider refusals ended the turn).
2. **Reload mid-execution** is not tested.
3. **Interrupted-task recovery and retry** are read, not driven.
4. **`path=unknown`** still appears for background callers (curiosity loop) — honest, but they are
   not yet labelled.
5. Evidence is capped in memory (5,000 dedupe keys, 200 queued, dropped on a failed flush). It is a
   log, not a durable execution store; there is no query API.
6. The 47k-token planner request (Path B) is still refused by OpenRouter and Groq — a payload
   problem outside this mission's scope.

## 11. Git state — deliberately not committed

Mission 6.1.7's Git rules forbid committing or pushing without separate authorization, so all work
is left **uncommitted** on `mission/6.1.7-unified-execution-evidence`, cut from `890c2b9`.

Changed:
```
 M server.ts                                   (mount the evidence route)
 M src/core/agent/AgentEvents.ts               (execution_evidence event)
 M src/core/agentic/TaskExecutor.ts            (path=task, stepId)
 M src/core/router/ProviderResolver.ts         (path=chat, suppressed record)
 M src/core/tools/ToolDispatcher.ts            (identity + lifecycle)
 M src/core/workspace/visualizers.ts           (event status map entry)
 M tests/creation-studio-tools.test.ts         (call-shape assertion)
 M tests/live-agent.test.ts                    (event-sequence assertion)
?? src/core/tools/ExecutionEvidence.ts         (new: identity, redaction, log line)
?? src/core/tools/ExecutionTelemetry.ts        (new: bus → server forwarder)
?? plugins/executionEvidenceApi.ts             (new: POST /api/execution/events)
?? tests/execution-evidence.test.ts            (new: 10 tests)
?? MISSION-6.1.7-UNIFIED-EXECUTION-EVIDENCE.md (this report)
```

No voice, VoxCPM, LiveKit, TaskPlanner or Orchestrator file is touched.

## 12. Recommended next mission

**6.1.8 — Payload weight under Path B, then durable execution records.** The planner request that
failed twice today carried 47,198 prompt tokens for a two-step task, which is why the live Path B
acceptance could not run: the same selection work 6.1.4 did for chat has never been applied to the
task planner's context. Addressing that both restores Path B acceptance and removes the largest
remaining source of provider refusals. Only after that is a durable (queryable) execution store
worth building.
