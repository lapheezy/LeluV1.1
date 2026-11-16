# LÉLU agentic runtime: integration contracts

Owner: Session 2 (cognition, orchestration, tools, execution).
For: Session 1 (avatar, Meshy, Blender, 3D world) and Session 3 (Cosmos, chat,
mobile, frontend).

This document covers the interfaces the agentic layer exposes and what it
expects from you. None of it requires a frontend change to *work*: the
existing execution timeline already renders every event below, and its
Approve / Reject buttons now drive real execution. The sections marked
**Opportunity** describe UI that would make the behaviour more visible.

Code: `src/core/agentic/`. Execution guarantees: `AGENTIC_RUNTIME_REPORT.md`.

---

## 1. Events (`AgentEventBus`, `src/core/agent/AgentEvents.ts`)

No new event types were added. A multi-step task emits, in order:

| Event | When | Notes |
|---|---|---|
| `task_started` | A task starts or resumes | `taskId` is the TaskEngine task id |
| `task_planning` | Right after start | `plan` lists the steps, one per line |
| `execution_phase` `backend_task_started` | A step starts | `label` = step title, `detail` = tool id / `agent` / `reason` |
| `tool_selected` / `tool_started` / `tool_result` | Inside a tool step | Emitted by `ToolDispatcher`, as for chat tool calls |
| `agent_started` / `agent_completed` / `agent_failed` | Inside an agent step | Emitted by `AgentRunner` |
| `execution_phase` `validation_completed` | A step passed verification | `detail` = what was checked |
| `execution_phase` `retry` | A step is retried | `detail` = the failure |
| `execution_phase` `error` | A step failed | `detail` = the real error |
| `approval_requested` | A sensitive step is waiting | `approvalId`, `title`, `detail` (tool + arguments), `systemsAffected` |
| `approval_resolved` | The user decided | Emit it with `decision: "approved" \| "rejected"` and the task continues by itself |
| `task_completed` / `task_failed` | Terminal state | `task_failed.error` is the first failing step |
| `cognition` `lesson-extracted` / `lesson-persisted` | Self-evaluation | After every finished task and every reflection |

The approval loop is already closed.
`GenesisExecutionTimeline.resolveApproval()` emits `approval_resolved`;
`ApprovalGate` listens for it and resumes the waiting task. Keep emitting
exactly that shape. `"modified"` is treated as a rejection, because the
backend cannot know what was meant.

## 2. APIs Session 3 may call

| API | Purpose |
|---|---|
| `AIService.getInstance().cancelActiveTurn(reason?)` → `boolean` | Stop button for a chat turn. The in-flight model call is aborted (Anthropic) and no further tool runs. The turn resolves with `provider: "cancelled"` and text `"Stopped. Before stopping, these ran: …"`. |
| `AIService.getInstance().isTurnActive()` | Whether to show the stop button. |
| `TaskExecutor.getInstance().onProgress(listener)` → unsubscribe | Plain-language progress per task: `kind` ∈ `started, step-started, step-succeeded, step-failed, step-retrying, step-skipped, awaiting-approval, completed, failed, cancelled, paused`, plus a `message`. Suitable for chat bubbles during background work. |
| `TaskExecutor.getInstance().cancel(taskId)` / `resume(taskId)` | Stop or continue a background task. |
| `TaskExecutor.getInstance().report(task)` | The verified step-by-step summary text. |
| `TaskEngine.getInstance().subscribe(listener)` / `list()` | Task list. Executable tasks have steps with an `action`. Statuses: `running, waiting (approval), paused (interrupted, resumable), completed, failed, cancelled`. |
| `ApprovalGate.getInstance().pending()` | Approvals waiting, which survive reload. |
| `ApprovalGate.getInstance().decide(id, "approved" \| "rejected")` | Equivalent to the timeline buttons. |
| `listCapabilities()` (`CapabilityCatalog`) | For a capabilities panel: ready / needs approval / blocked with a reason, plus run and failure counts. |
| `DailyReflection.getInstance().history()` | The last 30 reflections, with summary, proposals and self-model updates. |

**Opportunity (Session 3):**
- **Stop button.** Wire a stop control in chat to `cancelActiveTurn()`.
- **Pending approvals on reload.** Render `ApprovalGate.pending()` when the app loads. The timeline only shows approvals whose event it saw live, but a waiting task stays waiting across reloads.
- **Resume interrupted tasks.** Show paused tasks with a Resume control. `recoverInterrupted()` runs at boot, so a task cut off by a reload comes back as `paused`.

**SHAMAN (Cosmos).** `CosmosStore` already raises SHAMAN's activity on any
agent event. Multi-step tasks now produce a real stream of them, so SHAMAN
reflects real orchestration without changes. If you want SHAMAN to mean
"orchestration" specifically, key it on `task_planning` / `backend_task_*`.
Agent universes can key on `agent_started` / `agent_completed`.

## 3. Contract with Session 1 (avatar, world, forge)

- **Your tools are first-class.** `FORGE_EXECUTORS` and `WORLD_EXECUTORS` are
  merged into the same dispatch table. They appear in `capability.discover`,
  can be steps in a plan, and are tracked in `ToolStats`. Keep exporting them
  that way. A tool you add to those arrays needs no change on my side.
- **Approval for risk 3.** `world.promote` (risk 3) says it "needs the user's
  approval". It is now genuinely approval-gated inside a task: it pauses,
  shows Approve / Reject, and runs once if approved. In a plain chat turn at
  autonomy below L3 it is still refused, as before.
- **New tools at runtime.** Use
  `registerExecutor(executor, definition)` (`ToolDispatcher`). Ids must be
  dotted (`service.action`), an existing id cannot be replaced, and built-ins
  cannot be unregistered. Set `riskLevel` and `permissions` honestly: they
  decide whether each call needs approval.
- **Avatar behaviour (opportunity).** `TaskExecutor.onProgress` gives clean
  states for embodiment:
  - `step-started` → working;
  - `awaiting-approval` → asking;
  - `completed` → done;
  - `failed` → concerned.

  The avatar keeps reading the event bus as it does today. Nothing changes
  unless you subscribe.

## 4. Invariants (do not work around these)

1. **No tool approves anything.** Approvals come only from a human decision
   event (`approval_resolved`). `approval.list` is read-only.
2. **An approval is single-use** and bound to the exact tool and arguments
   shown. Different arguments mean a new request.
3. **An approval lifts at most to "Execute approved" (L3).** It never makes
   a destructive (L4) tool runnable below its autonomy level. It never
   replaces the project authorization that `project.apply` / `project.commit`
   need.
4. **A cancelled turn is not a provider failure.** It never falls back to the
   next provider.
5. **A task is "completed" only if every step ran and passed its
   verification.** A step whose dependency failed is skipped, never run.
6. **Self-improvement stops at a proposal.** Reflection writes
   `ImprovementQueue` entries with status `Proposed`.
   - Only a user moves one to `Approved`.
   - `SelfDevelopmentLoop` then develops it in the sandbox and stops at
     `Ready`.
   - Production apply (`applyCandidate`, L5) is never invoked automatically.
7. **Provider fallback and offline operation are unchanged.** The configured
   default provider (Anthropic) now leads the chain on every device; see
   `AGENTIC_RUNTIME_REPORT.md`.
