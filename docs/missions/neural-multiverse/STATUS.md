# Neural Map Multiverse — status (2026-11-27)

Brief: `brief/LELU_NEURAL_MAP_50_IMAGE_ATLAS_AND_CLAUDE_HANDOFF.pdf` (WP00–WP10) and its 50-reference
companion `brief/LELU_NEURAL_MAP_50_LIVE_SOURCE_IMAGES.html`.
Branch `claude/gallant-ritchie-wwievb`. The base is WP18 (85000c80), merged in as c9659905.

This is the first increment. It implements the **shared core** that every later package depends on: one map,
three aspects, twelve shared layouts, and saved views. Every aspect reads real authorities. Later packages
are listed below with what blocks them. None of them are claimed here.

## WP00: what the repository actually contains

| Named in the brief | Found |
|---|---|
| Neural Map V1 (index, adapters, tools, standalone + embedded views) | `src/core/neural/*`, `src/app/scene/genesis/neural/*` |
| CosmosObjectStore, CosmosNavigation, SpatialObjects, CosmosEntityRegistry | `src/core/cosmos/…` |
| SpatialSceneGraph · ToolRegistry · InterfaceCatalog | `src/core/spatial/` · `src/core/tools/` · `src/core/interface/` |
| ImprovementQueue · CognitiveLoop · ProactiveCore | `src/core/selfdev/` · `src/core/cognition/` · `src/core/proactive/` |
| WP18 modules (CognitiveEvaluation … TurnBridge, NeuralMapBridge, LearningLedger) | `src/core/conversation/*` (13 files, from 85000c80) |
| Agents (persistent) · executives | `src/core/agents/AgentStore.ts` · `src/core/executive/ExecutiveBoard.ts` (6 executives) |
| "Governor" | No separate system. The Lélu executive's Cosmos type is `governor`. Approval runs through AutonomyGate. |
| "Repository Agent" | **No module by that name.** The closest ones are acquisition/RepoExecutor, selfdev and engineering. |
| Contabo runtime | Not reachable from this container; not verified. |
| Neural Map V2 / V3 | Did not exist before this change (the WP18 audit says so too). |

## Implemented

- **One map, three aspects** (`src/core/neural/multiverse/Aspects.ts`). All three derive into one graph
  shape (`MultiverseTypes.ts`). Every node and edge carries **evidence**: measured, declared, inferred,
  classified, proposed or unknown.
  - **V1**: the canonical `NeuralMapIndex`, unchanged. The existing neighbourhood view stays V1's default.
  - **V2**: 67 real `src/core` subsystems, with lines and files measured from source. 415 subsystem→subsystem
    edges are counted from static imports, marked *inferred* (wiring, not calls). The 13 function groups are
    marked *classified*. The view states that no runtime telemetry is shown.
    Generator: `scripts/neural/build-cognitive-architecture.ts`.
  - **V3**: the 6 executives plus every persisted agent in AgentStore. Reports-to comes from the declared
    owner; a default owner is marked *inferred*. Delegations are counted from real tasks. Reliability is
    shown only when there are completed or failed tasks to measure. The view states that agent-to-agent
    conversation and self-dialogue have no record yet, so none are drawn.
- **Twelve shared layouts** (`Layouts.ts`): Core Orbit, Galactic Spiral, Nested Universes, Force-Directed
  Universe, Dimensional Layers, Radial Constellation, Infinite Canvas, Temporal River, Matrix/Grid,
  Topographic Field, Chord/Relationship Ring, Holographic Spatial. They are pure and deterministic.
  Hierarchy comes only from real edges. Temporal River never invents a date.
- **Saved views** (`SavedViews.ts`): save, rename, duplicate, favourite, search, restore and delete. Views are
  persisted, sanitised on load, and hold presentation only.
- **UI** (`MultiverseView.tsx`, header selector in `NeuralMapView.tsx`): aspect selector, layout picker,
  filter, group toggles, labels, theme (cosmos/paper/infrared), node scale, evidence-styled edges, an
  inspector with relations, a "Not shown" panel, and a mobile single-column layout.

## Evidence

- `tests/neural-multiverse.test.ts`: 22 tests covering every layout, the aspect rules, saved views and
  V2 freshness.
- `scripts/neural/verify-multiverse.mjs` in the real app: **44/44 verified**. It covers 3 aspects × 12
  layouts, with every derived node drawn, plus saved-view survival across a reload, iPhone, and no page
  errors. Results: `verify-multiverse.json`. Screenshots: `shots/`.
- Full suite after the merge: 3442 tests. The 5 failures (credential-exposure, foundry ×2,
  outfit-switching, supabase-config) fail identically on the pre-merge commit f354012a.

## Found, not fixed

- On Home, her companion (`LeluCompanion`, hero placement) draws above the full-screen Neural Map.
  It covers the stage centre on desktop and the header buttons on iPhone (see shots 04 and 10). This
  predates this change. Fix it in the companion's placement rules, not in the map.

## Next packages, in priority order

1. **WP04 V2 variants.** The anatomical, glass-brain and connectome styles need a 3D renderer (three.js is
   already in the app). The data contract is ready. Live activity needs CognitiveLoop/ProactiveCore to
   publish real per-subsystem counters; it must not be inferred.
2. **WP05 V3 conversations.** Direct, group and private self-dialogue need a persisted record and real model
   calls through the existing provider chain. No record exists today. Pause/resume uses the existing
   AgentStore.setStatus. The remaining controls should reuse AutonomyGate.
3. **WP03 specialised V1 variants** (semantic clusters, dependency flow) on the same layouts.
4. **WP06**: feed aspect/layout/selection into NeuralMapBridge so she can discuss what is on screen.
5. **WP01 atlas.** The 50 references are third-party, mostly copyrighted images. Download and commit them
   only after a per-image licence check. Until then the brief's HTML hotlinks them. Repository research
   (licence, maintenance, security) is still to do.
6. **WP07/WP08** need a decision. There is no "Repository Agent" module, and Contabo cannot be reached
   from here. The owner must choose which existing system takes that role and authorise any live runtime
   work.
