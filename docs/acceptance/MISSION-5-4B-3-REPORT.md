# MISSION 5.4B.3 — Real Immersive Portal Interaction

Status: **UNVERIFIED — the world opens, the raycast aims correctly, the click is
intercepted before it reaches the canvas.** Portal geometry was not modified.

Branch `claude/mission-5-4-spatial-interaction`, starting commit `c58247a`.

## 1. Immersive entry — SOLVED, with a defect found on the way

The navigator orb cannot be used as the entry affordance. Measured at its own
centre (720, 841):

```
DIV[data-spatial-group="communication"]   ← covers the button
DIV[data-spatial-groups="true"]
SPAN.lsn-orb-core
BUTTON.lsn-orb
```

The spatial communication HUD is laid over the orb, so a real pointer press at
the orb's coordinates is delivered to a `<div>` and `HomeStore.setImmersive`
never runs. That is an interface defect in its own right: the control a person
is told to tap is covered by other chrome.

The application's second, equally user-facing affordance works:

| Step | Evidence |
|---|---|
| Control | `button.lch-round.lch-cosmos` ("Look at the Cosmos") at (1246, 94) |
| Stack at that point | `SPAN.lch-cosmos-core` → `BUTTON.lch-cosmos` → `DIV.lch-header-right` |
| Press | real pointer (`page.mouse.click`) |
| `data-immersive` | `"false"` → **`"true"`**, stable across 24 samples (~2.6 s) |
| `window.__leluImmersive` | `null` → **`true`** |
| Home (`showHome`) | hidden (`GenesisInterface`: `!homeStore.immersive`) |
| Genesis renderer | still mounted; field reports 11 registry / 11 drawn / 11 on screen |

No DOM attribute was written by the harness: the transition is the app's own.

## 2. Camera settlement — the Core never holds still

`window.__leluCameraSettle` sampled on the immersive Core:

```
entry:  deltaPosition 3.0054  deltaRotation 0.4270  stableFrames 0
idle:   deltaPosition 0       deltaRotation 0.0049  stableFrames 0
```

The movement comes from `GenesisCameraController`: its `useFrame` calls
`controls.update()` every frame and lerps `controls.target` (`0.04`–`0.06` per
frame) toward the origin or the surface under the camera while
`OrbitControls.enableDamping` is on. Position can be still while orientation
keeps changing, so a "camera has not moved for N frames" gate never opens. The
motion is intentional (framing / docking / descent), not a bug, and it must not
be removed to make a test pass.

Consequence, and the reason this matters: **a screen coordinate sampled in one
JavaScript task is stale in the next.** During entry the camera moves ~3 world
units and ~0.43 rad per frame.

## 3. First real portal click — the trace is empty, and why

Six attempts, immersive confirmed, settlement gate relaxed to "no transition
running" (settlement is recorded, never faked). Result for the two attempts that
reached the click stage:

| Aimed | Projected centre | Raycast at that pixel | Top element at that pixel | Portal handler ran | Landed |
|---|---|---|---|---|---|
| `scene:files` | (588, 506) | `scene:files` | **`BUTTON`, `DIV`**, then `CANVAS` | **no** (`delivered: null`) | `core` |
| `scene:studio` | (878, 67) | `scene:studio` | **`DIV`, `DIV`**, then `CANVAS` | **no** (`delivered: null`) | `media` |

This is the answer to the A/B/C question, and it is none of them:

- **The raycast geometry is correct.** At the projected centre of both portals,
  `__leluPortalPick` returns exactly that portal.
- **The event never reaches the canvas.** `document.elementsFromPoint` at the
  same pixel returns HUD nodes above the canvas, and those nodes have
  `pointer-events: auto`. The click is delivered to the interface layer, which
  is what opens `media` — the same symptom seen in 5.4B and previously blamed on
  portal ordering.
- **The trace proves the handler never ran** (`delivered: null`), so this is not
  a mis-delivered identity and not a registry-resolution error.

So: world-space mouths do not overlap (PASS, unchanged), the aim is correct,
and the interaction is lost to interface layering above the canvas. Camera
motion compounds it — coordinates are stale — but the interception alone is
sufficient to explain every wrong destination measured so far.

## 4. Diagnosis

| Case | Status |
|---|---|
| A — R3F delivers the wrong portal | **RULED OUT as the cause observed**: no R3F event was produced at all |
| B — delivered portal, wrong destination | **UNTESTED** (needs a delivered event) |
| C — stale coordinates / unsettled camera | **CONFIRMED PRESENT**: camera never settles; projections stale |
| D — screen-space overlap of clear world hits | **NOT DECIDED** — untestable until a click reaches the canvas |
| E — **interface layer intercepts the click** | **CONFIRMED, primary cause** |

The fix therefore belongs to interface layering — the immersive world must
receive pointer input where the field is drawn, for example by making the
non-interactive chrome `pointer-events: none` and keeping only real controls
interactive — not to portal geometry. That change is a product/UI decision and
was deliberately not made here.

## 5. What is needed next (exact)

1. Make the immersive chrome stop covering the field: the stack at both portal
   centres is HUD, not canvas. Until that changes, no genuine click can reach a
   portal anywhere on screen.
2. Then rerun `docs/acceptance/spatial-phase-2-13/scripts/probe-settled-targets.mjs`.
   The trace now answers A/B immediately: read
   `window.__leluPortalEvents.at(-1).delivered.portalId`.
3. Keep verifying aim with `document.elementFromPoint` — a `canvasOnTop: false`
   reading must abort the attempt rather than count as a click, which this run
   now records.

## 6. Gates

| Check | Result |
|---|---|
| `npx tsc -b --force` | 0 errors |
| `portal-field` + `spatial-experience` + `spatial-portals` | 40 pass, 0 fail |
| Full suite / lint | not run this pass |

Preserved: geometry untouched, instrumentation intact, deterministic slots,
stable identities, no world-space overlap, orbits, portrait fitting, registry
persistence, renderer/camera architecture, and canonical branch untouched
(`ce768e0`).

## 7. Acceptance

| Criterion | Status |
|---|---|
| Real immersive entry through an app affordance | **PASS** (evidence above) |
| Camera settlement at click time | **FAIL** (measured; motion is intentional) |
| R3F delivered identity matches aim | **UNVERIFIED** — no event delivered |
| Two portals independently selectable | **UNVERIFIED** |
| Five repeats per destination | **UNVERIFIED** |
| No neighbouring portal intercepts | **UNVERIFIED** |

Mission B remains **not passed**. Missions C–G not started.

## 8. Addendum — the first click that reached the canvas, and the one that could not

`probe-first-real-click.mjs` searches *inside each portal's mouth* for a pixel
that satisfies both conditions at once: the top DOM element is the Genesis
canvas, and the raycast at that pixel returns the aimed portal. Only such a pixel
is clicked.

| Destination | Pixels sampled in the mouth | Canvas on top | Result of the real click |
|---|---|---|---|
| `scene:files` | 84 | **0** — every pixel is a `BUTTON` | not clicked: no uncovered pixel exists |
| `scene:studio` | (scan stopped at first hit) | 1 at (806, 396) | click delivered, **no R3F event** (`delivered: null`), scene stayed `core` |

Two distinct, measured obstacles:

1. **For `files`, the portal is entirely behind interface chrome.** Not a single
   pixel of its mouth is reachable by the pointer. The raycast is correct at every
   one of those pixels; the DOM simply does not let the press through.
2. **For `studio`, the single reachable pixel was reachable only at sampling
   time.** The click produced no event at all, while the camera rotated at
   `deltaRotation 0.0049` per frame (~0.3°). Between the scan and the press — a
   few frames — the mouth moved out from under that one pixel. Position was
   static (`deltaPosition 0`), so this is orientation drift, exactly the Case C
   condition measured earlier.

So a click can only be attributed once the field is both **uncovered** and
**not moving** between measurement and press — or once the aim is computed in the
same frame as the press. Neither is true today, and neither is a portal geometry
problem.

## 9. Final position for Mission B

- The world can be entered through the app's own affordance (PASS, evidenced).
- The raycast at a portal's projected position returns that portal (PASS,
  evidenced at every sampled pixel).
- World-space interactive mouths do not overlap (PASS, carried forward).
- A real pointer press cannot reach a portal, because chrome covers the field;
  where chrome does not cover it, the field moves between sampling and pressing
  (FAIL, evidenced).
- Therefore Mission B stays **not passed**, and the next change is interface
  layering (`pointer-events` on the immersive chrome and placement of the HUD)
  plus an in-frame aim strategy — not geometry.
