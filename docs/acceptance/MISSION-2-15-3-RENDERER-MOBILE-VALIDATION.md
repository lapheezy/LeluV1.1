# MISSION 2.15.3 — RENDERER, MOBILE VALIDATION & LIFECYCLE CLOSURE

- **Starting commit:** `78815d2` (`claude/mission-2-15-2-mobile-spatial-closure`)
- **Branch:** `claude/mission-2-15-3-renderer-mobile-validation`, isolated worktree
- **Canonical:** `claude/master-integration` at `ce768e08` (re-verified live) — untouched
- **Diff `febc5fa..78815d2` inspected:** 64 lines in `GenesisModuleHost.tsx` + evidence

## 1. Authoritative host — FOUND, and it exposes the real defect (VERIFIED)

Stable identifiers were added (`data-lelu-module-host`, `data-lelu-module-presentation`,
`data-lelu-module-content`; chrome and pin already had theirs). Instrumented probe at
360×640 reports **one** window:

```
{ id: "visualstudio", presentation: "expanded", host: null, x: 16, y: 50, w: 328, h: 540 }
chrome: { y: 72, h: 41 }   canvases: 1   visualViewport: 360×640
```

**On a phone, modules render through the EXPANDED presenter, not the inline host.** The
inline branch — where the 62 % sheet height, the dock snapping and the store-first restore
were written in 2.15.2 — never mounts at phone sizes, so none of that model can apply. The
expanded presenter fixes its own geometry (full available area at 16, 50) and ignores
`position`/`size`, which is why a drag produces dx 0, dy 0 and why `dockRange` computed to
−12 px. This is an application fact, proven from the DOM, not an environment limitation.

**Consequence:** Mission 2.15.2's correction is in the correct component but the wrong
branch for phones. The fix is to route phone modules through the inline host (or give the
expanded presenter the same sheet geometry and dock commit) — a change this mission did not
make, because it would alter presentation behaviour beyond the evidence gathered here.

## 2. Renderer isolation (PARTIALLY ESTABLISHED)

Instrumented timeline (load → gate → open → press → 6 moves → release) completed **without a
crash** in this run: `crashed: null`, no page errors, `canvases: 1` before and after, canvas
count unchanged by the gesture. Console carried only an autoplay warning and two
`ERR_CONNECTION_REFUSED` asset fetches (no backend in this environment).

- Six deaths in 2.15.2 and one earlier at the sign-in gate stand as recorded incidents.
- A run that completes cleanly proves the failure is **intermittent**, not deterministic.
- No `webglcontextlost`/`webglcontextrestored` signal was observed in the instrumented run,
  so no context-loss claim is made.
- No GPU-capable host was available; hardware validation remains **UNVERIFIED**.

Ownership was confirmed intact: module movement does not mount a second canvas, and the
gesture does not remount the renderer (canvas count identical before/after).

## 3. Mobile placement — UNVERIFIED (cause now proven)

At 360×640: window (16, 50, 328×540) before and after the gesture; store entry
`{ moduleId: "visualstudio", x: 8, y: 16, w: 336, h: 528, manual: false }` — the auto
default, not a committed placement. The gestures reach the chrome (chrome box recorded,
pointer sequence executed) but the expanded presenter's geometry is not position-driven, so
nothing moves and nothing commits.

The other three viewports were not re-measured: with the cause established, repeating the
same measurement at more sizes would only reproduce it.

## 4. Mobile persistence — **BLOCKED**

Depends on a committed placement (§3). Same-tab reload harness remains in place and creates
no second WebGL context.

## 5. Creation Studio restoration — **UNVERIFIED**

Not reached in this mission. The identity chain and the store-first restore change from
2.15.2 remain in place but unproven.

## 6. Canvas / context lifecycle

`canvases: 1` on the phone path, unchanged across open, press, move and release. No second
canvas, renderer, host or layout store was introduced by this mission; only test identifiers
were added to the existing host.

## 7. Gates on this tree

| Gate | Result |
| --- | --- |
| `bunx tsc -b --force` | **PASS** (exit 0) |
| `bun run build` | **PASS** (6.69 s) |
| `bun run lint` | NOT RUN on this tree |
| `bun run test` | NOT RUN on this tree (2.15.1 baseline remains 1725 pass / 0 fail / 6 skipped) |

No test result is claimed for this tree.

## 8. Files changed

- `src/app/scene/genesis/GenesisModuleHost.tsx` — stable test identifiers only
  (`data-lelu-module-host`, `data-lelu-module-presentation`, `data-lelu-module-content`).
  No behaviour change.

## 9. Remaining blockers

1. **Phone modules use the expanded presenter**, which ignores position/size — the single
   concrete application defect blocking mobile placement, persistence and its validation.
2. Renderer deaths are intermittent and not yet attributable; no GPU host available.
3. Full test suite, lint and Creation Studio lifecycle not run against this tree.

## 10. Merge readiness — **NOT READY**

The authoritative host question is answered and the mobile blocker is now a specific,
reproducible application fact rather than a mystery. But Gate A, B and C remain unverified
and Gate D is incomplete. Nothing is merged; canonical is untouched; Mission 2.15.2 and
2.15.1 remain published as separate checkpoints.
