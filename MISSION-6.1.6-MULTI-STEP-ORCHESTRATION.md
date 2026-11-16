# MISSION 6.1.6 — MULTI-STEP TOOL ORCHESTRATION & EXECUTION RELIABILITY

Freebuff session — this branch is not combined with any other workstream.
Date: 2026-11-13
Branch: `mission/6.1.6-multi-step-orchestration`
Baseline: `21b3279` (Mission 6.1.5)
Verdict: **Two sequential tools really ran, in order, through the production dispatcher, and the
answer was built from their actual output. Two execution paths exist; only one of them reports its
tool results to the server. A hung tool now has a deadline, and a repeated call no longer runs
twice.**

---

## 1. Phase 0 — branch, HEAD, working tree, ancestry

| item | value |
|---|---|
| canonical remote | `integration/lelu-four-workforce-consolidation` fetched — tip `098dd3e` |
| new canonical commits since 6.1.5's base | **0** — nothing to reconcile |
| my 6.1.5 commit on the remote | no (local-only, as instructed) |
| starting branch | `mission/6.1.5-tool-discovery-execution` |
| starting HEAD | `21b3279` (exact match to the required baseline) |
| working tree at start | clean |
| `e3172d9` ancestor of HEAD | yes |
| `098dd3e` ancestor of HEAD | yes |

Mission 6.1.5 is preserved untouched: `21b3279` is an ancestor of this branch, and its report,
tests and measurement script are intact.

**Established before changing anything:** the dispatcher, the tool registry and the discovery
system were read, not rebuilt. There are **two** production orchestration paths, and this mission
had to deal with both:

```
A. CHAT TOOL LOOP (mission 6.1.5's subject)
   ProviderResolver.generateWithTools → toolCalls → dispatchToolCall → tool message → next round

B. TASK ENGINE (pre-existing; a multi-step-sounding prompt goes here)
   TaskEngine plan → TaskExecutor step → perform() → dispatchToolCall (the SAME dispatcher,
   through the same approval gate) → step.result → TaskExecutor.report()
```

Both end at `dispatchToolCall`, so no capability is duplicated. Path B drives its model through a
text plan (`tools=0` on the wire), which is why a request recorder sees no `role: "tool"` messages
on that path even though tools really ran.

## 2. Phase 1 — sequential multi-tool execution

### 2.1 Verified in the production loop (scripted model, real dispatcher and real executors)

`tests/multi-step-orchestration.test.ts` drives path A with three scripted turns:
`system_config` → `workflow_list` → final answer.

| property | assertion |
|---|---|
| A executed, result returned | round 2 carried 1 tool message, id `step-a`, content matching the real `/Configured:/` output |
| B requested only after A's result | round 2's content is what the scripted model read before asking for B |
| B executed, result returned | round 3 carried **2** tool messages, ids `["step-a", "step-b"]`, in order |
| both results usable together | the two contents differ, and the final answer is produced in round 3 |
| correlation | every tool message keeps its own `toolCallId`; `toolError` is set per call |

### 2.2 Verified live, real model (Phase 5)

Prompt through the real UI: *"Step one: use system_config to check what is configured. Step two:
only after that, use workflow_list to count my workflows. Then tell me both answers."*

The production router chose **path B** for this phrasing. Evidence:

```
[model broker] provider=openrouter model=openai/gpt-4o-mini status=200 bytes=188781 messages=4
               toolResults=0 prompt≈47071tok tools≈0tok max_tokens=2500 stream=0
```

The model planned; `TaskExecutor` executed each tool step through `dispatchToolCall`. The answer
rendered by `TaskExecutor.report()` — which prints each step's **real** `step.result`:

```
Completed and verified: Step one… Step two…
1. [completed] Check configured capabilities (system.config) — Configured: nothing. Not configured:
   provider.groq, provider.openrouter, provider.cerebras, provider.mistral, provider.fireworks,
   provider.anthropic, provider.github-models, persistence.supabase.
2. [completed] List workflows (workflow.list) — No workflows are defined yet.
```

Both outputs match direct `dispatchToolCall` results exactly, step 2's title is only meaningful
after step 1, and the activity card read **"Working with tools — 2 tools used — Done"**. Step
results are assigned from the dispatcher's return value, not from the model's text, so this is real
execution rather than a plan being reported as done.

**Live limitation:** because the router picked path B, path A's *multi-round* loop was proven with
a scripted model, and the live run proved path B end to end. Both are production code; neither is
mocked except for path A's turn text.

## 3. Phase 2 — execution reliability

| case | behaviour | how established |
|---|---|---|
| **Duplicate tool calls** | identical `(name, args)` twice in one round executes **once**; the repeat's message starts "Not run again …" and carries the first result | fixed this mission; test |
| **Tool timeout** | a tool that never settles is stopped at the deadline (45 s default, `LELU_TOOL_TIMEOUT_MS`) and returns `"<tool>" did not finish within 45s. It was stopped, so nothing is reported as done.` | new deadline module; test on the mechanism |
| **Tool not found** | "There is no tool named …", `toolError: true` | test |
| **Registered, no executor** | dispatcher's own honest text | pre-existing |
| **Partial failure** | the working tool keeps its real output, the broken one is named, statuses stay per-call | test |
| **Disabled capability** | refused even when the model asks for it by name; the executor's output never appears | test |
| **Interrupted turn** | `throwIfStopped` before every dispatch; a stop between rounds settles as "cancelled" | pre-existing, unchanged |
| **Provider refusal** | chain falls through per rung; a refused model no longer erases tools that really ran | pre-existing |
| **Truncated response** | `metadata.truncated` from 6.1.5 | unchanged |
| **Reload during execution** | **NOT TESTED** — requires killing the tab mid-tool; the task engine's `recoverInterrupted()` marks such steps `paused` and resumable, read but not exercised | — |

**No false success states introduced.** The one risky-looking surface is path B's
"Completed and verified" headline: it is emitted only when `task.status === "completed"`, and each
step line carries that step's own status and real result — a failed step reads `[failed] ... — <error>`.

## 4. Phase 3 — activation and permissions

- The gate is `toolPermitted` → registry availability + `AutonomyGate` + `CapabilityActivation.isToolEnabled`
  + engineering/approval gates. Path B additionally routes sensitive tools through `ApprovalGate`
  before `dispatchToolCall`.
- Verified by test: a deactivated capability's tool cannot execute **even when the model names it**;
  the refusal is honest and the executor's real output never appears.
- **Marketplace discovery → activation → invocation: PARTIAL.** No acquired capability is registered
  in this environment (`capabilities_list` honestly reports none), so the trigger for an activation
  does not exist here. The gate it would move is verified; the catalogue is empty.

## 5. Phase 4 — observability

Added or aligned this mission:

| requirement | state |
|---|---|
| tool selected | `tool_selected` (pre-existing) |
| tool invoked / started | `tool_started` (pre-existing) |
| execution completed / failed | `tool_result` with `status: complete \| error \| blocked` (pre-existing) |
| **execution duration** | **new** — `durationMs` on every `tool_result`, and the activity step shows it as `… · 12ms` |
| retry / recovery | path B retries with `maxAttempts`, recovery marks steps resumable; path A has no retry — honest, documented |
| final task outcome | path B `report()`; path A settles the turn |
| UI card vs server | **PARTIAL** — see below |

**The gap, precisely:** the model broker now logs `toolResults=<n>` (the count of `role: "tool"`
messages in the request), which is the server's own proof that path A fed results back. In the live
run it read `toolResults=0` on both requests, correctly, because path B does not send tool messages
to the model. So:

- path A: UI events and server `toolResults` agree;
- path B: UI shows the real steps and durations, the server has no tool-level record.

Closing that would need a new server ingest for client events. That is new infrastructure, so it was
not invented here; it is reported instead.

## 6. Phase 6 — regression

| check | result |
|---|---|
| new acceptance tests | `tests/multi-step-orchestration.test.ts` — **5/5** |
| agentic execution tests | included in the full run (task engine, approvals, recovery) |
| provider tests | included in the full run |
| full suite | **2,035 tests / 2,028 pass / 1 fail / 6 skipped** |
| `tsc -b --force` | **exit 0** |
| `vite build` | **exit 0** |

Baseline was 2,030 / 2,023 / 1 / 6 (Mission 6.1.5). Five tests added; the same single pre-existing
failure remains (`tests/voice-continuity.test.ts`, "never stuck in 'speaking'" — untouched voice
workstream, unrelated to orchestration).

## 7. Files changed

| file | change |
|---|---|
| `src/core/tools/ToolDeadline.ts` | new — bounded execution (`withDeadline`, `ToolTimeoutError`, `toolTimeoutMs`) |
| `src/core/tools/ToolDispatcher.ts` | tools run under the deadline; a timeout is an honest failure; `durationMs` on result events |
| `src/core/router/ProviderResolver.ts` | identical calls in one round execute once; the repeat says so |
| `src/core/agent/AgentEvents.ts` | `durationMs` on `tool_result` |
| `src/core/multichat/TurnActivity.ts` | the step shows how long the tool really took |
| `plugins/modelApi.ts` | broker line carries `toolResults=<n>` |
| `tests/multi-step-orchestration.test.ts` | new — 5 integration tests |
| `MISSION-6.1.6-...md` | this report |

Nothing in voice, VoxCPM2 or LiveKit was touched. No provider, no second registry, no second
dispatcher, no capability removed.

## 8. Status board

| item | status |
|---|---|
| sequential tool A → result → tool B → result → answer (production loop) | **VERIFIED** (scripted model, real dispatcher) |
| sequential two-step task with the real model | **VERIFIED** (path B, real outputs) |
| duplicate call runs once | **VERIFIED** (new) |
| hung tool stops at a deadline | **VERIFIED** (mechanism); dispatcher integration not forced with a real slow tool |
| partial failure keeps the good result | **VERIFIED** |
| disabled tool refused when explicitly requested | **VERIFIED** |
| marketplace discovery → activation → invocation | **PARTIAL** — no acquired capability exists here |
| duration telemetry | **VERIFIED** (added) |
| server-side tool telemetry | **PARTIAL** — `toolResults` on path A only |
| reload during execution | **NOT TESTED** |
| real multi-round loop in path A with a live model | **NOT EXECUTED** — the router chose path B for the live prompt |

## 9. Remaining blockers

1. No acquired capability in this environment, so activation cannot be shown end to end.
2. Path B's tool executions are invisible to server-side telemetry.
3. Supabase server-side configuration still missing; persistence paths unverified.
4. The pre-existing voice test failure (out of scope, paused workstream).

## 10. Closure

Committed on `mission/6.1.6-multi-step-orchestration`. **Not merged, not pushed** — merging waits on
canonical reconciliation and review of this evidence.
