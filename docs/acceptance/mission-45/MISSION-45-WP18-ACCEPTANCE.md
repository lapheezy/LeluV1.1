# Mission 45 · WP18 — Acceptance Report

| | |
|---|---|
| Branch | `integration/m16-3-wp05-reconciliation` |
| Base commit | `543da7c8` |
| Acceptance suite | `tests/conversational-cognition.test.ts` — **18/18 pass** |
| Regression suites around the integration points | 16 files, **254/254 pass** |
| Harness | `scripts/wp18-evaluate.ts` — exit 0 |
| Evidence | `artifacts/wp18/evaluation.json`, `artifacts/wp18/interactions.json` |
| Lint | `oxlint` on all WP18 files — 0 warnings, 0 errors. The only warning in the touched screen (`GenesisBrowserPanel.tsx:118`) is pre-existing on the base commit and untouched by this change. |

---

## 1. Acceptance matrix

Each criterion is demonstrated by a test that exercises the real module. Test numbers are the test names in the suite.

| # | Criterion | Demonstration | Evidence |
|---|---|---|---|
| 1 | Independently identifies an incomplete objective | `CognitiveEvaluation.tick()` reads `AgentObjectives`, not the conversation, and reports the live work with its state | Test 1: objective created in the store appears in `report.liveWork` as `active` |
| 2 | Questions an assumption in her own proposed solution | `interrogate()` raises the unverified assumption; `applyRevision()` rewrites the conclusion | Test 2: challenge names “bottleneck”; revised conclusion contains “Revision” and “unverified” |
| 3 | Recognises an unnecessarily complex implementation | `assessScope()` separates incidental from necessary complexity | Test 3: `SIMPLIFY`; a duplicate of the existing `memory` capability is named; ≥2 incidental elements |
| 4 | Proposes a simpler alternative without removing required functionality | The assessment returns a `preserved` list and zero uncovered must-haves | Test 4: `preserved === ["Memory must persist across a reload"]`; `coverage.uncovered` empty |
| 5 | Recognises when additional investigation is necessary | `investigationGaps` outranks a shaped plan | Test 5: `EXPAND`, reason `investigation-needed`, headline names investigation |
| 6 | Asks a relevant question when the answer materially affects execution | `decideQuestioning()` | Test 6: `ask`, exact question, `expectedImpact > interruptionCost`, reason `material-gap` |
| 7 | Refrains from unnecessary questioning when instructions are clear | Explicit no-question instruction + bounded request | Test 7: `proceed-silently`, no question, reason `user-said-no-questions` |
| 8 | Naturally continues a conversation after completing a task | `planContinuation()` and the live bridge | Test 8: specific line with the finding and next step, no generic closer. Test 18: bridge completes a turn. Harness appended: *“Migrate the audit log table to the new schema finished — the migration exposed two rows with null actor ids.”* |
| 9 | Identifies a future dependency | `extractDependencies()` + scope assessment | Test 9: billing service dependency detected; `EXPAND`; reason `unresolved-dependency`; dependency listed as necessary complexity |
| 10 | Adapts questioning based on previous user feedback | `QuestioningLedger` per-kind effectiveness | Test 10: after four ignored questions of the same materiality, the identical request no longer produces an ask. Harness: unnecessary asks 2 → 0 across windows |
| 11 | Challenges an incorrect assumption with supporting evidence | `interrogate()` with contradicting evidence | Test 11: `counter-evidence` challenge quotes the row-count failure; `conclusionHeld === false`; revision includes the evidence |
| 12 | Recognises when to prioritise, expand, simplify or minimise | Four scope assessments from distinct inputs | Test 12: `EXPAND`, `PRIORITIZE`, `SIMPLIFY`, `MINIMIZE` all produced |
| 13 | Maintains continuity between voice, chat and browser sessions | `SurfaceContinuity` + `surface` on the real chat call | Test 13: voice → chat briefing names the voice surface and topic; browser sees all three surfaces. Test 18: a voice turn after a chat turn carries the working thread. Harness captures the actual briefing |
| 14 | Demonstrates measurable improvement over repeated evaluations | `summarizeDevelopment()` + `compareDevelopment()` and the harness | Test 14: later window scores higher on question effectiveness, objective continuity and correction discipline. Harness: unnecessary questions 2 → 0, necessary questions 6 → 6, missed 0 → 0 |

Two additional guards protect the rules the mission states but does not number:

| Test | Rule |
|---|---|
| 15 | An ungrounded observation is suppressed, not turned into conversation. `selectInitiatives` rejects a seed with no evidence and returns no brief when nothing is grounded. |
| 16 | A reversal is offered as a question about which position holds, never asserted as the user being inconsistent. |
| 17 | Neural Map keeps internal reasoning out of the user-visible layer. |

---

## 2. Measured performance comparison

`scripts/wp18-evaluate.ts` runs six fixed requests for twelve rounds against the real policy and ledger. The simulated user ignores exactly the three low-materiality questions (when they are asked) and answers the two high-materiality ones. Windows are three rounds.

| Measure | Baseline (rounds 1–3) | Adapted (rounds 10–12) | Change |
|---|---|---|---|
| Unnecessary questions asked | 2 | **0** | −2 |
| Necessary questions asked | 6 | **6** | retained |
| Necessary questions missed | 0 | 0 | none introduced |
| Total questions | 8 | 6 | fewer, all material |

The reduction is not achieved by asking less overall: recall is unchanged. The mechanism is per-kind learning — ignored low-materiality questions raise the cost of that *kind* of question, while answered high-materiality ones keep their cost low.

Decision cost, measured over 2 000 asks of the policy across repeated harness runs:

| | |
|---|---|
| Mean | **0.006–0.008 ms** |
| p95 | **0.011–0.015 ms** |
| Total for 2 000 decisions | ~13–14 ms |

The continuous evaluation lifecycle makes **0 model calls** per tick by construction; its cost is store reads plus these deterministic decisions.

---

## 3. Real interaction record

Captured from `TurnBridge` against the real stores (`artifacts/wp18/interactions.json`), not written by hand:

1. **Chat, before generation.** A request for “a new memory engine with a plugin system” produced a scope note naming the existing `memory` capability as a parallel system. Pre-plan recommendation: `HOLD` — with one redundant element, not a false “expand”.
2. **Chat, after generation.** The produced six-step plan measured `SIMPLIFY`: five steps untraceable to the one stated requirement, plus the duplicate module. Preserved: *“Memory must persist across a reload”*. A continuation was appended from a completed objective, naming the work: *“Migrate the audit log table to the new schema finished — the migration exposed two rows with null actor ids.”*
3. **Voice, next turn.** The conversation moved surfaces. The briefing carried the thread: *“It was last active in chat 1s ago; this turn arrived in voice… Do not ask the user to repeat what is already here.”* The pending scope judgement was carried into the turn.
4. **Chat, correction.** *“No — that's not what I meant…”* Mode switched to `reflective`, the correction was recorded as collaboration evidence, and the returned profile contained it (the first run of the harness exposed that it was computed before the correction; fixed).
5. **Voice, referential ambiguity.** *“Rotate it ninety degrees…”* produced `ask` with *“Which item does ‘it’ refer to?”*, justified by the materiality of the missing referent, not by a fixed list of prompts.

Neural Map projection from the same run: **17 nodes / 17 edges** in V2; V3 separated **7 internal** events from **1 user-visible** event, and the separation check passed.

---

## 4. Verification actually run

```
npx tsx --tsconfig tsconfig.test.json --import ./tests/support/ignore-css.mjs \
  --test tests/conversational-cognition.test.ts
  → 18 pass / 0 fail

npx tsx --tsconfig tsconfig.test.json --import ./tests/support/ignore-css.mjs \
  --test tests/cognitive-behavior.test.ts tests/continuous-cognition.test.ts \
         tests/cognition-chat-integration.test.ts tests/conversation-memory.test.ts \
         tests/chat-surface.test.ts tests/agent-cognition.test.ts
  → 101 pass / 0 fail

npx tsx --tsconfig tsconfig.test.json --import ./tests/support/ignore-css.mjs \
  --test tests/autonomy-bridge.test.ts tests/autonomy-diagnostics.test.ts \
         tests/initiation.test.ts tests/identity-question.test.ts tests/briefings.test.ts \
         tests/companion-mode.test.ts tests/development-loop.test.ts \
         tests/executive-board-status.test.ts tests/goal-contract.test.ts \
         tests/completion-verification.test.ts
  → 153 pass / 0 fail

npx oxlint src/core/conversation src/core/AIService.ts \
  src/core/cognition/CognitiveLoop.ts src/core/voice/VoiceEngine.ts \
  scripts/wp18-evaluate.ts tests/conversational-cognition.test.ts
  → 0 warnings, 0 errors (18 files)

# GenesisBrowserPanel.tsx carries one pre-existing react(set-state-in-effect)
# warning at line 118; the WP18 diff in that file is line 256 only.

npx tsx scripts/wp18-evaluate.ts
  → exit 0, artifacts written

npx tsc -b --force
  → 2 errors, both pre-existing in src/core/perception/FeatureUnderstanding.ts:455
    (untouched by this work; every WP18 file compiles clean)
```

### Dependency note

`npm ci` refuses this repository: `package-lock.json` is missing the livekit/mediabunny dependency graph that `package.json` declares (for example `livekit-client@2.24.0`, `livekit-server-sdk@2.19.3`, `@livekit/protocol@1.53.0`). Dependencies were installed with `npm install --no-package-lock` so the existing lockfile was not rewritten. **The lockfile is stale and should be regenerated deliberately in a dedicated change**, not folded into this mission.

---

## 5. Files

### Added

| File | Lines | Purpose |
|---|---|---|
| `src/core/conversation/types.ts` | 47 | Shared vocabulary |
| `src/core/conversation/text.ts` | 164 | Deterministic text primitives |
| `src/core/conversation/CollaborationModel.ts` | 458 | Adaptive collaboration model |
| `src/core/conversation/QuestioningPolicy.ts` | 628 | Questioning decision + learning ledger |
| `src/core/conversation/ScopeIntelligence.ts` | 403 | Scope and complexity judgement |
| `src/core/conversation/SelfInterrogation.ts` | 401 | Self-challenges + revision |
| `src/core/conversation/ContinuationPlanner.ts` | 195 | Post-action continuity |
| `src/core/conversation/ConversationalInitiative.ts` | 201 | Grounded initiative selection |
| `src/core/conversation/LearningLedger.ts` | 513 | Outcome-ratio development metrics |
| `src/core/conversation/NeuralMapBridge.ts` | 362 | Neural Map event record + projections |
| `src/core/conversation/SurfaceContinuity.ts` | 218 | Cross-surface thread |
| `src/core/conversation/CognitiveEvaluation.ts` | 598 | Continuous evaluation lifecycle |
| `src/core/conversation/TurnBridge.ts` | 892 | Chat-turn integration |
| `tests/conversational-cognition.test.ts` | 697 | Acceptance suite |
| `scripts/wp18-evaluate.ts` | 555 | Interaction + performance harness |

### Modified

| File | Change |
|---|---|
| `src/core/AIService.ts` | `surface` option; prepare before generation; completion before emitting; question counted only when present; reply text and memory use the composed reply |
| `src/core/cognition/CognitiveLoop.ts` | Scheduled WP18 evaluation on the existing heartbeat |
| `src/core/voice/VoiceEngine.ts` | Passes `surface: "voice"` |
| `src/app/scene/genesis/GenesisBrowserPanel.tsx` | Passes `surface: "browser"` |

### Generated evidence

| File | Contents |
|---|---|
| `artifacts/wp18/evaluation.json` | Rounds, windows, improvement, latency, verdict |
| `artifacts/wp18/interactions.json` | Five-turn interaction record, direct demonstrations, Neural Map counts |

---

## 6. What is not verified

* **No live-model conversation.** No provider credential exists in this environment. The notes injected into the model context were assembled and captured, but how a specific model uses them was not observed. Every *decision* in WP18 is deterministic; the *wording* of a reply is not.
* **No browser or voice run.** No UI panel was opened, no microphone used, no TTS produced. `surface` routing was verified at the call site and through `SurfaceContinuity`.
* **No human evaluation.** The 12-round comparison is a simulated user with explicit rules, not a preference study.
* **Thresholds are declared heuristics**, not learned weights. They are inspectable and each decision lists its reasons.
* **No Neural Map V2/V3 view exists to render.** The contract, record and projections are implemented and tested; the views are not present in this checkout.
