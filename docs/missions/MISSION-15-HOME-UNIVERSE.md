# LÉLU V1.1 — Mission 15: Home Universe

**Branch:** `claude/beautiful-euler-m3v9i5`

**Statuses used:** VERIFIED · PARTIAL · BLOCKED · FAILED · NOT STARTED · PROPOSED. A passing unit test is never counted as proof of a user-facing feature; every VERIFIED feature below was exercised through the real UI by `scripts/home/verify-home.mjs`.

> **Naming note.** `docs/missions/MISSION-15-GENERALIZED-CREATIVE-ENGINE.md` (Codebuff, `2513e90`/`a4f5df3`) is a *different* mission that also used the number 15. This document is the Home Universe mission. Neither file was changed by the other.

---

## 1. Repository and worktree reconnaissance (Phase 0)

| Item | Finding |
|---|---|
| Repository root | `/home/user/LeluV1.1` (a fresh cloud clone; the user's own machine was not available, so "local" here means this container's checkout) |
| Package manager | **bun** — `bun.lock` is canonical (CI runs `bun install --frozen-lockfile`). `package-lock.json` is **stale**: `npm ci` fails (missing `livekit-client`, `livekit-server-sdk`, `mediabunny`, `@types/dom-mediacapture-record`). It was not touched. |
| Start state | Branch `claude/beautiful-euler-m3v9i5` at `a4f5df3`, identical to `integration/lelu-four-workforce-consolidation`; working tree clean; one worktree. |
| Latest Claude work | `origin/claude/chat-universe-evolution-skidcz` @ `5a02ef8` (35 commits ahead, newest Claude commit) and `origin/integration/lelu-master-integration` @ `fc0169c` (8 commits not in skidcz). |
| Merges made | `4f1afeb` merged skidcz (clean). `9c30176` merged master-integration (3 conflicts). |
| Merge conflicts | **Evolution Trail** `trail.json`: kept both checkpoint sets and renumbered master-integration's to 17–23. **`StudioArtifactCards.tsx`**: took master-integration's lazy editors + `EmbedBoundary` (a superset). **`UniverseChatWindow.tsx`**: comment-only. |
| Semantic merge conflict | Found by the full suite and fixed in this mission (see §9): skidcz `015afda` vs master-integration `b0e7e78` on "make the chat a diagram board". |
| Not merged | `freebuff/8994d7c` (Mission 14 continuity, Freebuff), `freebuff/44c122e` (already reconciled in skidcz as superseded), and older `claude/*` branches (ancestors via squash/reconcile histories). The instruction was the latest **Claude** commit. |
| Build / test | `bun run build` = `tsc -b && vite build`. `npm test` = node test runner via tsx. `npx oxlint`. Browser checks use Playwright + `/opt/pw-browsers/chromium`. |
| Baseline tests (merged tree, before Home work) | 2222 tests: 2215 pass, **1 fail** (the merge conflict above), 6 skipped. |

"Mission 14 Workspace Runtime" does not exist under that name in this repository. The workspace runtime that exists, and that this mission reuses, is the Workspace Steward + module layout from the merged Claude branch (`core/interface/WorkspaceSteward.ts`, `layout/moduleLayout.ts`). "Mission 14" in the history is Freebuff's continuity work (unmerged branch) and the engine referred to in Codebuff's Mission 15 doc.

## 2. Ownership and reuse map

| Concern | Canonical owner (file) | Mission 15 |
|---|---|---|
| Home view shell | `genesis/home/CosmosHome.tsx` | **Adapted**: header + edit bar; the body is now a composition |
| Home modules | `genesis/home/HomeModules.tsx` | **New file, moved code**: the eight existing sections, unchanged in content, as components |
| Home composition rules | `genesis/home/homeComposition.ts` | **New** (pure): templates, profiles, solver, ops, snap |
| Home composition view | `genesis/home/HomeComposition.tsx` + `homeComposition.css` | **New**: renderer + edit chrome |
| Home state + persistence | `genesis/home/homeStore.ts` (`HomeStore`) over `core/storage/KvStore` | **Extended**: presentations, undo/redo, restore point. Key `lelu.home.presentations.v1`. Still the one owner. |
| App window geometry | `genesis/layout/moduleLayout.ts` + `ModuleLayoutStore` (`lelu.layout.v2`) | **Untouched**, reused through `launch()` |
| Screen-sharing policy | `core/interface/WorkspaceSteward.ts` over `SpatialModel.planWindows` | **Untouched** except the merge fix (§9) |
| Interface proposals / consent | `core/interface/InterfaceOrchestrator.ts` | Untouched |
| Panels and windows | `GenesisCore.openPanel`, `GenesisModuleHost`, `home/homeActions.launch` | **Reused** for "Open as a window" |
| Chat Universe | `chat/universe/ChatUniverse.tsx` (`lelu-open-universe`) | **Reused** for the Chat Universe hand-off |
| Spatial scene graph | `core/spatial/SpatialIntentBus`, `placeInWorld`, `SpatialRevealIntent` | **Reused** for "Place in the Cosmos" |
| Cosmos renderer | `genesis/cosmos/*`, R3F canvas | Untouched; no new renderer |
| LÉLU avatar placement | `avatar/LeluCompanion` + `presencePlacement` (reads `[data-lelu-hero-host]`) | Untouched; the LÉLU module keeps the one hero host |
| Z-order | `core/ui/Layers` | The studio uses `modal` (600) |
| Spatial nav | `genesis/home/SpatialNav.tsx` | **Fixed**: orb swipe/hold misfire (§9) |

No second store, window manager, renderer, scene graph or persistence layer was created.

## 3. Free technology research (Phase 1)

All values come from the npm registry (`registry.npmjs.org/<pkg>`), queried on 2026-11-15. Bundle sizes were **not** measured for packages that were not installed; the size column is the registry's unpacked size.

| Package | Version | License | Runtime deps | Unpacked | Last publish | Verdict | Reason |
|---|---|---|---|---|---|---|---|
| react-grid-layout | 2.3.0 | MIT | clsx, prop-types, fast-equals, react-draggable, react-resizable, resize-observer-polyfill | 479 KB | 2026-10-05 | **REJECT** | Six extra deps for grid drag/resize; the engine solves bento/masonry/split in a few dozen lines each; RGL can't do orbit, spatial, deck or freeform. |
| gridstack | 14.1.0 | MIT | none | 2.2 MB | 2026-11-04 | **REJECT** | Large, imperative DOM ownership that conflicts with React rendering of live modules; same coverage gap as RGL. |
| dockview / dockview-core | 8.9.0 | MIT | dockview-core | 1.7 MB + 5.8 MB | 2026-11-08 | **REJECT** | An IDE docking manager would be a second window manager next to `GenesisModuleHost` + `ModuleLayoutStore`. Nothing was adopted, so nothing depends on any paid tier. Whether Dockview has an enterprise tier was **not verified** here. |
| muuri | 0.9.5 | MIT | none | 1.0 MB | **2021-07-09** | **REJECT** | Unmaintained for over five years; native CSS Grid `dense` + the masonry solver cover the gallery. |
| interactjs | 1.10.28 | MIT | @interactjs/types | 1.4 MB | 2026-08-01 | **REJECT (for now)** | Pointer Events + `touch-action` on the handle were enough: drag, float, resize and touch-drag are VERIFIED. Revisit only for inertia or multi-touch resize. |
| motion | 14.14.0 | MIT | tslib, framer-motion | 1.0 MB | 2026-11-13 | **REUSE existing** | The repo already ships `framer-motion ^12.42.2`. Mission 15 uses CSS transitions only, so motion costs nothing and respects `prefers-reduced-motion`. |
| Three.js / R3F | repo `three ^0.185.1`, `@react-three/fiber ^9.6.1` | MIT | — | — | — | **KEEP** | The Cosmos; Home hands modules to it via `placeInWorld`. |
| Native CSS Grid, container queries, Pointer Events, ResizeObserver, `createPortal` | — | — | — | 0 | — | **ADD (as practice)** | Everything the mission needed. |

**Result: 0 dependencies added.** No API keys, accounts, trials or paid features are used anywhere in Mission 15.

## 4. Sixty-concept research catalog (Phase 2)

See **[`m15-home/CONCEPTS.md`](m15-home/CONCEPTS.md)**. Every concept lists composition, positioning, hierarchy, navigation, input, mobile/desktop behaviour, strengths and weaknesses, accessibility, performance risk, complexity, references and a recommendation.

References are labelled *Product* (an existing product, described from general knowledge, not re-verified this session) or *Original* (a LÉLU concept).

Totals: 11 BUILT, 21 SUPPORTED/KEEP/EXISTING, 15 PROPOSED, 12 REJECT, 1 BLOCKED.

## 5. Twelve working prototypes (Phase 3) — VERIFIED

Each prototype is a `HomeTemplate` in `homeComposition.ts`, rendered by the **real** `HomeComposition` with the **eight live modules** (real executive state, notifications, projects, weather, layout memory).

The **Home Design Studio** (`HomeDesignStudio.tsx`, lazy) shows each one at iPhone 390 px, tablet 834 px and desktop 1280 px side by side. "Try it" makes the frames editable with the same ops as the Home. "Use as a new presentation" saves it without overwriting anything (VERIFIED).

| # | Prototype | Phone | Tablet | Desktop | Screenshot |
|---|---|---|---|---|---|
| 1 | LÉLU Central (default) | bento | bento | bento | `m15-home/shots/proto-01-lelu-central.png` |
| 2 | Bento Universe | bento | bento | bento | `proto-02-…` |
| 3 | Cosmos Orbit | bento | orbit | orbit | `proto-03-…` |
| 4 | Spatial Home | layered | spatial | spatial | `proto-04-…` |
| 5 | Executive Command Center | grid | split | split | `proto-05-…` |
| 6 | Organic Asymmetry | masonry | masonry | masonry | `proto-06-…` |
| 7 | Creative Gallery | masonry | masonry | masonry | `proto-07-…` |
| 8 | Project Hub | grid | split | split | `proto-08-…` (tab group: Notifications + Activity) |
| 9 | Minimal Focus | focus | focus | focus | `proto-09-…` (the rest docked) |
| 10 | Adaptive Intelligence | bento | bento | bento | `proto-10-…` (order computed from live signals) |
| 11 | Workspace Deck | deck | deck | deck | `proto-11-…` |
| 12 | Living Home Ecosystem | bento | freeform | freeform | `proto-12-…` |

Phones never get the orbit, spatial or freeform families by default; this is a usability and performance decision, pinned by a unit test.

## 6. Recommended Home composition

- **Default: LÉLU Central.** It keeps today's Home recognisable (weather · LÉLU · now / apps / workspaces · notifications · library / activity) and makes it fully editable.
- **Desktop: Cosmos Orbit** as the expressive alternative. The scene shows through the centre at no GPU cost beyond the Cosmos already rendering.
- **Next build: #51 "orbit hero + bento body"** (PROPOSED). It needs a two-zone solver, about 60 lines in `solveHome`.

## 7. Shared layout integration (Phases 4–5)

| Capability | Status | Evidence |
|---|---|---|
| Bento, responsive grid, masonry, split, radial/orbital, spatial (CSS 3D), layered, freeform, deck, focus | VERIFIED | proto screenshots; `every composition solves on every device…` (no overlaps, all modules accounted for) |
| Drag / reorder (mouse) | VERIFIED | `v-02-desktop-dragging.png`, check "drag a module by its handle" |
| Drag (touch) | VERIFIED (Chromium emulation) | "iPhone: touch-drag a module by its handle" |
| Resize, collapse, pin, lock, hide/show | VERIFIED | checks "resize (+)", "pin…", "locked… handle disabled"; dock bar shows hidden modules in edit mode |
| Float + drag + snap/align | VERIFIED | `v-04-desktop-floating.png`; snapping unit-tested |
| Free resize of floating surfaces (corner handle) | PARTIAL | wired and unit-tested via `place`; not driven by the browser script |
| Dock (minimise) / restore (maximise into the layout) | VERIFIED | `v-05-desktop-docked.png` |
| Expanded Home (module maximised in place) | PARTIAL | built (menu → Expand, Enter key); not asserted in the browser script |
| Group / ungroup (tabs) | VERIFIED | `v-06-desktop-grouped.png` |
| Undo / redo | VERIFIED | checks "undo…", "redo…" (history per presentation, 50 steps, session only) |
| Keyboard: move, resize, pin, lock, collapse, float, dock, expand | VERIFIED for move + focus retention; the rest are unit-level | "keyboard — ArrowRight…", "focus stays…" |
| Save and restore; reload persistence | VERIFIED | `v-07-desktop-after-reload.png` |
| Create, rename, duplicate, apply, switch, reset, restore, delete presentations | VERIFIED: create/switch/reset/restore in the browser. Rename/duplicate/delete in `HomeStore` tests (unit). | "a new presentation never overwrites…", "reset, then restore…" |
| Independent phone/tablet/desktop profiles | VERIFIED | "phone and desktop profiles are saved separately" |
| Never silently overwrite | VERIFIED | new/apply create new presentations; reset and delete keep a restore point; adaptive order is never saved |
| Stable module IDs; task context preserved | VERIFIED | module ids are fixed (`HOME_MODULES`); panels are singletons, so "back to Home from the window keeps the arrangement" |
| Home → Workspace window | VERIFIED | `v-09-to-window.png` |
| Home → Chat Universe | VERIFIED | `v-10-to-chat-universe.png` |
| Home → Cosmos (scene-graph placement + immersive) | VERIFIED | `v-11-to-cosmos.png` |
| Floating surfaces → Cosmos and back with relationships | PARTIAL | a Home module becomes a *labelled object* in the one scene; it does not carry the module's live UI into 3D (no second renderer, by design) |
| Undo/redo across reloads | NOT STARTED | history is in memory by choice |
| `home.*` tool for LÉLU to arrange the Home through the consent gate | PROPOSED | §4 #48 |

## 8. Smallest viable implementation

| File | Lines | Role |
|---|---|---|
| `home/homeComposition.ts` | 735 | pure engine (about 110 of those lines are the twelve templates as data) |
| `home/HomeComposition.tsx` | 402 | renderer + edit chrome + hand-offs |
| `home/HomeModules.tsx` | 430 | mostly moved from CosmosHome (content unchanged) + the CSS LÉLU presence |
| `home/HomeDesignStudio.tsx` | 191 | lazy studio |
| `homeStore.ts` | +183 | presentations, history, restore point |
| CSS | 313 | compositions (225), studio (61), phone edit bar (+27) |
| Tests | 13 unit, 36 browser checks | — |

No dependency was added.

## 9. Defects found and fixed on the way

1. **Home icons (pre-existing):** about 20 icon names used by the Home and SpatialNav (Menu, X, Search, ChevronRight, Home, all weather icons…) were missing from the icon map and drew an empty circle (see `shots/00-baseline-*.png`). Fixed.
2. **Orb swipe (pre-existing):** a swipe starting on the nav orb toggled the Cosmos on release. A slow one fired "hold to talk", because with touch `pointerleave` only arrives on release. Both are guarded now (12 px movement). VERIFIED on emulation.
3. **Edit mode outlived the Home** (found in this mission). Fixed: leaving the Home ends it.
4. **Module menus went under floating surfaces** (found in this mission). Fixed.
5. **The studio was buried under the scene canvas's stacking context.** Fixed: it is portalled to `<body>` on the `modal` layer.
6. **Merge regression:** "make the chat a diagram board" produced `workspace.transform,workspace.stage`. Fixed in `WorkspaceSteward.parseWorkspaceCommand`: a *board/workspace* request is a stage change, not an artifact. Both branches' tests pass.

## 10. Test and performance evidence (Phase 7)

| Evidence | Result |
|---|---|
| `npm test` (full suite, final tree) | **2235 tests: 2229 pass, 0 fail, 6 skipped** (the merged tree had 1 failure; fixed, see §9.6) |
| `tests/home-composition.test.ts` | 13/13 pass |
| `scripts/home/verify-home.mjs` (real UI, desktop + iPhone emulation + no-WebGL/reduced-motion) | **35 VERIFIED, 1 PARTIAL**, 0 FAILED. Raw results: [`m15-home/verify-home.json`](m15-home/verify-home.json). |
| Typecheck `tsc -p tsconfig.app.json` | clean |
| Lint `oxlint` | 0 errors; new warnings are the same fast-refresh pattern the Home already had |
| Bundle (prod build vs merge base `9c30176`) | **+31.8 KB gzip total (+0.34%)**. The studio is a lazy chunk (~3.5 KB gz). 0 dependencies. |
| Runtime, iPhone profile, 4× CPU throttle, prod build | Home-visible 4785/4870 ms vs base 4694/4918 ms (two alternating 5-run batches): no measurable change. Home re-mount ~400 ms, unchanged. +26 DOM nodes. See [`m15-home/perf.json`](m15-home/perf.json). A 3-run batch showed +730 ms that did not reproduce, and it is recorded there. |
| WebGL unavailable | 2D Home renders (VERIFIED). **PARTIAL:** the existing `THREE.WebGLRenderer` throws 19 uncaught errors in that mode. The Home is unaffected, but the scene has no graceful no-WebGL path. That is outside the Home and was not changed. |
| Reduced motion | ambient animation off, spatial 3D transforms removed (VERIFIED) |
| iPhone Safari | **BLOCKED:** WebKit is not installed in this environment. All "iPhone" results are Chromium with the iPhone 15 Pro profile. Touch scrolling while editing, handle-only `touch-action`, 16 px fields (no focus zoom) and no horizontal overflow are VERIFIED on emulation only. |
| Companion 3D avatar on the LÉLU module | PARTIAL: the hero host is present and valid. On the iPhone emulation the companion sometimes chose a different spot (her own `presencePlacement` planner, not changed here). The CSS presence always shows. |

Screenshots: `docs/missions/m15-home/shots/` (baseline `00-*`, compositions `01–05-*`, prototypes `proto-*`, interactions `v-*`).

Re-run:

```
bun install && npx vite --port 5173
node scripts/home/verify-home.mjs
node scripts/home/studio-sheet.mjs
```

## 11. Final implementation report

| Phase | Status |
|---|---|
| 0 Recon + merge of the latest Claude work | VERIFIED: `4f1afeb`, `9c30176`; the semantic merge regression is fixed |
| 1 Free tooling research | VERIFIED: registry data; 0 dependencies added |
| 2 Sixty concepts | VERIFIED as research: `m15-home/CONCEPTS.md` |
| 3 Twelve prototypes + studio on three devices | VERIFIED (Chromium) |
| 4 Canonical layout extension | VERIFIED for the capabilities in §7; PARTIAL where marked |
| 5 Workspace / Chat Universe / Cosmos transitions | VERIFIED as hand-offs; PARTIAL for carrying live module UI into 3D (deliberately not built: no second renderer) |
| 6 Design quality, reduced motion, 2D fallback | VERIFIED for the Home; PARTIAL for the scene's no-WebGL errors |
| 7 Validation | VERIFIED in Chromium; **BLOCKED for real iPhone Safari** (no WebKit here) |

The next steps, in order:

1. Run `scripts/home/verify-home.mjs` against a real iPhone (Safari Web Inspector or a WebKit runner).
2. Give LÉLU a consented `home.*` interface tool over `HomeStore.applyHomeOp`.
3. Build the #51 orbit-hero + bento-body composition.
4. Give the Cosmos renderer a graceful no-WebGL path.

## Follow-ups on `claude/charming-hamilton-icbyrb`

| Date | Report | Commit | Status |
|---|---|---|---|
| 2026-11-15 | [15.1 Home Studio](MISSION-15.1-HOME-STUDIO.md): all sixty concepts as layouts; research, blend, merge, create; themes, fonts, borders | `94e96cb` | Chromium-verified (26/26) |
| 2026-11-15 | [15.2 Spatial bar off the Home](MISSION-15.2-SPATIAL-BAR-AWAY.md) | `6bf290e` | Superseded by the closeout below |
| 2026-11-16 | [15.2 WP03 closeout](MISSION-15.2-CLOSEOUT-WP03.md) | child of `6bf290e` | WP03 COMPLETE with limitations; full suite 2260/2266 pass, 0 fail, 6 skipped; iPhone NOT VERIFIED |
| 2026-11-16 | [15.3 LÉLU's presence: adaptation, forms, actions, runtime](MISSION-15.3-AVATAR-PRESENCE.md) | child of `3722579` | PARTIAL: forms, interface adaptation, actions and App Library coexistence TEST-VERIFIED in Chromium; full suite 2268/2274 pass, 0 fail, 6 skipped; iPhone NOT VERIFIED; real-GPU phone frame rate not measurable here |

The open items in §7 above (real iPhone Safari, the `home.*` tool, #51, no-WebGL) are unchanged by these follow-ups. **Mission 15 is not complete.**
