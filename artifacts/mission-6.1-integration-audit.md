# Mission 6.1 — LangChain / LangGraph integration audit (Phase A)

Branch `mission/6.1-runtime-validation`, cut from `mission/6.0-runtime-efficiency`
@ `1262b1c`. Working tree clean at start; checkpoint `artifacts/checkpoints/BASE-6.1.txt`.

## Verdict, before any change

**There is no LangChain or LangGraph integration in this repository — not partial, not
decorative, not disconnected. The packages are not installed, nothing imports them, and
no lockfile entry exists.**

Mission 6.1 rests on a premise the repository does not support. This document records
the evidence, answers Phase A's ten questions with it, and proposes the equivalent
validation against the orchestration LÉLU actually has. No dependency was added and no
integration was fabricated.

## Evidence

| check | command | result |
|---|---|---|
| declared dependencies | `package.json` deps + devDeps matching `/lang|graph|agent/` | **(none)** |
| installed packages | `ls node_modules/@langchain node_modules/langchain node_modules/@langchain/* node_modules/@langgraph/*` | **no such paths** |
| lockfile | `grep -c "langchain\|langgraph" package-lock.json` | **0** |
| source | `grep -ril "langchain\|langgraph\|stategraph" src server.ts scripts plugins` | **0 files** |
| documentation | `docs/architecture/2026-11-07/ECOSYSTEM_PHASE_0_STATE.md:64` | **"langgraphjs — Likely reject — Duplicates `TaskEngine`, `TaskExecutor`, `ApprovalGate` and checkpointing. Adopt only for a measured gap."** |

So the repository's own architecture review already considered LangGraph and declined it
on duplication grounds. Mission 6.1 asks to make that integration operational; there is
nothing to make operational.

## Phase A questions, answered with evidence

1. **Is LangChain executing model requests?** No. Model execution runs through
   `src/core/AIService.ts` → `AIRuntime` → `AIRouter` and the provider registry
   (`RegisterAIProviders` / `RegisterProviders` / `AIProvider` adapters).
2. **Is LangGraph executing workflows?** No. `src/core/workflows/WorkflowEngine.ts`
   does, with `WorkflowStore` persisting definitions and executions through `KvStore`.
3. **Are agents connected to graph nodes?** Not applicable. Agents run through
   `src/core/agents/AgentRunner.ts`, `Shaman.ts`, `ExecutiveOwnership.ts`, and the
   agentic layer (`TaskPlanner`, `TaskExecutor`, `ApprovalGate`, `AgenticTools`).
4. **Can nodes access LÉLU's tools?** No nodes exist. Tools are reached through
   `ToolRegistry` + `ToolDispatcher` (the single advertisable tool table).
5. **Can graph execution access memory?** No graph exists. Memory is `Brain`,
   `MemoryEngine`, `CognitiveContext` and the memory tools.
6. **Is execution state preserved?** Yes — but by `WorkflowStore`/`KvStore`
   (`saveExecution`), not by a LangGraph checkpointer.
7. **Can execution resume after interruption?** Yes, for the existing engine:
   `TaskExecutor.getInstance().recoverInterrupted()` pauses interrupted tasks as
   resumable, and workflow executions are persisted.
8. **Does streaming reach chat?** Yes, independently of either framework:
   `AIService.subscribeStream` → `GenesisBridge` → Genesis state → chat transcript.
9. **Are frameworks initialized once or repeatedly?** Neither is initialized at all.
10. **Decorative / disconnected integrations?** None to find. Zero occurrences.

## What LÉLU actually has (the surface the mission's gates should target)

| capability the mission attributes to LangGraph | existing owner | evidence |
|---|---|---|
| graph construction / conditional edges | `WorkflowEngine`, `WorkflowPatterns`, `WorkflowAuthoring` | `tests/workflow-control-flow.test.ts` |
| state transitions / learning | `WorkflowEngine`, `workflow-learning.test.ts` | tests |
| execution + reuse + inputs | `WorkflowEngine.getInstance().run(...)` | `tests/workflows.test.ts` (lines 127, 166, 191, 204, 228, 258, 433, 454, 519) |
| persistence / checkpoints | `WorkflowStore` → `KvStore` (`saveExecution`) | source + tests |
| tool invocation | `ToolRegistry`, `ToolDispatcher` | Mission 5.9/6.0 audits |
| agent orchestration | `Orchestrator`, `AgentRunner`, `Shaman`, `TaskExecutor` | `tests/agentic-execution.test.ts`, `tests/autonomy-end-to-end.test.ts` |
| interruption recovery | `TaskExecutor.recoverInterrupted`, workflow persistence | source |
| readiness reporting | Mission 6.0 `src/core/runtime/readiness.ts` | `tests/runtime-readiness.test.ts` |

## Consequence for the mission

- **Gate A (integration mapped): COMPLETE** — by this audit. The integration is absent.
- **Gates B–F (LangChain/LangGraph execution): CANNOT RUN.** They require installing
  two frameworks (~hundreds of transitive packages, a lockfile change) and building
  adapters that the project's own review rejected as duplicating `TaskEngine`,
  `TaskExecutor`, `ApprovalGate` and checkpointing. Mission 6.0's rules — and this
  mission's own §2 — forbid introducing dependencies without a demonstrated gap.
- **Gates G–H** (readiness accuracy, regression) are achievable and meaningful against
  the existing stack, or against a thin adapter if the framework is added deliberately.

## Two ways forward (a decision, not a default)

**A. Validate the existing orchestration (recommended).** Run Mission 6.1's gates
against `WorkflowEngine` + `ToolDispatcher` + `AIService` + Mission 6.0 readiness:
real workflow execution, real tool invocation, interruption/resume, failure isolation,
streaming to chat, and readiness states that only go READY on evidence. No new
dependencies; nothing duplicated; the gates keep their intent.

**B. Add LangChain + LangGraph deliberately.** Install the packages, build adapters
that delegate to the existing `AIProvider` registry and `ToolDispatcher` (never owning
providers, tools or agents), add a checkpoint port onto the existing `KvStore`, and
then run the mission's gates as written. This is a real dependency decision with a
boot-graph and maintenance cost, and must keep the frameworks lazy so Mission 5.9's
156-chunk / 1.65 MB shell is not regressed.

**C. Stop here** and treat this audit as the deliverable.

No option is taken without the user's choice: option B changes the dependency graph and
option A changes what the mission's gates are applied to. Both are the user's call, not
an agent's.
