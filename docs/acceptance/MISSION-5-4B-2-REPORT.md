# MISSION 5.4B.2 — Portal Hit Identity & Settled-Frame Verification

Status: **UNVERIFIED — experiment could not be driven to a valid click.** The
instrumentation is in place and measured real data, but in this environment no
pointer click reached a portal handler at all, so the A/B/C question is not yet
answered. Per the brief, geometry was **not** changed.

## 1. Baseline

| Fact | Value |
|---|---|
| Mission branch | `claude/mission-5-4-spatial-interaction` |
| Starting commit | `d8ab1c8` |
| Canonical HEAD (`git ls-remote`) | `ce768e0` — concurrent work, untouched |
| Working tree at start | clean |
| TypeScript | `npx tsc -b --force` — 0 errors |

## 2. Instrumentation added (development only)

### `src/app/scene/spatial/portalTrace.ts` (new)

A fixed-size ring buffer (240 entries) exposed as `window.__leluPortalEvents`,
written only when `import.meta.env.DEV`. Every entry records, in the frame the
handler ran:

- `performance.now()` timestamp, pointer client X/Y and NDC
- the event object's **own** `userData.portalId`, its object name and the
  destination the component would travel to
- hit distance, hit point, and **all** intersections with name, portal id and
  distance (so intersection ordering is visible, not inferred)
- camera position, quaternion and full projection matrix
- viewport width/height and device pixel ratio
- the projected client-space centre of the object that was actually hit
- the camera-settlement reading at that instant
- the runtime's scene, transition kind and travel destination

### `SpatialPortals.tsx`

- The hit disc's real `onClick` writes that trace before doing anything else.
- `CameraSettleProbe` publishes `window.__leluCameraSettle` every rendered frame:
  frame id, consecutive stable frames, per-frame position and rotation deltas.
  Development only.
- Window probe additionally exposes the identity of the drawing canvas
  (`data-spatial-canvas="genesis"`), because the page has three canvases.

### `docs/acceptance/spatial-phase-2-13/scripts/probe-settled-targets.mjs` (new)

Settlement-gated experiment: waits for no flight and a run of stable frames,
aims at the portal's own projected centre, clicks with real pointer input,
reads the trace for the delivered identity, waits for the flight to end and
records the landed scene. Per-attempt records include aimed id, aimed screen
point, delivered portal id, delivered destination, intersections, settlement at
click, transition destination and landed scene.

## 3. What was measured

### 3.1 The Core camera never settles

`window.__leluCameraSettle` on an idle Core:

```
{ frame: 60, stableFrames: 0, deltaPosition: 0, deltaRotation: 0.0049,
  position: [-5, 3, 5], quaternion: [-0.1329, -0.3787, -0.055, 0.9143] }
```

Position does not change; **rotation changes every frame** (~0.005–0.006 rad).
`stableFrames` therefore never rises above 0, and any screen coordinate sampled
before a click is already stale by the time the pointer lands. This is direct
evidence for **Case C (frame staleness)** as a real, contributing factor — not a
hypothesis. It also invalidates the earlier 5.4B measurement that clicked a
point 44 px off the portal centre: the projection it used was from a different
frame.

### 3.2 No click reached a portal at all in this environment

With the entry gate relaxed (no flight running, settlement recorded but not
required), the experiment ran six attempts across `files` and `studio`:

| Measurement | Result |
|---|---|
| Portal field rendered | 11 registry / 11 drawn / 11 on screen |
| Overlapping interactive mouths | `[]` |
| Trace entries produced by clicks | **0 on every attempt (`delivered: null`)** |
| Aimed points | `(8, 750)`, `(50, 365)` … — the field orbits with the camera |
| Landed | `core` once, `media` once, otherwise aborted |

`delivered: null` means the R3F handler never ran: the pointer never reached the
Genesis canvas. The cause is visible in the entry record:

```
immersive: "false"
```

The app never entered immersive mode, so the home HUD sits over the canvas. The
orb is a toggle whose state is published as `data-immersive="false"`; pressing
the visible orb (by real pointer and by its own `.click()`) did not change that
state in this headless session. With the HUD up, clicks land on dashboard
controls — which is also why an earlier attempt "travelled to `media`": the
dashboard's activity card opens the media surface, not a portal.

## 4. Diagnosis, stated at its true confidence

- **A (R3F delivers the wrong portal): UNTESTED.** No handler ran, so no
  delivered identity exists to judge.
- **B (delivered portal, wrong destination): UNTESTED.** Requires A to run.
- **C (stale coordinates / unsettled camera): CONFIRMED PRESENT.** The Core
  camera rotates continuously (`stableFrames: 0`); projections used by earlier
  probes were from earlier frames.
- **D (world hits clear, screen hits overlap): NOT DECIDED.** World-space
  overlap is proven absent; whether the projection of that safe layout still
  overlaps under a rotating, tilted camera is unmeasured — and cannot be
  measured until a click reaches the canvas.

What is **ruled out** as the explanation for the 5.4B `files → media` result: it
is not evidence that the geometry still overlaps, and it is not evidence that
R3F mis-delivers. In that run the pointer was 44 px off centre and the camera was
moving; and this session shows the same class of failure is reproducible purely
by clicking the HUD instead of the canvas.

## 5. Blocker for the next pass (exact)

The experiment needs a world state in which the pointer meets the Genesis canvas.
Two options, in order:

1. **Drive the app's own entry affordance correctly.** Find what actually
   switches `HomeStore.immersive` in this build — the orb's handler has branches
   (`setImmersive(true)` when at home, toggle otherwise) — and assert
   `data-immersive === "true"` before any attempt. Record the DOM path taken.
2. **Or measure in a state where no HUD covers the field** (for example the
   Cosmos surface, where the home dashboard is already closed), provided the
   portal field is the same mounted component — it is: `<SpatialPortals />` lives
   in the Genesis renderer, not in a route.

Once a click reaches the canvas, `__leluPortalEvents[-1].delivered.portalId`
answers A immediately: if it differs from the aimed id, the failure is identity
(A/D); if it matches and the scene differs, it is resolution (B).

## 6. Regression status

| Check | Result |
|---|---|
| `npx tsc -b --force` | 0 errors |
| `tests/portal-field.test.ts` + `tests/spatial-experience.test.ts` + `tests/spatial-portals.test.ts` | 40 pass, 0 fail |
| Full suite / lint | **not run this pass** — the runner killed the earlier long runs; instrumentation is DEV-gated and adds no production path |

Preserved: deterministic slots, stable destination identity, no world-space
mouth overlap, extra-portal orbits, portrait fitting, registry persistence, and
the existing renderer/camera/transition architecture.

## 7. Acceptance

| Criterion | Status |
|---|---|
| R3F delivered identity matches the aimed portal | UNVERIFIED — no handler ran |
| Two portals independently selectable by real canvas click | UNVERIFIED |
| Five repeated clicks per destination resolve correctly | UNVERIFIED |
| Camera settlement established at click time | **FAIL** — never settles (measured) |
| No neighbouring portal intercepts | UNVERIFIED |
| World-space mouths do not overlap | PASS (measured, `[]`) |

Mission B remains **not passed**. Missions C–G not started.
