# MISSION 22.4 — MEMORY DELETION END-TO-END VERIFICATION & CONTEXT TRANSPARENCY

**Branch:** `freebuff/m22-4-memory-deletion-browser-verification`
**Base:** `92ea2d2` (M22.3 remote HEAD, verified with `git ls-remote`; working tree clean at branch time)
**Scope:** prove that deleting a memory through the real Memory panel removes it from subsequent provider payloads, and that “Using other chats” says what actually happened.

---

## 1. Result in one paragraph

Deleting a memory in the real GenesisChat interface now works end to end: the row is removed from the panel, the record leaves the store, the next real Groq request in a fresh conversation carries none of it, and after a full reload it is still absent. Getting there uncovered two real defects that M22.3 had only observed as symptoms, and both were repaired in the existing authoritative pathways: **project checkpoints re-injected deleted statements into every later prompt**, and **CrossChatResolver could hand the user's own question back as “research from another chat”**, which is exactly what “1 other chat used” was counting. No new memory system, no authorization change, no second deletion path.

## 2. What was verified, in the browser, with the real application

Environment: the same development-only acceptance configuration M22.3 established (`?scene=off`, honoured only when `IS_DEV`; production cannot reach it), the real `GenesisInterface`/`GenesisChat`/Memory panel, the real `MemorySovereignty`, `ContextAuthorization`, `WorkspaceManager`, persistence, provider broker and payload transformation. Provider traffic went to the same-origin `/api/model` broker: **Groq `openai/gpt-oss-120b` answered HTTP 200**; **OpenRouter was reached and refused with HTTP 429** (free-models-per-day); no Anthropic request was made.

### 2.1 The deletion, as a user performs it

| Step | Evidence |
| --- | --- |
| Memory present before deletion | panel search row: “User's workshop access phrase is COPPER-LANTERN-77. (learned in the chat …)”, 100% confidence; second run: “Spare key is under SILVER-KETTLE-42.”, 90% |
| Delete through the panel | row **Delete** → inline **“Delete this memory?”** → **Confirm delete** |
| Interface reflects it | “Memory deleted. It is removed from the store and will not be recalled again.” + “No memories match this search.”; total count dropped 27 → 26 in the second run |
| Next request excludes it | second run, **0 occurrences** in both requests (HTTP 413 retry, then 200) |
| Reload does not restore it | after reload, **0 occurrences**; activity “Checked memory — nothing related”; reply “I don’t have the spare-key location in this chat…” |
| Scoping | one memory id removed; 26 other memories, the conversation transcript and every unrelated checkpoint stayed |

Screenshots: `MISSION-22.4/screenshots/01…05`. The before/after pair for both test memories shows the row, the confirmation and the emptied filtered listing.

### 2.2 The payload assertion is not a token grep

A request body contains both the assembled **context** and the conversation **history**. The evidence parser separates them: a phrase in `context` is memory-derived attachment; a phrase in the chat's own `messages` is the user's transcript, which deleting a memory does not rewrite. That distinction is why the first run's failure was provable rather than ambiguous.

## 3. The two defects, and the repairs

### 3.1 Deleting a memory left the statement in a project checkpoint (P0)

`Orchestrator.persistCheckpointFromRequest()` wrote **every answered turn's request** into a durable project checkpoint (`summary = request.slice(0, 200)`), and `CognitiveContext` re-injects checkpoints into later prompts as `## PROJECT CHECKPOINTS`. So after the memory record, its observations and its graph node were gone, every later prompt in every chat still contained:

```
## PROJECT CHECKPOINTS
[from the chat “Please remember this: my workshop ac”] - General [active]:
Please remember this: my workshop access phrase is COPPER-LANTERN-77.. Next: reassess.
```

Measured consequence: after deletion the next real request still held the phrase once, and the model answered with the deleted phrase.

Repair (existing paths only):
- An **answered** turn no longer writes a checkpoint. A checkpoint is resumable work state; this path has none (no pending steps, no next action). The planned-task path still checkpoints, because a plan is real state.
- `ProjectStore.forgetText(text)` removes exactly the checkpoint fields that quote a forgotten statement and drops a checkpoint left empty. `Brain.forgetMemory()` calls it with the deleted memory's own sentences, and records `checkpointsChanged` in the cognitive trace.

Regression coverage: `tests/context-sovereignty.test.ts` — “deleting a memory also removes a project checkpoint that quotes it” (the quoting checkpoint disappears, an unrelated one still says “Ship the pricing page by Friday.”).

### 3.2 “1 other chat used” was counting the user's own question (P1)

Reproduced exactly: a brand-new conversation asking *“What is my workshop access phrase? Answer in one short line.”* produced a request containing

```
## RESEARCH FROM OTHER CHATS (authorized)
[from the chat “What is my workshop access phrase? A”]
From the chat “What is my workshop access phrase? A” (the user brought it up):
  - User: What is my workshop access phrase? Answer in one short line.
```

and the badge `1 other chat used`. No foreign material was involved. Two causes:

1. **Title matching used plain `String.includes()`.** The chat created for that question was titled “What is my workshop access phrase? A”; the next question began “…? Answer…”, so the title's trailing **A** matched the first letter of **Answer** and the chat counted as *named*.
2. **The resolver never excluded the current turn's own words.** A conversation record holding this very question could be selected, scored on keyword overlap, and handed back as another chat's research.

Repair:
- `containsTitle()` requires a title to end on a word boundary; `namesChat` and the resolver's `contained`/`fullyNamed` logic use it.
- `CrossChatResolver` excludes any message whose normalized text equals this turn's prompt from scoring, from the picked set and from the latest-answer fallback.

Result: the same question now yields `used = []`, no research block, no badge, and the specific M22.3 observation is explained rather than left as a nuance.

### 3.3 What the indicator now means

| State | Where it appears | Counted as “used”? |
| --- | --- | --- |
| discovered, unauthorized | “Related, not used (not linked): …” (info step) | no |
| inspected (`chats.read`) | reference step naming the chat that was read | yes, it was read |
| retrieved memory | “Recalled N related memories” / “Checked memory — nothing related” | no — memory steps never produce this card |
| authorized + injected | labelled block in `request.context`; reference step “Used research from the chat …” | yes |
| rejected | never enters a used list | no |
| deferred (she asks) | nothing counted; seen after reload: “Would you like me to pull in the earlier … conversation?” with badge `Web research · 1 search · 1 issue` | no |
| own turn's words | no longer reachable as a source | no |

The card also reports provider fallback separately (“OpenRouter didn't answer — trying the next model”), which is what happened on the OpenRouter 429.

## 4. Deletion propagation audit

| Representation | Removed by | Status |
| --- | --- | --- |
| PatternMemory map | `PatternMemory.remove` | removed |
| IndexedDB memory store | `PatternMemory.remove → store.delete` | removed |
| cognitive graph node (`data.memoryId`) | `CognitiveCore.forgetMemory` | removed |
| workspace observations (`origin.memoryId`) | `WorkspaceManager.forgetMemory` | removed |
| project checkpoints quoting it | **new** `ProjectStore.forgetText` via `Brain.forgetMemory` | removed |
| answered-turn checkpoint creation | **removed** (no checkpoint without resumable state) | no new copies |
| synthesizer output | rebuilt each turn | no cache |
| reflection summary | recomputed each turn (not persisted) | no cache |
| conversation transcript | retained by design | deleting a memory is not deleting a chat |
| provider payload | rebuilt from the cleaned stores | clean in 4/4 post-deletion requests |

Residual, stated rather than hidden: checkpoints written by the **pre-fix** build (the COPPER-LANTERN one) still exist on disk until a deletion purges them. In the post-fix run the COPPER phrase still appeared once from that legacy checkpoint, while the newly deleted SILVER phrase appeared zero times. The fix stops new ones and purges on deletion; it does not rewrite the past without a migration, which this mission did not add.

## 5. Provider evidence

| When | Provider | Status | Payload | Deleted phrase |
| --- | --- | --- | --- | --- |
| before delete (run 1) | groq | 200 | 32,337 | present — via checkpoint |
| after delete (run 1, pre-fix) | groq | 200 | 33,086 | present — via checkpoint → **FAIL** |
| after delete (run 2, post-fix) | groq | 413 → 200 | 32,628 / 25,288 | absent |
| after reload (run 2) | openrouter → groq | 429 → 200 | 25,534 / 25,482 | absent |

OpenRouter is reported as **reached, refused (429)**, never as verified. Groq is the verified answering provider. No key, header or full body is committed; only statuses, lengths, occurrence counts and short labelled excerpts.

## 6. Tests and performance

Focused suites: `tests/live-agent.test.ts` + `tests/context-sovereignty.test.ts` — **64/64 pass** (new coverage: checkpoint purge on deletion; title word boundaries; own-turn exclusion; zero and anonymous retrieval; a positive linked-chat injection control).

Typecheck (`tsc -p tsconfig.app.json --noEmit`): the two pre-existing `FeatureUnderstanding.ts:455` errors, **no new errors**.

Full regression: `npm test` — **2,378 tests, 2,368 pass, 2 fail**, against the M22.3 baseline of 2,376 / 2,366 / 2. The two new tests are this mission's; the two failures are the same known ones (`tests/genesis-interface.test.tsx` CSS export, `tests/sandbox-security.test.ts` network probe). No new failures, no changed failure. Counts and the per-area list: `MISSION-22.4/regression.json`.

Measured overhead (`MISSION-22.4/perf-deletion.ts`, in-memory shims, 20 deletions): `Brain.forgetMemory` mean **0.10 ms**, median 0.06 ms, max 0.89 ms; context assembly (`buildCognitiveContext` + `formatCognitiveContext`) mean **1.14 ms**, median 0.38 ms. That is the deletion path plus the checkpoint text scan — no measurable cost added to a turn.

## 7. Acceptance

| Criterion | Result |
| --- | --- |
| Actual browser Memory deletion succeeds | **PASS** (two independent runs) |
| Deleted memory absent from the next provider payload | **PASS** after the checkpoint repair (was FAIL, measured) |
| Remains absent after reload | **PASS** (SILVER run; legacy COPPER residue documented) |
| Conversation B remains isolated | **PASS** — post-fix fresh conversations carried no other chat's material; the only “other chat” block ever seen quoted the user's own question and is now impossible |
| Deletion propagates through derived representations | **PASS** for every representation the existing policy requires, plus the checkpoint defect repaired |
| No stale cognitive snapshot restores deleted content | **PASS** |
| “Other chats” indicator has documented, accurate semantics | **PASS** |
| UI reporting reflects retrieval vs injection | **PASS** (used / related-not-used / deferred / provider-fallback distinguished) |
| Existing memory and conversation behaviour intact | **PASS** (focused 64/64; full suite in `regression.json`) |
| No unexplained new failures | See `regression.json` |

**Not verified:** native iOS/Android (no device or emulator; only the web build), successful OpenRouter completion (429 only), and the pre-fix legacy checkpoint's non-existence (it exists; recorded).

## 8. Files changed

- `src/app/scene/genesis/GenesisMemoryPanel.tsx` — a per-row Delete with inline confirmation, a status notice, and a re-read of the store after deletion; the panel calls the existing `AIService.forgetMemory`.
- `src/core/AIService.ts` — `forgetMemory(id)` delegating to the authoritative brain path.
- `src/brain/Brain.ts` — deletion also purges checkpoints that quote the memory; trace records it.
- `src/brain/PatternMemory.ts` — `get(id)` for reading the record before deletion (existing sync lookup, documented).
- `src/core/projects/ProjectStore.ts` — `forgetText(text)`, targeted checkpoint scrubbing.
- `src/core/orchestrator/Orchestrator.ts` — an answered turn no longer writes a checkpoint.
- `src/core/multichat/ChatConsent.ts` — `containsTitle()` word-boundary matching.
- `src/core/multichat/CrossChatResolver.ts` — own-turn exclusion; boundary-aware naming.
- `tests/context-sovereignty.test.ts`, `tests/live-agent.test.ts` — regression coverage for both defects.

Evidence: `MISSION-22.4/browser-deletion.json`, `cross-chat-indicator.json`, `deletion-propagation.json`, `provider-payloads.json`, `performance.json`, `regression.json`, `reproduction.md`, `screenshots/01–05`.
