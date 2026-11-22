# UI Universe × Cosmos × Infinite Cosmos — Recovery, Integration & Conflict Verification

Branch `claude/cosmos-integration-audit-t9ouny` · starting HEAD `f29071614aa27b07bd3c889fae32c7b73c81ede8` (M15.3 WP05) · working tree clean at start.

This was an integration pass, not a redesign. Every change below upgrades an existing file in place, except one small module (`cameraFlight.ts`). That module is the controller's existing flight function moved out unchanged so it can be tested; it isn't a new camera authority. Evidence is in `docs/missions/evidence/cosmos-integration/`.

---

## A. Recovery inventory

All five historical commits are **ancestors of HEAD**. Nothing is stranded on another branch. History needed `git fetch --unshallow`, because the session clone was shallow.

| Commit | Component | Current location | Status |
|---|---|---|---|
| feda0a4 | CosmosStore, CosmosTypes, CosmosLayer, CosmosVisuals, SolarSystem, CosmosOverview | `src/app/scene/genesis/cosmos/` | Present, integrated (CosmosLayer mounted lazily by GenesisController inside the one Genesis canvas) |
| feda0a4 | InfiniteCosmos engine | `src/app/scene/genesis/engines/InfiniteCosmos.ts` | Present, integrated; **untouched since feda0a4** before this pass, with defects F1–F3 |
| feda0a4 | GenesisCosmosPanel (stats + minimap navigation) | `src/app/scene/genesis/GenesisCosmosPanel.tsx` | Present, integrated |
| feda0a4 | Engine runtime (WorldLifecycle, EngineRuntime, FloatingCity, Weather, Vehicle, Tsunami, Zodiac) | `engines/` | Present, integrated |
| feda0a4 | UIOrchestrator | `src/core/ui/UIOrchestrator.ts` | Present (2 importers) |
| feda0a4 | CosmosMap, AgentCouncil, AstronomyEngine, TimeEngine, WorldMorph | — | **Removed deliberately**: 94d0d346 "cut the dead weight", verified zero importers. Superseded by GenesisCosmosPanel / CosmosOverview / CosmosWorkspacePanel / CosmosRooms3D. Not restored. |
| feda0a4 | CosmosCloudNav, CosmosIntegration, ResizablePanel ×2, VoiceControl | — | Removed in 038fd983 (local-first architecture rewrite). Superseded. Not restored. |
| d6f0daa | GenesisScene, GenesisCore, GenesisEarthCore, CosmosSkyBackdrop, CosmosAtmosphere, CosmosPhaseLight | `src/app/scene/genesis/…` | Present, integrated (GenesisCore has 55 importers; the sky backdrop is the DOM fallback layer under the canvas) |
| d6f0daa | Runtime/cognition wiring (AgentEvents, CognitiveLoop, Orchestrator, ToolRegistry) | `src/core/…` | Present, integrated (CosmosStore subscribes to AgentStore, CognitiveLoop, AIService, AgentEventBus) |
| d415887 | Workspace measurement, Layers, useWorkspace | `src/core/ui/Workspace.ts`, `src/core/ui/Layers.ts`, `genesis/useWorkspace.ts` | Present (Workspace 30 importers, Layers 19); see clash C7 |
| d415887 / 70bbd40 | MultiChatTabs | — | Removed in 3cf78fd5 ("the Chat Universe is the chat"). Superseded by `chat/universe/`. |
| 70bbd40 | Surface routing, useSurface, ChatErrorBoundary, chatLayout | `genesis/surface/`, `genesis/chat/` | Present, integrated. Since extended with `universeOwnsScreen` for the Chat Universe |
| ebe9f7b | Mobile chat verification (`verify-mobile-chat.mjs`) | `scripts/` | Present but **stale**: it targets `[data-lelu-composer]`, which the old chat panel drew; GenesisChat has rendered nothing since 3cf78fd5. See C8. (The "68/68" in the latest M15.3 commits is a different, avatar harness.) |

Later layers that build on these, all present and integrated: `core/cosmos/` (CosmosNavigation, CosmosLiveMap, CosmosFocus, SpatialObjects, CosmosInspector, CosmosTools, CosmosAutonomy, CosmosEntityRegistry), `scene/spatial/SpatialRuntime`, `SceneRenderBudget` / `SceneFrameGovernor` / `SceneRenderManager`, `cameraOwnership`, `CosmosRooms3D`, `CosmosObjectsLayer`, `CosmosWorkspacePanel`.

## B. Clash and conflict report

| # | Clash | Files | Root cause | Impact | Sev | Resolution |
|---|---|---|---|---|---|---|
| F1 | Infinite Cosmos sky empty at first paint | `engines/InfiniteCosmos.ts` `preloadAround`; `cosmos/CosmosLayer.tsx` | `preloadAround` filled chunks without emitting. Renderers read their initial state before the preload effect ran. The camera starts inside chunk (0,0,0), so `streamChunks` (the only emitter) never ran until the camera crossed a 40-unit boundary. | No procedural stars, galaxies or nebulae on entry. Browser before-run: **tablet 0 stars in 0 chunks**. Phone and desktop only filled because ambient exploration had pushed the camera into chunk −1. | **P1** | Fixed: preload emits when it adds chunks; renderers re-read on subscribe. |
| F2 | Unbounded chunk growth from preloads | `InfiniteCosmos.preloadAround` | Preloads never unloaded; only camera boundary crossings pruned. | Each preload away from the camera added 343 chunks (~4k stars) that stayed until the next boundary crossing. | P2 | Fixed: hard cap `1331 + 343`. Farthest-from-camera chunks are evicted first; the camera's own ring never is. |
| F3 | Render data rebuilt 4× per change | `InfiniteCosmos.getRenderableData` + 4 subscribers in CosmosLayer | Each subscriber flattened every chunk on every emit. | Redundant work on every chunk crossing. | P3 | Fixed: one cached snapshot per change, shared by reference. |
| F4 | Star field rebuilt every frame; stale culling sphere | `CosmosLayer.tsx` `InfiniteStarField` | Each frame allocated 2 `Float32Array`s, 2 `BufferAttribute`s and a `Color` per star, re-uploading static positions. `setAttribute` never resets `boundingSphere` (three.js `BufferGeometry.setAttribute`), so the sphere computed on the first frame stayed in use. | GC churn and GPU re-upload every frame. After travelling far from the origin, three culls the whole field against the origin-centred sphere. | P2 | Fixed: buffers built per data change, bounding sphere recomputed with them, twinkle written in place. |
| F5 | Detailed meshes picked in insertion order | `CosmosLayer.tsx` galaxies / nebulae / black holes `slice(0, N)` | First N in Map order means the oldest loaded chunks. | After exploring, the mesh budget went to regions behind the camera while new regions showed none. | P2 | Fixed: nearest-to-camera selection, re-evaluated per chunk change. |
| N1 | Navigation reached the highlight, not the camera | `cosmos/CosmosRooms3D.tsx`, `core/workspace/WorkspaceAPI.ts`, `cosmos/CosmosWorkspacePanel.tsx`, `core/cosmos/CosmosTools.ts` | Only a click on a 3D ring called `flyTo`. A panel row or LÉLU's `cosmos.workspace` "navigate" updated `CosmosNavigation.currentId` but nothing moved the camera. | A cognition-driven navigation looked connected (ring highlighted) but wasn't functionally connected. Browser before-run: camera off by 13–18 units at every size. | **P1** | Fixed: CosmosRooms3D, already subscribed to CosmosNavigation, flies the camera when `currentId` changes. It doesn't fly on load (restored position). Core returns to the Genesis view. |
| N2 | Competing camera flights | `GenesisCameraController.tsx` `flyCameraTo` (callers: `cosmos-navigate`, `planet-navigate`, spatial `fly` intent) | Each call started its own rAF loop and nothing cancelled the previous one. | Two navigations in quick succession had two loops lerping one camera toward different targets. A user drag didn't stop a flight in progress (the header promises "user camera control always wins"). | P1 | Fixed in `cameraFlight.ts`: one flight at a time; stops when `cameraOwner()` becomes `"user"`. A cinematic claim (LÉLU) does not stop it. |
| N3 | Ambient exploration overrode deliberate navigation | `ExplorationController.ts` (waypoints every 8–14 s via `planet-navigate`, enabled by GenesisPresenceEngine) vs Cosmos navigation | Cosmos navigation never claimed the camera, so the ambient waypoint cycle kept running. | The camera flew away from the destination you asked for within seconds. Browser: phone/tablet ended at the ExplorationController waypoints (0, 3.5, 8) and (−3, 1.5, 7). | P1 | Fixed with the existing mechanism: `__cosmosCamera.navigateTo` / `resetToGenesis` call `claimCinematicCamera()`. ExplorationController and the presence engine already pause on it; the claim ends when the user takes the camera. |
| C7 | Competing responsive breakpoints | `core/ui/Workspace.ts` (container-measured, 640 / 1024) vs 17 `window.innerWidth` reads at 720 / 768 / 900 (SpatialNavigator, LivingSystemUI, GenesisVisualStudio, GenesisScene, InterfaceSceneLayer, InterfaceConsentBar, GenesisCore, GenesisInterface …) | Newer surfaces read the window directly instead of `useWorkspace()`. | In a constrained container (embedded workspace) these surfaces decide on the browser width, not the container. Thresholds disagree between 640 and 720. | P2 | **Deferred.** Changing it moves the phone Chat/Cosmos thresholds, which currently work, and the layout harnesses that would catch a regression are stale (C8). Recommended: route these 17 reads through `useWorkspace().size` in a dedicated pass with a fixed layout harness. |
| C8 | Stale browser harnesses | `scripts/verify-workspace-layout.mjs`, `scripts/verify-mobile-chat.mjs` | Both open the old chat panel via `[data-lelu-composer]`, removed from rendering in 3cf78fd5. | Baseline on untouched HEAD: layout 23 pass / 7 fail ("chat did not open"); mobile-chat aborts at "chat is shown". Same results before and after this pass. | P2 (tooling) | **Deferred**, isolated as pre-existing. The new harness covers the Chat Universe path for this mission's checks. |
| C9 | `?perf-world` only half-works in a GPU-less container | `GenesisScene.tsx` paintWorld; `SceneRenderManager` "light" profile | The flag lifts the software-GL guard, but the manager still picks "light" from the renderer string and from measured fps. | Dev measurement only; no user impact. | P3 | Deferred; the harness works around it (see E). |

Checked, no clash found:
- **Canvas ownership.** One Genesis canvas; V1 / System / V2 are mutually exclusive in GenesisWorkspaceRouter. CosmosLayer is "NOT a separate Canvas" and lives inside it. LÉLU's companion figure has its own small canvas by design.
- **Stores.** CosmosStore draws runtime entities. CosmosNavigation owns "where you are". CosmosFocus holds a reference only. SpatialObjects are pointers. CosmosLiveMap syncs with stable ids. These are layered, not competing.
- **Frame loop.** One budget authority: SceneRenderBudget → `useSceneFrameloop` → the `<Canvas>` prop.
- **Hidden-surface rendering.** The phone Chat Universe unmounts the world (`surface.cosmosRendered`); a covered world is occluded through the budget.
- **Unmount cleanup.** All new subscriptions return their unsubscribe; the replaced geometry is disposed.

## C. Integration map (after)

```
LÉLU tool "cosmos.workspace" ─┐
CosmosWorkspacePanel row ─────┼─► WorkspaceAPI.execute({navigate}) ─► CosmosAutonomy (green) ─► CosmosNavigation.navigateTo
3D DestinationRing tap ───────┘                                                               │ notify
                                                                                              ▼
                          CosmosRooms3D (subscribed) ── currentId changed ──► __cosmosCamera.navigateTo / resetToGenesis
                                                                              │ claimCinematicCamera() ─► ExplorationController.stopAll,
                                                                              │                            presence engine pause
                                                                              ▼ "cosmos-navigate"
GenesisCosmosPanel minimap ──► __cosmosCamera.navigateTo ──►  GenesisCameraController ─► cameraFlight.flyCameraTo (one at a time;
planet-navigate / spatial fly ───────────────────────────────►        (OrbitControls)       user drag ⇒ cameraOwner "user" ⇒ stop)
                                                                              │
                                                       InfiniteCosmosTracker (useFrame) ─► InfiniteCosmos.updateCameraPosition
                                                                              │ chunk crossed ⇒ ensureAround + unloadFar + cap ⇒ emit
CosmosLayer mount ─► preloadAround(0,0,0) ⇒ emit ─────────────────────────────┤
                                                                              ▼
                                  getRenderableData() (one cached snapshot) ─► StarField (buffers per change) · Galaxies/Nebulae/BlackHoles (nearest N)
                                                                              └► GenesisCosmosPanel stats
AgentEventBus "tool cosmos" ─► GenesisSurfaceController ─► openPanel("cosmos")
Surface (useSurface) ─► GenesisWorkspaceRouter: phone Chat Universe ⇒ world unmounted; Home ⇒ world remounts (engine singleton keeps its chunks)
```

Remaining disconnected paths:
- A navigation made while the world is unmounted (phone chat open) moves `currentId` but no camera, because no scene exists. On return Home the camera restores its remembered pose, not the room. That's acceptable but noted.
- `InterfaceRuntime.applyCamera` (layout restore) dispatches `cosmos-navigate` directly, without a claim. That's intentional for restore.

## D. Implementation report

| File | Change | Finding |
|---|---|---|
| `src/app/scene/genesis/engines/InfiniteCosmos.ts` | `ensureAround` / `unloadFar` / `enforceCap` replace the duplicated loops. `preloadAround` emits when it adds chunks and respects the cap. Render snapshot cached per change. `lastAccessed` maintained. `clear()` and `getMaxLoadedChunks()` added. Generation, chunk size, radii and seeds unchanged, so coordinates stay deterministic. | F1 F2 F3 |
| `src/app/scene/genesis/cosmos/CosmosLayer.tsx` | Shared `useInfiniteCosmosData` hook. Star field buffers built per data change, with bounding sphere recomputed and in-place twinkle. Nearest-to-camera selection for detailed meshes. `__cosmosCamera` claims the camera. | F1 F4 F5 N3 |
| `src/app/scene/genesis/cosmos/CosmosRooms3D.tsx` | Flies the camera when `CosmosNavigation.currentId` changes (all three navigation sources). A ring tap no longer double-flies. | N1 |
| `src/app/scene/genesis/cameraFlight.ts` (new, 90 lines) | `flyCameraTo` moved verbatim from the controller, plus single-flight and user-wins rules. Injected frame clock for tests. | N2 |
| `src/app/scene/genesis/GenesisCameraController.tsx` | Uses `cameraFlight.flyCameraTo`; local copy removed. | N2 |
| `tests/infinite-cosmos.test.ts` (new) | 8 tests: first preload emits; no-op preload silent; determinism after unload; unique ids/chunks; streaming into new regions; cap under walk and preloads; shared snapshot; intra-chunk moves silent. **3 of 8 failed on the original engine.** | F1–F3 |
| `tests/camera-flight.test.ts` (new) | 4 tests: arrival; newer flight supersedes (exactly one loop alive); user grab stops in place; cinematic claim doesn't stop. | N2 |
| `scripts/verify-cosmos-integration.mjs` (new) | Browser harness, phone / tablet / desktop (below). | all |

No dependency, framework, store, registry, canvas, frame loop or event channel was added. No Supabase, credentials, production data or deployment were touched.

## E. Verification evidence

| Gate | Result |
|---|---|
| Typecheck `tsc -b --force` | 0 errors, before and after |
| Lint `oxlint` | 0 errors, 179 warnings, before and after (no new warnings; touched files clean) |
| Build `vite build` | success (8.7 s) |
| `verify:bundle` | PASS, no test files in dist (1519 files) |
| New unit tests | 12/12 pass |
| Cosmos / layout / genesis unit tests (19 files) | 143/143 pass before the changes (baseline) |
| Full suite `npm test` | **2310 tests: 2304 pass, 0 fail, 6 skipped** (clean run, tree untouched during it; `test-suite.txt`) |

**Browser (`scripts/verify-cosmos-integration.mjs`, Chromium + SwiftShader in this container).** About this environment: with no GPU, the app correctly refuses to paint the world. So the harness reports a hardware GL renderer string and switches off the render manager's fps downgrade on its singleton. That makes the real scene path run (CosmosLayer, tracker, flights) on a CPU rasteriser at about 1 fps.

| Check | Before (original code) | After |
|---|---|---|
| Scene canvas on Home, phone / tablet / desktop | pass | pass |
| Sky populated at first paint | **tablet: 0 stars, 0 chunks**; phone/desktop only after the camera left chunk 0 | pass ×3 (1716 stars / 343 chunks at chunk 0,0,0) |
| LÉLU `navigate` (actor "lelu", same path as the tool) reaches the destination | **fail ×3** (off by 13–18.5 units) | pass ×3 (off by 0.000 / 0.028 / 0.233) |
| Navigate to core returns to the Genesis view (0, 0, 6.8) | **fail ×3** | pass ×3 |
| New region generated far away; left region released; revisit identical; cap held (max 875 / 1674) | crashed (no cap API) | pass |
| Phone: Chat Universe composer up and accepts typing; **no Cosmos canvas mounted under it** (only the 100 px companion canvas) | pass | pass |
| Phone: going Home remounts the world and it draws (frames 3 → 13); sky still populated | pass | pass |
| No fatal page errors | pass | pass |

After: **30/30** (`browser-after.txt`). The tablet slot failed once in a run that also took perf samples: the lazily loaded CosmosLayer never mounted within 60 s. The before-run failed at the same step. Tablet alone passed twice (7/7, `browser-after-tablet-reruns.txt`). That's main-thread starvation at about 1 fps, not a defect.

**Performance (honest scope).**
- Desktop whole page, 3 runs each, 15 s samples on SwiftShader: after 0.42 / 0.78 / 0.66 fps, before 0.65 / 0.58 / 0.52 fps. Rasterisation (~1.4 s per frame) dominates, so this shows **no regression**, not an improvement. Heap growth per 15 s: after 12.7 / 38 / 9.4 MB, before 34.9 / 49.5 / 103.3 MB. That's consistent with fewer per-frame allocations but noisy.
- Star-field per-frame work, Node + real three.js, 1716 stars: CPU time within noise (0.186 vs 0.156 ms idle; 0.199 vs 0.199 ms under load). Structurally, zero per-frame allocations instead of ~1720, and half the GPU re-upload (colours only).
- **Not tested:** any real GPU, any physical phone or tablet, real-device frame rates.

## F. Final status

| Objective | Status |
|---|---|
| Historical components recovered and accounted for | VERIFIED |
| Existing architecture preserved; no duplicate authority | VERIFIED (code review + unchanged canvas/store/loop topology) |
| UI Universe loads without layout conflicts | PARTIALLY VERIFIED: loads and no overflow at 3 sizes; the overlap checks in `verify:layout` are blocked by its stale composer selector (C8, pre-existing) |
| Workspace responds to container resizing / panels inside workspace | PARTIALLY VERIFIED: `verify:layout` container checks pass (root accepts 420 px; controls stay inside), unchanged by this pass; C7 deferred |
| Surface transitions | VERIFIED (phone Home → Chat Universe → Home) |
| Cosmos loads from its entry point | VERIFIED |
| Entities and spatial objects synchronized | VERIFIED for navigation state ↔ 3D rings ↔ camera; CosmosStore ↔ runtime unchanged (existing tests pass) |
| Camera navigation reaches selected entities | VERIFIED (browser, 3 sizes) |
| Infinite Cosmos generates new regions | VERIFIED (unit + browser) |
| Coordinates deterministic | VERIFIED (unit + browser) |
| Chunk cleanup and resource limits | VERIFIED (unit + browser) |
| Genesis / Cosmos lifecycle connections | VERIFIED: unchanged; world remount after chat keeps the engine's chunks |
| Cognition-driven UI commands reach surfaces | VERIFIED for `cosmos.workspace` navigate → camera (via WorkspaceAPI with actor "lelu"; the model call itself not exercised) |
| Phone chat without a 3D scene underneath | VERIFIED |
| Returning Home restores Cosmos | VERIFIED |
| No duplicate loops / stores / subscriptions introduced | VERIFIED (unit test: exactly one flight loop alive; code review) |
| Performance regressions not introduced | PARTIALLY VERIFIED: SwiftShader only, no regression observed; real GPU NOT TESTED |
| Unified breakpoints (C7) | NOT DONE: deferred, P2 |
