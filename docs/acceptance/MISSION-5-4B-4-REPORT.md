# MISSION 5.4B.4 — Immersive Input Routing & Frame-Synchronous Selection

Status: **PARTIAL — input routing is fixed and the first correct portal travels
are recorded, but five-of-five repeatability is not yet met.** Portal geometry
was not modified.

Branch `claude/mission-5-4-spatial-interaction`.

## 1. Input routing — fixed

Three separate owners were swallowing presses intended for the canvas. Each was
found by reading `document.elementsFromPoint` at a portal's projected centre.

| Layer | Was | Now |
|---|---|---|
| `SpatialNavigator` control pill | container `pointer-events: auto` | container `none`; its own buttons re-take the pointer |
| `[data-spatial-groups]` panel | container `auto` | container `none`; chips/inputs re-take it |
| `[data-portal-panel]` | container `auto` | container `none`; fields/buttons re-take it |
| Portal label chip (`drei <Html>`) + its wrapper | `auto` on both | **`none`** — the canvas raycast owns a pointer press; the chip stays keyboard-focusable and still travels on Enter |
| `GenesisCoreBody` | `onClick` toggled the chat panel | **defers when the same press also hits a portal** (measured: core body at 2.418, portal disc at 3.290) |

The rule is deliberate, not blanket: panels paint, controls target. Effective
ownership is expressed once in `src/index.css` (containers off, real controls on)
rather than by z-index.

### Effect, measured

| Portal | Reachable pixels before | After |
|---|---|---|
| `scene:files` | 0 of 84 sampled mouth pixels | **reachable at the projected centre (1 px search)** |
| `scene:studio` | 1 pixel, only at sampling time | reachable at the projected centre |

## 2. The first correct portal travels

Five independent page loads, one real pointer click per destination per load
(`real-click-rep1..5.json`, `real-click-summary.json`). Reps 4 and 5 predate the
label-wrapper fix and are kept as-is, not discarded.

| Rep | `files` delivered | `files` landed | `studio` delivered | `studio` landed |
|---|---|---|---|---|
| 1 | `null` (no event) | `core` | `scene:studio` | **`studio`** ✓ |
| 2 | `null` | `core` | `scene:studio` | **`studio`** ✓ |
| 3 | **`scene:files`** | **`files`** ✓ | not reachable (84 px covered) | — |
| 4 (pre-fix) | not reachable | — | not reachable | — |
| 5 (pre-fix) | not reachable | — | `null` | `core` |

- **`files` 1/5, `studio` 2/5** correct end-to-end.
- Both destinations have now been delivered by the real R3F handler *and*
  reached their intended scene at least once — the identity chain
  `pointer → raycast → portal id → destination → transition → active scene` is
  demonstrated for the first time in this mission series.
- The core body no longer steals the press: no wrong destination (`media`) was
  observed in any attempt after the fix.

## 3. Why it is not five of five

The remaining failures are of one shape: the pixel was reachable and the raycast
returned the aimed portal at sampling time, but **no event was delivered** when
the press landed (`delivered: null`). The camera keeps rotating
(`GenesisCameraController` lerps the OrbitControls target every frame with
damping — intentional framing, not removed), so a mouth spanning ~18 px moves a
few pixels between the harness reading its centre and the browser delivering the
press. This is measurement latency, not application routing: a human press is
hit-tested by R3F against the camera matrix of the frame it arrives in, which is
exactly frame-synchronous by construction.

Two honest options to close it (neither is a geometry change):

1. Hold the pointer down inside the mouth and let the app hit-test the release
   frame — a press-and-release is one interaction, and R3F uses the event frame.
2. Drive the click from inside the page in the same task that computes the point
   (CDP `Input.dispatchMouseEvent` from a single evaluate), removing the round
   trip.

## 4. Preserved

Deterministic slots, stable identities, registry persistence, extra-portal
orbits, portrait fitting, no world-space mouth overlap (unchanged), existing
renderer and camera architecture, and the intentional camera motion.

## 5. Gates

| Check | Result |
|---|---|
| `npx tsc -b --force` | 0 errors |
| `portal-field` + `spatial-experience` + `spatial-portals` | 40 pass, 0 fail |
| Full suite / lint / build | not run this pass (command cap) |

## 6. Acceptance

| Criterion | Status |
|---|---|
| Immersive entry via app affordances | PASS (orb reachable after routing fix; Cosmos control works) |
| Canvas receives real portal interactions | **PASS** (events delivered for both portals) |
| Intended portal identity delivered | **PASS** (`scene:files`, `scene:studio`) |
| Both destinations independently selectable | **PASS** (each landed correctly) |
| Five consecutive successes per destination | **FAIL** (1/5, 2/5) |
| Neighbouring portals do not intercept | PASS in every attempt (no wrong-destination travel observed) |
| Camera motion does not invalidate interaction | **NOT YET** — it delays delivery under automation |
| Desktop and mobile verified | desktop only this pass |
| HUD functionality intact | spot-checked (entry, nav), not exhaustively re-tested |

Mission B is **not passed**, and is much closer than at any previous point.
Missions C–G remain unstarted.
