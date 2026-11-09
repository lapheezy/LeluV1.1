# MISSION 5.4B.10 — SPATIAL HARDENING & INTEGRATION READINESS

## 1. Starting and final commits

- Start: `fff0f86c5e273eab5798fefd1156a207a71e9915` on `claude/mission-5-4-spatial-interaction`
- Work branch: `claude/mission-5-4b-10-spatial-hardening` (created from that commit)
- Final: this mission's commit on the work branch. The 5.4B.9 application code was **not modified** —
  only the acceptance probe and evidence changed.

## 2. Remote verification

- `claude/mission-5-4-spatial-interaction` live tip: `fff0f86c…` (matches local, clean tree).
- Canonical `claude/master-integration` live tip: `ce768e08…` (unchanged by this mission).
- Merge base with canonical: `91f5361`; branch is **57 commits behind**, **11 ahead**.

## 3. Additional implementation changes

None to the spatial interaction itself. `pressOwnership.ts`, `SpatialPortals.tsx`, the canvas-level
pointer ownership, pointer-id validation, 18 px threshold, cancellation, duplicate suppression,
busy-flight protection, the runtime-state guard and GSAP `lagSmoothing(0)` are untouched.
The only change is the acceptance probe (`assets/probe-press-identity.mjs`), which gained `swap`,
`retap`, `touch`, `touchdrag` and `lowfps` scenarios.

## 4. Neighbour-swap evidence — **BLOCKED (environment)**

Attempted live, through the real pointer pathway: press portal A at the edge facing its nearest
neighbour B (`lastA` (292,693) → Files, `firstB` (297,708) → Media, 16 px apart), hold the pointer
perfectly still, then release.

- Hold duration: **32,024 ms**.
- Portal under the pointer at release: **scene:files — still A**.
- Travel: Files, 1322 ms, claim == resolution == Files.

Why the swap never occurred: the ring is re-fitted to the drawing surface from the runtime's own
scene pose whenever the layout or pose changes, so in a settled world the mouths do not drift under a
stationary pointer. Six viewport re-fits were applied to force the re-layout; the pixel still
raycast to the same mouth. A **live** neighbour-under-the-release-pixel swap is therefore not
producible in this build through a still pointer.

What *is* proven: release never re-picks a portal (`resolvePress` returns the claimed press),
the unit tests cover movement inside/outside the threshold, and 5.4B.9 landed 10/10 with
claim == resolution. I am **not** claiming the live swap succeeded.

## 5. Subsequent independent tap — **PARTIAL**

Same page, two separate presses on Files:

| Round | Claim at down | onSelect | Runtime scene | Travel |
|---|---|---|---|---|
| 1 | scene:files | 1 | files | 2423 ms |
| 2 | none | 0 | core | — |

Round 1 confirms activation once, completion, and no stale ownership blocking the second attempt.
Round 2's press reached **no mouth at all** (claim null, onSelect 0, no `duplicate`/`busy` refusal
record) — a delivery miss after returning to the core view, not an ownership guard. The subsequent
independent tap is therefore **not fully proven**; I am not presenting round 2 as a pass.
This is distinct from a press during an active transition, which is refused as busy by the runtime
guard (observed in 5.4B.9's tap run: one activation only).

## 6. Mobile / touch results

Conditions: **browser-emulated touch** via CDP `Input.dispatchTouchEvent` with a `hasTouch` context
on the cloud Chromium (software rendering). **No physical device was available.**

| Case | Claim | Movement | Resolution | Scene |
|---|---|---|---|---|
| touch tap (2 px move) | scene:files | 3 px | activated | files (1629 ms) |
| touch drag (60/40 px) | scene:files | 72 px | refused (`moved`) | core |
| touch cancel | scene:files | — | no resolution, onSelect 0 | core |

Pointer identity is preserved, the threshold applies identically to touch, and cancellation clears
ownership without travel.

## 7. Low-FPS measurements

Conditions: CDP `Emulation.setCPUThrottlingRate(6)` on the existing software renderer, page-side
50 ms sampler.

- Travel completed in **1887 ms** for a ~2 s transition, final authoritative scene **files**.
- No premature commit, no duplicate transition, no stale transition state.
- The sampler itself only captured a post-completion sample (round-trip cost under throttle), so
  monotonic progress is evidenced by `tests/tween-driver.test.ts` (monotonic, completes exactly once)
  and `tests/tween-driver-lagsmoothing.test.ts` (lag smoothing is 0), not by this series.

## 8. Full regression

| Gate | Command | Result |
|---|---|---|
| Typecheck | `bunx tsc -b --force` | exit 0 |
| Build | `bun run build` | exit 0 |
| Lint | `bun run lint` | exit 0 — 134 pre-existing warnings, 0 errors |
| Tests | `bun run test` | exit 0 — **1756 tests, 1754 pass, 0 fail, 2 skipped** |

Historical 5.4B.9 result preserved and unchanged: 1743 tests, 1741 pass, 0 fail, 2 skipped.

## 9. Canonical integration findings

- Canonical is 57 commits ahead; our branch changed 92 files against the merge base.
- Exactly **one** file changed on both sides: `src/app/scene/spatial/SpatialNavigator.tsx`.
- Our core interaction files (`SpatialPortals.tsx`, `SpatialRuntime.ts`, `tweenDriver.ts`,
  `index.css`, `GenesisCore.tsx`) are **untouched on canonical**.
- `git merge-tree` reports conflicts in `GenesisChat.tsx` and `GenesisInterface.tsx` — canonical
  removed the old chat panel and rewrote the chat surface (Missions 10.3 and the Chat Universe work),
  which collides with our 5.4B.4 routing edits to those surfaces.
- Canonical does not contain our `composerClearance.ts`-adjacent work; no second portal system
  exists on either side, so the interaction model can be carried over unchanged.

**Recommended integration strategy:** replay the 11 mission commits onto current canonical
(cherry-pick or a fresh integration branch), then reconcile `SpatialNavigator.tsx` (both sides
touched it) and re-apply the pointer-routing rules to canonical's new chat surfaces. Do not
plain-merge, and do not overwrite canonical's removal of the old chat panel.

Mission 2.15.x (mobile window placement) is a separate workstream and is **not** addressed or
claimed here.

## 10. Merge-readiness decision

**Not merge-ready as a plain merge.** The interaction implementation itself is ready and
self-contained; the blockers are (a) `SpatialNavigator.tsx` edited on both sides, (b) canonical's
chat-surface rewrite conflicting with our routing edits, and (c) 57 commits of drift. It needs a
replay-and-reconcile integration pass, which should be its own reviewable mission.

## Status

| Criterion | Result |
|---|---|
| 5.4B.9 behaviour intact | yes (no application changes) |
| Live neighbour swap | **blocked by environment** — not claimed |
| Legitimate subsequent tap | partial (round 1 verified, round 2 delivery miss) |
| Touch validated, conditions stated | yes — emulated touch only |
| Low-FPS reliability | yes (1887 ms, correct final scene) |
| Full regression | pass (0 fail) |
| Canonical conflicts resolved or documented | documented precisely |

**Mission 5.4B remains PASSED** (10/10 fresh-load journeys, zero wrong destinations). This follow-up
adds coverage and an integration analysis; it does not invalidate that result.
