# Mission 44.8 — WP01: memory architecture inventory

Read, not assumed. Every claim below is from the module named, and each one was
checked by opening it during this mission rather than from an interface list.
"Simulated" means the code computes a number for display and stores no fact.

## 1. What exists, and what each one is authoritative for

| System | File | Stores | Authoritative for | Durable |
|---|---|---|---|---|
| `PatternMemory` | `src/brain/PatternMemory.ts` | `ResponsePattern[]` in memory, mirrored to IndexedDB via `IndexedDBStore` | durable facts about the user, categories, keyword search, scoring | IndexedDB (`lelu-memory` db) |
| `MemoryEngine` (brain) | `src/brain/MemoryEngine.ts` | writes through `PatternMemory` | what becomes durable: create / reinforce / merge / supersede, with a 0.5 importance gate | via PatternMemory |
| `MemoryExtractor` | `src/brain/MemoryExtractor.ts` | nothing | what is a candidate fact at all (6 shapes + general first-person + decision) | n/a |
| `MemorySynthesizer` | `src/brain/MemorySynthesizer.ts` | nothing | ranking, de-duplication, contradiction detection **at read time** | n/a |
| `MemoryBridge` | `src/core/MemoryBridge.ts` | nothing of its own | the single recall+inject path for a turn; redacts unbacked action claims before writing | n/a |
| `MemoryOrchestrator` + providers | `src/core/memory/MemoryProvider.ts`, `providers.ts` | nothing; reads/writes providers | context by band (1–7); `local`, `supabase`, `og-archive`, `personality` | depends on provider |
| `MemoryStore` / `IndexedDBStore` | `src/core/memory/MemoryStore.ts` | `MemoryRecord` in 7 spaces (`user`, `lelu`, `shared`, `log`, `reflection`, `research`, `project`) | the storage shape | IndexedDB |
| `CognitiveBudget` | `src/core/memory/CognitiveBudget.ts` | nothing | bounding the injected context (dedupe → compress → drop oldest) | n/a |
| `MemoryMigration` | `src/core/memory/MemoryMigration.ts` | nothing | portability: export/import bundles through the providers | via providers |
| `ConversationEngine` | `src/brain/ConversationEngine.ts` | turns, via KvStore | short-term conversation window for the classic path | localStorage |
| `MultiChatStore` | `src/core/multichat/MultiChatStore.ts` | conversations, messages, active id | conversation history for the Chat Universe — the surface actually used | localStorage, coalesced 250 ms |
| `CrossChatResolver` + `ChatConsent` | `src/core/multichat/` | nothing | cross-conversation context, and the authorization for reading it | n/a |
| `ProjectStore` | `src/core/projects/ProjectStore.ts` | projects, items, `checkpoint` | project/workspace memory, including `completed`/`pending`/`nextAction` | localStorage |
| `ProjectMission` | `src/core/cognition/ProjectMission.ts` | mission state, directives | standing direction (north star, programs, directives) | localStorage |
| `ObjectiveLearning` | `src/core/cognition/ObjectiveLearning.ts` | lesson index + durable lessons through `AIService.consolidate` | procedural memory: what worked and what failed for a kind of objective | index in localStorage; lessons in the durable memory path |
| `EngineeringMemory` | `src/core/selfdev/EngineeringMemory.ts` | engineering journal | LÉLU's memory of her own changes | localStorage |
| `StudioMemory` | `src/core/studio/StudioMemory.ts` | studio project memory | creative project state | localStorage |
| `Genesis MemoryEngine` / `MemoryEvolutionEngine` | `src/app/scene/genesis/engines/` | an in-memory array of `{timestamp,type,value,importance}` | **display only** — it fills `state.memory.shortTerm/longTerm/archived` from array length | no |
| OG memories | `src/og/lib/memories.functions.ts`, `legacy_memories` | Supabase OG schema | historical OG archive, read-only through `OgArchiveProvider` | Supabase (when configured) |

## 2. Flow, before this mission

```
user turn
  └─ AIService.chat
       └─ MemoryBridge.enrich
            ├─ Brain.recall  ── PatternMemory.search ── IndexedDB
            ├─ Brain.synthesizeContext ── MemorySynthesizer (rank, dedupe, contradictions)
            ├─ buildContext (reflection, thread, cognition, projects, agents, self)
            ├─ MemoryOrchestrator.gather (bands 6–7 only: supabase, og-archive)
            └─ fitContext (budget) ── request.context
       └─ ProviderResolver ── model
  └─ MemoryBridge.learn ── redact unbacked action claims ── Brain.learn
                                     └─ MemoryEngine (create/reinforce/merge/supersede)
```

What that diagram does **not** carry: when a recalled fact was recorded, where
it came from, whether another record contradicts it, or whether it is stale.
The contradiction detection in `MemorySynthesizer` is real but exists only in
the prompt text for that one turn; it was never attached to the reply, and
`MemoryEngine.supersede` preserved the old value as a parenthetical inside the
record's own text that nothing parsed.

## 3. Findings

**Authoritative.** `PatternMemory` + `IndexedDBStore` is the one durable fact
store; `MultiChatStore` is the one conversation store; `ProjectStore` the one
project store. Nothing in this mission added a competing one.

**Duplicated names, different jobs.** Two classes are called `MemoryEngine`
(`src/brain/`, `src/app/scene/genesis/engines/`) and there are three panels
(`GenesisMemoryPanel`, `og/.../MemoryPanel`, `MemoryLogPanel`). The brain one
writes facts; the Genesis one is a display animation; the panels read different
stores. Naming is confusing; behaviour is not duplicated.

**Simulated.** `src/app/scene/genesis/engines/MemoryEngine.ts` derives
`shortTerm`/`longTerm`/`archived` from the length of a per-frame array. It is a
visual, not memory, and this report does not count it as a memory system.

**Incomplete at the edges.** `MemoryStore` declares seven spaces;
`PatternMemory.initialize()` reads only `"user"`, so the other six are declared
and unused. `MemoryEngine.supersede` embeds the superseded text in the record;
before this mission no reader separated it from the current value.

**Disconnected.** `MemoryOrchestrator` was wired to bands 6–7 only, so its
provider registry never served the memory a turn actually used. `ProjectStore`
had a `checkpoint` with `completed`/`pending` but nothing wrote step-level
progress into it — it was filled only by callers that happened to call
`checkpoint()`.

**No observability.** No component counted writes, retrievals, latency,
conflicts, stale records or resumptions. `CognitiveTrace` records events for a
turn; nothing survived as a measurement over a window.

**No instruction ledger.** `ProjectMission.directives` are seeded direction,
not what the user asked for in conversation. A sentence like "always run the
tests before claiming a pass" was, at most, a low-importance memory — nothing
recorded that it was an instruction, and nothing kept it apart from permission.

## 4. Flow, after this mission

```
user turn
  └─ MemoryBridge.enrich
       ├─ Brain.recall ── PatternMemory ── IndexedDB          [measured]
       ├─ MemoryProvenance.readMemory(memories)               ← NEW
       │     current / historical / stale / conflicting / superseded / incomplete
       │     + source conversation, recorded-at, retrieved-at, verified, inferred
       ├─ StandingInstructions.record(prompt, scope)          ← NEW
       │     record only (never authorize); recurrence → investigation
       ├─ WorkContinuity.currentPlan(projectId)               ← NEW
       │     steps done / remaining, mirrored to ProjectStore.checkpoint
       ├─ MemoryObservability.record(retrieval|conflict|stale|cross-conversation)  ← NEW
       └─ sections into request.context
  └─ ProviderResolver
       ├─ ClaimGrounding (44.7) — tool claims
       ├─ memory provenance note when the reply itself claims memory   ← NEW
       └─ recurrence investigation leads the reply                      ← NEW
  └─ MemoryBridge.learn ── Brain.learn (unchanged) ── MemoryObservability.record(write)
```

The measurement surfaces (`MemoryObservability.snapshot()`) are readable at
minute, hour, day, project, agent and conversation level, and declare a metric
`unavailable` rather than estimating it.
