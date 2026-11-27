# Mission 45 · WP18 — Cognitive Architecture Audit

| | |
|---|---|
| Branch | `integration/m16-3-wp05-reconciliation` |
| Base commit | `543da7c8` |
| Scope | Continuous cognition, self-questioning, adaptive questioning, conversational initiative, scope judgement, collaboration learning, post-action continuity, event integration |
| Constraint | No new agent, no parallel cognition engine, no second memory or question store |

This audit was written from the code as it exists in this checkout, not from the mission brief's assumptions about it. Where the brief names a subsystem that does not exist here, that is recorded rather than simulated.

---

## 1. What already existed, and what it actually does

| System | Where | What it owns | Relevance to WP18 |
|---|---|---|---|
| `CognitiveLoop` | `src/core/cognition/CognitiveLoop.ts` | The 60 s heartbeat: observe memories/projects/agents/queue, sync the self-model, propose learning work, derive project intent, run curiosity, daily reflection | The scheduler WP18 attaches to. It already defers while a user turn is in flight. |
| `AgentCognitionRuntime` | `src/core/cognition/AgentCognitionRuntime.ts` | Bounded objective execution: cycle/action budgets, deadlines, self-continuation, completion verification | Executes work; WP18 evaluates direction rather than duplicating execution. |
| `AgentObjectives` | `src/core/cognition/AgentObjectives.ts` | Durable objective state, priority, cycles, outcomes, yield reasons | The record WP18 reads to identify incomplete, stalled and completed work. |
| `SelfStudyEngine` | `src/core/cognition/SelfStudyEngine.ts` | Continuous question generation, evidence evaluation, learning consolidation | Already owns *study* questions. WP18 does not add a second study loop. |
| `ProactiveCore` + `QuestionLifecycle` | `src/core/proactive/` | The one durable question store: evidence fingerprinting, surfacing, deferral, dismissal, parking, workstream engagement | WP18 raises clarifications through policy but does not add a second question lifecycle. |
| `CuriosityEngine` | `src/core/curiosity/` | Notices ambiguity and gaps; pursues bounded investigations | Notices **what** is ambiguous. It did not decide **whether asking** is worth an interruption. WP18 adds that judgement. |
| `SelfModel` | `src/core/cognition/SelfModel.ts` | Persistent self-representation: capabilities, projects, limitations, unfinished work | Supplies real capability names for duplicate-detection and the live work list. |
| `CognitiveContext` | `src/core/cognition/CognitiveContext.ts` | The per-turn snapshot of runtime state injected into the model request | The existing context path WP18's notes join; no replacement. |
| `ExecutiveBoard` / `ExecutiveRuntime` | `src/core/executive/` | Six coordinated executive functions mapped onto real systems | WP18's `EXECUTIVE` mode is a behavioural state, not a new executive. |
| `Caretaker` (`HealthIntelligence`) | `src/core/caretaker/` | Evidence-graded health intelligence and the information firewall | WP18 keeps its own domain out of it; no health claims, no psychological inference. |
| Agent Forge (`AgentStore`, templates) | `src/core/agents/` | Agent creation, specialization, delegation | WP18 feeds capability gaps into the existing improvement queue for Forge/self-improvement to evaluate. |
| Memory path (`Brain`, `PatternMemory`, `MemoryBridge`) | `src/brain/`, `src/core/MemoryBridge.ts` | Recall, consolidation, offline composition | The real memory system. There is no module named “Memory Garden” in this checkout. |
| Development record (`DailyRecord`, `DailyReflection`, `LeluIdentity`) | `src/core/identity/` | Daily evidence, trait changes, reflection | The precedent WP18's `LearningLedger` follows: measure from recorded outcomes, not from activity. |
| Self-improvement (`ImprovementQueue`, `SelfDevelopmentEngine`) | `src/core/selfdev/` | Durable proposals, sandbox development, validation | Receives measurable capability gaps from WP18. |
| Graph surfaces (`KnowledgeGraph`, `SpatialSceneGraph`) | `src/core/cognition/`, `src/core/spatial/` | Observation graph; world graph | The only graph stores present. |
| Event spine (`AgentEventBus`, `Sentinel`) | `src/core/agent/`, `src/core/sentinel/` | Task/tool/cognition events, health reporting | The runtime trace WP18 records against. |

---

## 2. The actual gaps WP18 closes

1. **No evaluation of the conversation as an objective.**
   `CognitiveLoop` walked projects, agents, queue, gaps and the self-model. It did not ask whether the current conversation had an incomplete objective, an unanswered question, or a direction worth challenging.

2. **Ambiguity was noticed, not adjudicated.**
   `CuriosityEngine.observeConversation()` detects ambiguous wording and `ProactiveCore` can carry a question, but nothing computed whether *this* question, *now*, would change the next action more than it cost the user. Repetition was controlled per-question by the lifecycle, not per-kind by feedback.

3. **No scope judgement.**
   Planning produced steps; nothing evaluated whether the plan was larger than the stated requirements, duplicated an existing capability, or was justified in its size.

4. **Self-questioning did not exist as a loop.**
   `CompletionVerifier` checks whether claimed work is complete. No component challenged her own assumptions, sought counter-evidence, noticed an uncompared alternative, or revised a conclusion because a challenge survived.

5. **Post-action continuity was a notification, not a conversation.**
   `InitiationTriggers` can announce that an agent finished, with evidence. It could not say what followed from the result or continue the discussion.

6. **No model of how this user prefers to collaborate.**
   `UserProfile` stores declared preferences. There was no evidence-weighted, decaying estimate built from corrections, accepted/rejected recommendations and pacing.

7. **Cross-surface continuity was transcript-only.**
   `VoiceEngine`, `GenesisChat` and `GenesisBrowserPanel` all call `AIService.chat()` with the active `conversationId`, so history was shared — but the working thread (topic, last decision, open question, attached objectives) was not.

8. **Development was not measured at the collaboration level.**
   `DailyRecord` measures identity development; `ObjectiveLearning` measures task lessons. Nothing measured question effectiveness, interruption quality, objective continuity or repeated mistakes against a previous window.

---

## 3. What WP18 added — and deliberately did not add

New package: `src/core/conversation/` (13 modules, no new agent and no new timer).

| Module | Responsibility |
|---|---|
| `types.ts` | Shared vocabulary: surfaces, modes, evidence, visibility |
| `text.ts` | Deterministic text primitives: tokens, overlap, fingerprints, reversal detection |
| `CollaborationModel.ts` | Evidence-weighted, decaying, contextual collaboration preferences |
| `QuestioningPolicy.ts` | The ask/proceed decision, posture observations, and a per-kind learning ledger |
| `ScopeIntelligence.ts` | EXPAND / SIMPLIFY / PRIORITIZE / MINIMIZE / HOLD with reasons and preserved functionality |
| `SelfInterrogation.ts` | Nine grounded self-challenges and a conclusion-revision record |
| `ContinuationPlanner.ts` | The six post-action questions, answered from records |
| `ConversationalInitiative.ts` | Grounded candidate selection, budgets by mode, contradiction detection |
| `LearningLedger.ts` | Outcome-ratio development metrics, window comparison, capability gaps |
| `NeuralMapBridge.ts` | Typed cognitive events with internal/user-visible separation, V2/V3 projections |
| `SurfaceContinuity.ts` | One thread across chat, voice and browser |
| `CognitiveEvaluation.ts` | The continuous evaluation lifecycle, modes, budgets, reports |
| `TurnBridge.ts` | The single integration point used by `AIService` |

**Not created:** a second cognition engine, a second scheduler, a second question store, a second memory, a new agent, or a new persona. WP18 is a judgement layer over systems that already exist.

**No model calls.** Every decision is deterministic over recorded state. The evaluation lifecycle reports `modelCalls: 0` on every tick, which is what keeps continuous cognition from becoming continuous token spend.

---

## 4. Integration map

| Integration point | Change | Behaviour |
|---|---|---|
| `AIService.chat()` | `options.surface?: "chat" \| "voice" \| "browser"` | Marks where the turn arrived, so the thread can cross surfaces. |
| `AIService.chat()` | `TurnBridge.prepareTurn()` before the request | Adds collaboration evidence, continuity, self-challenges, scope judgement, questioning decision and grounded observations to the model context. Contained in `try/catch`; the turn proceeds unchanged on failure. |
| `AIService.chat()` | `TurnBridge.completeTurn()` before the reply is emitted | Measures the produced plan, decides whether one evidence-backed continuation follows, records outcomes, and appends at most one sentence. |
| `AIService.chat()` | `TurnBridge.noteQuestionAsked()` | Counts a clarification as asked only when the reply actually contains it. |
| `CognitiveLoop.runOnce()` | `CognitiveEvaluation.tick("scheduled", …)` | Scheduled reflection on the existing heartbeat, with its own gap and per-minute budgets. |
| `VoiceEngine` | `surface: "voice"` | Spoken turns share the same thread as typed ones. |
| `GenesisBrowserPanel` | `surface: "browser"` | Browser-surface turns do the same. |
| `LearningLedger` → `ImprovementQueue` | `fileCapabilityGaps()` | A weak measured ratio becomes an existing improvement proposal, owned by Agent Forge / self-improvement. |

Delegated agent replies in `AIService` do not pass through the continuation path: they are the agent's answer, not LÉLU's turn.

---

## 5. Neural Map: what exists here

**There is no subsystem named “Neural Map V2” or “V3” in this checkout, on the base commit, or on the other local mission branches.** Searching the source and branches for `NeuralMap`, `neural-map` and “Neural Map” finds only unrelated uses of “neural” (the Silero voice model, a visual “neuron” motif).

Building a second graph store under that name would be exactly the parallel cognition system the mission forbids. WP18 therefore delivers:

* **one authoritative event record** (`NeuralMapBridge`) for the ten event kinds the mission lists;
* **a V2-shaped connectivity projection** (events → subjects, conversations, objectives; `concerns`, `raised-in`, `advances`, `follows` edges);
* **a V3-shaped layered projection** (internal vs user-visible, timeline, salience by kind, unresolved questions).

The visibility split is the load-bearing part: an internal self-challenge can never appear in the user-visible layer as something LÉLU said. When V2/V3 views are present, they consume these projections; until then the bridge is inspectable and persistence-backed.

---

## 6. “Memory Garden” and “Caretaker” in this checkout

* **Memory Garden** does not exist as a module. The real memory path is `Brain` → `PatternMemory` → `MemoryBridge` → consolidation in `AIService`. WP18 writes development events to `LearningLedger` and raises nothing directly into long-term memory; a learned preference is a decaying estimate, not a memory that should be permanently planted. Where a correction must be remembered, the existing proactive-answer path already calls `memory.learn()`.
* **Caretaker** exists as `HealthIntelligence` plus the Caretaker executive. WP18 shares only the executive board's mode vocabulary; it makes no health inference and no psychological diagnosis. Posture observations are lexical and explicitly defeasible.

---

## 7. Risk register

| Risk | Control |
|---|---|
| Continuous cognition becomes a spin loop | Driven by the existing 60 s heartbeat; `MIN_GAP_MS = 12 s`, `MAX_PER_MINUTE = 6`; user-turn deferral; no timer of its own. |
| Proactive noise | Every contribution needs evidence; one contribution by mode; one continuation per 3 turns and 10 minutes; a question costs more after every ignored one; observational mode suppresses speech. |
| Fabricated claims | A completion claim with no supporting evidence is challenged; a continuation must name a completed item, finding, unresolved issue or next step; a question is counted only if the reply contains it; Neural Map separates internal from user-visible. |
| Scope advice removes requested work | SIMPLIFY/MINIMIZE require full must-have coverage and return a `preserved` list; ambition backed by ≥3 must-haves is never reduced (EXPAND/HOLD instead). |
| Preference lock-in | 21-day half-life; global/context blend; current message overrides the prior; no psychological claims. |
| Learning from too little | Metrics are `null` with no samples; the score needs two sampled metrics; the comparison states a small-sample caveat. |
| Duplicate cognition systems | No new stores for memory, questions, objectives or agents; the question lifecycle remains `ProactiveCore`'s. |

---

## 8. Honest limitations found during implementation

1. **No live-model validation in this environment.** The evaluation lifecycle needs no model; the *conversational effect* of the injected notes was not measured against a real provider because no credential is configured here. The integration is typechecked and exercised end-to-end through `TurnBridge`, not through a live reply.
2. **The harness is deterministic, not a user study.** The 12-round comparison uses a simulated user with explicit rules. It proves the policy learns from feedback and retains necessary asks; it does not prove a human prefers the result.
3. **Thresholds are heuristics.** Materiality, interruption cost and scope coverage are declared, inspectable formulas, not learned weights. They are tuned to produce explainable decisions and can be argued with through their `reasons`.
4. **No UI surface was inspected.** `NeuralMapBridge.subscribe()` exists for a view, but no panel was built or visually verified; the mission asked for event representation, not a new screen.
5. **Voice was verified at the call-site, not with audio.** `VoiceEngine` passes `surface: "voice"` and the same `AIService.chat()` path; no microphone or TTS run was performed.
