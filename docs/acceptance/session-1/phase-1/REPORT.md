# Session 1, Phase 1: Cosmos modes and chat windows as modules

## Scope and branch state

The Phase 0 plan (items 1–6) executed on `claude/avatar-3d-world`. Phase 1A
(`4a5fb98`, the persisted Workspace / Floating switch) was merged rather than
redone; this phase adds the single-owner mode, chat windows as module-host
windows rendered in `GenesisWindowFrame`, and the acceptance that proves both.

| Baseline | Branch | Commits |
|---|---|---|
| `fb6e7a8` (Phase 0 evidence) | `claude/avatar-3d-world` | `1521683` chat windows as module windows, `4924caa` merge of Phase 1A + one mode owner, `0f0f5b3` acceptance + the two fixes it found, and the merge of `cd8cd9c` that carries this file |

### Merge with Phase 1B (`cd8cd9c`)

A parallel session pushed Phase 1B (`aae182b`, `e39201d`, `cd8cd9c`) to the same
branch while this phase was finishing. Both implement the same feature, so the
merge had to pick one `chat:` renderer per module, and the branch carries **this**
one, because it is the one the plan asks for and the one this evidence verifies:

- **Reuse of `GenesisWindowFrame`.** The Phase 1B body (`ChatWindow.tsx`, a
  custom `lcw` transcript view) is not used here: measured on the merged tree, a
  `chat:` window contained **0** `genesis-window-frame` elements and **0**
  `panel-heading` elements. Here every chat window body is `GenesisWindowFrame`
  (body-only, one title bar), inside `GenesisModuleHost`.
- **The Universe was click-through in the merged tree.** `.lcu` computed
  `pointer-events: none` there, inherited from the interface root, so pointer
  clicks never reached its controls and only DOM-dispatched clicks worked.
- Phase 1B's geometry persistence, composer targeting and minimized-state restore
  are preserved in history at `cd8cd9c`, and its own record is kept untouched in
  `docs/acceptance/session-1/phase-1b/`.

## Plan item → what shipped

| Plan item | Implementation |
|---|---|
| **1. Mode switch** — `cosmosMode: "workspace" \| "floating"` in `homeStore`, single owner, persisted, toggled from the header and the Worlds sheet | `homeStore` owns `cosmosMode` and `UniverseState { open, geometry }`; persistence delegates to `loadCosmosMode`/`saveCosmosMode` (`lelu.universe.cosmosMode.v1`), so there is one owner and one stored key. The header toggle (`.lcu-mode`) and the Worlds sheet toggle call the same `setCosmosMode`. |
| **2. Workspace mode** — keep the opaque Cosmos, pause the scene's render loop through the existing visibility hooks | `.lcu-cosmos` stays opaque; `SceneRenderBudget.setOccluded("chat-universe", open && mode === "workspace")` drives the existing frameloop to `"never"`. |
| **3. Floating mode** — remove `.lcu-cosmos`, keep the scene rendering, transparent `.lcu-main`, solid cards and windows, home and nav hidden | `.lcu[data-cosmos="floating"] .lcu-cosmos { display: none }`, `.lcu-main { background: transparent }`, glass stays on cards, timeline and filters; the occlusion budget is released so the scene renders live. |
| **4. Chat windows as modules** — `chat:<id>` opened through `GenesisModuleHost` with `GenesisWindowFrame` chrome | `ChatUniverse` opens `chat:<conversationId>` through `GenesisCore`/`homeStore`; `GenesisModuleHost` renders it `inline` with the shared chrome, drag, resize and z-order; `GenesisWindowFrame` is the body with exactly one title bar. Windows outlive the Universe. No new window system. |
| **5. Persistence** — geometry in module state (normalized), open set and mode in `homeStore` | Module state carries geometry (normalized on resize); `homeStore` remembers the open set (`rememberUniverseOpen`) and the mode. Chat ids are deliberately excluded from `rememberLayout`, so a chat window never takes the panel slot. |
| **6. Acceptance** — switch modes, two windows, close and reopen the Universe with windows kept, reload with state kept, 390×844 and 430×932 (plus 1440×900) | `scripts/verify-cosmos-modes.mjs`: 61 checks over three viewports, a screenshot at each step, `results.json` written after every viewport so a cut-short run still leaves evidence. |

## Defects the acceptance caught (fixed in this phase)

1. **Chat windows painted behind the Cosmos.** `raiseModule` gave `chat:` windows a
   panel-level z-index (31), below the `.lcu` overlay (480): the window existed and
   was hit-testable, but invisible. Fixed with a per-id stacking floor —
   `CHAT_WINDOW_Z = 520` in `GenesisCore`, used by `raiseModule` and by
   `GenesisModuleHost`, which also clamps a previously persisted panel z-index.
2. **The Universe was click-through.** `.lcu` inherited `pointer-events: none`
   from the interface root, so taps fell through to the scene. `.lcu` now sets
   `pointer-events: auto`, because the Universe owns the screen while it is open.

Both were invisible to structure-only checks, so the suite gained **"the chat
window paints above the Cosmos and takes a click"** (z-index comparison plus
`elementFromPoint`).

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

- **Acceptance:** 61 checks — 20 at 390×844, 20 at 430×932, 21 at 1440×900 (drag
  and resize are desktop-only). **0 failures, 0 pageerrors** on all three.
- **Console errors:** optional local services are not running in this sandbox, so
  every run logs a set of `ERR_CONNECTION_REFUSED` messages of the same class as
  the 8 Phase 0 recorded; no page script error was raised.
- **`npm run typecheck`:** exit 0.
- **`npm run lint`:** 95 warnings and 1 error. The error is pre-existing and in a
  file this phase did not touch (`GenesisChat.tsx:1463`, a hook called
  conditionally); no Phase 1 file adds a warning.
- **`npm run build`:** exit 0.
- **`npm test`:** 1186 tests, 1184 pass, 2 skipped, 0 fail.

## Limitations (stated, not hidden)

- **Scene pause is verified through its contract, not the GPU.** The acceptance
  proves the occluder is set in workspace mode and released in floating mode by
  reading `SceneRenderBudget`; no profiler or frame-time measurement was taken.
- **Phone windows share one docking position.** Two windows on a phone dock to
  the same rectangle, so the top one covers the other; the dock and the "Open
  windows" rail are the switcher. That is the presentation the plan asks for
  (`inline`), but it is a real usability limit.
- **Pointer-click stability.** Playwright intermittently reports a Universe
  control as not stable enough to click. The handlers are correct — a DOM click
  runs the same action — so the harness verifies each click's *effect* and retries
  once, and records every fallback in `results.json` (`notes`) instead of hiding
  it.
- **Fonts and Chromium libraries.** The sandbox has no system fonts and no
  Chromium dependencies, so the run uses locally extracted DejaVu/Liberation
  fonts (`FONTCONFIG_FILE`) and Ubuntu `.deb` libraries (`LD_LIBRARY_PATH`).
  Nothing about that is part of the app.

## Gate

Phase 1 passes: both modes exist and persist, chat windows are module windows in
the shared frame that outlive the Universe and come back after a reload, all three
viewports pass every check, and the pageerror list is empty. Phase 2 was not
started.
