# MISSION 5.4B.9 — PRESS-OWNED PORTAL IDENTITY

## 1. Commits

- Start: `1a22433` (Mission 5.4B.8, wall-clock transition timing)
- Application fix + tests + evidence: this mission's commit on `claude/mission-5-4-spatial-interaction`
- Canonical `claude/master-integration`: untouched (`ce768e0`)

## 2. Exact root cause of the wrong-neighbour activation

A press has two ends and the app was deciding its identity at the **second** one.

`Portal` kept a per-mouth press record, but its own `onPointerUp` (`endPress`) cleared that
record before the canvas release listener ran — R3F's pointerup handler is registered on the
canvas at renderer creation, so it fires *first*. The owned identity was therefore destroyed
in the ordinary case, and activation fell through to the `click` R3F synthesises from the
release. That click is resolved against **the object under the release pointer**, so when the
rotating field moved a neighbour under the pointer during the press, the neighbour opened
(measured in 5.4B.8: a Studio press travelled to Browser).

The identity existed; the release simply never used it.

## 3. Exact cause of the lost Files activation

Not an activation defect. The press **was never delivered onto a mouth**: at the press pixel
the renderer's own raycast returned `null` (`pressLanding: [{ pick: null, element: "CANVAS" }]`).
At ~3 fps the field moves ~20–30 px per frame, so a press dispatched a frame after the pixel
was verified lands in the gap between mouths — correctly starting nothing. Two presses in the
superseded runs have this signature; no press that reached a mouth failed to activate.

## 4. Press-owned identity implementation

- New pure module `src/app/scene/spatial/pressOwnership.ts`: `claimPress` (records portal id,
  destination, pointer id and origin at pointer-down), `resolvePress` (matches pointer id,
  enforces the 18 px threshold and the one-activation window, and returns
  `activate` with **the claimed press** — it never re-resolves a portal), `refusesBusyFlight`.
- `SpatialPortals` now owns **one** press record and **one** canvas `pointerup`/`pointercancel`
  pair for the whole field. The mouth only claims (`onPointerDown`) and reports cancellation.
  The release travels to `owned.portalId`.
- The click R3F derives from the same press is recognised and discarded (`lastResolvedAt`
  window), so one press is one activation. Keyboard activation bypasses only the press window,
  never the runtime guard.
- The flight guard is now read from `runtime.getState()` at activation time, not from a
  render-time closure that can be a frame stale.

## 5. Pointer cancellation and threshold

- `drag` (press, move +60/+40, release there): refused, `moved` paste, `onSelect` 0, scene stayed `core`.
- `cancel` (real touch start, then a real touch cancel): claim recorded, **no** resolution,
  `onSelect` 0, scene stayed `core`.
- 18 px boundary pinned in `tests/portal-press-ownership.test.ts` (18 px activates, 19.5 px refuses).
- Wrong pointer id: refused (`tests/portal-press-ownership.test.ts`).
- A press that starts outside a portal has no record, so nothing can activate on release.
- A press cannot outlive its field: the effect cleanup drops the record.

## 6. GSAP regression findings

`ticker.lagSmoothing(0)` stays. It is asserted by `tests/tween-driver-lagsmoothing.test.ts`
(spies on the shared ticker and requires the driver to disable it), and completion/monotonicity
by `tests/tween-driver.test.ts`. Live travel in this mission ran 603–2762 ms for a 2 s transition,
which is the declared duration, not a clamped crawl. No animation jumps, runaway updates or
premature completion were observed; the runtime still commits the destination in `onComplete`.

## 7–9. Live acceptance

Ten fresh loads, one press each, real CDP mouse input, runtime scene authoritative:

| Destination | Result | Identity held | Wrong destination | Lost press | Duplicate |
|---|---|---|---|---|---|
| Files | **5/5** | 5/5 | 0 | 0 | 0 |
| Studio | **5/5** | 5/5 | 0 | 0 | 0 |

Every attempt: claim at down == resolution at up, movement 0 px, one `onSelect`, one transition,
final scene equal to the pressed portal's destination. Travel 603–1986 ms.

Superseded runs (quoted, not presented as passes): Files 4/5 with one press on empty canvas;
Studio 4/5 with one press that landed on the Browser mouth (which correctly opened Browser).

## 10–11. Regression

- `npx tsc -b --force` → exit 0.
- Full suite → 1743 tests, 1741 pass, **0 fail**, 2 skipped.
- `oxlint` → exit 0 (134 pre-existing warnings, 0 errors).
- `tsc -b && vite build` → exit 0.
- Mobile/touch: **unverified** except that a real touch start/cancel was delivered for the cancel case.

## 12. Evidence

`docs/acceptance/spatial-phase-5-4b-9/`: `files.json`, `studio.json`, `summary.json`,
`edge-cases.json`, per-scenario batch files, and `scripts/probe-press-identity.mjs`.
Mission 5.4B.8 evidence is untouched.

## 13. Remaining blockers

- The `neighbour` scenario did not observe the release pixel being taken by another mouth within
  its 6 s hold (the same mouth was still there). Press-owned identity is proven by the code path,
  unit tests and the 10/10 acceptance, but the explicit "neighbour under the release pixel" swap
  was not captured live.
- The `tap` scenario produced one activation (the second press arrived mid-flight and was
  correctly refused as busy), so "legitimate subsequent tap" is not separately proven.
- Mobile/touch fidelity beyond cancel, and low-FPS behaviour on real hardware, are unverified.

## Status

**Mission B: PASSED** — 10/10 fresh-load journeys, zero wrong destinations, zero lost presses,
zero duplicates, final authoritative scene equal to the pressed portal every time.
