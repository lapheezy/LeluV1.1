# Improvement 1 — "A study must conclude": Gate 2 evidence

Status: **IMPLEMENTED ON BRANCH, AWAITING YOUR ACCEPTANCE.** It is not deployed to production. The next improvement will not start until you accept or return this one.

Approved at Gate 1: "Both do A". That covers (1) "A study must conclude" and (2), as a separate item, making personality changes staged for your review by default.

---

## What changed

### 1. A study must conclude (`SelfStudyEngine` plus the stores it already used)

| Before | After |
|---|---|
| An objective was "answered" as soon as a tool returned any lines | An objective is answered only when it has a **Conclusion**; if the evidence settled nothing, it stays open |
| Objectives had no purpose | Every objective records its **purpose**: the gap, why it matters, what evidence would settle it, and the possible improvement |
| Every cycle with evidence made a model call ("ANSWER / CONFIDENCE / NEXT") | Each cycle concludes from the evidence alone; a model is called **only to conclude** judgement-worthy studies, at most **12 per hour**, and the call is labelled `self-study` in the usage ledger |
| Model output never said whether anything should change | A Conclusion records what was learned, the evidence, how it applies to her, a **verdict** (`change`, `no-change` or `insufficient`), and, for a change: benefit, risks and how to verify it |
| — | A proposed change must name something the evidence actually touched; otherwise it is downgraded and the reason recorded |
| Study never reached the improvement queue | A `change` conclusion becomes **one** `Proposed` item in the existing `ImprovementQueue`, linked back to its study (`origin: self-study`). It appears in the existing Self-Development panel for your approval. |
| — | **Only one self-study proposal waits for your decision at a time.** Later ones are held, then promoted in order once you decide: failures first, then priority, then age. A rejected proposal is not raised again until its evidence changes. |
| arXiv/news titles became study subjects | Leads are adopted only if they name a real source path, subsystem, capability or internal identifier |
| A failing read was retried 3× and then escalated | Identical evidence on a retry closes the objective as unresolved (≤2 attempts) |
| One new knowledge entry per question | One entry per **subject**, updated in place, with a category: architecture, technical, cognitive, personality or operational |
| Chat context showed questions and cycle counts | Chat context also shows **CONCLUSIONS FROM SELF-STUDY** and **PROPOSAL AWAITING THE OWNER'S DECISION** |

### 2. Personality changes are staged by default (`LeluIdentity`)

`sandboxMode` now defaults to **on**. Daily reflection stages trait changes in the Identity panel instead of applying them. Identities stored under the old default are read as staged, because that `false` was never anyone's choice. If you switch it off in the Identity panel, that explicit choice is recorded and respected.

## Before / after (same 40-cycle harness)

The baseline was recorded before the change. The after run uses the identical probe, seed state and stubbed model.

| Metric | Before | After | Target |
|---|---|---|---|
| Model calls / 40 cycles | **40** | **12** (the hourly cap) | ≤ 12 ✔ |
| Off-topic subjects (paper titles) | 5 | **0** | 0 ✔ |
| Most attempts on one failing file read | 3 + escalation | **2** | ≤ 2 ✔ |
| New knowledge entries | 21 | 16 | converging ✔ |
| Knowledge entries carrying a verdict | 0 | 22 | all conclusions ✔ |
| Objectives left open at the end | 6 | 1 | — |
| **Improvement proposals from study** | 0 | **0** | ≥ 1 ✘ **not met in this harness** |

**Why the harness produced no proposal, stated plainly.** In Node there is no build snapshot, so source reads fail. Self-diagnostics and self-tests also report nothing failing. With no model reachable (see the live run below), every conclusion was correctly `no-change` or `insufficient`. The proposal path itself is proven by `tests/self-study-conclusions.test.ts`, which goes from a conclusion to exactly one `Proposed` item, holds a second, and promotes it after your decision. I did not fabricate a "change" to make the number move.

### Live run with this environment's real provider keys (`evidence/after-live-40-cycles.json`)

40 cycles, with the 12-call cap as the only limit on spend:

- **Every provider refused.** Groq: 429, daily token limit reached. OpenRouter: 429, free-models-per-day exhausted. Cerebras: 401, key rejected.
- All 12 attempts are on the usage ledger with `operation: "self-study"`, so they can be told apart from chat.
- Self-study **kept working**: 34 conclusions (28 no-change, 6 insufficient), all deterministic, with no further model attempts after the cap.

Before this change, the same situation meant 40 calls hitting already-exhausted quotas in 40 cycles, competing with conversation for the same keys.

## Tests

- New: `tests/self-study-conclusions.test.ts`, 12/12 passing. It covers: no answer without a conclusion; purpose on every objective; paper titles rejected; regex and user-facing "not implemented" text not treated as unfinished work; grounding of model changes; fingerprint stability; exactly one `Proposed` (never `Approved`) item; a second held and promoted after rejection; conclusions with no provider; model only at conclusion, labelled `self-study`, within the cap; label reaching the usage ledger; retry with the same evidence closes; knowledge converging by subject; personality staged by default with the owner's choice kept.
- `self-study-loop` 20/20, `usage-budget` 26/26, `personality-development` 24/24.
- `curiosity-engine` 43/43 and `development-loop` 44/44. Their personality tests exercise the **apply-directly** path, so their setup now records the owner's explicit opt-out (`setSandboxMode(false)`). Without it, 3 tests failed against the new staged default, which is the intended behaviour change.
- Typecheck (`tsc -b --force`): clean. Lint: no warnings in changed files. `vite build`: succeeds.
- Full suite (`npm test`): **2305 tests, 2299 pass, 0 fail, 6 skipped** (the skips were already in the suite). The run started before the final marker/grounding refinement in `StudyConclusion.ts`; `self-study-conclusions.test.ts` was rerun afterwards and passes 12/12.

## Known limitations and possible regressions

- Real proposals in production depend on a **reachable provider** for judgement studies, or on evidence of failing self-tests, diagnostics errors or `TODO`/`FIXME` comments. With today's exhausted keys, expect conclusions but few or no proposals until quota returns. That is improvement 2 (background budget and local-first) on the roadmap.
- The "Why can I not answer X with my tools?" escalation is now concluded by the capability registry as `no-change`. That is honest, but weak; it should become a capability gap proposal in a later iteration.
- Chat-context size grows by up to six conclusion lines.
- No UI was changed. Proposals appear in the existing Self-Development panel; a dedicated development record is roadmap item 4.

## How to try it

1. Deploy this branch, open LÉLU, and let her run (each cycle takes 45 s while the tab is visible).
2. Ask: *"What have you concluded from your self-study, and what would you change?"* She now answers from the CONCLUSIONS section of her context. If a proposal exists, she names it and says it is waiting in the Self-Development panel.
3. Open the Self-Development panel. A proposal titled `Self-study: …` shows the study that produced it in its observation.
4. Open the Identity panel. Sandbox Mode shows **ON — changes staged**.

## Rollback

All stored fields are optional and backward compatible. Reverting the commit restores the previous behaviour. Your previous sandbox setting cannot be restored automatically, because it was never chosen; toggle it in the Identity panel if you want direct application.
