# Agentic intelligence and autonomous operations: Session 2, Phase 2

Scope: orchestration, tools, execution, self-evaluation, live control. No
avatar, Meshy, Blender, 3D-world, Cosmos, chat-UI or mobile code was changed.
Interfaces for those sessions are in `AGENTIC_INTEGRATION_CONTRACTS.md`.

## What the audit found

The foundation was substantial and much of it was real:
- `ToolDispatcher` had 24 real executors, plus the Forge and World families.
- `WorkflowEngine`, `AgentRunner`, `TaskEngine` (persistence),
  `ObjectiveLearning` (lessons), `ImprovementQueue` and `SelfDevelopmentLoop`
  (sandbox, approval-bounded) were all present.

The gaps were where the pieces met:

| Finding | Effect |
|---|---|
| `Orchestrator`'s multi-step path made one chat call, then marked every heuristic step "completed" with that same reply | Multi-step execution was reported but never performed |
| It also recorded agent "delegations" that never ran, and emitted approval requests nothing waited for | The timeline showed delegation and approval that did not exist |
| No backend listened to `approval_resolved` | The timeline's Approve / Reject buttons did nothing |
| The model had no tool to delegate to an agent, discover capabilities, or run a plan | LÉLU could not orchestrate from a conversation |
| There was no runtime tool registration and no per-tool outcome tracking | New integrations needed code edits; failures were invisible to reflection |
| There was no cancellation anywhere in the chat path | A turn could not be stopped, and voice barge-in left superseded turns running |
| `DailyReflection` did not exist | Reflection ran only inside chat context-building, and outcomes never became proposals |
| `ModelRouter` put Groq / Cerebras / Fireworks ahead of the configured default whenever device memory read as low (every Node process, many phones) | "Anthropic is primary" was false on those devices. Measured live: Groq was tried first |
| `ProjectScheduler`'s interval held every Node process open | Several test files "never finished", and scripts could not exit |

## What was built (`src/core/agentic/` + targeted edits)

| Component | Role |
|---|---|
| `TaskExecutor` | Runs `TaskEngine` steps for real: tool → `dispatchToolCall`, agent → `AgentRunner`, reasoning → `AIService.reason` (details below) |
| `ApprovalGate` | A durable, per-action human decision (details below) |
| `CapabilityCatalog` | One read-side join of registry, executors, live permission, approval policy, `ToolStats` and agents (agents listed by name) |
| `ToolStats` | Runs, successes, failures, refusals, recent errors and mean duration per tool. Recorded in `dispatchToolCall`, so it covers chat, workflows, tasks and agents |
| `TaskPlanner` | Model plan → validated against live capabilities (details below) |
| `AgenticTools` | `capability.discover`, `agent.list`, `agent.delegate`, `task.start`, `task.status`, `task.cancel`, `task.resume`, `approval.list`, `reflection.run`. There is no approving tool |
| `TaskEvaluator` | Each finished task → `ObjectiveLearning` lessons (durable through long-term memory, retrieved for later plans) plus capability gaps |
| `DailyReflection` | Daily and on request. Evidence (task evaluations, tool failures, `Brain` reflection) → memory, evidence-based updates to `SelfModel` (learning, improvements, unavailable — never identity) and `ImprovementQueue` proposals with status `Proposed` |

`TaskExecutor` guarantees:
- dependencies are respected, with branches;
- `{{steps.X.output}}` passes real data forward;
- transient failures are retried with backoff, and refusals are not;
- every step is verified;
- the task is checkpointed after each step;
- `cancel` works, and tasks cut off by a restart are recovered and resumed.

`ApprovalGate` rules:
- **Policy:** risk ≥ 3, or `DESTRUCTIVE`, `EXTERNAL_ACTION` or `SENSITIVE`.
- **Durability:** requests are persisted and resolved by the existing timeline's `approval_resolved` event.
- **Scope:** single-use, bound to the exact tool and arguments, lifts at most to L3, never covers L4 or `project.apply`'s authorization.

`TaskPlanner` checks:
- tools exist, are executable, available, and permitted or approvable;
- agents are runnable;
- dependencies and references point backwards only;
- at most 12 steps;
- an invalid plan gets one repair round with the exact errors, then is refused;
- lessons from similar earlier work are injected into the planning prompt.

Edits to existing code:
- **`TaskEngine`**: optional `action`, `dependsOn`, `verify`, `maxAttempts`, `output` and `approvalId` on steps; `origin` and `report` on tasks; `save()` and `reload()`. All existing callers are unchanged.
- **`ToolDispatcher`**: `registerExecutor` / `unregisterExecutor`; the agency tool family; `ToolStats` recording; an `approvalId` option.
- **`Orchestrator`**: the multi-step path now runs plan → validate → execute → per-step report. With no executable plan it answers as a normal turn. The fake delegation record, fake memory phases and decorative approval event were removed. `executeTask` resumes executable tasks through the executor.
- **Cancellation**:
  - `AIRequest.signal`;
  - `AIService.cancelActiveTurn()` / `isTurnActive()`;
  - the `ProviderResolver` tool loop checks the signal before each round and each tool, and a stop never falls back to another provider;
  - `AnthropicProvider` aborts the in-flight fetch with no retry;
  - `VoiceEngine` cancels a turn superseded by new speech, or when voice stops.
- **`ModelRouter`**: the configured default provider now outranks the low-memory hardware hint.
- **`ProjectScheduler`**: interval `unref`'d (a no-op in browsers).
- **`Bootstrap`**: registers the agency tools, recovers interrupted tasks and starts `DailyReflection`.
- **`AIService`**: `reflectOnMemory()` (returns null when not initialized; never boots the runtime).

No dependencies were added.

## Verification

### Automated (no network; tools execute for real)

`tests/agentic-execution.test.ts` (20) and `tests/agentic-live.test.ts` (5):
- **Tool layer:** runtime tool registration, discovery and tracking.
- **Execution:** a real multi-step task (`project.manage` create → a separate list verifies the effect → reasoning receives the real output). Verification failure is retried, then the task fails. Refusals are not retried and their dependants are skipped and never run. Gap recording, transient retry, and agent branches with data passing.
- **Approval:** the task waits; a pending approval cannot be used to force the call; approve → runs once with the exact arguments; reuse is refused; changed arguments are refused; rejection fails the task; L4 is never lifted.
- **Control:** cancel between steps; crash → recover → resume without re-running finished steps.
- **Planning:** planner repair round; refusal of a still-invalid plan; forward and dangling reference checks; `task.start` through the dispatcher; no approving tool exists.
- **Reflection:** proposals are `Proposed`, never `Approved`; the self-model is updated; reflection is not re-run within a day.
- **Live behaviour:** cancel mid tool loop (no further tool, no fallback); `providerBlocks` replay through the router; Anthropic in-flight abort with no retry; the `Orchestrator` plans and executes a real multi-step request.

`runtime-integration.test.ts`: the default-provider test now also asserts that
Anthropic leads over Groq.

Full suite, using the per-file loop from `tests/README.md`:
**379 assertions passing across 41 files** (before this phase: 250 across 31
files). The 3 failures are pre-existing (details in `tests/README.md`). The
number of files that do not finish dropped from 14 to 6, because
`ProjectScheduler` no longer holds the process open.

### Live, against the real provider chain

`scripts/verify-agentic.ts` uses the container's Anthropic key. **5/5 passed,
and every model call went to Anthropic first:**

- **A.** A real model planned a 3-step task: `project.manage` → `project.manage` → a real agent. It was valid on the first attempt.
- **B.** The task executed and verified. The project really exists, and the agent's real answer confirmed it.
- **C.** A sensitive step paused. It ran 0 times before approval and once after the `approval_resolved` event.
- **D.** In an ordinary chat turn, the model itself called `task.start`, which ran `capability.discover` and `agent.list`, and it reported the verified result: "found 15 capabilities".
- **E.** Reflection summarised 3/3 tasks completed, with memory themes.

The first live run found two real defects, both now fixed:
- the catalog listed agents by internal id, so the model could not name them;
- routing tried Groq before Anthropic.

## Limits, stated plainly

- **Persistence is browser storage.** Tasks, approvals and stats persist through `KvStore` (browser storage). A server-side deployment that wants tasks to survive a server restart needs a server store. That is not built.
- **Abort support is partial.** Only Anthropic aborts its HTTP request on cancel. Other providers finish their in-flight call, and the result is discarded.
- **Only fresh voice turns are cancelled.** Voice barge-in cancels the *chat* turn. A background task started from that turn keeps running until stopped with `task.cancel`.
- **Live verification needs a key.** `scripts/verify-agentic.ts` needs a provider credential and spends a few model calls.
