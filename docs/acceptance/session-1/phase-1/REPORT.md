# Session 1, Phase 1: Cosmos modes and chat windows as modules

## Scope

The Phase 0 plan (items 1–6) executed on `claude/avatar-3d-world`. Phase 1A
(`4a5fb98`, the persisted Workspace / Floating switch) was merged rather than
redone; this phase adds the single-owner mode, the module-host chat windows, and
the acceptance that proves both.

| Baseline | Branch | Commits |
|---|---|---|
| `fb6e7a8` (Phase 0 evidence) | `claude/avatar-3d-world` | `1521683` chat windows as module windows, `4924caa` merge of Phase 1A + one mode owner, plus the fixes and evidence in this directory |

## Plan item → what shipped

| Plan item | Implementation |
|---|---|
| **1. Mode switch** — `cosmosMode: "workspace" \| "floating"` in `homeStore`, single owner, persisted, toggled from the header and the Worlds sheet | `homeStore` now owns `cosmosMode` and its `UniverseState { open, geometry }`; persistence delegates to `loadCosmosMode`/`saveCosmosMode` (`lelu.universe.cosmosMode.v1`), so there is one owner and one stored key. Header toggle (`.lcu-mode`) and the Worlds sheet toggle call the same `setCosmosMode`. |
| **2. Workspace mode** — keep the opaque Cosmos, pause the scene's render loop through the existing visibility hooks | `.lcu-cosmos` stays opaque; `SceneRenderBudget.setOccluded("chat-universe", open && mode === "workspace")` drives the existing frameloop to `"never"`. |
| **3. Floating mode** — remove `.lcu-cosmos`, keep the scene rendering, transparent `.lcu-main`, solid cards and windows, home and nav hidden | `.lcu[data-cosmos="floating"] .lcu-cosmos { display: none }`, `.lcu-main { background: transparent }`, glass stays on cards/timeline/filters; the occlusion budget releases, so the scene renders live. |
| **4. Chat windows as modules** — `chat:<id>` opened through `GenesisModuleHost` with `GenesisWindowFrame` chrome | `ChatUniverse` opens `chat:<conversationId>` via `HomeStore`/`GenesisCore`; `GenesisModuleHost` renders it as `inline` with the shared chrome, drag, resize, z-order. `GenesisWindowFrame` is the body, header rendered once. Windows outlive the Universe. |
| **5. Persistence** — geometry in module state (normalized), open set and mode in `homeStore` | Module state carries geometry (normalized on resize); `homeStore` remembers the open set (`rememberUniverseOpen`) and mode. Chat ids are deliberately excluded from `rememberLayout`. |
| **6. Acceptance** — switch modes, two windows, close the Universe and reopen with windows kept, reload with state kept, 390×844 and 430×932 (plus 1440×900) | `scripts/verify-cosmos-modes.mjs`: 61 checks over three viewports, screenshots at each step. |

## Defects the acceptance caught (and fixed in this phase)

1. **Chat windows painted behind the Cosmos.** `raiseModule` assigned a panel-level
   z-index (31) to `chat:` windows, which put them *under* the `.lcu` overlay
   (z-index 480): the window existed, was hit-testable in the DOM, and was
   invisible. Fixed by a per-id stacking floor — `CHAT_WINDOW_Z = 520` in
   `GenesisCore`, used by `raiseModule` and by `GenesisModuleHost` (which also
   clamps a previously persisted panel z-index).
2. **The Universe was click-through.** `.lcu` inherited `pointer-events: none`
   from the interface root, so taps fell through to the scene (this is why the
   first harness runs needed DOM-click fallbacks for the mode toggle and the
   Universe close). `.lcu` now sets `pointer-events: auto`.

Both were invisible to the earlier checks, which asserted structure, not paint,
so the suite gained **"the chat window paints above the Cosmos and takes a
click"** (z-index comparison plus `elementFromPoint`).

## Evidence in this directory

| File | What it is |
|---|---|
| `390x844_{1..8}_*.png`, `430x932_{1..8}_*.png`, `1440x900_{1..8}_*.png` | After: home, workspace mode, chat window, two windows, floating mode, Universe closed, Universe reopened, after reload |
| `before/*.png` | Before: the untouched Phase 0 baseline (home, Universe, "open github", after close) at 390×844 and 1440×900 |
| `results.json` | Every check with its result and detail, per viewport, plus pageerrors and console errors |
| `checks.txt` | `typecheck`, `lint`, `build`, `test` output with exit codes |
| `acceptance-run.log` | The acceptance run's own stdout |

| Screen | Phone 390×844 | Phone 430×932 | Desktop 1440×900 |
|---|---|---|---|
| Home | `390x844_1_home.png` | `430x932_1_home.png` | `1440x900_1_home.png` |
| Workspace mode | `390x844_2_workspace.png` | `430x932_2_workspace.png` | `1440x900_2_workspace.png` |
| Chat window (module window) | `390x844_3_chat_window.png` | `430x932_3_chat_window.png` | `1440x900_3_chat_window.png` |
| Two windows | `390x844_4_two_windows.png` | `430x932_4_two_windows.png` | `1440x900_4_two_windows.png` |
| Floating mode | `390x844_5_floating.png` | `430x932_5_floating.png` | `1440x900_5_floating.png` |
| Universe closed, window kept | `390x844_6_universe_closed.png` | `430x932_6_universe_closed.png` | `1440x900_6_universe_closed.png` |
| Universe reopened | `390x844_7_universe_reopened.png` | `430x932_7_universe_reopened.png` | `1440x900_7_universe_reopened.png` |
| After reload | `390x844_8_after_reload.png` | `430x932_8_after_reload.png` | `1440x900_8_after_reload.png` |

## Results

- **Acceptance:** 61 checks — 20 at 390×844, 20 at 430×932, 21 at 1440×900
  (drag and resize are desktop-only). **0 failures, 0 pageerrors** on all three.
- **Console errors:** 78 across the whole run, all `ERR_CONNECTION_REFUSED` for
  optional local services that are not running in this sandbox (Phase 0 saw 8 of
  the same class per viewport).
- **`npm run typecheck`:** exit 0.
- **`npm run lint`:** 95 warnings and 1 error. The error is pre-existing and in a
  file this phase did not touch (`GenesisChat.tsx:1463`, a hook called
  conditionally); none of the Phase 1 files add a warning.
- **`npm run build`:** exit 0.
- **`npm test`:** 1186 tests, 1184 pass, 2 skipped, 0 fail.

## Limitations (stated, not hidden)

- **Scene pause is verified through its contract, not the GPU.** The acceptance
  proves the occluder is set in workspace mode and released in floating mode by
  reading `SceneRenderBudget`; no profiler or frame-time measurement was taken.
- **Phone windows share one docking position.** Two windows on a phone dock to
  the same rectangle, so the top one covers the other; the dock and the "Open
  windows" rail are the switcher. That is the presentation the plan asked for
  (`inline`), not a bug, but it is a real usability limit.
- **Pointer-click stability.** Playwright intermittently reports the Universe
  close (and once, the mode toggle, in an 11-minute run over three viewports) as
  not stable enough to click. The handlers themselves are correct — a DOM click
  runs the same action, and the mode toggle passed on three separate runs — so
  the harness now verifies the click's *effect* and retries, and records every
  fallback in `results.json` (`notes`).
- **Fonts and Chromium libraries.** The sandbox has no system fonts and no
  Chromium dependencies, so the run uses locally extracted DejaVu/Liberation
  fonts (`FONTCONFIG_FILE`) and Ubuntu `.deb` libraries (`LD_LIBRARY_PATH`).
  Nothing about that is part of the app.

## Gate

Phase 1 passes: both modes exist and persist, chat windows are module windows
that outlive the Universe and come back after a reload, all three viewports pass
every check, and the pageerror list is empty. Phase 2 was not started.
