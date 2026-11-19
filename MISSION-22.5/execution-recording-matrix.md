# MISSION 22.5 — EXECUTION RECORDING MATRIX

**Date:** 2026-11-19
**Verified code commit:** `e481c2c4ca6f8421528b653d9b06646aad6bc9aa`
**Question this answers:** for each field K2 requires, *where* is it recorded, *by which canonical owner*, for *how long*, and is it **verified** or merely *available*?

Legend — **Verified**: exercised in this mission's tests or existing passing tests. **Available**: the field exists and is written by a real path, but this mission did not exercise it end to end. **Gap**: no runtime record exists.

---

## 1. Matrix

| Required field | Recorded at | Owner | Lifetime / retention | Privacy treatment | Status |
|---|---|---|---|---|---|
| Mission / work-package identity | **Nowhere at runtime** — these documents only | — | repository | n/a | **Gap** |
| Task identity | `AgentTask.id`, `ExecutionRecord.taskId` | `AgentStore`, `ToolDispatcher` | persisted (`AgentStore`), ledger bounded | ids only | Verified |
| Subtask / step | `ExecutionRecord.stepId`, `AgentTask` | `TaskExecutor` | task record | ids only | Available |
| Agent or system responsible | `AgentTask.delegatedBy`, `.executive`, `.routeReason`; `ExecutionRecord.path` | `Shaman`, `AgentRunner`, dispatcher | persisted with task | names/ids | Verified |
| Tool or service invoked | `ExecutionRecord.tool`, `requestedName`; `ExecutionLedger.tool` | `ToolDispatcher` | event + bounded ledger | registry id only, **never arguments** | Verified |
| Repository | **Nowhere** | — | — | — | **Gap** |
| Branch | **Nowhere** | — | — | — | **Gap** |
| Commit SHA | **Nowhere** | — | — | — | **Gap** |
| Files inspected | `file_*` / `browser_*` events; agent execution `result` | `AgentEventBus`, `AgentStore` | event history bounded (~80 recent), execution record persisted | path only | Available |
| Files modified | `file_changed` event (`path`), agent result | `AgentEventBus` | bounded | path only | Available |
| Research sources | `rememberKnowledge` provenance: `sources`, `query`, `retrievedAt`, `resultCount` | `ResearchResolver` → `Brain` | long-term memory | URLs/source names only | Verified (repair) |
| Discoveries | durable `knowledge` patterns; agent insight memory (≤600 chars) | `Brain.rememberKnowledge`, `AgentRunner.consolidate` | long-term memory | truncated, attributed | Verified |
| Decisions | `CognitionCycleRecord.decision`; `routeReason`; `yieldReason` | `AgentCognitionRuntime`, `Shaman` | objective records | text | Verified |
| Decision rationale | verification `reason`, `routeReason`, `missing[]` | `CompletionVerifier`, `ObjectiveEvidence` | cycle records | text | Verified |
| Implementation outcome | `AgentTask` completion + execution `result`; objective conclusion | `AgentStore`, runtime | persisted | bounded insight copied to memory | Available |
| Test names | **Nowhere** | — | — | — | **Gap** |
| Test results | **Nowhere** | — | — | — | **Gap** |
| Failures | `agent_failed`, `tool_failed`, task `error`, `ExecutionOutcome.failed` | bus, `AgentStore`, dispatcher | bounded/persisted | `redactExecutionText`, ≤200 chars | Verified |
| Error details | as above + `TurnFailure.message` (voice) | `TurnFailure` | session state | redacted | Available |
| Corrections | `MemoryEngine` `context.history` (last 8), `context.corrected`; lesson `contradictions`; `resumedBy` | `MemoryEngine`, `ObjectiveLearning`, `AgentStore` | long-term / persisted | text | Verified |
| Subsequent verification | `CompletionVerifier` verdict history via `ObjectiveEvidence.verdicts`; `continuationsAfterRejection` | cognition | cycle records | text | Verified |
| Unresolved issues | `ObjectiveState.yielded`, `yieldReason`, `waitingFor`, `awaiting-approval` | `AgentObjectives` | persisted objective | text | Available |
| Blockers | blocked verdict (`user-information`, repeated tool failure) | `CompletionVerifier` | cycle record | text | Verified |
| Timestamps | every record (`startedAt`, `finishedAt`, `createdAt`, `updatedAt`) | all owners | with record | — | Verified |
| Execution status | `ExecutionStage` × 8; `AgentTask.status`; `ObjectiveState` | dispatcher, `AgentStore`, objectives | with record | — | Verified |
| Timed out / suppressed | `stage=timed-out`, `stage=suppressed` | dispatcher | with record | reason redacted | Available |
| Source | pattern `context.source`, lesson provenance, `ExecutionRecord.path` | memory engine, dispatcher | with record | — | Verified (repair) |
| Confidence | `ResponsePattern.confidence`, lesson `confidence`, `executionVerified` | memory engine, `ObjectiveLearning` | with record | — | Verified |
| Project scope | `projectId` on tasks/objectives/executions | `AgentStore`, objectives | persisted | id | Available |
| Conversation scope | `conversationId` on turn/task binding and memory writes | `TurnOwnership`, `AIService`, `MemoryBridge` | conversation store | id | Verified (write scope) |
| Session scope | `VoiceEngine` session/diagnostics | voice engine | process | no audio retained | Available |
| Authorization scope | `RelationshipStore`, `CrossChatResolver` consents, `CHAT_SCOPED` | authz / multichat | persisted | consent records | Available |

---

## 2. What a record actually contains

### 2.1 One tool invocation (`ExecutionRecord`)

```ts
{
  executionId: "chat-mwf2hvh1-1-i46w37",  // stable across every stage
  taskId: "1794579820487",
  path: "chat" | "task" | "direct" | "unknown",
  stepId?: "…",
  tool: "workflow.list",
  requestedName?: "workflow_list",
  approval: "not-required" | "approved" | "refused",
  stage: "requested" | "authorized" | "refused" | "started"
       | "succeeded" | "failed" | "timed-out" | "suppressed",
  outcome?: "succeeded" | "failed" | "timed-out" | "refused" | "suppressed" | "not-found",
  startedAt?, finishedAt?, durationMs?,
  reason?: "redacted, truncated"
}
```

Server line (post-redaction, no arguments, no prompt text):

```
[execution] id=chat-mwf2hvh1-1-i46w37 stage=succeeded path=chat tool=workflow.list task=… outcome=succeeded durationMs=1
```

### 2.2 One objective cycle (`CognitionCycleRecord`)

Holds `decision`, `executed[{tool, ok}]`, `requested[]` (asked ≠ ran), `provider`, `model`, `finishReason`, `verification{verdict, reason, observed, missing}`, `nextState`, `yieldReason`, timestamps.

### 2.3 One durable fact (`ResponsePattern`)

Holds `prompt`, `response`, `category`, `keywords`, `confidence`, `importance`, and — after this mission's repair — `context.source`, `context.attribution`, `context.executionVerified`, plus any caller fields (`lessonId`, `topic`, `confidence`, `sources`, `query`, `retrievedAt`, …). Corrections add `context.history` (last 8 superseded values) and `context.corrected`.

### 2.4 One lesson (`Lesson`)

`topic`, `lesson`, `kind` (`worked`/`failed`), `observations`, `contradictions`, `confidence` (derived, never asserted), `firstSeenAt`/`lastSeenAt`, `objectiveIds[]`, `persistedDurably`. The durable copy now carries `source=objective-learning`, `lessonId`, `objectiveId`, `confidence`.

---

## 3. Retention and bounds

| Record | Bound | Consequence |
|---|---|---|
| `ExecutionLedger` | 15-minute window, 60 entries | interrupted-write guard only; not an audit log |
| `AgentEventBus` recent | ~80 events | UI/trace evidence, not durable history |
| `PatternMemory` patterns | Supabase/IndexedDB policy | durable |
| `ObjectiveLearning` lessons | 200, sorted by recency | older lessons evicted |
| Objective cycles | per objective | completed objectives persist |
| `CognitiveTrace` turns | 20 (dev only) | never production |
| Voice audio | not retained | only state/diagnostics |

---

## 4. Provenance gaps this matrix exposes

1. **No repository, branch or commit field anywhere.** The unit of work LÉLU records is the task/tool, not the code change. A future M22.5-class mission cannot answer "which commit implemented this?" from memory.
2. **No test-record primitive.** Test names, suites and results are not execution records; only tool invocations are.
3. **No mission/work-package scope.** `projectId` and `conversationId` exist; mission identity does not.
4. **Long-term memory has no conversation tag.** Scope is enforced by refusing chat-scoped writes, not by labelling every stored fact with the chat that produced it. That is a deliberate design (user-global memory) and a real limit on forensic reconstruction.

These are recorded as gaps. None was silently converted into a pass, and no parallel recording system was added to paper over them.
