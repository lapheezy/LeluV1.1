# LÉLU 2.2 — MEMORY SOVEREIGNTY, CONVERSATIONAL CONTINUITY & RECALL INTEGRITY

Branch: `freebuff/4fe6237b54885c7ced31f590`
Base: `aa8b1bd`
Date: 2026-11-19

---

## 1. Executive summary

The defect from 2.1 was real and reproducible in the canonical pipeline, and it had **six** contributing
causes, not one. The root cause is that LÉLU's memories carried no statement of **where** they came from,
so the store could not tell "relevant to this question" apart from "authorized for this conversation".
Retrieval was doing exactly what it was designed to do; the design had no notion of ownership.

2.2 adds **provenance and authorization to the existing memory pipeline** — not a second store:

- every new memory records its owner, originating conversation, runtime session, time, scope, source type
  and confidence;
- retrieval filters ineligible memories **before ranking** and then decides RETRIEVE /
  RETRIEVE_WITH_CONTEXT / DEFER / REJECT deterministically;
- historical and inferred material reaches the model **with its origin attached**, and the model is told
  how to speak about it;
- the cognitive knowledge graph, which the live run proved was a second, independent leak path, is now
  conversation-scoped;
- corrections now win over a restatement, and chronology is preserved.

Historical recall still works. Personality 2.1 is untouched and regression-tested. The boundary costs
≈0.01 ms per recall.

**Verification levels, stated plainly**

| Level | Status |
|---|---|
| Implemented | yes |
| Unit/integration tested | 28/28 new tests, 2,326/2,336 full suite |
| Live model validated (canonical pipeline) | 8/8 turns, 4/4 scenarios |
| Provider parity | 2/2 (Groq + OpenRouter) |
| Browser validated (GenesisChat) | isolation, return, restore — **historical recall turn in the UI not re-verified after reload** (see §12) |
| Device/mobile | not tested |

---

## 2. Root cause

`ResponsePattern` had no origin. `MemoryEngine.learn()` persisted records with
`context: { source: "memory-engine", memoryCategory, consolidated }`; `PatternMemory.search()` ranked
every record in the store against the current prompt by lexical overlap, confidence, importance and
recency. Nothing anywhere said *which conversation* the fact came from.

That collapsed three separate questions into one:

```
Is this relevant?  →  Is this authorized?  →  Is this about now?
```

The loss from conversation A scored as relevant to "Can you fix it?" because the two shared the word
"fix", so it was treated as current context. The fix is to make those three questions separate and make
the answers auditable.

Full analysis: `MISSION-22/MEMORY-ARCHITECTURE-AUDIT.md`.

---

## 3. Architecture before and after

**Before**

```
AIService.chat
  → MemoryBridge.enrich(request)
      → Brain.recall(prompt)                      no scope; every record a candidate
      → synthesizeContext(...)                    no origin labels
      → buildContext(...)                         prints global cognitive nodes
      → gather(prompt, bands 4/6/7)               no scope forwarded
  → runtime.process
  → post: MemoryBridge.learn(prompt, reply)       no origin written
          Brain.learn → CognitionRuntime.observe  global node, no conversation
```

**After**

```
AIService.chat
  → MemoryBridge.enrich(request)
      → scope = {userId, conversationId, sessionId, prompt}
      → Brain.recall(prompt, "cognition", scope)
          → MemoryEngine.recall → PatternMemory.search(prompt, scope)
              → isEligible(): ownership, session, provenance integrity   [BEFORE ranking]
      → authorize(recalled, scope)                RETRIEVE / WITH_CONTEXT / DEFER / REJECT
      → synthesizeContext(allowed, conversationId) labels [earlier conversation]/[inferred]
      → buildContext(cognitiveState(conversationId), ...) provenance note top+bottom
      → gather(prompt, {scope})                   forwarded to every provider
  → runtime.process (only authorized memories returned to the router)
  → post: MemoryBridge.learn(prompt, reply, taskId, conversationId)
          → MemoryEngine.create writes context.origin
          → CognitionRuntime.observe(text, conversationId)
```

The map, with every stage's scope before/after: `MISSION-22/memory-flow-map.json`.

---

## 4. Files created and modified

**New**

| File | Purpose |
|---|---|
| `src/core/memory/MemorySovereignty.ts` | provenance model, session id, eligibility, retrieval decisions, provenance labels and instruction |
| `tests/memory-sovereignty.test.ts` | 28 acceptance tests, Groups A–G |
| `scripts/memory-live.ts` | live validation through `AIService.chat` + provider parity |
| `scripts/memory-bench.ts` | deterministic performance measurement |
| `MISSION-22/*` | audit, flow map, findings, provenance spec, policy, live/performance/browser results, acceptance |

**Modified**

| File | Change |
|---|---|
| `src/brain/PatternMemory.ts` | eligibility filter applied inside `search`, before ranking |
| `src/brain/MemoryEngine.ts` | writes `context.origin`; correction now precedes the high-overlap reinforce branch; provenance `updatedAt` advances without moving the origin; recall accepts scope |
| `src/brain/Brain.ts` | recall/learn accept scope and provenance; cognitive observation carries the conversation; `cognitiveState(conversationId)` |
| `src/brain/MemorySynthesizer.ts` | provenance labels per memory; possessive-aware tokenisation |
| `src/brain/CognitionRuntime.ts` | `observe(text, conversationId?)` |
| `src/core/cognition/CognitiveCore.ts` | nodes carry `conversationId`; `state(conversationId)` filters |
| `src/core/MemoryBridge.ts` | scope construction, authorization, provenance write, provenance note, thread-context fallback fix, no unlabelled band-4 re-injection |
| `src/core/AIService.ts` | conversation id reaches learning; post-write profile sync scoped; unknown conversation id no longer falls back to the shared window |
| `src/core/memory/MemoryProvider.ts` | `GatherOptions.scope`; provider `context()` receives scope |
| `src/core/memory/providers.ts` | local provider forwards scope to recall |
| `src/core/memory/MemoryMigration.ts` | imported memories marked `external-tool` |
| `src/core/agents/AgentRunner.ts` | agent conclusions marked `derived` / `agent-reported` |

Nothing from the 2.0/2.1 voice layer was reverted or rewritten; those files remain as they were.

---

## 5. Memory boundary implementation

Three boundaries, each in code:

1. **Eligibility (hard).** `PatternMemory.search(prompt, scope)` drops a record when
   - the provenance id does not match the record id (tamper),
   - the recorded owner is not the current user,
   - it is session-scoped and the session id differs, or the session was never recorded.

   A dropped memory is not a candidate: it cannot influence ranking, the working set, or any consumer
   that receives the recall result.

2. **Authorization (policy).** `authorize()` decides, in this fixed order: ownership → session →
   provenance integrity → scope → relevance → confidence.

3. **Rendering (delivery).** `originLabel()` prefixes historical and inferred lines; `memoryContextNote()`
   is added at the top **and** bottom of the context when — and only when — such material is present.

The scopes demanded by the mission are all represented: `current-conversation`, `historical-conversation`,
`persistent-user`, `session`, `derived`. A conversation never inherits another's transcript or emotional
context through memory: the memory layer refuses it, and the cognitive graph no longer carries it either.

---

## 6. Retrieval authorization behaviour

Policy: `MISSION-22/retrieval-policy.json` (generated from, and asserted equal to, the code constants).

- **RETRIEVE** — owned, relevant, and current (same conversation), or a session memory belonging to this
  session.
- **RETRIEVE_WITH_CONTEXT** — authorized and relevant, but from another conversation or an inference.
  Usable only with its origin stated.
- **DEFER** — retained but not used: unrelated, unsure, or an inference below 0.75 confidence.
- **REJECT** — owner mismatch, wrong session, tampered provenance.

Relevance is measured on the request's **subject words**, with instruction words (`fix`, `help`, `can`,
`it`, `now`) removed. A request made only of instructions names nothing, so it cannot authorize history —
which is precisely why "Can you fix it?" no longer retrieves a bereavement memory that shares the verb.
Emotionally private history (deterministic lexicon plus 2.1's `appraise()` at intensity ≥ 0.7) needs a
0.45 subject match; ordinary persistent facts need 0.1; historical transcript material needs 0.2.

---

## 7. Provenance implementation

Written by the existing writer, read by the existing reader. Fields:
`memoryId, userId, originatingConversationId, originatingSessionId, originatingConversationTitle,
createdAt, updatedAt, scope, sourceType, confidence, persistence, retention`.

- `sourceType` distinguishes `user-said`, `lelu-observed`, `agent-reported`, `inferred`, `external-tool`.
- A correction advances `updatedAt`; it **never** moves `originatingConversationId`.
- Memories written before 2.2 are read as historical, with no owner and no conversation. They are
  recalled as something previously learned, never as said here, and they are **not deleted**.
- A session id is generated per runtime; a restored page is a new session and cannot see the previous
  session's temporary material.

Spec: `MISSION-22/memory-provenance-spec.json`.

---

## 8. Cross-conversation test results

`tests/memory-sovereignty.test.ts` — **28/28 pass** (0.43 s).

| Group | Tests | Result |
|---|---|---|
| A — isolation | loss in A not retrieved in B; same memory available in A; cross-user; session crossing; legacy is historical; restored session; cognitive nodes scoped | 7/7 |
| B — historical recall | project from another chat recalled and labelled; instruction present; no tokens when clean; no invented origin | 4/4 |
| C — chronology | correction supersedes and origin never moves; inference not promoted to fact | 2/2 |
| D — ownership | cross-user reject; forged provenance reject; invalid conversation id gains no authority; ownerless memory not claimed | 4/4 |
| E — contamination | irrelevant deferred; same-chat irrelevant authorized but not rendered; sensitive history deferred on a bare verb; retrieved when asked directly; possessive matching; duplicates; outdated summary | 7/7 |
| F — concurrency | parallel conversations do not share context; parallel writes keep their own provenance | 2/2 |
| G — personality regression | historical grief does not change present appraisal; policy document matches code | 2/2 |

---

## 9. Multi-agent and tool memory results

- `AIService.delegate` uses the same `MemoryBridge.enrich`; agents inherit the boundary. An agent request
  has no conversation id, so agent reads are conversation-neutral and everything it sees is labelled as
  history.
- `AgentRunner.consolidate` now writes `sourceType: agent-reported`, `scope: derived`, `confidence: 0.6`.
  Such a memory can only be retrieved as `[inferred]`, never asserted as a user fact.
- `MemoryMigration.importBundle` writes `sourceType: external-tool` with no conversation of origin.
- Tool-generated context (diagnostics, engineering findings) is not memory and is not persisted as such.
- Existing agent hierarchy, stores and permissions were not changed; no agent was recreated and no
  LangChain/LangGraph component was introduced.

Verified by the full suite's agent tests plus the new D/E tests.

---

## 10. Personality regression (2.1)

- `tests/personality-voice.test.ts` + `tests/personality-voice-2_1.test.ts`: **all pass** as part of the
  100/100 memory+voice batch and the full suite.
- New assertion: `appraise("Can you fix it?")` is not grief, and `composeVoice` for that message carries
  no grief language even when a bereavement memory exists. Historical emotion is data; it is not the
  present state.
- The 2.1 live personality evidence is untouched; nothing in the voice layer was modified by 2.2.
- Persona signature stability: the voice directive is still composed before provider selection from the
  current turn only.

---

## 11. Groq and OpenRouter validation

Canonical pipeline (`AIService.chat` → `AIRuntime.process` → provider HTTP), real keys, no Anthropic.

**Live scenario run** (`MISSION-22/live-validation.json`) — 8/8 turns answered, chain chose OpenRouter
(`nvidia/nemotron-3-ultra-550b-a55b:free`). Probe latencies 2,342 / 4,912 / 6,104 / 7,369 ms.

| Scenario | Requirement | Result | Evidence |
|---|---|---|---|
| A-isolation | "Can you fix it?" in chat B never receives chat A's loss | **PASS** | no grief text in the captured payload; reply asks what needs fixing; 0 memories recalled |
| B-historical-recall | a project from chat C is recalled in B with its origin | **PASS** | payload contains `[earlier conversation “C — Aurelia studio”]` + provenance note; reply grounded in Aurelia |
| C-chronology | the corrected value is what reaches the model | **PASS** | platinum in payload; superseded rose gold not current; reply: "Platinum. You corrected it in our “D — metals” chat…" |
| E-sensitive-history | a directly asked-about loss is retrievable as history | **PASS** | labelled memory in payload; reply opens "Last month you said you couldn't focus on anything…" — history, not present mood |

**Provider parity** (`MISSION-22/live-parity.json`) — same memory path, provider pinned:
`groq: answered, griefInContext=false`; `openrouter: answered, griefInContext=false`. **2/2 PASS.**

Sensitive information: all prompts are synthetic test strings; no credentials, tokens or keys appear in
any artifact, log or report.

---

## 12. Browser acceptance (GenesisChat)

`MISSION-22/browser-acceptance.json`, screenshots `artifacts/genesis-memory-isolation.png` and
`artifacts/genesis-memory-return.png`.

Executed in the real app on the dev server:

1. Summoned the chat; conversation A exchanged multiple messages.
2. Sent the loss in A; real reply: "That's not a technical error. That's grief…".
3. **New chat** → conversation B, empty.
4. Sent "Can you fix it?" in B; real reply addressed the 503 engineering runtime. **No grief, no
   condolences, no mention of a father.** A's transcript was open beside it.
5. Returned to A: the loss turn and its reply were intact; B's question was absent.
6. Reloaded the page and opened a new tab: both conversations restored from
   `lelu.multichat.workspace.v1` — `[Can you fix it? (2 msgs), hey, how's it going? (6 msgs),
   Engineering (3 msgs)]` with an active conversation id.

**Not browser-verified:** a historical-recall turn typed in the UI *after* the reload. The cloud
browser's accessibility tree and JS evaluation both time out once the 3D scene has run for ~2 minutes
(the same saturation documented in 2.1). Historical recall is validated at pipeline level, and the UI
return step shows the memory-bearing transcript. Mobile/native shell was not available.

---

## 13. Performance

`MISSION-22/performance-report.json` — 500 memories, 20 conversations, 180 samples per metric, Node.

| Measure | Mean | p95 |
|---|---|---|
| Recall, scoped (includes eligibility filter) | 0.056 ms | 0.108 ms |
| Recall, unscoped (pre-2.2 behaviour) | 0.047 ms | 0.098 ms |
| Scope-filter overhead | **0.009 ms** | — |
| Authorization decisions (whole recall set) | 0.069 ms | 0.106 ms |
| Provenance read (per memory) | 0.001 ms | 0.002 ms |
| Synthesis (with labels) | 0.023 ms | 0.045 ms |
| Provenance note | 0.001 ms | 0.002 ms |

Token overhead: the provenance instruction is **0 characters** on a turn with no labelled material and
486 characters when historical/inferred material is present; labels cost 23 chars (`[earlier conversation]`)
or 11 (`[inferred]`) per line. Provenance metadata stays inside the record and is never shipped to the
model. Retrieval decisions and counts go to the internal cognitive trace only.

---

## 14. Remaining defects and limitations

1. **Model compliance is not guaranteed.** With a labelled memory in context, the model always had the
   material and the instruction; it named the chat in the chronology case and used a time reference
   ("Last month you said…") in the loss case. In the Aurelia case it answered from the project registry
   instead of quoting the memory. The *system* preserved and labelled the origin; the model chose a
   different, still-truthful grounding. This is a reply-quality issue, not a boundary failure.
2. **The legacy shared `ConversationEngine` window is still written every turn.** It is now used only by
   callers with no conversation id (headless/agent paths). It is not consulted when a known conversation
   exists, and an unknown id with chats present now receives no history.
3. **Global registries are unlabelled.** `ProjectStore` and `AgentStore` are LÉLU's own state, deliberately
   global; they are not user transcripts, but a project created in one chat can be mentioned in another.
   Out of scope for memory sovereignty; noted as residual R2.
4. **Cross-user isolation is structural, not multi-tenant tested.** The app is single-user
   (`primary-user`). Ownership is enforced by `userId`, and cross-user records are rejected by test, but
   there is no second account in this deployment to drive end-to-end.
5. **Two tabs making model calls simultaneously** were not driven in the browser; concurrency is covered
   by test Group F (parallel recalls and writes).
6. **Browser UI saturation** prevents long UI sessions; see §12.
7. **Pre-existing failures**, unrelated and reproducible before this mission:
   `tests/genesis-interface.test.tsx` (`ERR_PACKAGE_PATH_NOT_EXPORTED` for
   `@excalidraw/excalidraw/index.css`) and `tests/sandbox-security.test.ts` (the sandbox returns `''`
   where the test expects `denied:`). `src/core/perception/FeatureUnderstanding.ts:455` has two
   pre-existing TypeScript errors. None is introduced by 2.2; all new code typechecks.
8. **Full-suite numbers** are reported in §15 from the completed run; the two failures listed above are
   environmental.

---

## 15. Checks run

| Check | Command | Result |
|---|---|---|
| Memory acceptance | `npx tsx … --test tests/memory-sovereignty.test.ts` | 28/28 pass |
| Memory + voice batch | memory, personality 2.0/2.1, conversation, providers, safety | 100/100 pass |
| Affected-path batch (after final fix) | runtime-integration + memory + conversation + personality | 70/70 pass |
| Typecheck | `tsc -p tsconfig.app.json --noEmit` | only the 2 pre-existing errors |
| Full suite | `npm test` | see below |
| Live canonical | `npx tsx scripts/memory-live.ts` | 8/8 answered, 4/4 scenarios |
| Provider parity | `npx tsx scripts/memory-live.ts --parity` | 2/2 pass |
| Performance | `npx tsx scripts/memory-bench.ts` | see §13 |
| Browser | GenesisChat, real providers | §12 |

**Full suite (completed run after the final code fix):** 2,336 tests, 2,326 pass, 8 skipped, 2 fail —
the two pre-existing environmental failures above. Detailed record: `MISSION-22/test-results.json`.

---

## 16. Branch, commit and reproduction

- Branch: `freebuff/4fe6237b54885c7ced31f590`
- Base commit: `aa8b1bd`
- Implementation commit: **`2c3d149`** — "Add memory sovereignty to Lélu's memory pipeline". It carries
  this report, all 2.2 code, tests, scripts and artifacts, together with the prior mission's 2.0/2.1 work
  that this mission extends (it was uncommitted on the branch and cannot be separated from it).
  A follow-up commit records `MISSION-22/commit.txt` with the exact hashes. Nothing was pushed.

Reproduction instructions: `MISSION-22/acceptance/README.md`.

---

## What changed in how LÉLU remembers

She still knows the people she talks to, the projects they build and the things they told her months ago.
What she now also knows is **where each of those things came from** — and she no longer hands a memory to
the wrong conversation, or treats a remembered grief as the mood in the room.
