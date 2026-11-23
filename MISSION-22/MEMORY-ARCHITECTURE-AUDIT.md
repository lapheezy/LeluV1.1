# MISSION 2.2 — MEMORY ARCHITECTURE AUDIT

Status: audit performed against the working tree at commit `aa8b1bd` plus the uncommitted 2.1 work.
Verification: source inspection + live pipeline runs (see `live-validation.json`) + the defects reproduced as tests in `tests/memory-sovereignty.test.ts`.

## 1. What was actually audited

The canonical runtime, not a diagram of it:

```
USER INPUT
  AIService.chat(prompt, media, context, { conversationId })
    → bindTask(taskId, conversationId)
    → CognitiveTrace.begin(taskId, prompt)
    → buildCognitiveContext(conversationId)                 [conversation-scoped]
    → priorTurnsFor(conversationId, message)                [conversation-scoped]
    → Brain.getConversation().record("user", message)       [SHARED window]
    → MemoryBridge.enrich(request)
        → Brain.recall(prompt)                              [UNSCOPED before 2.2]
            → MemoryEngine.recall(query) → PatternMemory.search(prompt)
        → Brain.reflect()                                   [global]
        → threadContext(request)                            [fallback to SHARED window]
        → UserManager.context()                             [global profile, intended]
        → composeVoice({ prompt, messages })                [current turn only]
        → Brain.synthesizeContext(prompt, memories, {...})  [no origin labels]
        → buildContext(synthesized, reflection, conversation, cognition)
        → MemoryOrchestrator.gather(prompt, bands 6/7)      [no scope forwarded]
        → MemoryOrchestrator.gather(prompt, bands 4)        [no scope forwarded]
        → fitContext(merged)                                [global budget]
    → AIRuntime.process(enriched, { recalledMemories })
        → ProviderResolver → labelOtherChats(context)       [transcript quotes only]
        → provider.generate(request)  (leluSystemPrompt(request, provider))
    → emitMessage + Brain.getConversation().record("assistant")
    → post-response: MemoryBridge.learn(prompt, response, taskId)
        → LanguageObserver.observeTurn
        → Brain.learn(...) → MemoryEngine.learn  [no conversation origin]
        → CognitionRuntime.observe(prompt+response)         [GLOBAL graph]
        → SupabasePersistence.persistMemories
    → Brain.recall(message, "post-write-profile-sync")      [UNSCOPED]
```

## 2. Root cause

**Memories were stored and recalled without provenance.**

`ResponsePattern` carried a category, a prompt, a response, keywords, importance and confidence — but
nothing that said *which conversation* the fact came from, *which session*, *which user*, *when it was
learned*, or whether it was stated, observed, reported or inferred. `MemoryEngine.learn()` wrote
records with `context: { source: "memory-engine", ... }` and no origin; `PatternMemory.search()`
ranked every record in the store against the current prompt by lexical overlap alone.

With no origin, three questions that must be separate collapsed into one:

```
Is this relevant?   →   Is this authorized?   →   Is this about now?
```

A memory that scored well was therefore treated as current context. That is the reported defect: a loss
discussed in conversation A was retrieved in conversation B and answered as though it had been said
there. The retrieval was working exactly as designed; the design had no notion of *whose* memory it was.

## 3. Contributing defects

The audit found six, not one. Two were found only by running the pipeline live; they are marked LIVE.

| ID | Defect | Where | Effect |
|----|--------|-------|--------|
| F-01 | No provenance written with a memory | `MemoryEngine.create` / `MemoryBridge.learn` | Nothing downstream could distinguish origin |
| F-02 | Recall had no scope; ranking was lexical only | `PatternMemory.search`, `MemoryEngine.recall`, `Brain.recall`, `MemoryBridge.enrich` | Another conversation's fact was a normal candidate |
| F-03 | Context assembly rendered global state with no attribution | `MemoryBridge.buildContext` → `formatCognition` | "Recent knowledge nodes" printed another chat's turn verbatim |
| F-04 | Cognitive graph observations had no conversation | `Brain.learn` → `CognitionRuntime.observe` → `CognitiveCore.observe` | **LIVE**: chat B's provider context contained chat A's loss even with zero memories recalled |
| F-05 | `threadContext` fell back to the brain's shared window | `MemoryBridge.threadContext` | A chat id missing from the store inherited the last chat's topic/recent messages |
| F-06 | `AIService` fell back to the shared window for an unknown conversation id | `AIService.chat` (`priorTurnsFor ?? modelMessages`) | A stale id could receive last chat's transcript |
| F-07 | A correction with high word overlap was REINFORCED, not superseded | `MemoryEngine.learn` branch order | The old value stayed current; chronology lied |
| F-08 | Possessives tokenised as distinct words | `MemorySynthesizer.concepts` | **LIVE**: "my father's death" matched nothing, so an authorized memory was dropped and the model denied having it |
| F-09 | Provenance note placed only at the end of a 10k-char context, and worded as "not something the user said here" | `MemoryBridge` / `MemorySovereignty.memoryContextNote` | **LIVE**: the model denied a memory that was in its own payload |

## 4. Components affected

- `src/brain/PatternMemory.ts` — retrieval boundary. **Changed**.
- `src/brain/MemoryEngine.ts` — write consolidation, recall. **Changed**.
- `src/brain/Brain.ts` — recall/learn façade, cognitive observation. **Changed**.
- `src/brain/MemorySynthesizer.ts` — ranking, rendering, provenance labels. **Changed**.
- `src/brain/CognitionRuntime.ts`, `src/core/cognition/CognitiveCore.ts` — global graph. **Changed**.
- `src/core/MemoryBridge.ts` — context assembly, provenance write, thread context. **Changed**.
- `src/core/memory/MemoryProvider.ts`, `providers.ts` — scope forwarded to providers. **Changed**.
- `src/core/memory/MemoryMigration.ts` — imported memories marked external-tool. **Changed**.
- `src/core/agents/AgentRunner.ts` — agent insights marked derived/agent-reported. **Changed**.
- `src/core/AIService.ts` — learns carry conversationId; post-write recall scoped; stale-id fallback closed. **Changed**.
- `src/core/memory/MemorySovereignty.ts` — new boundary (provenance + decisions + labels). **New**.

## 5. Was it retrieval, caching, summarisation or assembly?

All three of the first, none of the third in the sense of a cache keyed by prompt:

- **Retrieval** was the primary cause (F-02): unscoped, lexical.
- **Context assembly** was the amplifier (F-03, F-05, F-06): it rendered global state and labelled nothing.
- **Caching**: no prompt→context cache exists. `OgArchiveProvider` caches rows per *user* (correct). `PatternMemory` is an in-process map, now filtered by scope at read time. `fitContext` is stateless. **No cache collision was found**; cache isolation is a property of the scope filter, not of a separate cache key.
- **Summarisation**: `MemorySynthesizer` does not persist summaries; `DailyRecord`/`DevelopmentSummary` are identity material, not conversation summaries, and are behind an explicit development query. `UserManager` builds a profile from recalled durable facts — now from the scoped recall, so it cannot absorb another chat's current context.

## 6. Agents, tools, tabs, mobile

- **Agents**: `AIService.delegate` calls the same `memory.enrich`, so it inherits the boundary; its request has no conversationId (agent work is not inside a user chat), so agent reads are conversation-neutral and label everything historical. `AgentRunner.consolidate` wrote agent conclusions with no origin — now `derived` / `agent-reported`, and retrieval only surfaces them labelled as inference.
- **Tools**: `LocalMemoryProvider.persist` → `Brain.learn` with whatever metadata the caller supplied. Tools that write memory (ingestion, migration) now state `external-tool`. No tool reads the store directly except through the orchestrator.
- **Tabs**: each tab is a separate JS runtime with its own `currentSessionId()` and its own in-process `PatternMemory` map, so one tab cannot see another's session memory at all; they share `localStorage` for conversation transcripts, which is per-conversation keyed.
- **Mobile / restored session**: a restored page is a new runtime session. Session-scoped memory from the old session is refused (`isEligible`), while durable facts survive and are labelled historical. Verified by test and by the browser reload.
- **`labelOtherChats`** already existed and labels *transcript quotes* in the final context (`ProviderResolver`). It does not see structured memory records, which is why it did not prevent this defect — and why the fix belongs in the memory layer, not in that textual pass.

## 7. Why the fix is not a new memory system

No store, table, index or second retrieval path was added. The change is:

1. a provenance record written by the existing writer (`MemoryEngine.create`) from a seed the existing caller supplies (`MemoryBridge.learn`);
2. an eligibility filter inside the existing reader (`PatternMemory.search`);
3. a decision layer (`MemorySovereignty.decide`) applied to the existing recall result;
4. labels rendered by the existing synthesiser and explained by one conditional instruction block.

The store schema, provider registry, consolidation rules and identity model are unchanged. Memories written before 2.2 are read as `historical-conversation` with no owner and no conversation — never as current — and are not deleted.
