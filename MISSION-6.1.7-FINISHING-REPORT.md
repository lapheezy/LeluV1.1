# MISSION 6.1.7 — FINISHING PASS

Date: 2026-11-13
Branch: `mission/6.1.6-multi-step-orchestration` (the 6.1.7 work was never given its own branch; committed here, not pushed, not merged)
Base: `890c2b9`
Verdict: **The duplicated planner context is fixed at its source and Path B now runs live — a real plan, two real tool executions, server-visible. Resume drives the executor. Interrupted writes are no longer repeated blindly.**

---

## 1. The duplicate, at its actual source

Not `TaskPlanner.ts`. The planner builds one prompt string and calls
`AIService.reason(prompt, { system, maxTokens })`. That method put the prompt in `messages` **and**
passed it as `prompt`, while every provider appends `prompt` itself (`trailingUserTurn`). So the same
91,427-character block went out twice.

```
before: messages: [system 1712, system 1507, user 91463, user 91463]  → 186,228 B / 46.5k tok
after:  messages: [system 1712, system 1507, user 91427]             →  94,723 B / 23.7k tok
```

Fixed in `src/core/AIService.ts` for both `reason()` and `deliberate()` — neither is protected, and
no planning logic changed shape.

## 2. Path B actually runs now

Dedupe alone left 23.7k tokens, still above Groq's 8k TPM and OpenRouter's credit-limited ceiling.
The remaining bulk was the **full JSON Schema of all 59 capabilities**. Because `TaskPlanner.ts` is
protected, the budget was applied at the dispatch seam instead:
`src/core/agentic/PlannerContextBudget.ts` orders the prompt by value per byte and drops the schema
block first, keeping the capability list and always the `REQUEST:` line, with an explicit
"trimmed to fit this model's context" marker.

Live result — a 52-character request, planned and executed for real:

```
[model broker] provider=groq model=openai/gpt-oss-120b status=200 bytes=23381
               messages=3 toolResults=0 prompt≈5802tok max_tokens=2500

[execution] id=task-mwfbdj5u-1-bojckk stage=requested path=task tool=system.config step=s1
[execution] id=task-mwfbdj5u-1-bojckk stage=succeeded path=task tool=system.config
            task=18beabe2-3a43-4f49-8aba- step=s1 outcome=succeeded durationMs=1
[execution] id=task-mwfbdj6l-2-bojckk stage=succeeded path=task tool=workflow.list
            task=18beabe2-3a43-4f49-8aba- step=s2 outcome=succeeded durationMs=1
```

Answer, taken from the steps' real results:

> Completed and verified: Step 1… Step 2…
> [completed] Check system configuration (system.config) — Configured: nothing. Not configured:
> provider.groq, provider.openrouter, … persistence.supabase.
> [completed] List available workflows (workflow.list) — No workflows are defined yet.

Two distinct execution ids, one per plan step, both `path=task`, both with step ids, both
server-side. Not Path A fallback, and no provider response was faked.

![Path B live](artifacts/perf/6.1.7-path-b-live.png)

## 3. Idempotency for interrupted executions

`src/core/tools/ExecutionLedger.ts` + a gate in `dispatchToolCall`:

- only **side-effecting** tools are tracked (WRITE / EXECUTE / DESTRUCTIVE / EXTERNAL_ACTION or risk ≥ 2);
- an attempt is recorded **before** the tool runs and marked complete after;
- an identical call (same tool + arguments + request) while an earlier attempt is still unfinished is
  **refused**: *"…never reported whether it finished. Its outcome is unknown, and repeating it could
  apply the change twice."*;
- a **completed** attempt does not block a later deliberate repeat;
- reads are never held (tested: `system_config` twice in one request still runs).

This is exactly the reload behaviour measured earlier (one execution left at `started`, the reloaded
turn re-running the same tool under a new id) — the write case would have double-applied.

## 4. Task resume through the application

The ▶ button in `CosmosWorkspacePanel` calls `WorkspaceAPI.execute({ action: "resume-task" })`, which
previously only flipped `status` to `running` — nothing executed, so the button looked broken.
`src/core/workspace/WorkspaceAPI.ts` now drives `TaskExecutor.start(taskId)` after the resume, so the
task continues from its checkpoint.

Verified through that same production action (`tests/interrupted-execution-policy.test.ts`): a paused
task with a real `system.config` step, resumed via `WorkspaceAPI.execute`, reaches `completed`, and
the step's output contains the executor's real text (`/Configured:/`).

**Not driven:** an actual mouse click on the panel's ▶, because the workspace panel with the task
list could not be reached through the cloud browser in this session. The action it invokes is the one
verified.

## 5. Reload / interruption / retry / duplicate — final matrix

| case | result |
|---|---|
| reload during a read tool | **VERIFIED** — execution left at `started` with no terminal record; the reloaded turn re-ran it as a new id (correctly not upgraded to success) |
| reload during a *write* | **POLICY VERIFIED** (unit): unfinished attempt blocks the identical retry; different request unaffected |
| paused-task recovery after reload | **VERIFIED** — `paused`, checkpoint `{stepIndex, reason:"interrupted"}`, running step → `pending`, completed step preserved |
| resume from the app action | **VERIFIED** — reaches `completed`, real tool output |
| duplicate call in one round | **VERIFIED** (6.1.6) — runs once, `suppressed` record with its own identity |
| completed write, asked again | **VERIFIED** — not blocked |
| duplicate terminals / success without `started` | **VERIFIED absent** (programmatic scan of the log: 7 executions, 0 anomalies) |

## 6. Test totals

| check | result |
|---|---|
| `tsc -b --force` | exit 0 |
| `vite build` | exit 0 |
| full suite | **2,053 tests / 2,046 pass / 1 fail / 6 skipped** |
| previous total | 2,045 / 2,038 / 1 / 6 — 8 tests added, same single failure |

The one failure remains `tests/voice-continuity.test.ts` ("never stuck in 'speaking'"), owned by the
paused voice workstream and untouched here.

New tests: `tests/interrupted-execution-policy.test.ts` (5), `tests/planner-context-budget.test.ts` (3).

## 7. Files changed in this pass

```
 M src/core/AIService.ts                        prompt sent once, planner budget applied
 M src/core/router/ProviderResolver.ts          turnSignature for the ledger
 M src/core/tools/ToolDispatcher.ts             ledger gate + suppressed evidence
 M src/core/workspace/WorkspaceAPI.ts           resume drives the executor
?? src/core/tools/ExecutionLedger.ts            interrupted-write policy
?? src/core/agentic/PlannerContextBudget.ts     bounded planner context
?? tests/interrupted-execution-policy.test.ts
?? tests/planner-context-budget.test.ts
```

`TaskPlanner.ts` and `Orchestrator.ts` were read only; no voice, VoxCPM or LiveKit file touched.

## 8. Remaining blockers

1. **OpenRouter is out of credit**: `402 … can only afford 617` of even a 700-token completion. Every
   OpenRouter call is refused regardless of payload.
2. **Groq is the only working provider** and its 8k TPM ceiling is why the planner budget exists; a
   plan needing the full schema catalogue will still be trimmed.
3. **GitHub Models answers `200 text/plain "OK"`** for every path — the broker correctly refuses it
   as a contract violation, so it is not a usable fallback.
4. **The workspace task panel was not reachable** in the cloud browser, so the resume button was
   verified by its action rather than by clicking it.
5. Provider cooldowns make a live planner run take more than one attempt; the successful run above
   came after a page reload cleared them.
