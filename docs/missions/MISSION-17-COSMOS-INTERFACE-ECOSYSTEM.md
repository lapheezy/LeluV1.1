# LÉLU V1.1 — Mission 17: Cosmos Evolution — the Interface Ecosystem, LÉLU's Room, Legacy UIs

**Branch:** `claude/intelligent-lovelace-5l7zoz`
**Statuses:** VERIFIED (exercised in the real app UI by `scripts/cosmos/verify-interfaces.mjs`) · PARTIAL · BLOCKED · FAILED · NOT STARTED · PROPOSED.
A unit test is never counted as proof of a user-facing feature.

> This mission is additive. Mission 15 (Home Universe, and Codebuff's Generalized Creative Engine) and Mission 16 (Cosmos Object Ecosystem, plus the Fashion/Textile work referenced by the brief) are untouched. No previous mission document was edited.

---

## 1. Starting point

| Item | Finding |
|---|---|
| Branch tip at start | `8101ec2` (Codebuff — Mission 16 Cosmos objects) |
| Latest **Claude** commit | `fe0cc0d` on `origin/claude/beautiful-euler-m3v9i5` (Mission 15 Home Universe), diverged from the tip |
| Merge | `6574ea7` — one conflict in `src/core/router/DirectResolver.ts`: both sides added a "done locally" preface. Kept both (Cosmos-object plans and workspace plans each keep their wording). Typecheck clean; 66/66 related tests. |
| Package manager | bun (`bun.lock` canonical; `package-lock.json` is stale, `npm ci` fails — not touched) |

## 2. Phase 1 — inventory (what exists, what was reused)

| Brief name | Real implementation | State found | Mission 17 |
|---|---|---|---|
| Original LÉLU UI | `src/og/*` — **Inner Sky** (`/og/app`, AppShell: Home, Chats, Agents, Memory Garden, Files, Projects, Action queue, Settings) and **Core** (`/og/core`) | Working standalone routes; same AIService via `og/compat/chat.ts` | Reused unchanged; made embeddable through the compat router |
| Genesis V1 | The Cosmos world — `GenesisScene.tsx` `GenesisV1Workspace` + `GenesisController` | Primary experience | Reused; shown *through* a composition region, never duplicated |
| Genesis V2 | `GenesisLab.tsx` + `GenesisV2Scene3D.tsx` (Core, Creation Studio, Research Lab, Vault; Core Evolution) | Reached as "Her world" in Worlds and "Genesis V2" in the library | **LÉLU's Room** — same component, renamed in Worlds and the catalog |
| Neural heartbeat / System UI | `LivingSystemUI.tsx` + `LivingSystemVisuals.tsx` (Heartbeat, Matrix, Nerve, Neuron, Core) | Reached as "System" in Worlds | Moved to **Infinite Library → Legacy UIs**; gained an `embedded` prop |
| Infinite Library | Did **not** exist on any branch (searched all remotes). Closest: the Home's **App Library** sheet (`home/HomeSheets.tsx`) | — | The App Library **became** the Infinite Library (no second library) |
| Visual editing engine | `core/interface/InterfaceOrchestrator.ts` + `InterfaceTools.ts` (`interface.inspect/propose/revert/themes/recommend`, consent-gated) | Exists | Not duplicated; composition tools use distinct ids |
| Window/layout runtime | `GenesisModuleHost`, `ModuleLayoutStore`, `WorkspaceSteward`, Mission 15 `homeComposition` | Exists | Untouched |
| Tool runtime | `ToolRegistry` / `ToolDispatcher.registerExecutor` | Exists | Used for the three new tools |
| Persistence | `core/storage/KvStore` | Exists | Used (key `lelu.interfaces.compositions.v1`) |
| Render budget | `SceneRenderBudget` (global), surface gate in `GenesisWorkspaceRouter` | Exists | Router gate extended; no new loop |

## 3. Phase 2 — architecture

```
InterfaceCatalog (pure)          5 real interfaces, each: standalone entry, source path, identity, webgl flag
interfaceComposition (pure)      regions = references to catalog ids; clone/fork/merge/split/variants/edits;
                                 liveRegions(): ≤1 WebGL region live, everything off-screen unmounted
InterfaceCompositionStore        the one owner; KvStore; built-ins read-only (edits fork); undo ×20; trash/restore
interfaceLaunch                  one launcher attached by the shell; tools fail honestly without it
InterfaceCompositionTools        interface.list · interface.open · interface.compose  (registerExecutor)
genesis/interfaces/
  InterfaceShell (lazy, 1.2 KB)  attaches launcher, ?interface= / ?composition= deep links, mounts the view
  InterfaceJourney (lazy, 11.9 KB) the continuous view: jump bar, seams, edit drawer, alternatives, clone, Talk
  InterfaceRegion                mounts the REAL component: GenesisLab · LivingSystemUI embedded · OgEmbedded
  interfaceActions               open = existing mechanisms (openPanel, VisualEngine focus, navigate, goHome)
home/LibraryInterfaces           Infinite Library sections: Cosmos · Legacy UIs · Compositions · Recently removed
```

Key decisions:

- **Composing never copies an interface.** A region is a pointer to a catalog id plus presentation. That is what makes "customise without destroying the source", independent clones and recursive composition true by construction.
- **Full-screen scenes fit a region unchanged.** The region body is `transform: translateZ(0); contain: layout paint`, which makes it the containing block for the scenes' `position: fixed; inset: 0`. Not a line of GenesisLab or the OG pages changed.
- **No second Cosmos.** The Cosmos region is transparent: it shows the one world the scene router already draws. The router unmounts the world while an opaque region is current (`compositionCoversWorld`) — the same pattern used when chat owns a phone screen — and the Core, cognition and engine tick carry on.
- **OG navigates inside its region.** `og/compat/router.tsx` gained an `OgEmbedContext`; `Link`, `useNavigate` and `useRouterState` consult it. Inside a composition, "Chats" changes the region, not the app URL. The OG sources are untouched.
- **One runtime.** Every region is mounted in the same React tree under the same `GenesisCore`; no iframes, no second AIService, no second chat store (verified: conversation count unchanged when Talk opens the chat over a composition).

## 4. Phase 3 — dependencies

**No dependency was added.** No external API, key, hosted service or network call was introduced; every new module works offline (KvStore + in-tree components).

| Candidate (brief §2) | Decision | Reason |
|---|---|---|
| three / @react-three/fiber | Reuse (already installed) | Room and Cosmos already render with them; no new renderer |
| @excalidraw/excalidraw | Already installed (Sketch) | Not needed for this slice |
| react-grid-layout, react-resizable-panels | Reject here | Mission 15 already rejected RGL with measurements; the composition is a scroller, not a grid |
| @tanstack/react-virtual | Reject here | ≤ a few dozen regions; IntersectionObserver + unmount gives the same memory bound with zero bytes |
| react-zoom-pan-pinch, Phaser, Tone.js, chess.js, pdf.js, ECharts, Transformers.js, Konva/Fabric, xyflow/dagre | Not evaluated in this slice | Their features (games, music, PDF, Neural Map graph, local vision) are NOT STARTED — see §7 |
| tldraw | Reject | Not permissively licensed for production |
| Playwright | Dev/verification only | Pre-installed; not a runtime dependency |

## 5. Real-UI verification — `node scripts/cosmos/verify-interfaces.mjs`

Result: **36/36 VERIFIED** (desktop 1440×900 + iPhone 15 Pro emulation, Chromium/SwiftShader). Evidence: `docs/missions/m17-cosmos/verify-interfaces.json`, screenshots `docs/missions/m17-cosmos/shots/01…34-*.png`.

| # | Acceptance item | Status | Shot |
|---|---|---|---|
| A1 | Infinite Library lists Cosmos, Legacy UIs, Compositions | VERIFIED | 02, 03 |
| A2 | Legacy UIs → LÉLU System UI launches the real component | VERIFIED | 04 |
| A3 | All five System modes (Heartbeat, Matrix, Nerve, Neuron, Core) | VERIFIED | 05–09 |
| A4 | Return from System UI to the Cosmos | VERIFIED | 10 |
| A5 | Worlds: Genesis V2 is "LÉLU's Room"; System is no longer a world | VERIFIED | 11 |
| A6 | LÉLU's Room opens on its own | VERIFIED | 12 |
| A7 | Standalone deep link `?interface=lelu-system` | VERIFIED | 13 |
| A8 | Original LÉLU launches independently (`/og/app`) | VERIFIED | 14 |
| A9 | Compose Original LÉLU + LÉLU's Room from the library | VERIFIED | 15, 16 |
| A10 | Original LÉLU keeps working inside its region; app URL unchanged | VERIFIED | 17 |
| A11 | Mouse-wheel scroll continuously from Original LÉLU into the Room (live Genesis V2) | VERIFIED | 18 |
| A12 | "One LÉLU": Inner Sky → Room → Cosmos → System → Core in one space | VERIFIED | 19–23 |
| A13 | World unmounted behind opaque regions; shown through the Cosmos region; Room unmounted there | VERIFIED | 20–23 |
| A14 | Customising a built-in forks a copy; the source is unchanged | VERIFIED | 24, 25 |
| A15 | Clone with lineage | VERIFIED | 26 |
| A16 | Four alternative arrangements; cinematic (horizontal) opens | VERIFIED | 27, 28 |
| A17 | Shared chat opens over the composition (same chat store) | VERIFIED | 29 |
| A18 | Compositions persist across reload | VERIFIED | 30 |
| A19 | iPhone: library, composition, scroll into the Room, world unmounted | VERIFIED | 31–34 |
| A20 | No new page errors | VERIFIED (excluding pre-existing: optional-service connection refusals; the curiosity engine's arxiv fetch blocked by CORS) | — |

Brief §14.11 mapping: 1 → A8 · 2 → A6 · 3 → A1/A2/A9 · 4 → A9/A12 · 5 → A11/A19 · 6 → A12 · 7 → A10/A3 · 8 → A14 · 9 → A15 · 10 → A16 · 11 → A6/A8/A7 · 12 → A17 (chat store) — **agents/memory sharing is by construction (same tree, same singletons), not separately exercised.**

Unit tests: `tests/interface-composition.test.ts` (10, rules only). Full suite: **2249 pass, 0 fail, 6 skipped** after updating one source-shape pin in `tests/chat-surface.test.ts` (the CosmosOverview gate now also requires `!compositionOpen`) and one label pin in `tests/genesis-interface.test.tsx` ("Infinite Library").

## 6. Performance

| Measure | Value |
|---|---|
| Entry chunk (`index-*.js`) | 394.05 → 407.77 KB raw (+13.7 KB); 122.81 → 127.09 KB gzip (**+4.3 KB**) — the router reads the composition store synchronously |
| InterfaceShell chunk | 1.24 KB (0.65 gzip), lazy |
| InterfaceJourney chunk | 11.90 KB (3.77 gzip), fetched only when a composition opens |
| Live regions | current region + visible DOM-only neighbours; **≤ 1 WebGL region**; off-screen regions unmounted |
| Canvases while composing (measured) | Room current: 2 (Room + companion avatar), world 0 · System: 1 · Cosmos: world's own 2 + avatar |

Not measured: frame rate on a real iPhone (no device in this container; SwiftShader numbers are not meaningful).

## 7. Status of the wider Mission 17 vision (honest)

| Area (brief §) | Status | Notes |
|---|---|---|
| Original LÉLU + Genesis V2 + System as native, standalone, composable interfaces (§14) | **VERIFIED** (see §5) | |
| LÉLU's Room in the Cosmos (addendum §1) | **PARTIAL** | Same GenesisLab, same Core/runtime, reachable from Worlds, Library, deep link and compositions. **Inside a composition region her companion avatar does not enter the room** (LeluCompanion keys "in world" off `activeScene === "genesisv2"`); she stays in companion mode. Standalone Room behaves exactly as before. |
| Infinite Library → Legacy UIs → System UI (addendum §2) | **VERIFIED** | |
| Unified interface menu (§14.4) | **VERIFIED** for interfaces + compositions + apps in one Library | Gardens/games/music listed only once those experiences exist |
| Continuous composition, 2D (§14.5–14.7) | **VERIFIED** vertical + horizontal, jump, bookmarks, return position | Nesting one interface *inside* another, branching journeys: NOT STARTED |
| Composition in 3D space (portals between regions in the 3D Cosmos) | NOT STARTED | Seams are 2D ("portal" seam is a visual) |
| Composition engine — merge / split / clone / variants / undo / trash / lineage (§13) | **PARTIAL** | All exist and are unit-tested; clone + variants + fork are UI-verified; merge/split/undo/trash are in the edit drawer but not yet exercised by the script |
| Tools (`interface.list/open/compose`) | **PARTIAL** | Registered through `registerExecutor`; unit-tested incl. honest failure without a shell. Not yet exercised from a live chat turn. |
| Canonical Cosmos entity mapping / Neural Map of real agents (§3–4) | NOT STARTED in this slice | Existing `CosmosLiveMap` / `CosmosEntityRegistry` untouched |
| Environment engine (ocean, jungle, brain…) (§5) | NOT STARTED | Existing `core/interface/Environments.ts` + `EnvironmentLibrary` are the place to extend |
| Heartbeat wired to real runtime events (§6) | Existing behaviour only | The System UI already reads VisualEngine signals; not re-audited here |
| Object-to-interface, Experience engine, Forge, Contextual Cosmos (§7, 8, 10, 12) | NOT STARTED | |
| Universal visual editing (§9) | Existing `InterfaceOrchestrator` (consent-gated) — not extended | |
| Independent universes / synchronisation (§15–16) | NOT STARTED | Compositions are presentation-only and cannot mutate canonical state by construction |

## 8. Fixes found on the way

- **Infinite/App Library taps fell through to the Home** (pre-existing). The sheet inherited `pointer-events: none` from the interface root; on desktop every tap over a Home card hit the card. Fixed in `spatialNav.css` (`.lsh-backdrop { pointer-events: auto }`).
- **Scroll-snap fought continuous scrolling.** `proximity` snapping pulled each wheel step back to the region start; removed (measured by A11).

## 9. Known limitations

- **Pre-existing:** at 1440 px the "Spatial" control strip (SpatialNavigator) covers the nav bar's **Worlds** button, so a pointer cannot reach it; the script records this as a separate, pre-existing FAILED item and presses the button via the DOM. Not fixed here (it is the spatial rail's layout, outside this mission).
- 3D regions: a mouse wheel over the Room's canvas may be used by the scene; the region bar, seams and jump bar always scroll.
- OG code that calls `navigate()` to `/` inside a region returns the region to its start rather than leaving it.
- A composition opened from a deep link uses the built-in ids (`one-lelu`, `original-and-room`, `room-and-cosmos`) or a saved id on this device; compositions are local (KvStore), not synced.
- In vite dev only, the first visit to `/og/*` can be blank while Vite re-optimises dependencies; the script allows for one reload (it was not needed in the final run).

## 10. Files

New: `src/core/interface/{InterfaceCatalog,interfaceComposition,InterfaceCompositionStore,interfaceLaunch,InterfaceCompositionTools}.ts`, `src/app/scene/genesis/interfaces/{InterfaceShell,InterfaceJourney,InterfaceRegion,interfaceActions,useInterfaceCompositions}.ts(x)` + `interfaceJourney.css`, `src/app/scene/genesis/home/LibraryInterfaces.tsx`, `tests/interface-composition.test.ts`, `scripts/cosmos/verify-interfaces.mjs`.
Changed: `GenesisScene.tsx` (shell mount, world gate, overview gate), `LivingSystemUI.tsx` (`embedded`), `og/OgRoutes.tsx` (route table + `OgEmbedded`), `og/compat/router.tsx` (embed context), `home/HomeSheets.tsx` (Infinite Library, Worlds), `home/SpatialNav.tsx`, `home/HomeModules.tsx`, `home/homeCatalog.ts`, `home/homeComposition.ts`, `home/spatialNav.css`, `core/Bootstrap.ts`, two test pins.
