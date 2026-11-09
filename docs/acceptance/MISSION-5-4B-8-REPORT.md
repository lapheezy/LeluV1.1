# MISSION 5.4B.8 — Portal-to-Runtime Travel Diagnosis

Status: **NOT PASSED — 8/10 correct travels, one wrong destination.** Root cause
of the travel failure found and fixed; neighbour interception is the last defect.

## 1. Root cause: the transition never advanced

Not a guard, not a contract mismatch, not a rollback. The runtime accepted every
request: `destination: "studio"`, `transition: "studio-entrance"`,
`interaction.mode: "travelling"`, `onSelect` recorded once. **Progress crawled** —
measured on the rail path (no portal involved):

```
0.5 s → 0.001   1.5 s → 0.002   3.5 s → 0.015   5.5 s → 0.051   9.5 s → 0.144
```

A ~2.5 s transition would have needed minutes. Cause: GSAP drives transitions and
its default **lag smoothing** clamps every tick to ~33 ms; under the software
renderer the page runs at ~3 fps, so each 300 ms frame advanced the journey by
33 ms. `src/app/scene/spatial/tweenDriver.ts` now calls
`ticker.lagSmoothing(0)`, so a transition is timed by real elapsed time. This is
the single module that talks to GSAP, so no other behaviour changes.

After the fix, measured live: `rail → studio 1996 ms`, `portal → files 3116 ms,
delivered scene:files`. Travel completes.

## 2. First failing boundary

`SpatialRuntime.travel()` entered, transition created, state mutated, tween
started — and never arrived. The first incorrect state was **transition progress
advancing at ~11% of wall clock**, i.e. inside the tween driver, below every
guard.

## 3. Guard and contract findings

- `busyElsewhere` (portal) and the runtime's duplicate-flight guard behaved
  correctly; no stale busy state observed.
- Destination contract is consistent: portal `spec.destination` → `travel()` →
  `transition.to` → committed `current` all agreed in every successful attempt.
- No rollback: every accepted request that completed reached exactly the
  requested scene.

## 4. Files changed

- `src/app/scene/spatial/tweenDriver.ts` — disable GSAP lag smoothing.
- `src/app/scene/spatial/SpatialPortals.tsx` — (this mission) release read from
  the canvas so a fast press completes when the mouth has rotated away; dev-only
  `__leluSelectCalls` marker.
- Probe: wall-clock travel wait, runtime scene treated as authoritative.

## 5. Live acceptance — five fresh loads per destination

`docs/acceptance/spatial-phase-5-4b-8/{files.json,studio.json,summary.json}`

| Portal | Attempt | Delivered | Landed | Result |
|---|---|---|---|---|
| files | 1 | — (no event) | core | fail |
| files | 2 | `scene:files` | **files** | pass |
| files | 3 | `scene:files` | **files** | pass |
| files | 4 | `scene:files` | **files** | pass |
| files | 5 | `scene:files` | **files** | pass |
| studio | 1 | `scene:studio` | **studio** | pass |
| studio | 2 | `scene:studio` | **studio** | pass |
| studio | 3 | `scene:studio` | **studio** | pass |
| studio | 4 | `scene:studio` | **studio** | pass |
| studio | 5 | **`scene:browser`** | browser | **fail (wrong destination)** |

- Files **4/5**, Studio **4/5**; eight correct arrivals where the series
  previously had zero.
- **One wrong destination**: a press aimed at Studio resolved to its neighbour
  `scene:browser`. The delivered identity was `scene:browser`, so this is a
  targeting/interception failure at press time, not a resolution failure — the
  field had rotated between the pixel measurement and the press.
- No duplicate activations; no premature-transition travel observed.

## 6. Regression

`npx tsc -b --force` — 0 errors. Portal/spatial tests — 40 pass, 0 fail.
Full suite, lint, build, mobile: not run.

## 7. Remaining blockers

1. One activation lost (files attempt 1: press reached canvas, no event).
2. One neighbour interception (studio → browser) when the measured pixel drifts
   onto an adjacent portal.
3. 5/5 per destination not yet reached, so Mission B is **NOT PASSED**.
