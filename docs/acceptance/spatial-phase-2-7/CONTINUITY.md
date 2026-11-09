# Phase 2.7 — universal spatial continuity

Companion to [REPORT.md](REPORT.md) (the reveal + recolour work). This file covers
the continuity pass over surfaces: what was measured, what was fixed, and what
was **not** built. Baseline `f350221`, branch `freebuff/phase-2-2`.

## What changed

| Change | Why |
| --- | --- |
| `src/app/scene/genesis/cameraPoseMemory.ts` | The phone **unmounts** the v1 world while chat owns the screen. The graph survived that; the camera did not, so every return began at the canvas default pose. The pose is now remembered for the session and restored on mount, with NaN/degenerate poses refused rather than stored. |
| `GenesisCameraController.tsx` | Restores the remembered pose (origin only for a world never left) and records the pose on unmount. |
| `avatar/companionDock.ts` | Her full window sat over the middle of the frame exactly while the world was being looked at. `immersiveDock()` is the small, nav-clear corner she waits in. |
| `avatar/LeluCompanion.tsx` | Uses it whenever the world has the screen and chat is closed: 84×100 instead of a third of a phone screen, tap to talk. She is not removed. |
| `tests/spatial-continuity.test.ts` | 4 tests: pose round-trip, no-pose default, refusal of unusable poses, and the dock's geometry at 375/390/430/1440. |

## Measurements

Each run: create "Nova" in chat → close (reveal) → record → reopen chat → close
**with no command** → record. Per-viewport JSON: `<tag>-continuity.json`,
screenshots `<tag>-13-reveal.png` / `<tag>-14-return.png`.

| Viewport | World remounted? | Camera delta | Surface kept | Her window |
| --- | --- | --- | --- | --- |
| 375×812 | yes — canvases 3 → 1 (chat) → 3 | **0.000** | revision 1, one object, same name | collapsed, 86×102, 2.9% of screen, 114 px above the bottom |
| 430×932 | yes — 3 → 1 → 3 | **0.000** | revision 1, one object | collapsed, 86×102, 2.2%, 114 px |
| 1440×900 | no — 3 throughout | **4.876** | revision 1, one object | collapsed, 86×102, 0.7%, 114 px |

Phone camera: `(4.301, −0.013, 6.02)` before and after, identical to the reveal's
framed pose. This is the case the memory exists for: without it the remount
started at the canvas default `(0, 1.5, 5)`.

### Desktop: not preserved, and why

At 1440×900 the world is never unmounted, so nothing needed restoring — but the
camera still moved. The log shows the reveal re-running on return with a **new**
framing (`Framed "Nova" — camera at (1.68, −0.58, 5.27)`), not the first one
(`(−1.89, −0.58, 1.95)`). Two causes, both pre-existing and now documented rather
than papered over:

1. the reveal frames from the object's **live world** position, and the cosmos
   rotates, so the same object is framed differently a few seconds later;
2. opening the desktop chat ends the camera takeover, so the autonomous
   exploration controller owns the camera again while chat is open.

Nothing is lost — revision, identity and the object are unchanged (`worldKept`
true at all three sizes) — but "return to the same view" is only true where the
world was actually destroyed and restored. Fixing it means deciding that a reveal
holds the camera until the user takes it, which changes chat camera behaviour, so
it is left as an explicit decision rather than smuggled into this pass.

## Directive, item by item

| # | Item | Status |
| --- | --- | --- |
| 1 | Reveal from Chat, Dashboard, Creation Studio, Workspace, agent tools | **Mechanism universal, surfaces not all wired.** Every commit goes through `SpatialIntentBus`, which now requests a reveal for every verified mutation, and the bridge honours it whenever the world becomes visible again (any panel closing, any remount), not only from chat. But Creation Studio, Workspace and the dashboard have **no spatial-creation entry point at all** — there is nothing to reveal from them until one is built. |
| 2 | One scene state and identity across surfaces | **Holds** — one graph, one revision, one bus; measured object/revision identical after a round trip (all three viewports). |
| 3 | Camera transitions to a selected object | **Existing infrastructure** — `camera.focus` → `SpatialCameraApplier` → `flyCameraTo` (1.5 s eased) on the live rig; no new animation code added. |
| 4 | Chat open/close never destroys the world | **Holds on phone by design** (world unmounted, graph authoritative, remount reproduces it) and on desktop (world untouched). Now the view survives it too, where the world does remount. |
| 5 | Preserve camera, orbit, selection, revisions | **Camera: phone yes, desktop no** (above). Selection/revision preserved everywhere. |
| 6 | Reveal when the world was never mounted | **Holds** — the bridge polls until the target is rendered; both phones started from a world that did not exist while chat was open. |
| 7 | Overlays must not obscure the world | **Partly** — `HomeStore.immersive` hides CosmosHome for the reveal; the dashboard is confirmed absent (`home: false`) in every reveal state. Her window was the remaining obstruction and is fixed; proactive toasts still overlay the world. |
| 8 | Explicit transitions between CORE, Cosmos, workspaces, objects | **Not built as scene-to-scene transitions.** Scene switching is a hard swap (by design: exactly one scene mounted); object transitions use the existing camera flight. |
| 9 | Lightweight mobile / iPhone Safari | **Not profiled.** No iPhone available; software-GPU Chromium at phone sizes only. |
| 10 | Companion must not obstruct mobile controls | **Fixed and measured** — see table; 2.2–2.9% of the screen, 114 px clear of the navigation bar, tap to talk. |

## Gates

| Command | Result |
| --- | --- |
| `bun run test` (project runner) | **1403 pass, 0 fail, 6 skip**, exit 0 |
| `bun run typecheck` | exit 0 |
| `bun run lint` | 0 errors, 109 warnings (108 before; the extra is the pre-existing `only-export-components` rule applied to `dockedWindow`'s neighbouring exports) |
| `bun run build` | exit 0, built in 4.7 s (chunk-size warnings only) |
| `spatial-continuity.test.ts` | 4 pass, 0 fail |

Note on the "38 existing failures" in the directive: that number came from
`bun test`, which is not this project's command. Under `bun run test` the suite
was 1389/1/6 before this phase; see REPORT.md §4.

## Limits

* **No physical iPhone.** Viewport emulation (375/390/430/1440), guest sign-in,
  software renderer. Item 9 is unverified by measurement.
* **Voice and agent-tool creation paths were not driven end-to-end** (no
  microphone; no tool creates spatial objects today).
* Desktop camera continuity is documented as failing, with the cause, above.
* The full create → chat → orbit → dashboard → workspace → return sequence was
  run in pieces: one command is capped at 290 s and a complete sequence exceeds
  it, so each viewport is its own run with its own trace.
