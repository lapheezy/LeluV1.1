# Mission 5.9 — Genesis boot graph decoupling

Branch `perf/lelu-render-architecture`. Base `32e8175`. Checkpoint before any
edit: `artifacts/checkpoints/mission-5.9-base-*.{patch,tar.gz}` (sha256 in
`mission-5.9-base.sha256`).

## 1. Boot graph — original and new

Same instrument both times (`node scripts/measure-boot-graph.mjs dist`), which
walks the *static* import graph of the built entry chunk: what a cold boot must
fetch before first paint.

| | before | after |
|---|---|---|
| static chunks | 654 | **156** |
| static bytes | 4.49 MB | **1.65 MB** |
| modulepreload links | 0 | 0 |
| chunks emitted total | 1717 | 1440 |
| entry share of bundle | 38.1% | **10.8%** |
| source modules on graph | 635 | **144** |
| source bytes on graph | 6.30 MB | **1.04 MB** |
| import cycles on graph | 16 | **0** |

Instrument added this mission: `scripts/map-static-graph.mjs`
(`--files`, `--why <module>`, `--impact N`, `--graph`). `--impact` ranks every
module by how many bytes leave the graph if it stops being a static import;
that ranking is what the changes below followed, rather than intuition.

## 2. Real browser measurements

Cloud VM, Chromium, production build served by `vite preview`, cold load.
`239` JS requests, `250` requests total, `1378 KB` transferred.

| | |
|---|---|
| responseEnd | 541 ms |
| FCP | 2244 ms |
| DOMContentLoaded | 2179 ms |
| load | 2385 ms |
| `#root` children at FCP+ | 6 (text: build stamp, Atmosphere HUD, Spatial rail) |
| app marks | APP_START 3174 ms, PROVIDER_READY 10816 ms, BOOTSTRAP_DONE 10917 ms |

Deferred pieces arrive *after* first paint, which is the whole point:

| chunk | starts | duration | transferred |
|---|---|---|---|
| LeluCompanion | 2219 ms | 131 ms | 3 KB |
| runtimeKernel | 2308 ms | 131 ms | 1 KB |
| GenesisInterface | 2385 ms | 237 ms | 6 KB |
| GenesisController | 2414 ms | 127 ms | 1 KB |
| GenesisChat | 2668 ms | 150 ms | 11 KB |

So the shell paints at ~2.2 s, the engine kernel starts at ~2.3 s, and the full
interface (chat included) is present by ~2.8 s.

**Not a performance figure:** `__leluRenderStats` reported `fps: 2, calls: 0,
buffer: 384x661, profile: balanced`. This VM has no GPU (software
rasteriser) and the world was behind the home surface, so that number is an
artefact of the harness, not of the app. No FPS claim is made.

The "before" column is graph measurement only — the previous build was not
re-measured in this browser, so there is no browser-level before/after delta.

## 3. Functionality preserved

Full suite: **1974 tests, 1968 pass, 0 fail, 6 skipped**. `tsc -b --force` 0.
`vite build` 0 (5.25 s).

Browser, manually driven:
- Cosmos landing renders (build stamp, atmosphere HUD with live phase, spatial
  rail, portal destinations, zodiac observatory, app library, notifications).
- Sign-in gate: "Continue without an account" dismisses it.
- Chat opens: composer present (`textarea` count 1), conversation surface
  reachable from the dock.
- Her companion figure mounts (`button "Lélu — tap to talk, drag to move her"`).
- Console: one 403 on `/manifest.webmanifest` (preview host serves HTML for the
  root and 403s the manifest — infrastructure, present before this mission) and
  one transient 503 on a chunk (the proxy's burst cap; the chunk loaded).

Not verified here: provider failover, tool invocation against real backends,
voice, offline/PWA behaviour, and 3D frame rate — the preview has no `/api`
backend and no GPU. Those remain UNVERIFIED, not "passing".

## 4. Modules decoupled

`src/app/scene/genesis/GenesisScene.tsx` — the entry route no longer statically
imports:

- `GenesisInterface` (freed 864 KB / 69 modules from the graph)
- `GenesisController` (334 KB — the world renderer: planets, cosmic field,
  portals)
- `GenesisBridge`, `ProactiveBridge`, `VoiceBridge`, `WorkspaceBridge`,
  `DeepLinkIntake` — the AI/agent/voice/workspace wiring. `DeepLinkIntake`
  alone was the reason the entire intelligence tower below was statically
  reachable.
- `VisualBridge`, `GenesisSurfaceController`, `GenesisNotificationCenter`,
  `EngineTick`
- `LeluCompanion` (148 KB — body, rig, clips), `SpatialExperience`

Each keeps its name, mount point, props and lifetime; only the fetch moved.
`<Suspense fallback={null}>` means the frame that appears is the Cosmos, not a
spinner.

`src/core/runtime/runtimeKernel.ts` (new) + `src/core/runtime/useLeluRuntime.ts`
— the engine tree (Bootstrap, LeluRuntime, Orchestrator, TaskEngine,
BackgroundEngine, ProactiveEngine, PersistentRuntime, CognitiveLoop,
SelfHealing, ToolRegistry, UIOrchestrator, WorldLifecycle) is now one dynamic
module started from an idle slot after first paint. The sequence, order and
singletons are unchanged; there is a module-level promise so concurrent callers
share one start, and a refcount so a StrictMode remount cannot stop engines the
next mount needs.

Also: `Bootstrap` imports the 175 KB remote engineering agent when consulted
instead of statically; `CosmosHome` imports 33 icons instead of all of
lucide-react (733 KB, for one icon actually used); Vite no longer emits 674
`modulepreload` links; `LeluBody` fits textures to 1024² instead of 2048².

## 5. Remaining bottlenecks

1. **three.js and @react-three/fiber are still in the shell** — the `<Canvas>`
   is the entry scene, so `three.core` + `three.module` (~713 KB before this
   mission) are a large share of the remaining 1.65 MB. Isolating it means
   extracting the canvas and the tests that grep `GenesisScene.tsx` for the
   frameloop derivation; left alone deliberately rather than done blind.
2. **`GenesisCore` is still static** (55 KB + `SupabasePersistence`,
   `ProactiveCore`, `ExecutiveRuntime`) because it owns the shared state every
   surface reads.
3. **239 JS requests after all deferred loads** — the split is now one chunk
   per module. Merging vendor and app modules into a few cached chunks is the
   next big lever, untouched here.
4. The intelligence stack is now entirely post-paint (1.6 MB). It is off the
   critical path, not small; `ToolDispatcher` (129 KB), `CuriosityEngine`
   (84 KB), `VoiceEngine` (78 KB) still load as a block on first use.
5. `PROVIDER_READY` at 10.8 s is server-bound in this environment (no backend
   behind the preview) and was not investigated.

## 6. Test change, stated plainly

`tests/chat-surface.test.ts` pinned `SHARED_TEXTURE_LIMIT = 2048`. Mission 5.8
lowered it to 1024² for her 4096² source textures. The test now asserts 1024²
and the title records that the 240 → 96 MB figure was measured at 2048². The
structural assertions (parse once, fit once, cached per buffer) are unchanged;
no assertion was removed or loosened otherwise.

## 7. Commits

- `f61f609` — Measure the boot graph and the render policy instead of guessing
- `81dd643` — Load the intelligence kernel after the shell has painted
- `2c22427` — Give the world one render budget and stop mounting it before the shell
