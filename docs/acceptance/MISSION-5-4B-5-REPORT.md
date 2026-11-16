# MISSION 5.4B.5 — Portal Interaction Reliability

Status: **INCOMPLETE — repeatability not achieved.** No geometry change, no
routing change, no fabricated events. Five-of-five was not reached, so Mission B
remains unpassed.

Branch `claude/mission-5-4-spatial-interaction`. Starting HEAD `7c91d7d`
(verified: clean tree, canonical `claude/master-integration` at `ce768e0`).

## 1. What was built

`docs/acceptance/spatial-phase-2-13/scripts/probe-reliable-clicks.mjs`

- five independent page loads; every attempt enters the world through the app's
  own "Look at the Cosmos" control;
- the target is measured **once, in the page** (canvas-owns-pointer **and**
  raycast-agrees), then the press is dispatched through the browser input
  protocol (`Input.dispatchMouseEvent`: moved → pressed → released) as a burst,
  with no Playwright actionability round trips in between;
- a canvas-level `pointerdown`/`pointerup` counter distinguishes *input never
  arrived* from *raycast rejected it*;
- the R3F handler's own trace (`__leluPortalEvents`) supplies delivered identity
  and camera state at the press frame; the app's spatial state supplies the
  landed destination. Nothing is called directly, no state is written.

`MODE=hold` (press, 110 ms, release) and `MODE=playwright` exist for comparison.

## 2. Measured result (10 attempts, 1440×900, SwiftShader)

`measurements/reliable-clicks-1440x900-burst.json` — the pre-gate burst run.

| Load | Destination | Point | Canvas pointerdown | R3F event | Delivered | Landed |
|---|---|---|---|---|---|---|
| 1 | files | 588,454 | 1 | **0** | — | core |
| 1 | studio | 855,443 | 2 | 1 | `scene:studio` | core |
| 2 | files | — | — | — | — | no reachable pixel |
| 2 | studio | 797,426 | 1 | 1 | `scene:studio` | core |
| 3 | files | 460,602 | 1 | **0** | — | core |
| 3 | studio | 797,412 | 2 | 1 | `scene:studio` | core |
| 4 | files | — | — | — | — | no reachable pixel |
| 4 | studio | 466,365 | 1 | **0** | — | core |
| 5 | files | 460,605 | 1 | 1 | `scene:files` | core |
| 5 | studio | — | — | — | — | no reachable pixel |

**Files 0/5, studio 0/5. Zero wrong destinations. Six of ten presses reached the
canvas and produced no R3F event.**

## 3. What the two counters actually prove

Two separate facts, neither of them about portal geometry:

1. **`down: 1` with `events: 0` — the canvas received the press and R3F produced
   no click.** R3F synthesises `onClick` from a pointerdown/pointerup pair that is
   resolved on the same frame; a burst that releases before the next render has
   no pair to resolve. This is a dispatch-contract issue, and it is why "the
   event never arrived" and "the raycast rejected it" had been indistinguishable
   until now.
2. **When a click *is* delivered (`scene:studio`, `scene:files`), the scene stays
   `core`** — travel is refused because a transition is already in flight
   (`busyElsewhere`). In this run each press fired while the immersive entry was
   still settling. The refusal is correct product behaviour, not a bug: the
   earlier 5.4B.4 successes happened when the press came after the world had
   settled.

So the remaining gap is **test synchronisation and dispatch semantics**, plus
**one real application question**: whether a fast press-and-release should
produce a selection at all. A person pressing a world object expects it to
activate; requiring the release to land in a later render is a plausible
robustness defect in the portal handler, worth fixing in the app rather than
being worked around in the harness.

## 4. Work started but not completed (reported, not claimed)

A ready-gate (`transition === null` and ≥8 stable camera frames before each
attempt) was added to the probe, but its five-load run exceeded the 290 s command
cap, so **the file `reliable-clicks-1440x900-burst.json` is the un-gated run**
and the gated run has no evidence. No numbers above are from the gated code path.

## 5. Gates

| Check | Result |
|---|---|
| `npx tsc -b --force` | 0 errors (unchanged source since `7c91d7d`) |
| portal-field / spatial-experience / spatial-portals | 40 pass, 0 fail |
| Full suite / lint / build / mobile touch | **not run** — cap reached |

No application source changed in this mission: the only additions are the probe
and this evidence.

## 6. Next step, precisely

1. Run the gated probe per destination (`DESTS` filter) so each load does one
   attempt, keeping every run inside the command cap; five loads per destination.
2. Then decide the application question the counters exposed: make the portal
   handler select on `onPointerUp` when a pointerdown landed inside its own mouth
   (pointer capture), so a fast press still selects. That is an interaction
   contract fix, not geometry, and it must be proven with the same trace.

Mission B stays **not passed**. Missions C–G not started.
