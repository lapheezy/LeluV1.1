# MISSION 5.2 — ACCEPTANCE COMPLETION

Manual placement, spatial lifecycle and regression verification against the canonical tree.

- **Base commit tested:** `ce768e0` (Merge remote `claude/master-integration`, the canonical tip at the time of the run)
- **Evidence branch:** `claude/mission-5-2-acceptance-completion` (isolated; `claude/master-integration` was not merged into or rewritten)
- **Preserved prior evidence:** commit `47785f4` on `claude/mission-5-2-acceptance-evidence`
- **Worktree:** isolated checkout of `ce768e0`; the shared Mission 5.3 worktree (with its uncommitted `PortalRegistry.ts` / `SpatialNavigator.tsx` edits) was never switched, stashed, reset or committed.

---

## 1. What was broken, and why

The outstanding requirement was manual module placement: a drag had never produced a recorded placement, and the report of a hung main thread was unexplained.

Two real defects, both in `src/app/scene/genesis/GenesisModuleHost.tsx`, plus the environment's rendering cost:

1. **Every pointer move committed the layout.** `moveModule` → the geometry sync effect → `ModuleLayoutStore.place()` → `commit()` → a synchronous `KvStore`/localStorage serialization of the whole layout **and** a notification that re-rendered the entire spatial navigator. A 16-step drag therefore meant 16 full-surface re-renders and 16 storage writes.
2. **The final placement was never recorded.** After coalescing the writes, the window moved but the counter still read `0 placed`. The sync effect keys on `position.x/y` and `width/height`; when the last animation frame had already applied the final coordinates, those dependencies did not change, so after the gesture flag cleared the effect never ran again and `place()` — the only thing that sets `manual: true` — was never called. Auto-arrange could therefore still move a window the person had just placed by hand.

Measured before any change, 1440×900, module `visualstudio`, real pointer, 16 moves:

| Reading | Before |
| --- | --- |
| Drag wall-clock | **55 004 ms** |
| Long tasks | 17, totalling **49 223 ms** |
| Worst frame gap | **11 252 ms** |
| Window moved | `dx 140, dy 90` |
| Layout counter | **`0 placed · 0 pinned`** |

## 2. The correction (smallest compatible)

Both changes are inside the one window host; no layout engine, camera or scene manager was added.

- Pointer moves now coalesce into **one geometry update per animation frame** (`pendingMoveRef` + `requestAnimationFrame`), and the store-sync effect is skipped while a gesture is in flight (`gesturing`).
- `endDrag` records the gesture explicitly: the final rect is committed to `ModuleLayoutStore.place()` once, which is what marks the entry `manual: true`. A press with no movement is treated as a raise, not a placement. Resizes are recorded the same way.

`git diff --stat`: `src/app/scene/genesis/GenesisModuleHost.tsx | 56 insertions(+), 3 deletions(-)`

### Measured after the fix, same harness, same viewport

| Reading | Before | After |
| --- | --- | --- |
| Drag wall-clock | 55 004 ms | **32 700 ms** |
| Long tasks / total | 17 / 49 223 ms | **10 / 24 808 ms** |
| Worst frame gap | 11 252 ms | **9 112 ms** |
| Layout counter | `0 placed · 0 pinned` | **`1 placed · 0 pinned`** (settled in 2 ms) |
| Window moved | dx 140, dy 90 | dx 140, dy 90 |

Blocking time during a drag was roughly halved. The remaining cost is scenery rendering under SwiftShader on this VM — the 3D surface still takes seconds per frame, so a 16-move drag stays slow here. That is an environment limitation, not a claim of GPU performance.

## 3. Manual placement — pointer (1440×900)

Method: real CDP mouse events (`page.mouse`) — pointerdown on the title bar, 16 pointermoves, pointerup. No DOM `click()`, no direct state mutation. Playwright's actionability wait is bypassed because the animated surface never reports a stable box; the events themselves are genuine browser input at the on-screen coordinates. Post-conditions are polled instead of assumed after a fixed sleep.

| Step | Result |
| --- | --- |
| Open a module by pointer | `visualstudio` window, 1338×818 at (88, 64) |
| Drag by the title bar | (88, 64) → (228, 154), `dx 140 dy 90` |
| Placement recorded | counter `1 placed · 0 pinned`, settled 2 ms |
| Pin | `aria-label="Unpin Visual Studio"`, `aria-pressed="true"`, counter `1 placed · 1 pinned` |
| Reposition while pinned | (178, 124) → (128, 154), counter unchanged `1 placed · 1 pinned` |
| Unpin | label back to `Pin Visual Studio`, counter `1 placed · 0 pinned` |
| Persisted layout | key `lelu.lelu.layout.v2`, 1 manual entry, 233 bytes |
| Fresh document (reload-equivalent) | reopened at (208, 134) vs (208, 134) before close — **dx 0, dy 0** |

Evidence: `drag-after-fix-1440x900.json`, `pin-and-persistence-1440x900.json`, `persistence-1440x900.json`, and the pre-fix baseline `../spatial-phase-2-11/manual-placement-pointer-1440x900.json`; screenshots `1440x900-manual-after-fix.png`, `1440x900-pinned-unpinned.png`, `1440x900-placed-before-fresh-load.png`, `1440x900-restored-fresh-load.png`.

## 4. Manual placement — touch (390×844)

Real CDP touch events (`Input.dispatchTouchEvent`): touchStart → 12 touchMoves → touchEnd on the title bar.

| Reading | Value |
| --- | --- |
| Module window | 358×642 at (16, 101) — a phone-width sheet |
| Events reaching the header | pointerdown 1, pointermove 10, pointerup 1 |
| Layout state after | **`1 placed · 0 pinned`** |
| Rect delta captured in the read window | **not observed** |

So touch placement is registered by the same code path, and the input genuinely arrives, but the phone sheet's clamping leaves almost no travel (x can move only 0–32 px, y 16–106 px) and the rect delta was not captured before the read window closed. **The touch rect shift is UNCONFIRMED**; only the placement state and the event delivery are proven.

Evidence: `touch-diagnostic-390x844.json`, `manual-placement-touch-390x844.json`, `screenshots/390x844-touch-diagnostic.png`.

## 5. Ten-transition memory — UNVERIFIED on this tree

The requirement was ten genuine transitions, each verified by the active scene before sampling.

- **Portal travel is not reachable in this build.** The portal panel reports “Only the built-in ring exists” and `[data-portal-travel]` count is **0** at both 375×812 and 1440×900, so the travel control the previous mission used no longer exists at either width.
- **Scene navigation did not complete a transition.** Driving `[data-spatial-scene="studio"]` from the navigator was attempted once: `before: core`, `after: core` after 25.1 s, `arrived: false`. The run aborted by its own rule rather than sampling a non-transition.
- No heap series is reported. The earlier 5.2 series (`interactive-memory-transitions.json`) remains recorded as a **refuted** attempt and is not a measurement.

Evidence: `memory-ten-transitions-375x812.json` (aborted at step 1, with the control census).

**Result: UNVERIFIED — no leak and no absence of leak is claimed.**

## 6. Regression gates, run on this tree (`ce768e0` + the fix)

| Gate | Command | Result |
| --- | --- | --- |
| TypeScript | `bunx tsc -b --force` | **exit 0** |
| Lint | `bun run lint` | **exit 0** — 0 errors, 124 warnings |
| Tests | `bun run test` | **exit 0** — 1798 tests, **1792 pass, 0 fail, 6 skipped**, 200.7 s |
| Build | `bun run build` | **exit 0** |

An earlier test invocation was killed by the runner restart (exit 137); the numbers above come from the completed re-run, not from that attempt.

## 7. Limitations, stated plainly

- **Software rendering.** Every frame is rasterized by SwiftShader on a shared VM; a drag still takes ~33 s for 16 moves. Nothing here measures GPU performance, and the frame timings are not a benchmark.
- **Module used.** Creation Studio is not reachable from this tree's surfaces (the spatial build has no dock and the rail has no creation control); the **Visual Studio** module was used — same window host, same layout store, same pin control. The placement machinery proven here is the shared one.
- **Touch rect delta unconfirmed** (section 4).
- **Memory unverified** (section 5).
- **Input method.** Real CDP events at coordinates, with Playwright actionability bypassed; labelled as such rather than as `locator.click()`.
- **Scope.** The concurrent Mission 5.3 worktree's uncommitted changes were not touched, reviewed, merged or reverted.
