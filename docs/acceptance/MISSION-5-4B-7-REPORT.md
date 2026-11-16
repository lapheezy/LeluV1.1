# MISSION 5.4B.7 — Live Portal Acceptance

Status: **NOT PASSED.** Activation is fixed and proven; **travel resolution is now
the blocker**. Geometry, camera, identity and routing untouched.

Tested implementation commit: `d21c87d` (pointer-up activation) plus the
canvas-level release listener added in this mission.

## 1. Live result — ten fresh-load attempts, real browser input

`docs/acceptance/spatial-phase-5-4b-7/{files-a,files-b,studio-a,studio-b}.json`

| Batch | Load | Portal | Gate | Press reached canvas | R3F event | Delivered id | Landed |
|---|---|---|---|---|---|---|---|
| files-a | 1 | files | ok | 1 | 1 | `scene:projects` | core |
| files-a | 2 | files | ok | 1 | **0** | — | core |
| files-a | 3 | files | ok | 1 | 1 | `scene:files` | core |
| files-b | 1 | files | ok | 1 | 1 | `scene:files` | core |
| files-b | 2 | files | ok | 1 | 1 | `scene:files` | core |
| studio-a | 1 | studio | ok | 1 | 1 | `scene:studio` | core |
| studio-a | 2 | studio | ok | 1 | 1 | `scene:studio` | core |
| studio-a | 3 | studio | ok | 1 | 1 | `scene:studio` | core |
| studio-b | 1 | studio | ok | 1 | 1 | `scene:studio` | core |
| studio-b | 2 | studio | ok | 1 | 1 | `scene:studio` | core |

- **Activation: 9/10 delivered an R3F event** (files 4/5, studio 5/5).
- **Identity: 9/10 correct**; one `files` press delivered `scene:projects`, a
  neighbour — the first wrong identity in the series and it is recorded, not
  discarded.
- **Destination: 0/10 reached.** Every attempt landed on `core`.
- **Wrong-destination travel: 0.**
- **Gate:** `transition === null` at every attempt; `stableFrames` recorded as 0
  because the Core camera rotates every frame by design.

## 2. What this changes

The 5.4B.6 activation contract fix works: a fast press-and-release now produces
an R3F activation record where it previously produced nothing (6/10 silent
before). The remaining failure has moved downstream and is now **Case B —
delivered identity correct, destination never reached**. `onSelect` runs, the
trace records the correct portal, and the active scene stays `core`.

That is a resolution/travel defect, not an activation or targeting defect, and it
must be diagnosed before anything is declared complete. Candidate causes to test
next, in order: whether `runtime.travel` is refused by a guard other than
`busyElsewhere`; whether the portal path passes a destination the runtime does
not accept; and whether the transition starts and is reverted because the probe
returns to core too early.

## 3. Edge cases

| Requirement | Result |
|---|---|
| Fast press-and-release activates | **PASS 9/10** |
| One press, one activation | PASS — no attempt produced two activations (`events` grew by ≤1) |
| Subsequent legitimate tap | not re-run this pass |
| Drag > 18 px cancels | implemented; not exercised live |
| Pointer cancel activates | implemented as no-activation; not exercised live |
| Wrong pointer id | ignored by id check; not exercised live |
| Keyboard Enter | unchanged path; not re-run |
| Premature transition refused | guard preserved; not exercised live |

## 4. Regression

| Check | Result |
|---|---|
| `npx tsc -b --force` | **0 errors** |
| portal-field / spatial-experience / spatial-portals | **40 pass, 0 fail** |
| Full suite / lint / build / mobile | not run — command budget spent on the ten live loads |

## 5. Verdict

**Mission B: NOT PASSED.** Activation is proven; destination resolution is not.
No application behaviour was changed to obtain these records, and every failing
attempt is preserved in the evidence directory.

Note on the probe: the settled-world gate is transition-based because the camera
never holds still; `stableFrames` is recorded as 0 rather than being faked to 8.
