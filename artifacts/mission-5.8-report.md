# MISSION 5.8 — COSMOS RENDERING ARCHITECTURE & MAIN-THREAD RECOVERY

**Project:** LÉLU V1.1 / LÉLUVERSE
**Branch:** `perf/lelu-render-architecture`
**Starting commit:** `32e8175` (Mission 5.7 render-architecture recovery)
**State:** all Mission 5.8 work is **uncommitted** in the working tree — the brief forbids committing without permission.
**Date:** 2026-11-11

---

## A. ARCHITECTURE

### A.1 What was there (Phase A audit)

```
GenesisScene (GenesisCore)
├─ GenesisWorkspaceRouter        useGenesis() → re-renders per token
│  ├─ GenesisV1Workspace         <Canvas> #1 (world)  frameloop ← useSceneFrameloop()
│  │  ├─ CosmosSkyBackdrop       own rAF loop, DOM, always painting
│  │  ├─ Canvas → SceneFrameGovernor + AdaptiveQuality + GenesisController
│  │  └─ CosmosPhaseHUD          own rAF loop, 4 Hz
│  ├─ GenesisV2Workspace / LivingSystemUI / CosmosOverview   (lazy)
│  └─ GenesisInterface           chat, dock, 31 code-split panels
├─ LeluCompanion → LeluCharacter3D  <Canvas> #2 (avatar) frameloop "demand"
├─ SpatialExperience             DOM navigation
└─ EngineTick                    one rAF simulation heartbeat
```

Two full-screen WebGL contexts, by design: **world** (opaque cosmos) and **avatar**
(transparent overlay, `powerPreference: low-power`, 1.4 dpr cap, demand-driven at 24 fps).
They are not duplicates: unmounting either removes a feature the product depends on.

Existing controls found: `SceneRenderBudget` (modes `full`/`reduced`/`paused`, occluders,
typing throttle, slow-device latch), `SceneFrameGovernor` (`frameloopFor`), `AdaptiveQuality`
(measured-fps dpr), `Surface`/`useSurface` (which surface owns a phone screen).

### A.2 Gaps the audit found

| Gap | Consequence |
|---|---|
| No page-visibility suspension anywhere | a backgrounded/occluded tab kept its loops scheduled |
| No `webglcontextlost`/`restored` handling on either canvas | a driver reset left a dead transparent canvas: the world silently vanished |
| No rendering *profile* — only per-component `mobile` ternaries | degradation was ad hoc and could not be reasoned about or tested |
| No owner of "which surfaces exist" | nothing could answer "what is painting and why" |
| Two components polled layout every 400–500 ms unconditionally | `querySelector` + `getBoundingClientRect` + `JSON.stringify`, forever, hidden or not |

### A.3 What was built

**`SceneRenderManager`** (`src/app/scene/genesis/SceneRenderManager.ts`, 378 lines) — the one
coordinator for surface ownership, capability, visibility, context lifecycle and quality
profile.

It deliberately does **not** decide the frame loop. Every suspension it learns about is
expressed as a **named occluder on the existing `SceneRenderBudget`** (`page-hidden`,
`context-lost:<id>`), so `frameloopFor(mode)` remains the only answer to "may this canvas
paint now". A second mechanism deciding that was the Mission 5.7 bug; this mission does not
reintroduce it.

```
document visibility ──┐
webglcontextlost  ────┼─→ SceneRenderManager ──setOccluded("page-hidden" | "context-lost:id")──→ SceneRenderBudget ──→ frameloopFor() ──→ <Canvas frameloop>
measured fps      ────┘            │                                                                    ▲
                                   └── profile: full / balanced / light ────────────────────────────────┘
                                       (screen: GenesisScene paintWorld gate, sky cadence, avatar cap)
```

**`RenderContextGuard`** (66 lines) — mounted inside both canvases: registers the surface, and
handles `webglcontextlost` (`preventDefault()` — required for restoration to be attempted at
all) → budget paused → `webglcontextrestored` → resumed.

### A.4 Profiles (Phase E)

| profile | when (evidence only) | behaviour |
|---|---|---|
| `full` | real GPU, wide viewport | every loop every frame |
| `balanced` | narrow viewport or mobile UA hint, real GPU | same world, same layers; sky 30→10 snow paints/s, avatar 24 fps |
| `light` | software rasteriser, no WebGL, Save-Data, or measured < 30 fps for 3 s | no continuous WebGL; the DOM cosmos (atmosphere, sunset, static, hurricane, lightning, rainbow) plus the simulation heartbeat carry the identity |

Rules encoded and tested:
- a phone is **never** profiled `light` from its UA — mobile is evidence for `balanced` only;
- an **unreadable** renderer string (Safari hides it) is not evidence of weakness → `full`;
- capability sets a **ceiling** measurement can never exceed (a software rasteriser cannot adapt a GPU into existence);
- an **unpainted** second is not a slow second (`painting: false` is ignored), so a backgrounded tab cannot permanently degrade the scene;
- downgrade after 3 consecutive slow seconds, upgrade only after 15 consecutive fast ones.

### A.5 Chat independence

The interface was already decoupled from the scene (it mounts above the router and the scene
unmounts when chat owns a phone screen). This mission adds the guarantee that the composer
stays above navigation (`LAYERS.composer = 300 > navigation = 200`, already centralised) and
removes 44–86 ms/s of main-thread work from the layer that ran *beside* the chat.

---

## B. PERFORMANCE

### B.1 Measured (real modules, Node, `scripts/measure-render-policy.mjs`)

| profile | sky paints/s | snow paints/s | gradient ms/s | snow ms/s | total ms/s | vs full |
|---|---|---|---|---|---|---|
| full | 60.0 | 30.00 | 0.076 | 56.273 | **56.349** | baseline |
| balanced | 20.0 | 10.00 | 0.025 | 18.758 | **18.783** | −66.7% |
| light | 12.5 | 6.25 | 0.016 | 11.724 | **11.739** | −79.2% |

Same layer, **before** any Mission 5.8 change: **109.093 ms/s** (noise fill 3.6339 ms/paint,
two `Math.random()` per pixel).

- algorithm fix alone (seeded LCG, identical bimodal distribution): **3.6339 → 1.8698 ms** per paint, −48.6%, at *every* profile;
- profile cadence on top: **109.09 → 56.35 → 18.78 → 11.74 ms/s**;
- combined at `light` vs the original code: **−89.2%** of this layer's main-thread JavaScript, with the atmosphere still visibly animating.

Adaptation decision cost: **0.032 µs** per measured second.
Hysteresis over 60 synthetic seconds: 24/60 alternating → **no change** (held);
20 s at 22 fps then 40 s at 60 fps → `full→balanced` at 3 s, `balanced→light` at 6 s,
`light→balanced` at 35 s, `balanced→full` at 50 s.

### B.2 NOT measured — and why

FPS, draw calls, triangle count, GPU/compositing time, shader compilation, boot time, FCP,
TTI, long tasks, memory, chat latency, and every browser-based interaction test.

The blockers are environmental and were re-confirmed this mission:
- the platform edge answers **503** for the app's own chunk requests (`/assets/*.js`, `/src/**`) while the same URLs answer 200 from inside the VM, so the cloud browser mounts an empty `#root` — any FPS read there is the frame rate of a blank page;
- the local Playwright Chromium cannot start (missing `libnspr4`/`libnss3`/…, `playwright install-deps` refused by the sandbox's no-new-privileges flag, no `apt` package lists);
- `preview_playwright` fails platform-side (`options.mode` must be `'strip'`).

No number in this report is derived from an empty page. The instruments for measuring on real
hardware are shipped: `window.__leluRenderStats` (`fps`, `dpr`, `buffer`, `calls`,
`triangles`, `frames`, `mode`, `profile`), `window.__leluRenderManager` (`profile`, `ceiling`,
`hidden`, `mode`, `surfaces`, `lostContexts`), and `scripts/measure-scene-perf.mjs`
(Playwright desktop + mobile harness).

---

## C. APPLICATION INTEGRITY

| check | result |
|---|---|
| `tsc -b --force` | **exit 0** |
| full suite (`npm test`) | **1987 tests, 1981 pass, 0 fail, 6 skipped** (Mission 5.7 baseline: 1966 / 1960 / 0) |
| focused suites (render-manager, render-architecture, cosmos-chat-experience, spatial-experience) | **66 / 66 pass** |
| production build (`vite build`) | **exit 0**, built in 6.56 s |
| existing assertions | not weakened; one stale assertion in `tests/render-architecture.test.ts` was updated to the new (equivalent) `AdaptiveQuality` shape |
| code splitting | unchanged (31 lazy panels untouched) |
| simulation / cognition / memory / voice / workspaces | untouched |

New tests (21, `tests/render-manager.test.ts`): renderer-ownership registry, visibility
suspension (including registering while already hidden), context loss and restore, suspension
release on unmount, listener ownership, snapshot identity, capability ceiling, the
"paused ≠ slow" rule, hysteresis, sky cadence monotonicity, and structural guards that the
manager never sets a frameloop and that both canvases register + recover.

---

## D. REMAINING ISSUES

1. **Two WebGL contexts remain.** Consolidating the avatar into the world canvas would mean
   redrawing her into every world view and every workspace; the current design mounts her once
   and both canvases are budget-governed and demand-driven. Documented as a deliberate
   requirement, not an oversight; the measurement needed to justify consolidation could not be
   taken here.
2. **`light` still mounts the world `<Canvas>`** with `frameloop="never"` (keeps state, costs
   one context and its shader compile at mount). Not mounting it would save that compile but add
   a remount stall on upgrade.
3. **`PlanetWeather` / `PlanetFloatingCities`** still draw individual meshes per group when
   visible — not instanced. Carried over from 5.7.
4. **Partial occlusion** (a surface covering part of the canvas) is not detected; suspension
   relies on explicit occluder signals plus page visibility, not an `IntersectionObserver`.
5. **No worker/OffscreenCanvas work** was introduced. The one workload that justified it was
   the static-snow fill, and a 40-character RNG change removed 48.6% of it — a worker would
   have added a boundary for less.
6. Everything under B.2 remains unmeasured until a browser can load the app.

---

## E. REPOSITORY STATE

- Branch `perf/lelu-render-architecture` at `32e8175`; **nothing committed, nothing pushed** (per the brief).
- Modified (6 files, +141 / −22): `GenesisScene.tsx`, `AdaptiveQuality.tsx`, `CosmosSkyBackdrop.tsx`, `avatar/LeluCharacter3D.tsx`, `avatar/LeluCompanion.tsx`, `tests/render-architecture.test.ts`.
- New: `SceneRenderManager.ts` (378), `render/RenderContextGuard.tsx` (66), `tests/render-manager.test.ts` (300), `scripts/measure-render-policy.mjs` (148).
- Evidence: `artifacts/perf/mission-5.8-render-policy.txt`.
- `node_modules` was rebuilt with `npm ci` after the workspace restore dropped it; `package-lock.json` untouched, no dependency added or upgraded.
- All changes are reversible: every modification is additive or a swap of an inline expression for an imported equivalent; no file was deleted or renamed.
