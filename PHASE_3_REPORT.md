# LÉLU — Phase 3 Architecture Report

## Method (and its limits, stated up front)

This environment has **no network access and no `node_modules`**. I could not run
`npm install`, `tsc -b`, `vite build`, or the Playwright tests. Everything below
comes from **static analysis**: a script that parses every `import`/`export ... from`
statement starting at `src/main.tsx` and resolves relative paths exactly the way
Vite/TypeScript would (no path aliases are configured, so this is a faithful
reconstruction of the real module graph). I re-ran it after every change to confirm
zero broken imports. What I could **not** verify: type-correctness, runtime
behavior, or whether the app actually renders. Treat "confirmed live" below as
"provably imported from the entry point," not "known to work."

## 1. The core finding

Of **619** TypeScript/TSX files under `src/`, only **180** were reachable by import
from `src/main.tsx`. **439 files (71%) were completely orphaned** — not imported by
anything in the live chain, directly or transitively. This one number explains
almost everything the audit and this brief were pointing at: LÉLU isn't one system
with some duplication, it's one live application sitting inside several generations
of abandoned rewrites of the same subsystems.

## 2. What I did

**Archived, not deleted**, all 439 orphaned files to `_archive_orphaned/`, preserving
their original `src/` path (e.g. `src/ai/AI.ts` → `_archive_orphaned/ai/AI.ts`). Full
list in `ARCHIVE_MANIFEST.md`. After moving them I re-ran the import graph: **0
orphans remain, 0 broken imports** — nothing live pointed at anything archived.

## 3. What's actually live today (the real architecture)

```
main.tsx → App.tsx → GenesisScene (app/scene/genesis/*)
                         ↓
                  GenesisChat / GenesisController
                         ↓
                    core/AIRuntime.ts
                    ├── core/AICore.ts
                    ├── core/AIRouter.ts
                    │     ├── core/router/BrainResolver.ts
                    │     ├── core/router/ResearchResolver.ts
                    │     └── core/router/ProviderResolver.ts → providers/*
                    ├── core/RegisterProviders.ts / RegisterAIProviders.ts
                    └── brain/Brain.ts
                          ├── brain/ConversationEngine.ts
                          ├── brain/MemoryEngine.ts, PatternMemory.ts, MemoryExtractor.ts, MemoryOrganizer.ts
                          ├── brain/LearningEngine.ts
                          ├── brain/ReflectionEngine.ts
                          ├── brain/ConfidenceEngine.ts, OfflineComposer.ts
                          ├── brain/CognitionRuntime.ts
                          └── core/cognition/CognitiveCore.ts
                                └── core/cognition/KnowledgeGraph.ts
                                └── core/cognition/WorkspaceManager.ts
```

Data providers (`src/providers/*`): Arxiv, CrossRef, GDELT, GitHub, GitHub Models,
Groq, HackerNews, NASA, News, Nominatim, OpenAlex, OpenMeteo, OpenRouter,
OpenStreetMap, Wikidata, Wikimedia, Wikipedia, YouTube — all live, all routed
through `AIProvider.ts` / `BaseProvider.ts` / `Provider.ts`, and reached only via
`core/router/ProviderResolver.ts`. This part already matches the "one routing
layer" goal — there was no second, competing provider-routing stack in the live
graph once the orphans were removed.

User identity/session: `core/user/UserManager.ts`, `UserProfile.ts`,
`UserProfileStore.ts` — single live implementation, no duplicates found.

Persistence: `core/memory/IndexedDBStore.ts` and `MemoryStore.ts` — single live
pair.

The Genesis 3D layer (`app/scene/genesis/`) is its own large live subtree —
~90 files of Three.js engines, materials, ocean rendering, timeline, and state
machine, all reachable from `GenesisScene`.

## 4. Duplicate names that were **not** real conflicts

A few names appear twice in the live set. I checked each one before touching
anything:

- **`MemoryEngine`** exists in both `brain/` (AI conversational memory) and
  `app/scene/genesis/engines/` (the 3D universe's simulated memory-state
  visualization). Different responsibilities, different files, no import
  collision — this is coincidental naming, not duplication. Left alone.
- **`GenesisCore`** exists as `app/scene/genesis/GenesisCore.tsx` (scene
  orchestrator) and `app/scene/genesis/materials/GenesisCore.tsx` (a material/shell
  component). Same situation — different jobs, different paths. Left alone.

## 5. Duplication that *was* real (now resolved by archiving)

Every one of these had exactly one live copy; the rest were dead weight now in
`_archive_orphaned/`:

| Subsystem | Live copy | Archived copies |
|---|---|---|
| Runtime | `core/AIRuntime.ts` | `voice/VoiceRuntime.ts` |
| Router | `core/AIRouter.ts` | `core/AIProviderRouter.ts`, `core/KnowledgeRouter.ts`, `core/tools/ToolRouter.ts`, `voice/VoiceRouter.ts` |
| Knowledge Graph | `core/cognition/KnowledgeGraph.ts` | `core/KnowledgeGraph.ts` |
| Cognitive Core | `core/cognition/CognitiveCore.ts` | `brain/CognitiveCore.ts` |
| Conversation Engine | `brain/ConversationEngine.ts` | `ai/conversation/ConversationEngine.ts` |
| Workspace Manager | `core/cognition/WorkspaceManager.ts` | `app/scene/genesis/interface/WorkspaceManager.ts` |
| Reflection | `brain/ReflectionEngine.ts` | `core/ReflectionEngine.ts`, `core/tools/ReflectionTool.ts` |

I did **not** attempt to hand-merge functionality out of the archived copies into
the live ones. Without a compiler I can't confirm an archived class's methods,
types, or dependencies still line up with the live version's — a blind merge here
is how you silently break a working app. Where I skimmed an archived file and it
looked genuinely more capable (a few are), I've flagged it below as a candidate for
a follow-up pass done with build verification available, rather than merging it in
unverified.

## 6. The pipeline the brief asked me to verify

```
User → Conversation → Context → Working Memory → Long-Term Memory → Knowledge Graph
→ Reasoning → Planning → Task Execution → Provider Router → Selected Provider
→ Reflection → Memory Consolidation → Workspace Update → Genesis Update → Response
```

Checked stage by stage against the live graph:

- ✅ User → Conversation → `brain/ConversationEngine.ts`
- ✅ Knowledge Graph → `core/cognition/KnowledgeGraph.ts`
- ✅ Provider Router → Selected Provider → `core/AIRouter.ts` → `ProviderResolver.ts` → `providers/*`
- ✅ Reflection → `brain/ReflectionEngine.ts`
- ✅ Workspace Update → `core/cognition/WorkspaceManager.ts`
- ✅ Genesis Update → the whole live `app/scene/genesis/` tree, driven by `GenesisController`/`GenesisBridge`
- ⚠️ **Working Memory / Long-Term Memory as named, separate stages**: no live file
  named for either. There's `core/memory/MemoryStore.ts` and `IndexedDBStore.ts`
  plus `brain/MemoryEngine.ts`, but no explicit working/long-term split. Not
  necessarily broken — may just be collapsed into `MemoryEngine` — but I can't
  confirm the distinction exists without reading runtime behavior I can't execute.
- ❌ **Reasoning**: no live implementation. `core/ReasoningEngine.ts` and everything
  in `core/cognition/Reasoning*.ts` (Evaluator, Facts, Hypotheses, Stage) are all
  orphaned — never wired into `Brain.ts` or `AIRuntime.ts`. Now archived.
- ❌ **Planning / Task Execution**: same story. `core/PlanningEngine.ts`,
  `core/Planner.ts`, `core/TaskPlanner.ts` are all orphaned. There is currently no
  live task-planning stage between "provider selected" and "response returned."

**This is the one honest gap I can't close for you in this pass.** Wiring
Reasoning and Planning into the live pipeline isn't a file move — it's real design
work (deciding the call contract into/out of `Brain.ts`, deciding what "Task
Execution" even means for a chat-driven app) plus compilation to catch what breaks.
I'd rather tell you it's missing than paper over it with an unverified splice of
archived code into the live runtime.

## 7. The "living interface" ask

I did not attempt the adaptive-workspace UI rebuild, panel intelligence, Genesis
activity-binding, or the performance pass in this session. Reasoning: this is a
behavioral/visual rewrite touching a ~90-file live Three.js scene graph, and
without being able to run `vite dev` or the Playwright tests, I cannot see the
result or catch a regression before handing it to you. Doing that blind on a scene
graph this size is a good way to hand you something that silently doesn't render.
This is the main piece of the brief still outstanding.

## 8. Remaining technical debt (found, not fixed)

- `scripts/verify-provider-pipeline.ts` was **already broken before this pass** —
  it imports `../src/core/RegisterProvider.ts` (singular; only `RegisterProviders.ts`,
  plural, ever existed) and `Planner.ts`/`ResearchCoordinator.ts`, both of which were
  already orphaned dead code (now archived). Not something I broke; flagging it as
  stale tooling.
- Root-level debug scripts (`playwright-debug*.mjs`, `playwright-verify*.mjs`,
  `playwright-capture.mjs`, `playwright-interact.mjs`, `playwright-test-chat.mjs`)
  and screenshot PNGs are one-off dev artifacts, not part of the `tsc -b`/`vite
  build` graph (confirmed via `tsconfig.app.json`'s `include`). Left untouched —
  out of scope for architecture unification, but worth a cleanup pass.
- No test currently exercises `core/AIRuntime.ts` or `brain/Brain.ts` directly;
  the one surviving root test (`tests/genesis-interface.test.tsx`) only covers the
  Genesis UI shell.

## 9. Recommended next phase (in order)

1. Get this rebuilding somewhere with `npm install` + `tsc -b` available (locally,
   or re-upload with the ability to grant network access here) so changes can
   actually be compiled and caught before they reach you.
2. Design and wire Reasoning + Planning into `Brain.ts` — the biggest real pipeline
   gap.
3. Only then attempt the living-interface/panel-intelligence rebuild, with the dev
   server running so each step is visually verified.

## 10. What's in this ZIP

- `src/` — the same 180 live files, untouched in content, confirmed still fully
  self-consistent (0 orphans, 0 broken imports).
- `_archive_orphaned/` — all 439 archived files, original paths preserved.
- `ARCHIVE_MANIFEST.md` — full list of what was archived.
- `PHASE_3_REPORT.md` — this file.
