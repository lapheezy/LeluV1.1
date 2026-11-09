# MISSION 2.15.5 — MOBILE TOUCH PLACEMENT & EXACT RESTORATION

- **Starting commit:** `0af24d7` (`claude/mission-2-15-4-mobile-presenter-integration`, remote-verified)
- **Branch:** `claude/mission-2-15-5-mobile-placement-closure` (isolated worktree)
- **Canonical:** `ce768e08`, untouched. Mission 5.3's four dirty paths preserved.
- **Status: NOT READY** — one of the two target defects fixed, one narrowed but not closed.

## 1. Root cause A — why touch produced zero movement

Two causes, both in `GenesisModuleHost.tsx`:

1. **The store overrode the live gesture.** `rawPosition` preferred `storedRect` on every render.
   `handlePointerMove` → `moveModule(id, …)` updated the module, but the store is written only on
   release, so each render recomputed the rectangle from the *stored* dock: the window never moved,
   and `endDrag` derived the commit from that same unchanged rectangle. This is the measured
   "touch arrives, dx 0" behaviour, and it is why 2.15.2's geometry fix alone could never move a
   phone window. Fixed: during a gesture the live module position is authoritative
   (`interacting && mod.position`), the store is authoritative at rest.
2. **The phone had two presenters** (see §2), so the drag contract and the rendered contract
   diverged.

After the fix, the ORIGINAL defect class is gone from the code, but the measured result is still
`dx 0, dy 0` at 360×640 and 375×812: CDP `dispatchTouchEvent` is not driving the chrome's pointer
sequence, and the commit appears only later (store reaches `manual:true, y:104` after the pin/unpin
phase, i.e. at the next gesture end rather than at release). **Placement acceptance is therefore
NOT met.** The precise remaining question is whether pointer capture inside the backdrop's
`pointer-events:auto` layer swallows synthetic touch moves, or whether it is a CDP fidelity limit;
no real device was available to separate them.

## 2. Root cause B — presenter mismatch on restore (FIXED)

`isExpanded = mod.presentation === "expanded"`. Presentation is **in-memory module state**, never
persisted, and `expandModule()` is only called on the open path — so after a reload the module
reopened through the inline host while it had been measured as expanded. Two geometry paths for
one phone window.

Fix: `isExpanded = mod.presentation === "expanded" && !isMobile`. A phone now has exactly one
presentation — the sheet host with the store-owned rectangle — while desktop keeps the centred
expanded modal untouched. The 2.15.4 phone-specific style inside the expanded branch was removed
so only one mobile geometry implementation exists.

Verified: window is `presentation:"inline"`, `host:"creation"` both before and after reload, with
exactly one window and one content surface.

## 3. Files changed

`src/app/scene/genesis/GenesisModuleHost.tsx`:
- `interacting` state moved above the geometry block (it is now read by `rawPosition`);
- `rawPosition` uses the live module position during a gesture;
- `isExpanded` excludes phones;
- expanded branch's phone-specific geometry removed, test identifiers retained.

No new presenter, host, canvas, renderer, store or persistence layer.

## 4. Four-viewport results

| Viewport | presenter / host | before | after release | store at release | reload |
| --- | --- | --- | --- | --- | --- |
| 360×640 | inline / `creation` | (8, 16, 346×329) | (8, 16, 346×329) | `manual:false` | inline, one window, (8, 104, 346×275) |
| 375×812 | inline / `creation` | (8, 16, 361×436) | (8, 16, 361×436) | `manual:false` | inline, one window, (8, 104, 361×381) |
| 390×844 | — | — | — | — | no window after open (harness blocked) |
| 430×932 | — | — | — | — | no window after open (harness blocked) |

Movement: **0 px in both measured viewports** — acceptance not met.
Canvas count: **1** at open, at release and after reload — no second renderer.

## 5. Store commitment

At both measured viewports the store eventually held `{ creation, x:8, y:104, w:344/359, h:273/379,
manual:true, pinned:false }` — a real dock commit with a non-default y, but observed after the
pin/unpin phase, not at release, and never reflected in the rendered rectangle of the measured
gesture. Pin → `pinned:true`, unpin → `pinned:false`, geometry unchanged.

## 6. Restoration

Same presenter, same identity, one window, restored from the store — but height restores to
**273** where the expanded-sheet measurement was **329** (and 379 vs 436), a 54/55 px difference
caused by the stale default `height:528` persisted in `lelu.lelu.layout.v2` competing with the
2.15.2 sheet clamp. **Not within 1 px. Restoration is not accepted.**

## 7. Renderer stability

Canvases 1 throughout; no page errors or `webglcontextlost` in the measured viewports. Viewports
390×844 and 430×932 failed to produce a window inside the run budget (the command hit its
five-minute ceiling mid-run). No GPU host available, so hardware behaviour remains unverified.

## 8. Gates

| Gate | Result |
| --- | --- |
| `bunx tsc -b --force` | **PASS**, 0 errors |
| `bun run build` | **PASS** (exit 0) |
| `bun run lint` | NOT RUN |
| `bun run test` | NOT RUN |

## 9. Remaining blockers

1. A real touch drag still produces no movement under CDP; needs a device test or a
   pointer-capture/ownership fix in the backdrop layer.
2. The commit lands one gesture late rather than at release.
3. Persisted default height (528) vs sheet height (329) must be reconciled so restoration is 1 px.
4. Lint and full suite unrun on this tree.

## 10. Merge readiness — **NOT READY**
