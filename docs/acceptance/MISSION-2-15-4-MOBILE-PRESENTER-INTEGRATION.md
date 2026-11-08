# MISSION 2.15.4 — MOBILE PRESENTER INTEGRATION & LIFECYCLE CLOSURE

- **Starting commit:** `e618923` (`claude/mission-2-15-3-renderer-mobile-validation`, remote-verified)
- **Branch:** `claude/mission-2-15-4-mobile-presenter-integration`, isolated worktree `wt-2154`
- **Canonical:** `claude/master-integration` at `ce768e08` (live-verified before work) — untouched
- **Preserved:** `febc5fa`, `78815d2`, `e618923` as separate checkpoints; Mission 5.3's four dirty paths in the shared worktree untouched

## 1. Root cause (confirmed)

Phone modules open with `presentation: "expanded"` (GenesisCore sets it on open). The expanded
presenter rendered a **centred modal** — `width: min(92vw,900px)`, `height: min(84dvh,640px)` —
with no `left`/`top`, so it never consumed `position` or `size`. The 62 % sheet height, the dock
clamping and the store-first restore written in 2.15.2 all live in the inline branch, which never
mounts on a phone. That is the whole defect: the geometry was correct but attached to the wrong
presenter.

## 2. Architectural option chosen — **B (integrate the contract)**

The expanded presentation is not redundant: it owns a backdrop, z-order above the world and the
wider desktop modal. Routing every phone module to the inline host would either strip that or
duplicate it. So the expanded window keeps its role and, **on phones only**, becomes position-driven
from the same contract the inline host uses. Desktop expanded geometry is byte-identical to before.

## 3. Files changed (application)

`src/app/scene/genesis/GenesisModuleHost.tsx`:
- expanded window gains `data-lelu-module-host`, `data-lelu-module-presentation="expanded"`,
  `data-lelu-module-content`;
- expanded window style, when `isMobile`: `position: fixed`, `left/top = position`, `width/height = size`
  — i.e. the store-owned rectangle and the 2.15.2 sheet height;
- desktop keeps `min(92vw,900px)` / `min(84dvh,640px)`.

No new host, store, canvas, renderer or persistence layer. No change to the sheet model itself.

## 4. What the integration is PROVEN to do (live browser, 3 of 4 viewports)

| Viewport | presenter | host identity | window rect | sheet height | canvases |
| --- | --- | --- | --- | --- | --- |
| 360×640 | expanded | `creation` | (8, 16, 346×**329**) | applied | 1 |
| 375×812 | expanded | `creation` | (8, 16, 361×**436**) | applied | 1 |
| 390×844 | expanded | `creation` | (8, 16, 376×**456**) | applied | 1 |
| 430×932 | — | — | — | — | BLOCKED before open |

Before this mission the same phone window measured 328×**540** at 360×640 — the full usable height,
i.e. the zero-freedom geometry. It is now the docked sheet, position-driven, inside the expanded
presenter. Controls: 5 chrome buttons reachable in every measured viewport.

## 5. Mobile placement — **UNVERIFIED (0 px)**

Every measured viewport reports `dx 0, dy 0` after a 1 800 ms settle, and the store entry stays
`manual:false` at the pre-existing default. The window is now position-driven, so this is no longer
a geometry impossibility — the touch sequence dispatched through CDP is not driving the chrome's
pointer drag. Not established: whether the cause is the synthetic touch path (pointer capture on a
`position: fixed` chrome inside a `pointer-events:auto` backdrop), or a handler guard. The mission's
bar — "a pointer event without a committed placement is not a pass" — is not met, so placement is
reported as unproven, not as fixed.

## 6. Persistence — **PARTIAL, and informative**

At 360×640 and 375×812 the module restores after a same-tab `page.reload()` and reopen:
`(8, 104, 346×275)` and `(8, 104, 361×381)`, both from a store entry `manual:true` with the same
x/y. That is real store-driven restoration of a non-default dock. It is **not** accepted as the
mission's persistence proof, because the placement that produced it was not observed committing in
the measured gesture, and the reopened window uses the inline presenter (275 px) while the measured
one was expanded (329 px) — a presenter-dependent height difference that must be reconciled before
exact restoration can be claimed.

## 7. Creation Studio

- Stable identity: **`creation`** (not the literal `panel` id), window attribute value `creation`.
- Exactly one window per viewport; `data-lelu-module-content="creation"` present.
- Pin → `pinned:true`, unpin → `pinned:false`, geometry unchanged; verified in 2.15.4 runs.
- Exact ≤1 px restoration: **not measured** (depends on §5).

## 8. Renderer lifecycle

Canvases: **1** at open, 1 after drag, 1 after release in every measured viewport — the new
expanded geometry does not mount a second canvas or remount the renderer. Two deaths recurred at
phone size (390×844 during the reload wait, then context creation failure at 430×932), so the
intermittent instability from 2.15.2/2.15.3 is **unchanged and still unattributed**. No
`webglcontextlost` signal captured. **No GPU-hardware test was possible.**

## 9. Gates on this tree

| Gate | Result |
| --- | --- |
| `bunx tsc -b --force` | **PASS** |
| `bun run build` | **PASS** |
| `bun run lint` | NOT RUN |
| `bun run test` | NOT RUN (baseline 1725/0/6 remains historical only) |

## 10. Evidence

`docs/acceptance/spatial-phase-2-15-4/lifecycle-{360x640,375x812,390x844,430x932}.json` plus the
harness `lifecycle.mjs`. Failed and partial records are kept, not overwritten.

## 11. Remaining blockers

1. Touch drag does not reach the expanded chrome's pointer handlers under CDP dispatch — needs a
   real-device check or a pointer-capture fix, and is the sole blocker on placement/persistence proof.
2. Expanded (329 px) vs reopened inline (275 px) height must match for exact restoration.
3. Renderer deaths remain intermittent and unproven; no GPU host.
4. Full suite and lint have not run on this tree.

## 12. Merge readiness — **NOT READY**

The routing defect is fixed and the phone window demonstrably consumes the shared placement
contract (identity, sheet height, store authority, single canvas). Placement and exact restoration
remain unproven, so nothing is merged and canonical is untouched.
