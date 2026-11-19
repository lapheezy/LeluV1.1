# MISSION 22.5 — LEARNING INTEGRITY AUDIT (Work Package K)

**Date:** 2026-11-19
**Auditor:** Freebuff (Buffy)
**Verified code commit:** `e481c2c4ca6f8421528b653d9b06646aad6bc9aa`
**Starting branch / SHA:** `integration/m16-3-wp05-reconciliation` / `543da7c8d7876258869d928648cffa913cd10649`
**Companion evidence:** [execution-recording-matrix.md](execution-recording-matrix.md), [learning-retrieval-verification.md](learning-retrieval-verification.md), [provenance-and-scope-evidence.md](provenance-and-scope-evidence.md), [release-candidate-verification.md](release-candidate-verification.md)

---

## 0. What was actually found before auditing

Two facts shape everything below, and neither was assumed:

1. **There was no `MISSION-22.5` directory, no M22.5 branch, and no M22.5 commit in this repository.** The remote has only `freebuff/m22-2-global-cognitive-context-elimination` and `freebuff/m22-3-genesischat-browser-acceptance`; neither is an M22.5 branch. The latest commit at mission start was `543da7c8` *"Replace the 2.1 hair shell with scalp-rooted volumetric locks"* — avatar work.
2. The workspace started **clean**, on `freebuff/a194f0c9c3c58bfdf5946c17`, whose HEAD and `origin/integration/m16-3-wp05-reconciliation` both point at `543da7c8`. History is a truncated/shallow clone: 700 commits, base `f46cb9ae` *"Initial cloud project"*.

This audit therefore assesses the learning architecture that **actually exists** in the latest commit, and records what the mission's Work Package K asks for against it. It does not pretend that a completed M22.5 voice branch was reviewed.

---

## 1. K1 — The complete learning pathway, as built

The pathway is real and already has canonical owners. No stage needed a new subsystem; four connections were broken and are repaired (section 6).

| # | Stage | Canonical owner (existing) | What is recorded | Verified |
|---|---|---|---|---|
| 1 | User instruction / mission objective | `AIService.chat` (`src/core/AIService.ts`), `MultiChatStore`, `TurnOwnership.bindTask` (`src/core/multichat/TurnOwnership.ts`) | Conversation identity, task→conversation binding, user and assistant turns | Yes |
| 2 | Task / agent delegation | `Orchestrator` → `Shaman.route/dispatch` (`src/core/agents/Shaman.ts`) → `AgentRunner.run` (`src/core/agents/AgentRunner.ts`) → `AgentStore.recordTask` | `delegatedBy`, `executive`, `routeReason`, task status | Yes |
| 3 | Agent activity / tool execution | `ToolDispatcher.dispatchToolCall` (`src/core/tools/ToolDispatcher.ts`) → `ExecutionEvidence` → `AgentEventBus` → `ExecutionTelemetry`; `ExecutionLedger` for interrupted writes | One identity per invocation, lifecycle stages, duration, refusal/failure reason | Yes |
| 4 | Research / repository inspection / discovery | `ResearchResolver` (`src/core/router/ResearchResolver.ts`), `BrowserTool`, `IngestionPipeline` (`src/core/memory/IngestionPipeline.ts`) → `MemoryOrchestrator.persist` | Retrieval sources, candidate facts, attribution (after repair) | Partial — repository file inspection is not a knowledge event |
| 5 | Decisions / reasoning / implementation | `CognitionCycleRecord` (`src/core/cognition/AgentObjectives.ts`), `CompletionVerifier`, `ObjectiveEvidence`, `OutcomeDerivation` | Model decision, requested vs executed tools, verification verdict and reason | Yes |
| 6 | Test execution / verification results | **No runtime owner.** Test outcomes live in repository evidence documents and CI, not in LÉLU's memory or execution ledger | Nothing at runtime | **No — gap** |
| 7 | Failures / corrections / lessons | `AgentStore` task `failed`/`interrupted`; `agent_failed`/`tool_failed` events; `TurnFailure` (`src/core/voice/turnFailure.ts`); `MemoryEngine.supersede`; `ObjectiveLearning` (`Lessons` with contradiction counts); `CuriosityEngine` superseded learnings | Failure reason, correction history, lesson confidence | Yes after repair |
| 8 | Memory / knowledge persistence | `Brain.learn` → `MemoryEngine` → `PatternMemory` → `IndexedDBStore`; Supabase mirror; lessons via `AIService.consolidate` | Fact, keywords, category, confidence, provenance context | Yes after repair |
| 9 | Future retrieval / application | `Brain.recall` → `MemoryBridge.enrich` context injection (measured by `CognitiveTrace.CONTEXT_INJECTION`); `ObjectiveLearning.guidanceFor` into planning; `MemoryOrchestrator.gather` | Recall count, injected characters, memories used | Yes |

### Reading the chain end to end

```
USER TURN ──► AIService.chat ──► bindTask(taskId ↔ conversationId)
                    │
                    ├──► Orchestrator ──► SHAMAN.route (why this agent) ──► AgentRunner.run
                    │                            │
                    │                            └──► AgentStore task (running → complete/failed/interrupted)
                    │
                    ├──► ToolDispatcher.dispatchToolCall ──► ExecutionEvidence (requested … succeeded)
                    │            │                                   │
                    │            │                                   ├──► AgentEventBus ──► ExecutionTelemetry ──► /api/execution/events
                    │            │                                   └──► CognitiveTrace.TOOL_CALL
                    │            └──► ExecutionLedger (in-flight write guard)
                    │
                    ├──► Provider answer
                    │
                    ├──► MemoryBridge.learn ──► Brain.learn ──► MemoryEngine
                    │        (scope check)      (provenance)     (create/reinforce/merge/supersede)
                    │                                                  │
                    │                                                  └──► PatternMemory ──► IndexedDB
                    │
                    └──► next turn: Brain.recall ──► MemoryBridge.enrich ──► request.context (measured)
```

### Structural findings

- **One memory subsystem.** `MemoryEngine` is the only writer of long-term user/project facts; `Brain.persistLayer` is the only writer of `knowledge`/`system` memories; `PatternMemory` is the only store; `MemoryOrchestrator` is a provider registry, not a second store. Nothing in this mission added a store, queue, bus, logger or database.
- **One execution identity.** `ExecutionEvidence` is created by the dispatcher, the only place an invocation becomes real. `ExecutionTelemetry` forwards the same records; it does not produce its own.
- **One event bus.** `AgentEventBus`. `CognitiveTrace` subscribes to it rather than hand-instrumenting tools.
- **Chat scope is enforced by refusing writes,** not by tagging stored facts: `CHAT_SCOPED` (`src/core/multichat/ContextProvenance.ts:95`) is checked in `MemoryBridge.learn` (`src/core/MemoryBridge.ts:401`) and in `ToolDispatcher` (`:1355`). Long-term memory is user-global by design; provenance labelling (`labelOtherChats`) and `CrossChatResolver` consents govern how other-chat content is presented.

---

## 2. K2 — Recording coverage

The full field-by-field matrix, with storage location, lifetime and privacy treatment, is in [execution-recording-matrix.md](execution-recording-matrix.md). Summary:

| Field group | Recorded? | Where |
|---|---|---|
| Mission / work-package identity | **No (gap)** | only in these documents |
| Task / subtask | Yes | `AgentStore` task, `ExecutionRecord.taskId` / `stepId` |
| Agent / system responsible | Yes | `AgentRunner`, `routeReason`, `ExecutionRecord.path` |
| Tool / service invoked | Yes | `ExecutionRecord.tool`, `ExecutionLedger` |
| Repository / branch / commit | **No (gap)** | not a runtime field anywhere |
| Files inspected / modified | Partial | `file_changed` events; full result in `AgentStore` execution record; not in memory |
| Research sources / discoveries | Yes after repair | `rememberKnowledge` provenance (`sources`, `query`, `retrievedAt`) |
| Decisions / rationale | Yes | cycle `decision`, verification `reason`, `routeReason`, yield reason |
| Implementation outcomes | Yes | agent task result/conclusion; objective evidence |
| Test names / results | **No (gap)** | repository evidence only |
| Failures / error details | Yes | `agent_failed`, `tool_failed`, task error, `TurnFailure`, redacted `ExecutionRecord.reason` |
| Corrections / subsequent verification | Yes | `MemoryEngine.supersede` history; lesson contradictions; `resumedBy` |
| Unresolved issues / blockers | Yes | `ObjectiveState.yielded`, `yieldReason`, `waitingFor`, `awaiting-approval` |
| Timestamps / execution status | Yes | all records |
| Source / confidence | Yes after repair | pattern `context.source`/`attribution`, lesson `confidence`, `executionVerified` |
| Project / conversation / session / authorization scope | Partial | `projectId`, `conversationId` on tasks/turns; **not on long-term memory records** |

**Privacy.** `ExecutionEvidence.redactExecutionText` strips bearer tokens, `sk-`/`ghp_`/`xox*` keys and `api_key=…`/`token=…` fields, and truncates to 200 characters. Tool **arguments are never recorded** (`sanitizeExecutionRecord` rebuilds the record field by field). Raw audio is not retained by the memory path. Logs are excluded from Git by `*.log`.

---

## 3. K3 — Learning, not just logging

A log entry is not learning. Each requirement was tested against the running pathway, not asserted from source:

| # | Requirement | Verdict | Evidence |
|---|---|---|---|
| 1 | Capture the information | **PASS** | Unique nonce discovery captured; `tests/learning-provenance.test.ts`; 13/13 acceptance checks |
| 2 | Preserve source and provenance | **PASS after repair** | `context.source=lelu-chat`, `attribution`, `executionVerified=false` persisted |
| 3 | Distinguish observed fact from agent inference | **PASS** | `executionVerified` + `source` + lesson confidence; `ClaimGrounding`; `MemoryBridge.ACTION_CLAIM` redaction |
| 4 | Distinguish verified outcome from unverified claim | **PASS for tool work; GAP for acceptance** | `CompletionVerifier` rejects `DONE:` without executed evidence; but no "verified by test/browser" state exists |
| 5 | Store at the appropriate scope | **PASS** | chat-scoped statements are not persisted; authz relationships govern shared context |
| 6 | Retrieve in a later relevant task | **PASS** | recalled after a fresh store instance; injected into a different conversation's request |
| 7 | Apply to a subsequent decision | **PASS (input-level)** | `MemoryBridge.enrich` injects it into `request.context`; measured `CONTEXT_INJECTION` |
| 8 | Correct/supersede without corrupting history | **PASS after repair** | correction wins, prior value retained in `context.history`, unrelated facts survive |

**Controlled test.** A unique, non-sensitive discovery (`ORCHID-<nonce>`) was recorded by the existing bridge, persisted, re-read after a fresh instance, retrieved for a separate conversation, blocked in its chat-scoped variant, and corrected. Details, commands and raw results: [learning-retrieval-verification.md](learning-retrieval-verification.md).

**What "apply" does and does not mean here.** The acceptance proves retrieval reached the exact string the model would receive. It does not prove a model *used* it well; that requires a live provider and is outside what this environment can measure.

---

## 4. K4 — Truth and execution accountability

`ExecutionEvidence` already separates the states the mission names:

```
requested → authorized → started → succeeded
         ↘ refused
         ↘ failed
         ↘ timed-out
         ↘ suppressed (duplicate, own identity, never a second success)
```

Objective work separates `active / waiting / scheduled / awaiting-approval / completed / yielded / cancelled`, with `yieldReason` (`cycle-budget-exhausted`, `repeated-failure`, `no-progress`, `capability-unavailable`, `awaiting-information`, …). Agent tasks distinguish `running / complete / failed / interrupted`, and resumption creates a **new** task linked by `resumedFrom`/`resumedBy`, so history is not rewritten.

The verifier refuses model prose as evidence: `CompletionVerifier` rejects a bare `DONE:`, a tool requested but never dispatched, and a required tool that only failed. `ObjectiveEvidence` reports what was required, what was observed, how many premature claims were rejected, and whether work continued after rejection.

**Gaps, stated plainly:**

- There is **no distinct `tested` or `verified` state at task level**. A task is `complete` when the model returned, even if no test or browser check ran. `CompletionVerifier` maps tool success → outcome satisfied, which is *not* browser acceptance.
- A **successful command is not a successful outcome** in the ledger either: `stage=succeeded` means the executor returned ok, not that the world changed correctly. Verification of effect is a separate, mostly absent layer (Cosmos object verification is the notable exception).
- Mission/work-package identity and commit provenance are not first-class fields, so "which commit did this work produce" cannot be answered from LÉLU's memory.

---

## 5. K5 — Voice-specific learning

Verified by source and deterministic tests (74 tests: 73 pass, 1 skipped, 0 fail):

| Requirement | Verdict | Evidence |
|---|---|---|
| Spoken input associated with the correct conversation | **PASS** | `VoiceEngine.handleUserSpeech` reads `MultiChatStore.getActiveId()` and passes `{ conversationId }` to `AIService.chat` (`src/core/voice/VoiceEngine.ts:1674–1684`); `tests/voice-core-integration.test.ts` pins coexistence |
| Transcripts retain source and confidence | **FAIL — gap** | the engine knows which path produced text (browser recognition, Whisper, ElevenLabs, LiveKit) but the `VoiceTurn` carries only `text`; no ASR confidence is stored |
| Response associated with the correct turn | **PASS** | `turnId` per utterance; stale replies ignored (`VoiceEngine.ts:1662`, `:1686`) |
| Corrections to transcription / misunderstood requests representable | **PARTIAL** | a restated sentence supersedes the remembered fact, but transcript records themselves are not stored, so a mis-transcription cannot be annotated |
| Voice-session failures and recovery recorded | **PARTIAL** | `TurnFailure` kinds (`transcription-failure`, `playback-failure`, …), `VoiceResourceManager`, per-session diagnostics; not written to long-term memory or the execution ledger |
| Conversational preferences retained under existing rules | **PASS** | spoken turns use the same `AIService.chat → MemoryBridge.learn` path; `CHAT_SCOPED` is honoured; provenance now stored |
| Real microphone + audible output + multi-turn + interruption + recovery | **NOT VERIFIED / BLOCKED** | no Chromium system libraries, no LiveKit server, no VoxCPM model, no microphone or speaker in this container |

Voice is therefore **integrated** with the learning architecture, but **not acceptance-tested live** here. See the release report for the exact blocker list.

---

## 6. Repairs made (inside existing systems only)

| # | Broken connection | Repair | Files |
|---|---|---|---|
| 1 | `Brain.learn` accepted intent, keywords and provenance then discarded them (`_intent`, `_keywords`, `_context`) | parameters are passed to `MemoryEngine.learn`; supplied keywords join the extracted ones | `src/brain/Brain.ts` |
| 2 | `MemoryEngine` had no provenance input, so every stored fact looked identical | `LearnProvenance` (`source`, `attribution`, `keywords`, `context`) is merged into created/reinforced/merged/superseded patterns | `src/brain/MemoryEngine.ts` |
| 3 | a correction whose extractor category differed from the original became a **competing fact**, not a supersession | corrections may match across categories with two shared keywords; same-category matching unchanged; history preserved | `src/brain/MemoryEngine.ts` |
| 4 | `LocalMemoryProvider.persist` dropped the caller's `attribution` | attribution is carried into the learned context | `src/core/memory/providers.ts` |
| 5 | `rememberKnowledge` / `rememberSystem` / `AIService.consolidate` had no provenance channel | optional provenance parameter, written into pattern context; research and objective lessons supply it | `src/brain/Brain.ts`, `src/core/AIService.ts`, `src/core/router/ResearchResolver.ts`, `src/core/cognition/ObjectiveLearning.ts` |

No new store, table, event bus, logger, scheduler or "second brain" was introduced. Every repair writes through the path that already existed.

---

## 7. What remains unproven

1. **Repository/branch/commit provenance** is not recorded by the runtime (K2 asks for it "where applicable" — it is currently absent, not merely incomplete).
2. **Test outcomes are not learning events.** A test that passes today leaves no durable memory; only the repository document records it.
3. **No mission-scoped memory.** Long-term memory is user-global; a mission/work-package identity cannot be used to retrieve "what happened during M22.5".
4. **Voice transcripts carry no source/confidence**, so a misheard sentence cannot be traced to the engine that produced it.
5. **Live model application** of retrieved knowledge was not measured (no provider credentials in this environment); only injection was.
6. **Real voice acceptance** is blocked (section 5).

These are recorded as gaps, not downgraded to passes.
