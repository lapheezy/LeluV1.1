# LÉLU self-study → applied development: audit and first proposal

Status: **AUDIT COMPLETE. PROPOSAL AWAITING GATE 1 APPROVAL. Nothing in production has been changed.**

Base: `claude/cool-mccarthy-dliwu9` @ `4fa5660d`. This is the most recently committed branch on the remote. The M17.3 canonical integration line (`integration/lelu-four-workforce-consolidation`) differs from it in only one cognition file (`SystemEnvironment.ts`), so these findings apply to both lines.

Evidence: `evidence/baseline-40-cycles.json`, produced by `evidence/baseline-probe.test.ts.txt`. The probe runs 40 real `SelfStudyEngine.runCycle()` cycles against the real stores, with the provider replaced by a counter.

---

## 1. Current architecture and execution flow

```
LeluRuntime.initialize()
 ├─ CognitiveLoop.start()            every 60 s + project-change nudges
 │    ├─ gaps → WorkQueue "Study: …" LEARNING items      (a second, parallel study list)
 │    ├─ SelfStudyEngine.start()      own timer: 45 s visible / 8 s cheap / 5 min hidden, 1 leader tab
 │    ├─ CuriosityEngine.tick()       one curiosity per tick; can file REVIEW items into WorkQueue
 │    ├─ runDueReflections()          DailyRecord → keyword match → LeluIdentity trait changes
 │    ├─ SelfDevelopmentEngine.proactiveScan()  diagnostics/capabilities → ImprovementQueue
 │    └─ project intent / autonomous work derivation
 └─ AgentCognitionRuntime.start()    acts on AgentObjectives
```

The SelfStudyEngine cycle (`src/core/cognition/SelfStudyEngine.ts:585`):

observe state → reconcile gaps → select/generate an objective (`StudyObjectives`) → recall memory → `StudyAgentRouter.investigate` (architecture-map, source-read, capability-registry, runtime-status, knowledge-providers…) → **`evaluate()` = one provider call through `AIService.reason` whenever there is any evidence** → `incorporate()` into `KnowledgeLibrary` and `SelfModel` → `consolidate()` into Brain memory → `derive()` 0–3 new questions → mark the objective answered when `evidence.length > 0`.

The improvement pipeline is separate. `ImprovementQueue` (full engineering record) → `SelfDevelopmentLoop.approve` (Gate 1 exists) → develop in sandbox → Ready → `applyCandidate` (L5, never automatic) → Integrated/Recorded. It is fed only by `SelfDevelopmentEngine.detectOpportunities` (diagnostic errors, planned or partial capabilities, agent repetition, blocked items, file overlap), by `SelfTestRunner`, and by the user.

## 2. Why research does not reliably produce conclusions or improvements

| # | Cause | Where |
|---|---|---|
| 1 | **There is no path from a study result to an improvement.** SelfStudyEngine never writes to `ImprovementQueue`. Its outputs end at KnowledgeLibrary, SelfModel and memory. The proposal generator never reads study conclusions. | `SelfStudyEngine.ts` has no ImprovementQueue reference; `SelfDevelopmentEngine.ts:132` reads diagnostics only |
| 2 | **"Answered" means the tool returned something.** An objective closes when `investigation.ok && evidence.length > 0`. Nothing asks whether the question was actually settled. | `SelfStudyEngine.ts:689` |
| 3 | **The evaluation prompt never asks what should change.** It asks for ANSWER / CONFIDENCE / NEXT. So every cycle ends by producing another question, never a recommendation. Across 40 cycles, **0 of 21 new knowledge entries** contain a change recommendation. | `SelfStudyEngine.ts:1331` |
| 4 | **Objectives carry no purpose.** No objective records the problem, why it matters, the evidence that would settle it, or the improvement it could lead to. They are templates such as "What is the state of X?". | `generate()` `:1068`, `derive()` `:1482` |
| 5 | **Leads are adopted without a relevance check.** Titles from arXiv/knowledge-provider results became objectives. Examples: "What is the state of *Tabletop Roleplaying Games as Procedural Content Generators*?" and "…*pricing/hedging using shortfall risk*…". `architecture-map` then "answered" them, and they were marked learned. | `derive()` lead branch; baseline cycles 12, 13, 14, 18, 32 |
| 6 | **Repetition without new evidence.** The same file was studied over and over: `MemoryStore.ts` 4×, `PatternMemory.ts` 2×, `BaseProvider.ts` 2×, `AIProvider.ts` 2×. 50% of cycles were model-derived "discovery" follow-ups. | baseline cycles 5/17/36, 10/30, 27/35, 28/40 |
| 7 | **Knowledge piles up instead of converging.** `KnowledgeLibrary.add()` creates a new entry, titled with the question, every time. Nothing dedupes or caps entries. The only categories are `ai` and `selfdev`. | `KnowledgeLibrary.ts:183`, `SelfStudyEngine.ts:1424` |
| 8 | **Four overlapping "learn" lists.** `StudyObjectives`, WorkQueue "Study:" items, the `CuriosityLedger` and `AgentObjectives` each hold learning intents, and none of them link to the others. | CognitiveLoop.ts:298, CuriosityPorts.ts:287 |
| 9 | **No Gate 2.** Statuses go Ready → Applying → Integrated/Recorded. There is no "demonstrated to the owner" or "accepted" state, no rule allowing one improvement at a time, and no check that an improvement made her better. | `ImprovementQueue.ts` statuses |

On the finite-queue question: the buffer already refills (the floor case is revalidation), so it does not run dry. The problem is the reverse: it refills with unfocused questions, because nothing gives it a direction.

Answers to the brief's ten questions: (1) no defined learning objective; (2) no sufficiency test; (3) it accumulates, it does not synthesize; (4) conclusions are kept, but as unconsolidated per-question entries; (5) partly: the `KnowledgeStatus` labels separate learned, inferred and unverified; (6) no relevance filter; (7) prioritization ranks *questions*, not impact; (8) no proposal comes out of study; (9) Gate 1 exists, but implementation is not traced back to the study that motivated it; (10) no.

## 3. What is worth preserving

- The loop's safety engineering: `withDeadline` on every step, user-turn priority, a single leader tab, the hidden-tab slowdown, `quotableQuestion`, and the honest labels for development-runtime vs static-snapshot evidence.
- The deterministic fallback evaluation, so study continues with no provider at all.
- `StudyAgentRouter`'s real tools and `KnowledgeLibrary` status semantics.
- `ImprovementQueue`'s full proposal record and `SelfDevelopmentLoop`'s sandbox, approval and L5-gated apply. This is the right destination for study output. It just has no inbound connection from study.
- `UsageLedger` / `UsageBudgetGate`: these already reserve, settle and cap every billed call.
- The CuriosityEngine's "learned only if recall returns it" rule, and its constraint learning.

## 4. API consumption

- **Every cycle that has evidence makes one provider call**: 40 of 40 in the probe, with prompts averaging 1,419 characters. Cadence is 45 s while the tab is visible, which is up to ~80 calls an hour per open browser, and 5 min while hidden (~12 an hour). CuriosityEngine (`CuriosityPorts.ts:343`) and AgentCognitionRuntime (`deliberate`) add more.
- Background calls go through the **same `AIService.reason` → ProviderResolver chain and the same per-provider budgets as chat**. They can spend the Groq/OpenRouter free-tier windows that conversations need.
- **Usage is not attributed by purpose.** `gatedGenerate(provider, req, operation = "generate")` already takes an `operation` label, but every caller passes the default. The ledger cannot tell chat from self-study.
- **Local inference is effectively absent in production.** `LocalInferenceProvider` probes `localhost:11434` etc. *from the user's browser*, and `DEPLOY_CONTABO.md` states that no local models are loaded.
- Reduction opportunity: most evidence (architecture map, capability registry, runtime status, source listings) is structured, so a deterministic reading is enough. A model is only worth calling once per objective, when the evidence is turned into a conclusion and a proposal.

**Not measured:** real production call volume. I have no access to the production usage ledger. The figures above come from code and the probe.

## 5. Memory and knowledge retention

- Durable writes do happen: `consolidate()` → Brain/MemoryEngine, and later cycles do recall them (`memoryRetrieved`).
- Duplicates build up in KnowledgeLibrary, because entries are keyed by question, not by subject. 40 cycles added 21 entries, several of them about the same file.
- The five categories the brief asks for (architecture / technical / cognitive / personality / operational) do not exist. Domains are computing, software, creative, engineering, ai and selfdev, and study only writes `ai` or `selfdev`.
- **Governance finding (separate from the proposal):** `LeluIdentity.sandboxMode` defaults to `false`. With that default, `DailyReflection.applyReflection` updates trait confidence and status **automatically**, based on keyword counts in the day's record ("investigate", "discovered", "connected"…). Self-study's own wording can therefore raise her "Curiosity" and "Synthesis" traits, and established traits are injected into the chat prompt (`CognitiveContext.ts:768`). This conflicts with "no autonomous personality change". The one-line fix is to make `sandboxMode` default to staged. It needs your decision, so I have not changed it.

## 6. Proposed first improvement — "A study must conclude"

**Existing behaviour.** A cycle closes when a tool returns lines. The model is asked for the next question, and the result is a new knowledge entry plus up to three more questions. No conclusion is formed and no proposal is made.

**Problem.** Research volume grows. Learning outcomes and applied improvements stay at zero.

**Change, inside the existing SelfStudyEngine. No new loop, store or provider layer:**

1. **Purpose on every objective.** `StudyObjective` gains optional `purpose` fields: the gap, why it matters, what evidence would settle it, and the potential improvement. `generate()` and `derive()` fill them from the source that raised the objective. Existing stored objectives stay valid.
2. **Relevance gate on leads.** A derived lead is adopted only if it resolves to a real handle: a source path in `SourceAccess`, an `ArchitectureMap` subsystem, or a `CapabilityRegistry` id. Paper titles and prose are dropped.
3. **Conclude, not just evaluate.** Per-cycle evaluation becomes deterministic, so no provider call is made per evidence read. When an objective's evidence meets its stated sufficiency, **one** bounded provider call (or the deterministic synthesizer when none is reachable) produces a structured **Conclusion**: what was learned, supporting evidence, relevance to LÉLU, whether anything should change, expected benefit, risks and dependencies, and how it would be verified. An objective is `answered` only once it has a Conclusion. Otherwise it stays open with an explicit "insufficient evidence" verdict.
4. **Converging knowledge.** The Conclusion is written to KnowledgeLibrary by *subject*. It updates the existing entry for that file, subsystem or capability rather than adding another, and records a category from the five the brief names.
5. **Study → Gate 1.** A Conclusion whose verdict is "should change" becomes **one** `ImprovementQueue` proposal with status `Proposed`. That puts it in the existing approval panel. Duplicates are stopped by `hasOpenSimilar`, and the proposal carries `origin: { kind: "self-study", objectiveId }` so it can be traced. Nothing moves past `Proposed` without you.
6. **Repetition guard.** A subject studied twice with no new evidence (same evidence fingerprint) is parked until its source changes.
7. **Chat can answer.** `formatSelfStudyState` adds the latest conclusions and any proposal awaiting approval, so LÉLU answers "what have you concluded?" from persisted fact.
8. Self-study provider calls pass `operation: "self-study"` through the existing `gatedGenerate`. This uses an existing argument, and it is what makes before/after attribution measurable.

**Expected result.** Fewer, purposeful cycles. Model calls happen per conclusion, not per cycle. No off-target subjects. Knowledge entries converge. Real, evidence-backed proposals appear in the existing approval queue.

**Risks.** Proposals could be low quality. This is mitigated by requiring the fields to be grounded quotes from the evidence, and by the existing approval gate. Existing self-study tests may assert the old "answered on evidence" semantics and will need their expectations updated deliberately. Without the relevance gate's lead adoption, the buffer will hold fewer objectives; the revalidation floor still keeps it from ever running empty.

**Rollback.** All fields added are optional. The change is limited to the files below, so reverting the commit restores current behaviour, and persisted stores remain readable by both versions.

## 7. Before/after demonstration plan

A. **Harness (repeatable, the same probe as the baseline):** 40 cycles, same seed state, provider counted.

| Metric | Before (measured) | After (target) |
|---|---|---|
| Provider calls / 40 cycles | 40 | ≤ number of conclusions (expected ≤ 12) |
| Improvement proposals from study | 0 | ≥ 1, each with every field filled and grounded |
| Knowledge entries with a "what should change" field | 0 / 21 | every Conclusion has one (possibly "no change") |
| Off-target objectives (paper titles, prose) | 5 | 0 |
| Same subject re-studied without new evidence | up to 4× | ≤ 2× then parked |
| New knowledge entries | 21 (duplicates) | ≤ distinct subjects studied |

B. **Production, for you to try:** open LÉLU and ask *"What have you concluded from your self-study, and what would you change?"*

- Before: she reports cycle counts, the current question and the questions she derived.
- After: she names a specific conclusion, cites its evidence, and points to the proposal waiting in the Self-Development panel, where you can approve or reject it.

Then open the panel and check that the proposal links back to the study that produced it.

## 8. Tests and acceptance criteria

New `tests/self-study-conclusions.test.ts`:
- No objective is marked `answered` without a persisted Conclusion.
- A lead that is not a real source path, subsystem or capability is never adopted.
- A "should change" Conclusion creates exactly one `Proposed` ImprovementQueue item, never `Approved`, and a repeat does not create a second.
- With no provider, Conclusions are still produced deterministically.
- A provider call is made only at conclusion time, and is recorded with operation `self-study`.
- Repeat studies with the same evidence fingerprint park the subject.
- KnowledgeLibrary is updated by subject, not appended to.

Regression: `self-study-loop.test.ts` (expectations for the changed semantics updated explicitly and listed in the Gate 2 report), `curiosity-engine.test.ts`, `usage-budget.test.ts`, then the full `npm test`, typecheck, lint and build.

Gate 2 evidence will include the before/after probe JSON, test output, a screenshot of the proposal in the panel, and the chat exchange from production.

## 9. Files that would change

- `src/core/cognition/SelfStudyEngine.ts`: generate/derive purpose, relevance gate, deterministic evaluate, `conclude()`, proposal hand-off, repetition guard
- `src/core/cognition/StudyObjectives.ts`: optional `purpose` and `conclusion` fields
- `src/core/cognition/StudyConclusion.ts` (new, **pure functions only**: parse, validate and ground a Conclusion; decide verdict and sufficiency; no state of its own)
- `src/core/cognition/KnowledgeLibrary.ts`: `upsertBySubject()`, optional `category`
- `src/core/selfdev/ImprovementQueue.ts`: optional `origin` on `ImprovementProposal`
- `src/core/AIService.ts`: let `reason()` pass an `operation` label through (the existing `gatedGenerate` parameter)
- `src/core/router/ProviderResolver.ts`: forward that label to `gatedGenerate`
- `src/core/cognition/CognitiveContext.ts`: conclusions and pending proposal in `formatSelfStudyState`
- `tests/self-study-conclusions.test.ts` (new); `tests/self-study-loop.test.ts` (updated expectations)

## Roadmap after acceptance (one at a time, each through both gates)

2. Background resource budget: a separate background cap in `UsageBudgetGate`, attribution reporting, and server-side local inference where the host allows it.
3. Gate 2 in `ImprovementQueue`: `Demonstrated` → `Accepted` / `Returned` states, a single active development objective, and the next one blocked until acceptance.
4. Development record in the existing Cognition/Self-Dev panels: objective → why → research → conclusion → proposal → status → result → acceptance.
5. Personality development through staged, example-backed proposals (depends on the `sandboxMode` decision).
6. Merge the duplicate learning lists (WorkQueue "Study:" items and curiosity follow-ups) into `StudyObjectives`.
