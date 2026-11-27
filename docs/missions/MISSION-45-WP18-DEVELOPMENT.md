# Mission 45 · WP18 — Development Documentation

How to work on LÉLU's conversational cognition without turning it into a second brain.

---

## 1. Run it

```bash
# acceptance suite
npx tsx --tsconfig tsconfig.test.json --import ./tests/support/ignore-css.mjs \
  --test tests/conversational-cognition.test.ts

# interaction record + measured before/after comparison
npx tsx scripts/wp18-evaluate.ts

# lint
npx oxlint src/core/conversation

# typecheck (WP18 compiles clean; two pre-existing errors remain in
# src/core/perception/FeatureUnderstanding.ts on this branch)
npx tsc -b --force
```

There is nothing to start: WP18 has no timer, no daemon and no model call. It runs when the existing chat turn calls `TurnBridge`, and when `CognitiveLoop` ticks.

---

## 2. Where each behaviour lives

| Behaviour | Module | Entry point |
|---|---|---|
| Continuous evaluation, modes, budgets | `CognitiveEvaluation.ts` | `tick(trigger, options)` |
| Self-questioning and revision | `SelfInterrogation.ts` | `interrogate(input)`, `applyRevision(...)` |
| Ask / proceed / defer | `QuestioningPolicy.ts` | `decideQuestioning(input)` |
| Learning when to ask | `QuestioningPolicy.ts` | `QuestioningLedger` |
| Scope judgement | `ScopeIntelligence.ts` | `assessScope(input)` |
| Initiative candidates | `ConversationalInitiative.ts` | `selectInitiatives(seeds, context)` |
| Post-action continuation | `ContinuationPlanner.ts` | `planContinuation(input)` |
| Collaboration preferences | `CollaborationModel.ts` | `observe()`, `profile()` |
| Development metrics and gaps | `LearningLedger.ts` | `summarizeDevelopment()`, `compareDevelopment()`, `capabilityGaps()` |
| Neural Map events | `NeuralMapBridge.ts` | `record()`, `projectV2()`, `projectV3()` |
| Cross-surface thread | `SurfaceContinuity.ts` | `touch()`, `briefingFor()` |
| Chat integration | `TurnBridge.ts` | `prepareTurn()`, `completeTurn()`, `noteQuestionAsked()` |

Everything except `TurnBridge`, `CognitiveEvaluation`, `LearningLedger`, `CollaborationModel`, `QuestioningLedger`, `SurfaceContinuity` and `NeuralMapBridge` is pure: same input, same output, no store, no clock.

---

## 3. Data contracts worth knowing

### Questioning decision

```ts
decideQuestioning({
  objective, ambiguity, missing, decisionImportance,
  userInstructions, urgency, priorQuestions, repeatedQuestionKeys,
  corrections, questionTolerance, wantsUninterruptedExecution,
  proposedQuestion, expectedAction, learnedAdjustment,
})
```

Returns `{ action, question, assumption, confidence, reasons, expectedImpact, interruptionCost, posture, answerWouldNotChangeAction, key }`.

* `action` is `"ask" | "proceed-with-assumption" | "proceed-silently" | "defer"`.
* `reasons` is signed and named; every ask is explainable after the fact.
* `defer` is the honest answer when a gap exists but no specific question would repay the interruption.
* `key` is the fingerprint used to learn the outcome.

**Invariant:** `ask` is impossible without a concrete `proposedQuestion`. There is no generic question generator.

### Scope assessment

```ts
assessScope({ objective, requirements, plan, existingCapabilities,
  proposedNewModules, dependencies, competingObjectives,
  urgency, investigationGaps, evidenceGaps, signaledSimplicity, ambition })
```

Returns `{ recommendation, headline, why, coverage, incidentalComplexity, necessaryComplexity, preserved, confidence, ambitionRespected, fingerprint }`.

**Invariants:**
* `SIMPLIFY` / `MINIMIZE` require every must-have covered and a non-empty `preserved` list.
* Without a plan, requirements are **unknown**, not uncovered (`coverage.planStated === false`).
* Ambition backed by ≥3 must-haves is never reduced.
* `HOLD` is a real answer.

### Self-challenge

```ts
interrogate({ objective, conclusion, approach, assumptions, evidence,
  requirements, alternatives, recentActions, userCorrections,
  objectiveAgeMs, objectiveStillRelevant, nextStepDefined,
  existingCapabilityFor, dedupe })
```

Returns `{ challenges, considered, suppressed, conclusionHeld, modelCalls: 0 }`. Each challenge carries `kind`, `question`, `correction`, `basis`, `severity`, `fingerprint`.

**Invariants:**
* A challenge needs a basis. No basis, no challenge.
* Fingerprints prevent repetition; a repeated observation is suppressed unless its basis changed.
* `applyRevision()` records `{ from, to, because, challengeIds }`. A dismissed challenge is kept as evidence the conclusion survived.

### Continuation

```ts
planContinuation({ completed, revealed, affectedObjectives, unresolved,
  nextSteps, opportunities, userTolerance, interruptedRecently })
```

Returns `{ worthRaising, line, answers, evidence, reason }`.

**Invariants:**
* `line` is null unless there is a specific source with evidence.
* There is no branch that produces “let me know if you need anything else”.
* `interruptedRecently` suppresses the line regardless of content.

---

## 4. Tuning knobs and why they are where they are

| Constant | Value | Rationale |
|---|---|---|
| `CollaborationModel.HALF_LIFE_MS` | 21 days | Long enough to be stable, short enough that a month-old instruction cannot govern today |
| `CollaborationModel` global/context blend | 0.65 / 0.35 | Context moves faster than the global estimate without overriding it |
| `CognitiveEvaluation.MIN_GAP_MS` | 12 s | A scheduled reflection cannot spin, even if nudged |
| `CognitiveEvaluation.MAX_PER_MINUTE` | 6 | Hard ceiling on evaluation work |
| `CognitiveEvaluation.RECENT_COMPLETION_MS` | 15 min | What counts as “just completed” for continuation |
| `QuestioningPolicy` baseline cost | 0.18 | Every question costs the user a turn |
| Tolerance weight | `(1 − tolerance) × 0.4` | The user's measured tolerance dominates the cost |
| Ignored-question penalty | `0.1` each, capped `0.3` | Two or three ignored questions change behaviour; after that it saturates |
| Ask threshold | `impact ≥ max(0.3, cost)` | A gap must beat the interruption, never merely exist |
| Per-kind learning band | `±0.2` impact | Low-stakes and high-stakes questions are not evidence about each other |
| `QuestioningLedger` band history | 24 records | Enough that answered questions cannot push ignored ones out of view |
| `ScopeIntelligence` incidental threshold | 2 elements | One redundant element is noted, not turned into a detour |
| Continuation turn gap | 3 turns | Prevents a suffix on every reply |
| Continuation wall-clock gap | 10 min | Prevents re-raising in a long thread |
| Challenge cap | 6 | Bounded context cost |
| Initiative budget by mode | conversational 1, collaborative 2, executive 1, reflective 1, observational 0 | Mode changes how much she says |

The numbers are heuristics. Change them with evidence: run the harness before and after, and keep recall (`necessaryAsks`) intact.

---

## 5. Extending it

### Add a self-challenge

1. Add a kind to `SelfChallengeKind`.
2. In `interrogate()`, compute the input it needs and call `add(kind, question, correction, basis, severity)`.
3. If it should ever block a claim, make `severity ≥ 0.6`.
4. Add a test that the challenge appears **and** that it does not appear when its basis is absent.

Do not add a check whose input is always missing; it will either never fire or fire generically.

### Add an initiative source

1. Build an `InitiativeSeed` with `grounding` (at least one `Evidence`), a `strength`, and a stable `key`.
2. Add it in `TurnBridge.prepareTurn()` or `CognitiveEvaluation.tick()`.
3. Selection, relevance, tolerance and dedupe are handled by `selectInitiatives()`.
4. A seed without grounding is suppressed by construction; do not bypass that.

### Add a scope rule

1. Add the signal to `ScopeInput`.
2. Push a `ScopeReason` with a code, a human-readable detail and a signed delta.
3. Decide where it sits in the recommendation order. Expansion and investigation outrank simplification; priority outranks reduction when objectives compete.
4. Update `coverage`/`preserved` if the rule can change what is required.

### Add a learning metric

1. Add an event type to `DevelopmentEventType` and `EVENT_TYPES`.
2. Compute it as a **ratio of outcomes** in `summarizeDevelopment()`.
3. Give it a weight only if it reflects something that happened to the user.
4. Return `null` when it has no samples. Never treat “not measured” as zero.
5. If it can justify a capability gap, add the rule to `capabilityGaps()` with the counts as evidence.

Do not add counts of prompts, tokens, turns, words or cycles to the score. The suite's test 14 compares a later window with *more* events against an earlier one and only allows the score to rise if outcomes improved.

### Add a surface

1. Extend `Surface` in `types.ts`.
2. Pass `surface` to `AIService.chat()` from the new entry point.
3. `SurfaceContinuity`, `NeuralMapBridge` and the initiative budget need no change.

---

## 6. Honesty invariants (do not weaken)

1. **No evidence, no contribution.** `selectInitiatives` enforces this; keep it.
2. **No question without a concrete question.** The policy returns `defer` otherwise.
3. **A question is counted as asked only when the reply contains it.** `AIService` calls `noteQuestionAsked()` under that condition.
4. **A completion claim needs support.** `interrogate()` blocks an unsupported “done” at severity 0.9.
5. **Internal ≠ user-visible.** `NeuralMapBridge` records the distinction; never mark an internal challenge as user-visible because it was included in context.
6. **Scope reduction preserves must-haves.** `preserved` must be non-empty for `SIMPLIFY`/`MINIMIZE`.
7. **No psychological claims.** `posture` is lexical evidence; phrase it as an observation and let the next message override it.
8. **No generic closers.** Continuation lines are built only from named evidence.

---

## 7. Troubleshooting

**No scope note appeared.** Expected when `recommendation === "HOLD"` and nothing is incidental, when confidence < 0.45 before generation or < 0.55 after, or when the message is not a build/change request.

**No continuation was appended.** Check, in order: `plan.worthRaising`, `turnsSinceContinuation ≥ 3`, `now − lastContinuationAt > 10 min`, `!profile.wantsUninterruptedExecution`. The withheld reason is recorded as an internal `post-action-continuation` event.

**She keeps asking the same question.** Confirm the question was actually asked (reply contained it), that its outcome was closed (`recordAnswered`/`recordIgnored`), and that both sides use the same `impact` band (`historyFor`).

**A correction did not change the profile.** `TurnBridge` recomputes `collaboration.profile()` *after* `recordCorrection()`. If you add another behavioural recorder, recompute after it too.

**The evaluation tick reports `skipped`.** Reasons are explicit: user mid-turn, minimum gap, per-minute budget. `manual` bypasses the gap for a bounded call but not the per-minute ceiling.

**Neural Map shows the wrong layer.** `visibility` defaults to `"internal"`. Only mark `"user-visible"` where something was actually delivered (a continuation sentence, a clarification that appears in a reply).

---

## 8. What live validation would require

1. A provider credential on the server; then run a real conversation and capture the assembled context from `CognitiveTrace` (it records “conversational evaluation assembled”).
2. A reply sample where the injected self-challenge visibly changes the answer, and one where it is correctly ignored.
3. A continuation judged useful by the user rather than merely specific.
4. A correction followed by a changed profile and a measurably different next answer.
5. The 12-round harness re-run with a human answering instead of the simulated rules.

Until those exist, the claim is: **the decisions are implemented, measured and tested; the conversational effect is not yet verified against a live model.**
