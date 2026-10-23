# LÉLU Curiosity Engine v1 — Report

Branch `claude/open-session-rbwmdw`. This is the first operational curiosity loop. It is **not** complete autonomy, and this report says exactly what it can and cannot do.

---

## 1 · Architecture audit — what already existed

| Component | Status | Relationship to curiosity |
|---|---|---|
| `app/scene/genesis/engines/CuriosityEngine.ts` | IMPLEMENTED — **unrelated** | A scalar in the cosmos visual simulation. Only the name overlaps; not cognition. |
| `proactive/ProactiveCore` questions + `QuestionLifecycle` | IMPLEMENTED | **Reused as the only host-question channel**: key+evidence dedupe, one question on screen, ignore→park, answer revives the asking objective. |
| `AIService` proactive-answer path (`looksLikeProactiveAnswer → resolveQuestion`) | IMPLEMENTED | Reused: Heru answers a curiosity question in normal chat. |
| `tools/ToolDispatcher.dispatchToolCall` + `toolPermitted` | IMPLEMENTED | **Reused as the only execution path** (registry → AutonomyGate → EngineeringAuthorization → executor → AgentEventBus). |
| `tools/ToolRegistry.execute()` | IMPLEMENTED, *no permission check* | Deliberately **not** used by curiosity. |
| `cognition/AutonomyGate`, `engineering/EngineeringAuthorization` | IMPLEMENTED | Unchanged; curiosity is checked by both via the dispatcher. |
| `cognition/SelfStudyEngine` + `StudyObjectives` + `StudyAgentRouter` | IMPLEMENTED, live (Bootstrap) | A mission-driven background *architecture self-study* loop with its own question buffer. **Not duplicated**: curiosity covers conversation, execution failures, host ambiguity and her own behaviour, which self-study never sees. Curiosity reuses `objectiveKey` (its dedupe convention). |
| `cognition/KnowledgeLibrary` gaps | IMPLEMENTED | Already consumed by CognitiveLoop/SelfStudy — curiosity does not re-detect them. |
| `cognition/ObjectiveLearning`, `AIService.recall / consolidate` | IMPLEMENTED | Reused as the memory read/write path. |
| `cognition/AgentObjectives`, `WorkQueue` (REVIEW) | IMPLEMENTED | Curiosity only **proposes** into REVIEW. |
| `cognition/CompletionVerifier` | IMPLEMENTED | Verifies objective completion — a different question; curiosity's evidence check is its own small pure function. |
| `cognition/CognitiveLoop` | IMPLEMENTED | The existing lifecycle point where curiosity ticks. |
| `identity/LeluIdentity`, `security/PersonalityGuard`, `identity/DailyRecord` | IMPLEMENTED | Personality evidence and the journal. |
| `identity/DailyReflection` | **DISCONNECTED** | Nothing calls `reflectOnDay` / `applyReflection`. |
| `identity.curiosities` | **DISCONNECTED** | Only `applyReflection` writes it → always empty. Still shown in the Questions view as "From reflection". |

Defects found while auditing (fixed in this change):

- **`npx tsc --noEmit` checks zero files** — root `tsconfig.json` is `"files": []` with project references. The "TypeScript clean" claims in the engineering-pass and Personality v1 reports used that command and were vacuous. The real check is `tsc -b`, and it was failing with two pre-existing errors:
  - `GenesisCognitiveTracePanel.tsx`: `STAGE_COLOR` lacked the three stages the engineering pass added to `CognitiveStage` (my earlier change) — this broke `npm run build`.
  - `GenesisIdentityPanel.tsx`: passed a non-existent `label` prop to `GenesisWindowFrame` (Personality v1).
- `GenesisIdentityPanel` Apply/Dismiss on a staged change called `window.location.reload()` — reloading the whole app. Replaced with a state refresh.
- Found in the browser: the Identity window opened at **y = −103** on a 1280×860 viewport — its title, Exit Core button and every tab were above the screen and unclickable. It nested its own scroller (`maxHeight: calc(100% - 30px)`) inside the frame's scrolling body, and window frames here grow upward from a fixed bottom anchor. Fixed by letting the frame body scroll (as the Memory panel does) and capping the frame at `min(52vh, 480px)` → now y = 52. **Not fixed (pre-existing, out of scope):** the Cognition panel opens at y = −226 for the same frame-anchoring reason.

## 2 · New implementation

`src/core/curiosity/`

| File | Role |
|---|---|
| `Curiosity.ts` | Types and **pure** judgement: priority (`importance × uncertainty × relevance × expectedBenefit`, bounded, urgency/cost modifiers), queue tiers, triviality filter, the decision tree (`nextStep`), host-question quality check, action classes + curiosity permission policy, tool selection, failure-cause classification, evidence verification, answer classification, and the detectors (conversation ambiguity, repeated tool failures, her own failure patterns, unconnected capabilities, follow-ups). |
| `CuriosityLedger.ts` | Lifecycle records (`lelu.curiosity.v1` via KvStore): bounded active queue (40, displacement not deletion), history (200), learned tool constraints. **Not a knowledge store** — learnings live in the Brain; records point at them. |
| `CuriosityPorts.ts` | The only effects, each one existing system: dispatcher, `AIService.consolidate`, ProactiveCore, WorkQueue, LeluIdentity, DailyRecord, AgentEventBus. Heavy modules load lazily (no cycle with AIService). |
| `CuriosityEngine.ts` | Sequencing: notice → assess → retrieve / investigate / ask → evidence → verify → learn → remember (verified by recall) → apply → reflect → bounded follow-up. Sandbox `explain()`. |

Wiring (existing files): `AIService.chat` → `observeConversation` (skipped when the message answers a pending question); `CognitiveLoop.runOnce` → one bounded `tick()` under `withDeadline`; `GenesisIdentityPanel` Questions view.

Curiosity object fields match the spec (id, createdAt, question, unknown, context, category, importance, uncertainty, relevance, expectedBenefit, priority, source, status, relatedMemoryIds/ConversationIds/ObjectiveIds, proposedActions (ToolIntents), evidence, answer, verification, learning, appliedResult, resolvedAt) plus a step `trail`, `depth/rootId/parentId`, `attempts`, `nextAttemptAt` (backoff) and `expiresAt`. All 8 categories and 12 statuses exist.

## 3 · Integration — systems reused

AIService (chat path, recall, consolidate) · Brain/PatternMemory (via consolidate/recall only) · ToolDispatcher + ToolRegistry catalog · AutonomyGate · EngineeringAuthorization · AgentEventBus · ProactiveCore + QuestionLifecycle · CognitiveLoop · WorkQueue · StudyObjectives' key convention · LeluIdentity + PersonalityGuard · DailyRecord · KvStore · existing Identity panel. **Nothing** was added to MemoryBridge, no provider, runtime, chat or agent loop was created.

## 4 · Tool use

Curiosity selects tools purposefully (`selectTools`) and every invocation is a `ToolIntent { curiosityId, tool, actionClass, objective, reason, expectedEvidence, args, permission, permitted, outcome, resultSummary, cause }`.

| Tool | Class | Used for |
|---|---|---|
| `memory.recall` | READ | Always first (RETRIEVE), and to prove a learning is retrievable |
| `system.config` | READ | Configuration evidence for tool/capability diagnoses |
| `workflow.list`, `sandbox.read` | READ | Project questions that name them |
| `research.web` | EXTERNAL (read-only) | World/strategic/creative questions |
| `internal:tool-registry` | ANALYZE | Read-only probe of a tool's registry state (available, permitted, executable, route) or tools sharing its route |
| `internal:curiosity-ledger` | ANALYZE | Read-only probe of her own past investigations (self-curiosity) |

`internal:*` probes read in-process state, have no side effects and are never dispatched.

## 5 · Permission model

Two independent gates, both must pass:

1. **Curiosity policy** (`curiosityPermission`, narrower than the system's): READ / ANALYZE / diagnostic EXECUTE (`workspace.test`, `workspace.typecheck`, `project.validate`) / read-only EXTERNAL research → `auto`. WRITE, DESTRUCTIVE, other EXECUTE (e.g. `workflow.run`), write-capable external → `proposal`. `project.apply`, `project.commit` → `never`.
2. **The dispatcher's own** `toolPermitted()` (registry availability, AutonomyGate level, human authorization) — re-checked inside `dispatchToolCall`.

A blocked tool is recorded as a blocked intent with the accurate reason and is never dispatched. Automatic: memory retrieval, inspection, diagnostics, analysis, read-only research, evidence collection, storing verified learning, proposing a REVIEW objective, one personality evidence item. Requires Heru: anything WRITE/EXECUTE-with-effects, every proposed objective, staged personality changes for established traits or in Sandbox Mode. Never: changes to core values, PersonalityGuard, permissions, autonomy level, memory architecture, credentials, prompts, or the real project.

## 6 · Learning — how a curiosity becomes memory

Verified evidence (≥ 0.6 combined independent support, no contradiction) → classified learning (`fact, constraint, preference, goal, decision, procedure, capability, technical-knowledge, self-knowledge, …`) → `AIService.consolidate` (`system` layer for self/technical/capability, `knowledge` otherwise) → an immediate `memory.recall` through the dispatcher must return it → only then `learned`. A write the Brain accepted but cannot return is **blocked, not learned**. If memory already held the answer, nothing new is written (`fromExistingMemory`). Host answers become `"Heru clarified “…”: …"` knowledge — never identity.

## 7 · Personality

A resolved, retrievable, non-host curiosity supplies **one** observation per inquiry *chain* (a follow-up adds none): `pattern-recognition` for execution/self patterns, `synthesis` for ≥2 agreeing sources, otherwise `curiosity`. It goes through `LeluIdentity.addTraitObservation`, so **PersonalityGuard remains the authority** for any status change and LeluIdentity's thresholds still require ≥3 evidence to leave `candidate`. If the trait is `established` or Sandbox Mode is on, the evidence is **staged** for approval instead. The journal (`DailyRecord`) gets: curiosities (`questions`), investigations (`experiences`), lessons (`lessons`), personality evidence (`emergingTraits`), host clarifications (`relationshipObservations`). Quiet days write nothing.

## 8 · Autonomy — what bounded behaviour now works

- Notices ambiguity in Heru's requests, repeated tool failures across turns, her own repeated investigation failures, and available-but-undispatchable capabilities (daily).
- Decides memory → tools → Heru → defer/dismiss, and stays quiet when a question is not worth asking (can investigate, already asked, unimportant, another question waiting, channel off).
- Runs at most **one** curiosity per CognitiveLoop cycle, never during Heru's turn (8 s grace), with `maxToolSteps 4`, `timeoutMs 30 s`, `stepTimeoutMs 8 s`, `maxDepth 2`; deferred work backs off; queue capped at 40; chains past the depth limit **pause** (`blocked: depth-limit: awaiting continuation`) until `resume()`.
- Applies what it learns: verified tool diagnoses become **constraints** that change later tool selection (`background` scope for context-dependent tools), and important ones become **REVIEW proposals**.
- Opens the next question after a verified diagnosis ("Which other capabilities share X's limitation?").

## 9 · Tests

- `tests/curiosity-engine.test.ts`: **43/43** — detection (6), prioritisation (4), memory (6), host (5, incl. real ProactiveCore), tools (7, incl. the real dispatcher + AutonomyGate at level 0), learning (3), personality (4, incl. real LeluIdentity: 1 curiosity → still candidate; 3 independent → emerging), autonomy (6), architecture/integration (2).
- Full suite `npm test`: **835/835 passing, 0 failing** (baseline before this change: 792/792; +43 new).
- Acceptance script `scripts/verify-curiosity.ts`: **33/33**.
- Browser (Vite dev server + Chromium, 1280×860): the app's own CognitiveLoop tick pursued a host curiosity and its question appeared on the **existing** proactive question card in the chat window (*"When you say you want LÉLU to become autonomous, which actions should she eventually be able to initiate without asking you?"* with Answer / Later); the Questions view showed *Waiting for Heru*, *Investigating* and *Curious about* (including the daily capability-scan question); in Sandbox Mode a question expands to Detected / Why / Potential action / Tools / Permission / Evidence / Confidence; no page errors.

## 10 · TypeScript

`npx tsc -b --force` (the repo's real `typecheck`): **exit 0**, after fixing the two pre-existing errors listed in §1. (`npx tsc --noEmit` at the root checks no files and is not evidence.)

## 11 · Demonstration — `npx tsx scripts/verify-curiosity.ts`

Real AIService/Brain, real dispatcher, real ProactiveCore, LeluIdentity, DailyRecord, WorkQueue (only browser storage shimmed). **33/33 checks pass.** Cycle B, verbatim:

```
turn-b1: project.read → "project.read" is not available in this runtime, so it was not run.
turn-b2: project.read → "project.read" is not available in this runtime, so it was not run.
NOTICE     Why does project.read keep failing?   (execution → technical, tier 2, priority 0.38)
QUESTION   unknown: the cause behind 2 failures of project.read
TOOL       memory.recall → ok (nothing covering it)
           internal:tool-registry → ok   [ANALYZE, auto, purpose + expected evidence recorded]
EVIDENCE   [supports 0.30] observation: failed in turn turn-b1 …
           [supports 0.30] observation: failed in turn turn-b2 …
           [supports 0.50] registry: project.read: available=false, permitted=false, executable=true, route=EngineeringWorkspace.readFile
VERIFY     verified (0.76) — 2 sources: observation, internal:tool-registry
LEARN      constraint: project.read fails because it is not available in this runtime  [stored=true, retrievable=true]
APPLY      Future investigations will not select project.read (unavailable).
           Proposed a REVIEW objective for Heru (approval required; nothing changed).
REFLECT    one evidence item → pattern-recognition (via LeluIdentity / PersonalityGuard)
NEXT       Which other capabilities share project.read's limitation? → resolved: project.copy, project.list, project.write, … share EngineeringWorkspace
```

Cycle A (host): "I want to make LÉLU more autonomous — something like…" → memory had only restatements of the request (correctly not treated as an answer) → asked *"When you say you want LÉLU to become autonomous, which actions should she eventually be able to initiate without asking you?"* on the existing question channel → Heru answered in normal chat → classified **constraint** → stored, recalled on a later "autonomous" query → identity untouched.

Cycle C (self): two background investigations failed with `research.web` → *"Why do my own investigations keep failing when I use research.web?"* → her own records + registry → verified self-knowledge (it needs a turn's router context) → background investigations stop selecting it → one evidence item for pattern-recognition (stays `candidate`, 2 evidence) → daily record updated.

## 12 · Remaining limitations — what LÉLU still cannot do

1. **No web research in the background.** `research.web` requires a turn's RouterContext; curiosity has none, so world questions currently defer and then dismiss/block. She learned this herself (cycle C); fixing it is an engineering decision for Heru.
2. **No LLM reasoning inside curiosity.** Detection, interpretation and verification are deterministic rules; she cannot read arbitrary tool output for meaning beyond those rules, nor phrase novel questions beyond templates.
3. **Conversation detection is narrow**: a directive plus explicit vagueness markers. Most real ambiguity goes unnoticed.
4. **Contradiction detection is structural** (registry/config/own-records vs. a hypothesised cause), not semantic.
5. **Diagnoses stop at "why it fails"** for a small set of causes; she does not fix anything, and REVIEW proposals still need Heru and the normal development workflow.
6. **Constraints are only lifted manually** (`removeConstraint`) or by a new diagnosis — not automatically when a tool recovers.
7. **No persistence across devices** for the ledger (KvStore only, like StudyObjectives); learnings themselves do sync through the Brain's existing path.
8. **`DailyReflection` is still disconnected.** If it is wired later, it must skip `Curiosity —` lines, or curiosity work would be counted twice (curiosity already supplies its own evidence).
9. The Questions view was checked in Chromium but not with a real human answering through the card; the answer path itself is covered by the real-chat acceptance cycle A and the ProactiveCore integration test.

This is Curiosity Engine **v1**: bounded, observable, reversible — not finished.
