# LÉLU Development Pass — Report

Branch `claude/open-session-rbwmdw`, on top of Curiosity Engine v1 (`93c407a`). This pass connects the existing pieces into one loop:

```
experience → observation → curiosity → retrieve / investigate / ask → evidence → verify
→ learn → remember → apply → outcome → DailyRecord → DailyReflection → PersonalityGuard
→ LeluIdentity → (tendency) → next curiosity
```

No new AIService, runtime, memory, tool catalog, chat, personality or curiosity system was created.

---

## 1 · Existing architecture discovered (audit A–F)

| Question | Finding |
|---|---|
| **A. Why DailyReflection was not called** | Personality v1 created `reflectOnDay` / `applyReflection` but nothing imported them — no lifecycle point was ever wired. |
| **B. Where curiosity entered the daily record** | `CuriosityEngine.journal` → `DailyRecord.appendToday` (free-text lines). Curiosity *also* wrote trait evidence straight into `LeluIdentity`, so wiring reflection as-is would have counted the same work twice. |
| **C. Where capability metadata lives** | `ToolRegistry` (id, category, description, availability, risk, permissions, route); `ToolDispatcher.executableToolIds / executorParameters` (what is really callable, and its inputs); `SelfModel` (capabilities / limitations / discoveries); `CapabilityManifest` and `selfdev/CapabilityRegistry` are separate provider-level catalogs, not used for tools. |
| **D. How permission checks run** | `toolPermitted()` (registry availability → `AutonomyGate.can(risk)` → `EngineeringAuthorization` for apply/commit), re-checked inside `dispatchToolCall`. |
| **E. Objectives / proposals** | `WorkQueue` REVIEW items (CognitiveLoop turns them into a question to Heru); `AgentObjectives` revive on an answer via `ProactiveCore.resolveQuestion`. |
| **F. How the question card is triggered** | `ProactiveCore.enqueueQuestion` → `getActiveQuestion` → `subscribeQuestions` (GenesisChat card, ProactiveBridge). |

Defects found and fixed while auditing:

- **Text from documents would have become personality.** `PersonalityMemoryProvider.persist` (called only by document ingestion and memory migration) copied sentences such as *"I noticed…"* from ingested text into the day's `observations` / `lessons`. Once reflection runs, those would have become trait evidence. Such lines are now labelled `Read in memory intake:` and are never evidence.
- `applyReflection` in Sandbox Mode staged new questions as `"preference"` changes — approving one would have stored a question as one of LÉLU's preferences. Questions are now added directly (they are not identity changes).
- `applyReflection` snapshots recorded confidence/status *after* the change, so every "before → after" was identical. It now captures the before-state.
- Found by the acceptance run: for "Why does X keep failing?" memory accepted *any* memory naming X — e.g. a list of related tools — as the answer. A diagnosis is now answered only by a recorded diagnosis of that tool.

## 2 · Changes made

| File | Change |
|---|---|
| `src/core/identity/DailyRecord.ts` | Structured `developmentalEvidence` (one per trait × line of inquiry, deduplicated), `reflection` outcome per day, `recordEvidence`, `awaitingReflection`, `markReflected`, provenance prefixes (`ACCOUNTED_PREFIXES`, `INTAKE_PREFIX`). Older records still load. |
| `src/core/identity/DailyReflection.ts` | Reads structured evidence (≤ 3 votes per trait per day) + keyword patterns over text that is neither intake nor already counted; `meaningful` flag and *"No meaningful development detected."*; the two `applyReflection` fixes; **`runDueReflections(now)`** — the lifecycle entry point. Still pure: no model, no AIService. |
| `src/core/identity/DevelopmentSummary.ts` (new, pure) | Answers *what did I learn / pursue / fail at / discover / change my mind about / get better at / leave unresolved* from the record's lines only. |
| `src/core/identity/PersonalityMemoryProvider.ts` | Intake labelling; adds the day's development summary to context **only** when Heru asks about her development. |
| `src/core/curiosity/Curiosity.ts` | Failure kinds; `input` cause; revalidation policy/trigger/fingerprint; `VERIFY_PROBES`; `discoverAlternatives`; `capabilityStates`; `tendencyBoost`; `deriveFollowUps`; preferred-capability goals; learning metadata (`verifiedAt`, `revalidation`, `dependency`, `supersededAt`). |
| `src/core/curiosity/CuriosityLedger.ts` | Learned strategies; `revisiting` status. |
| `src/core/curiosity/CuriosityPorts.ts` | Evidence → DailyRecord (not identity); `refreshCapabilities` (forced SourceAccess probe + `ToolRegistry.refreshAvailability`); `toolParameters`; `onToolSuccess`; `traitTendencies`; `syncSelfModel` (existing `SelfModel`). |
| `src/core/curiosity/CuriosityEngine.ts` | Re-evaluation and recovery, capability discovery in pursuit, strategies, failure-kind behaviour, tendency ranking, capability states, self-model sync, richer sandbox explanation. |
| `src/core/cognition/CognitiveLoop.ts` | Calls `runDueReflections()` after the curiosity tick. |
| `src/app/scene/genesis/GenesisIdentityPanel.tsx` | Identity: *What I can and cannot use*, strategies. Journal: per-day development summary. Growth: evidence awaiting reflection, last reflection. Questions: + *Revisiting*, *Resolved*. History: re-evaluations. Sandbox trace: route, verification, personality impact, re-evaluations. |
| `scripts/support/node-browser-shims.ts` (new) | Shared storage shims for the Node acceptance scripts. |
| `scripts/verify-development.ts` (new) | Real-path acceptance A–E + demonstration. |
| `scripts/verify-curiosity.ts` | Uses the shared shims; personality checks follow the new route (evidence at DailyRecord, identity unchanged until reflection). |
| `tests/development-loop.test.ts` (new) | 31 tests. |
| `tests/curiosity-engine.test.ts` | One assertion updated: the Questions group *"Recently learned"* is now *"Resolved"* (spec §33), and *"Revisiting"* was added. No other existing test changed. |

## 3 · DailyReflection — where and why

`CognitiveLoop.runOnce` → `runDueReflections()`, after the curiosity tick. CognitiveLoop is the existing background cycle; no timer was added. Each **completed** day (date < today) with no `reflection` is reflected **exactly once**: at most three days per call, from the last week. The first cycle after midnight does the work; every other cycle is a cheap date check.

**Flow:**

```
DailyRecord → reflectOnDay (pure) → candidate trait evidence → applyReflection
  → LeluIdentity.addTraitObservation → PersonalityGuard.record on status change
  → snapshot (real before/after) → DailyRecord.markReflected
```

Sandbox Mode stages trait changes instead of applying them. An empty day is recorded as *"No meaningful development detected."* and changes nothing.

## 4 · Curiosity re-evaluation

**Metadata.** Every learning now carries `verifiedAt`, a `revalidation` policy and a `dependency`. The dependency is the tool plus a fingerprint of its state: `available | permitted | executable | executionRoute`.

**Policies:**

| Policy | Applies to | When it is re-checked |
|---|---|---|
| `stable` | What Heru meant, preferences, goals, decisions | Never needlessly; only if the same question comes up again. |
| `on-change` | Tool and capability findings | When the state they depend on changes. |
| `periodic` | Context-dependent tools (24 h), world facts (7 d), tool-derived technical facts (24 h) | After the interval. |

**Triggers.** `revalidationTrigger` fires on:
- an environment change (a new fingerprint; once per fingerprint);
- a later success of the tool in a conversation (new evidence);
- a newer question needing a suppressed tool (relevant again);
- meeting the same question again;
- the interval passing (time-sensitive).

Except for a new environment fingerprint, nothing is re-checked more than once an hour.

**Scheduling.** A re-check competes with ordinary pursuit for the **one** action per cycle. Urgent ones (environment change, new evidence) rank at tier 2.

**Self-correction.** A finding that turns out wrong is marked `supersededAt`, kept in `supersededLearnings`, and replaced by a newly verified, stored learning.

## 5 · Recovery

A learned-unavailable tool becomes a constraint, and the tool is suppressed from selection. While any constraint is in force, the engine re-probes the environment at most once per interval: a forced `SourceAccess.status` followed by `ToolRegistry.refreshAvailability`.

**A changed fingerprint leads to one bounded verification:**
- If a harmless read-only probe exists for the tool (e.g. `project.git {action:"status"}`, `system.config`, `sandbox.read`), it is called once under the step deadline.
- Otherwise the registry state, recomputed from a live probe, decides. This applies only to availability or permission causes.

**Outcome:**
- **Recovered:** the finding is superseded, the constraint lifted, the tool eligible again, and the new state stored in memory.
- **Still failing:** the finding is confirmed and re-dated, and is not re-checked until the next trigger. No retry storm.

**Permission failures are never bypassed.** They become an *"Approve X?"* REVIEW proposal and never prompt a search for alternatives. They recover only when the dispatcher actually permits the tool.

## 6 · Capability discovery

`discoverAlternatives` searches the **existing registry** only.

**When a candidate qualifies.** It must plausibly provide the same information: the same category plus a shared distinctive term, or two shared distinctive terms. Generic words like "read" or "file" don't count. It must also:
- be executable, available and permitted by the dispatcher;
- be read-only for curiosity;
- not be known to fail here;
- be callable with the inputs in hand (inputs are carried by name, e.g. `path`).

**Ranking:** a learned strategy first, then relatedness, lower risk, and observed reliability. Every rejection is recorded with its reason.

**When it is used:**
- inside a pursuit, when a preferred tool is unavailable, suppressed or fails for availability reasons;
- as a follow-up ("What else can provide what X provides?") after an availability diagnosis, opened only when something plausibly could stand in.

A verified alternative becomes a **learned strategy**. It is stored in the ledger, in memory and in the `SelfModel`, and is chosen first next time.

## 7 · Learning

Verified evidence → classified learning → `AIService.consolidate` (Brain) → an immediate `memory.recall` through the dispatcher must return it, or it is not "learned". Strategies and recoveries are stored the same way. Curiosity records point at memory; there is no second store.

## 8 · Personality

- **Curiosity** records one evidence unit per line of inquiry into `DailyRecord.developmentalEvidence`. It is keyed by chain root, and follow-ups add none. Sandbox Mode or an established trait stages it for approval instead.
- **DailyReflection** turns units into evidence: one vote each, at most 3 per trait per day. It adds no narrative double vote, and never counts intake text.
- **PersonalityGuard** records every status change. LeluIdentity's own thresholds still require ≥ 3 independent evidence items before a trait leaves *candidate*.
- **Feedback into curiosity.** Emerging or established traits reorder curiosities *within a tier* (multiplier ≤ 1.5, recorded in the trail). For example, pattern-recognition favours recurring-failure and self questions, and synthesis favours follow-ups. These are tendencies, not templates. No trait labels are hard-coded as facts about LÉLU or Heru.

## 9 · Self-model

`CuriosityEngine.capabilityStates()` distinguishes **available**, **unavailable**, **unknown**, **permission_required**, **temporarily_failed** and **revalidation_needed**. Each state carries its basis: registry, learned, verified use, observed failure, or no executor.

For example:
- `selfdev.analyze` is *unknown*: it is catalogued but not callable as a tool.
- `research.web` is *unavailable outside a live conversation*: learned, and re-checked every 24 h.

Learned limitations and strategies sync into the existing `SelfModel` (lines prefixed `Tool `, replaced on each sync). Everything comes from verified state.

## 10 · Tool permissions

| Category | What it covers |
|---|---|
| **Automatic** (curiosity policy **and** the dispatcher must both allow it) | Memory lookup; read-only tools; diagnostics (`workspace.test` / `typecheck`, `project.validate`); read-only research where the environment permits; capability inspection; read-only verification probes; storing verified learning; daily reflection; recording evidence; proposing to REVIEW. |
| **Needs Heru's approval** | Writes; other execution (e.g. `workflow.run`); project modification; staged personality changes in Sandbox Mode or for established traits; anything a REVIEW proposal names. |
| **Never** | Bypassing a permission refusal; `project.apply` / `project.commit`; changing security, autonomy limits, PersonalityGuard or core values. |

## 11 · Autonomy — what bounded behaviour now works

LÉLU now:
- notices recurring failures and her own failure patterns;
- diagnoses them through memory and the registry;
- learns constraints and, when a preferred capability can't be used, finds and verifies an existing alternative, then remembers that strategy;
- notices when the environment changes, re-checks once, and corrects herself;
- reflects on each finished day, with the resulting tendencies influencing what she pursues next.

Bounds that still hold:
- one action per CognitiveLoop cycle, never during Heru's turn;
- 4 tool steps, a 30 s overall budget and an 8 s per-step budget;
- chain depth 2;
- re-checks once per new state, otherwise at most hourly;
- no writes, no commits, no permission bypass.

## 12 · Tests

- `tests/development-loop.test.ts`: **31/31**.
- Curiosity, development and personality suites together: **98/98**.
- `npm test`: **866/866 passing, 0 failing** (baseline before this pass: 835/835; +31).

## 13 · TypeScript

The real compiler, `npx tsc -b --force` (the repo's `typecheck`), exits **0**. Root `npx tsc --noEmit` checks zero files and is not evidence.

## 14 · Build

`npm run build` (`tsc -b && vite build`): **exit 0**, built in 6.3 s.

## 15 · Results

| Check | Result |
|---|---|
| `npx tsc -b --force` | exit 0 |
| `npm test` | **866/866**, exit 0 |
| `npm run build` | exit 0 |
| `npx tsx scripts/verify-development.ts` | **47/47** |
| `npx tsx scripts/verify-curiosity.ts` | **34/34** |

## 16 · Acceptance (real path)

Real systems throughout; only browser storage is shimmed. In scenario B the engineering runtime is **actually started** part-way through.

| Scenario | What ran | Result |
|---|---|---|
| **A — Daily development** | Real DailyRecord → `runDueReflections` at the next day's boundary → pattern-recognition **candidate 0.35 → emerging 0.53** (3 independent lines of inquiry) → PersonalityGuard recorded it → never reflected twice → the new tendency put the recurring-pattern question ahead of an equal one | ✓ |
| **B — Tool recovery** | `project.git` refused in two turns → diagnosed → suppressed → no re-check while nothing changed → **real engineering runtime started** → environment-changed re-evaluation → one real `git status` succeeded → old finding superseded and kept → eligible again → recovered state in memory → no further checks | ✓ |
| **C — Alternative capability** | Goal preferring `project.read` (unavailable) → `project.read` excluded as known-unusable → discovery → `sandbox.read` (curiosity policy + dispatcher allowed) → returned the real file → verified → remembered; the earlier strategy was the stated reason | ✓ |
| **D — Host question** | Ambiguity in real chat → memory couldn't resolve it → question on the existing card → answered in normal chat → classified, stored → a later recall returns it | ✓ |
| **E — Self-development** | Two background research attempts failed (no conversation context) → *"Why do my own investigations keep failing when I use research.web?"* → her own records + registry → self-knowledge → web research represented as a capability boundary → evidence unit → reflection (A) | ✓ |

## 17 · Demonstration — one cycle across systems (from the real run)

```
turn-d1/d2  project.read → "project.read" is not available in this runtime, so it was not run.
NOTICE      Why does project.read keep failing?            (execution → technical)
QUESTION    the cause behind two failures in two turns
INVESTIGATE memory.recall first, then internal:tool-registry → available=false
VERIFY      observations + registry agree (verified)
LEARN       "project.read fails because it is not available in this runtime" — consolidated, recalled
DISCOVER    follow-up: What else can provide what project.read provides?
            compared 16 existing capabilities; chose sandbox.read — same Engineering capability,
            shares "sandbox", READ, risk 0; every rejection recorded with its reason
TEST        sandbox.read → ok
APPLY       learned strategy: when project.read cannot be used, sandbox.read stands in
            (ledger + memory + SelfModel); later goal C chose it for that reason
OUTCOME     DailyRecord: lesson, strategy, one evidence unit (pattern-recognition) for the chain;
            the follow-up added none ("This chain already contributed its one evidence item")
REFLECT     day boundary → DailyReflection → 3 pattern-recognition units that day
PERSONALITY LeluIdentity.addTraitObservation ×3 → candidate 0.35 → emerging 0.53
            → PersonalityGuard recorded "trait:pattern-recognition"
NEW         the emerging tendency ranks a recurring-pattern question ahead of an equal one
```

## 18 · Remaining limitations

1. **No web research outside a live conversation.** This is represented and re-checked daily, not faked. There is still no independent source for world facts in the background.
2. **No model-assisted curiosity** (spec §30). Detection, relatedness, verification and reflection are deterministic rules. Relatedness depends on registry categories and descriptions, so a poorly described tool won't be found as an alternative.
3. **"Relevant code changes" are detected only through the registry fingerprint** (availability, permission, executor, route), not by watching source diffs.
4. **Alternatives are tested for availability and response, not deep semantic equivalence.** `sandbox.read` answering proves it works and can read files; it does not prove it covers everything `project.read` does.
5. **Keyword reflection is coarse.** Structured evidence is the reliable path, and at present only curiosity produces it.
6. **The ledger, strategies and daily record live in KvStore** (this device only). Learnings themselves sync through the Brain.
7. **The new Identity, Journal, Growth, Questions and History views** were exercised in Chromium against the dev server with real activity (no page errors). This was not a full day of live use, and in the live app `project.read` is available — the engineering runtime is same-origin there — so no strategy was needed. Catalogued tools without an executor are summarised as one "unknown" count rather than listed individually.
8. **Development is only as rich as real activity.** A quiet day stays quiet.
