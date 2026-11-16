# MISSION 2.15 — TOUCH, PORTAL TRAVEL & PERSISTENT WORLD

Continues from the verified Mission 5.2 acceptance completion.

- **Starting commit:** `68fd4f9` (branch `claude/mission-5-2-acceptance-completion`)
- **Work branch:** `claude/mission-2-15-spatial-world`, isolated worktree `wt-215` created at `68fd4f9`
- **Canonical:** `claude/master-integration` still at `ce768e08`; nothing merged into it, nothing force-pushed
- **Concurrent Mission 5.3 work:** preserved. Its uncommitted `PortalRegistry.ts` / `SpatialNavigator.tsx` edits (a collision-free portal id and a Creation Studio rail control) were **imported as a patch** into the mission worktree and reconciled here; the shared worktree still holds them uncommitted, unmodified.

Every result is classified VERIFIED / PARTIALLY VERIFIED / UNVERIFIED / FAILED / BLOCKED.

---

## 1. Mission B — real portal travel: root cause and fix (VERIFIED)

**The architectural reason travel controls were absent.** Two independent gaps compounded:

1. `PortalRegistry.seedRing()` — which gives every built-in destination a stable `scene:<destination>` identity — was called **only from `SpatialPortals.tsx`**, the 3D field. The navigator's panel listed `registry.list()` but never seeded it, so the panel's world depended on the 3D field having mounted first.
2. Even when seeded, `SpatialNavigator` rendered **only non-built-in portals** (`customPortals`); the built-in ring existed exclusively as clickable 3D torus meshes. With no user-created portals, the panel said “Only the built-in ring exists” while rendering **zero** travel controls. That is exactly the `[data-portal-travel]` count of 0 observed at both widths.

**The fix (not a decorative button):** the panel now seeds `RING_SCENES` through the same idempotent `seedRing`, and renders one real travel control per registered built-in destination — `data-portal-travel="scene:<destination>"`, resolved through the existing `planTravel()` → `SpatialRuntime.travel()`, the same path the 3D portals and the rail use. No second registry, no second router.

**Registered destinations and ids observed at runtime (11 built-ins + `core` as a control):**

`scene:galaxy`, `scene:planet`, `scene:portal`, `scene:agents`, `scene:browser`, `scene:studio`, `scene:research`, `scene:projects`, `scene:files`, `scene:media`, `scene:conversation` — plus `core` (the world itself, not a portal).

**Travel is genuine and back-and-forth works.** Ten transitions, verified by the active scene (`[data-spatial-nav][data-spatial-current]` must equal the destination with no transition in flight; the harness aborts on a miss):

| Session | Steps | Result |
| --- | --- | --- |
| Run 1 (720×520) | 5 | **5/5 verified**, 2 710 / 43 703 / 14 180 / 29 419 ms |
| Run 2 (720×520) | 5 | **5/5 verified**, 19 315 ms (last), no crash |

Destinations alternated `core → studio → core …`; the transition kind observed in flight was `studio-entrance` and the return is `return-to-core`. The run is split into two sessions of five **only** because the execution platform caps a single command at five minutes; each session is consecutive.

## 2. Mission C — ten-transition memory (PARTIALLY VERIFIED)

Measured per session, sampled after each settled arrival (`performance.memory.usedJSHeapSize`; `--enable-precise-memory-info`):

| Session | Heap samples (MB) | Canvases | DOM nodes |
| --- | --- | --- | --- |
| Run 1 | 264.4 → 411.7 → 420.3 → 403.8 → 405.7 → 385.7 | 3,1,3,3,3,3 | 1070 → 1204 |
| Run 2 | 255.3 → 399.8 → 408.5 → 404.9 → 489.7 → 408.0 | 3,1,3,3,3,3 | 1071 → 1198 |

- Each session rises from a ~260 MB cold baseline to a ~400–410 MB plateau on the **first** transition, then oscillates (one 490 MB spike, then back to 408).
- No monotonic growth across ten transitions; canvas count returns to 3 and DOM nodes stay within ~1070–1210.
- **`window.gc` is not exposed**, so retained-versus-allocator-slack cannot be separated. No leak is claimed, and no absence of leak is claimed. This is why the classification is PARTIALLY VERIFIED.

## 3. Mission A — real touch placement (UNVERIFIED / BLOCKED)

- Touch input **does** reach the host: pointerdown 1 / pointermove 10 / pointerup 1 on `[data-lelu-module-chrome]`, and the layout counter became `1 placed · 0 pinned` (recorded in `docs/acceptance/spatial-phase-2-14/touch-diagnostic-390x844.json`).
- **A measured nonzero rect delta at a phone viewport was not obtained.** The phone sheet is clamped to x 0–32 px / y 16–106 px, and the run that attempted to record the delta ended with the renderer/browser closed when a second page (second WebGL context) was created for the persistence step.
- Therefore touch placement and touch persistence remain **UNVERIFIED**. What *is* verified is pointer placement, pin/reposition/unpin and fresh-document persistence at desktop (Mission 5.2, commit `68fd4f9`).

## 4. Mission D — Creation Studio integration (VERIFIED for reachability, PARTIALLY VERIFIED overall)

- The canonical implementation is `GenesisCreationStudio` (panel id `creation`), mapped in `GenesisInterface`'s `MODULE_RENDERERS` alongside `visualstudio`.
- Reachable in **6.6 s** from the spatial rail's `[data-spatial-control="creation"]` control (reconciled from the concurrent 5.3 work; before it, the spatial shell had no Creation Studio entry point at all).
- Window `[data-lelu-module-window="creation"]` at (88, 64) 922×638 with module chrome and pin control, `[data-lelu-studio-library]` present, and exactly **one** module window.
- Layout persistence uses the single store: `localStorage` holds only `lelu.lelu.layout.v2` — no duplicate layout store, no competing spatial host. Visual Studio is untouched and still present.
- Drag/pin/persistence **under the Creation window itself were not executed** (the harness exceeded the command cap), so its placement lifecycle is inferred from sharing the identical host, store and controls — not measured. PARTIALLY VERIFIED.

## 5. Mission E — performance and reliability (measured, environment-limited)

- All timings are **SwiftShader software rendering on a shared VM**; they are not GPU or hardware benchmarks.
- A transition costs 2.7–43.7 s wall-clock here; the same code path commits deterministically, verified by scene identity.
- The camera is untouched: continuous cinematic animation still runs during interaction; nothing was frozen to make travel work.
- **Known environment failure:** compositing the portal panel over the live WebGL canvas during a long transition killed the renderer once (`page.waitForTimeout: Target page, context or browser has been closed`) at 900×650, matching the recorded handoff note. Mitigated in the harness by closing the panel immediately after selecting a destination; with that, ten transitions ran without a crash.

## 6. Gates on this tree (`68fd4f9` + these changes)

| Gate | Command | Result |
| --- | --- | --- |
| TypeScript | `bunx tsc -b --force` | **PASS** (exit 0) |
| Build | `bun run build` | **PASS** (exit 0, 6.98 s) |
| Lint | `bun run lint` | **PASS** — 0 errors, 130 warnings |
| Full test suite | `bun run test` | **FAILED** (exit 1) |

The failing assertion is a mobile-layout overflow measurement, not a spatial/travel test:

```
actual:   'content 520px wide in a 358px box; the overflow begins at: div "Default Identity"
           (width 520px, needs at least 414px, display flex) → button "Identity"
           (width 200px, needs at least 66px, min-width auto)'
expected: /... button "Identity" (width 200px, needs at least 59px, min-width auto)/
```

Cause not established: it is a measurement that differs by 7 px, in code this mission did not touch, and could be a font-metric/headless-layout difference or a real regression from concurrent work. It is recorded as FAILED, not waived. (An earlier invocation that reported “Promise resolution is still pending” was my own 200 s timeout truncating the runner, not a test result.)

## 7. Remaining blockers and merge readiness

1. **Touch placement delta + touch persistence** — unverified; needs a single-context runner without a second WebGL context.
2. **Ten-transition series split** across two sessions because of the platform's five-minute command cap; memory needs an exposed GC to separate slack from retention.
3. **Full test suite fails** on the mobile-overflow assertion above; that must be resolved before any integration.
4. **Creation Studio drag/pin** unmeasured under its own window.

**Merge readiness: NOT READY.** The portal-travel repair is sound and verified end-to-end, but a failing suite and an unverified touch lifecycle are exactly the conditions this mission said must stop dependent work. The branch is published for review only; `claude/master-integration` is untouched.

## 8. Files changed

- `src/app/scene/spatial/SpatialNavigator.tsx` — seed the registry's ring in the navigator; render a real travel control per built-in destination; Creation Studio rail control (reconciled from concurrent work).
- `src/app/scene/spatial/PortalRegistry.ts` — collision-free portal id (reconciled from concurrent work, unchanged in behaviour).
- `docs/acceptance/spatial-phase-2-15/` — `transitions-720x520-run{1,2}.json`, `portal-travel-memory-*.json`, `ten-transitions-720x520.json`, screenshots, and the Creation Studio probe.

## 9. Evidence index

- Travel + memory: `docs/acceptance/spatial-phase-2-15/transitions-720x520-run1.json`, `…run2.json`
- Portal census with ids: `docs/acceptance/spatial-phase-2-15/portal-travel-memory-1440x900.json`
- Mobile touch state (from 5.2): `docs/acceptance/spatial-phase-2-14/touch-diagnostic-390x844.json`
- Pointer placement/persistence (verified): `docs/acceptance/MISSION-5-2-ACCEPTANCE-COMPLETION.md`, commit `68fd4f9`
