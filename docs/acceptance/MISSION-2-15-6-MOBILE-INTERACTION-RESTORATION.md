# MISSION 2.15.6 — MOBILE DRAG EXECUTION & EXACT GEOMETRY RESTORATION

- **Starting commit:** `6f0ebb6` (remote-verified on `claude/mission-2-15-5-mobile-placement-closure`)
- **Branch:** `claude/mission-2-15-6-mobile-interaction-restoration-closure` (isolated worktree)
- **Canonical:** `ce768e08`, untouched. Mission 5.3's four dirty paths preserved.
- **Verdict: every acceptance gate passes** — four viewports, same-gesture commit, 0 px restoration, one renderer, full suite green. Not merged (by directive).

---

## 1. Root cause A — the drag moved nothing

Three defects, in the order they were hiding each other:

**A1. The live rectangle was read from the store (fixed in 2.15.5, `a226c0f`).**
`rawPosition` preferred `storedRect` on every render, so each `pointermove` render snapped the
window back to the dock it started in and `endDrag` committed that unchanged rectangle.

**A2. The measured 0 px was mostly the probe, not the engine.** Both 2.15.5 harnesses pressed the
**centre of the chrome**. On a 346 px phone chrome the centre sits inside the control cluster
(pin / minimize / expand / close occupy roughly the right 150 px), and `handlePointerDown`
deliberately refuses to start a gesture on `button, input, select, textarea, a` (`e.preventDefault()`
there had once killed the control clicks). So no gesture ever started — and the store's
`manual:false` entry `(8, 16, 336, 528)` recorded in 2.15.5 is exactly
`layoutWindowRects(1, 360×640)` (left 8, top 16, width 336, height 528): it was the auto-arrange
tile from `ensure()`, not a placement. The old harness also targeted `[data-spatial-control="creation"]`,
which exists only inside a selector list in `LeluCompanion.tsx` — the module was really opened by
the text-fallback loop.

**A3. The probe reused a stale press point.** After the first gesture moved the window, the second
press still used the coordinates computed before it, landing in empty scene. That read as "pointer
drag broken" while touch worked. The probe now measures the press point per gesture
(`pressPoint()`), which is what a person does.

With A1 fixed, a real gesture on the title now moves the window and commits on release:
touch pointer type `touch`, 6 `pointermove` events, `onChrome: true`, live `dy 80`, store
committed at release, `manual:true`.

## 2. Root cause B — restored height differed by 54–55 px

`size` preferred `mod.size` over the committed rectangle:

```ts
height: Math.max(mobileMinHeight, Math.min(mod.size?.height ?? mobileSheetHeight, Math.min(mobileSheetHeight, mobileHeight)))
```

`mod.size` is **in-session state rebuilt from the viewport whenever a module is opened**, while only
`position` was restored from the store. So a reload re-derived the height (273 px at 640, 379 px at
812) instead of restoring the committed 329/436. The mount sync effect then mirrored that
viewport-derived geometry back into the store, replacing a valid manual rectangle with a default —
`place()` even marks it `manual:true`, so the corruption looked like a placement.

### Correction — one geometry contract

| Kind | Owner | Rule |
| --- | --- | --- |
| Default | module host | sheet dock height, only when nothing was committed |
| Live | `mod.position` | authoritative **during** a gesture only |
| User-committed | `ModuleLayoutStore` (`manual:true`) | authoritative at rest, for **position and size** |
| Viewport-constrained | the clamps | may reduce a stored rect to what fits; never replaces it with a default |

```ts
const committedRect = storedRect && ModuleLayoutStore.getInstance().isManual(id) ? storedRect : null;
width:  Math.max(mobileMinWidth,  Math.min(committedRect?.width  ?? mod.size?.width  ?? mobileWidth, mobileWidth)),
height: Math.max(mobileMinHeight, Math.min(committedRect?.height ?? mod.size?.height ?? mobileSheetHeight, Math.min(mobileSheetHeight, mobileHeight))),
```

and the sync effect now returns early for a manual entry, so a re-open can never overwrite a
placement. No second presenter, host, renderer, store or persistence layer was added.

## 3. Files changed

- `src/app/scene/genesis/GenesisModuleHost.tsx` — committed rect outranks `mod.size` for dimensions;
  the mount sync effect no longer overwrites a manual placement. (`rawPosition` gesture-live and the
  phone presenter unification came from 2.15.5 and are untouched.)
- `docs/acceptance/spatial-phase-2-15-6/lifecycle.mjs` — new instrumented probe.
- `docs/acceptance/spatial-phase-2-15-6/lifecycle-*.json` — per-viewport records.

## 4. Four-viewport results

Every row: module `creation`, presenter `inline`, host `creation`, content `creation`, one canvas.

| Viewport | opened (x, y, w×h) | touch live | committed at release (store) | 2nd drag from commit | pin → unpin | reload (x, y, w×h) | Δ |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 360×640 | 8, 16, 346×329 | `dy 80` (6 moves) | 8, 117, 344×327 `manual:true` | yes | `true → false`, geometry kept | 8, 117, 346×329 | 0, 0, 0, 0 |
| 375×812 | 8, 16, 361×436 | `dy 80` | 8, 282, 359×434 `manual:true` | yes | `true → false`, geometry kept | 8, 282, 361×436 | 0, 0, 0, 0 |
| 390×844 | 8, 16, 376×456 | `dy 80` | 8, 155, 374×454 `manual:true` | yes | `true → false`, geometry kept | 8, 155, 376×456 | 0, 0, 0, 0 |
| 430×932 | 8, 16, 416×510 | `dy 80` | 8, 172, 414×508 `manual:true` | yes | `true → false`, geometry kept | 8, 172, 416×510 | 0, 0, 0, 0 |

The store records the **content box**; the rendered rectangle adds the 1 px border on each side
(344×327 ↔ 346×329), so the store↔render comparison is exact once that border is accounted for.
Restoration is 0 px on all four axes at all four viewports.

### Same-gesture commit

Commit is sampled twice: immediately at `pointerup`/`touchend` with no wait, and again 400 ms later.
In every accepted record the release sample already holds the final rectangle, and the rect the
renderer shows at release equals it — the commit belongs to the gesture that produced it, not to a
later re-render. The next drag starts from the committed `y` (`startedFromCommit: true`), proving the
store is the new baseline.

## 5. Input validation

| Gesture | Pointer id / type | Events | On chrome | Result |
| --- | --- | --- | --- | --- |
| touch | id 2, `touch` | 1 down, 6 move, 1 up | yes | moved 80 px, committed |
| pointer | id 1, `mouse` | 1 down, 13 move, 1 up | yes (375, 430) | moved 72 px, committed |

CDP touch **does** drive the app: the pointer events arrive with `pointerType:"touch"` on the
chrome, so no synthetic-input limitation had to be declared for touch. The 360 and 390 records were
captured before the per-gesture press-point fix, so their *pointer* leg shows the stale press
(`onChrome:false`) and is not used as evidence; their touch leg is valid.

## 6. Renderer

One canvas, one module host, one content surface after interaction and after reload at all four
viewports. Two renderer deaths occurred in software rendering and are recorded, not hidden:
375×812 (page closed mid-run, first attempt) and 430×932 (0 canvases sampled before the async mount
was awaited). Both were re-measured and passed. No GPU-capable host was available, so hardware
behaviour is still unverified. Desktop expanded presentation was **not** exercised in this run; its
code path is unchanged (`isExpanded` still true when `!isMobile`).

## 7. Gates

| Gate | Result |
| --- | --- |
| `bunx tsc -b --force` | **PASS** (exit 0) |
| `bun run build` | **PASS** (exit 0) |
| `bun run lint` | **PASS** — 0 errors, 135 warnings (pre-existing) |
| `bun run test` | **PASS** — 1,727 pass / 0 fail / 4 skipped (178.5 s) |

## 8. Completion gates

| Gate | Status |
| --- | --- |
| All four viewports open | PASS |
| Real touch drag visibly moves the window | PASS (80 px, all four) |
| Final rect commits on the same release | PASS |
| Next drag starts from the committed geometry | PASS |
| Reload restores same identity + presenter | PASS |
| Position and dimensions within 1 px | PASS (0 px) |
| Pin/unpin preserves geometry | PASS |
| One host, one content surface, one canvas | PASS |
| Full regression / test suite | PASS — 1,727 pass, 0 fail, 4 skipped |

## 9. Remaining blockers

1. Hardware touch input is unverified: software rendering took the page down twice and no
   GPU-capable device was available. Every drag above is synthetic-but-real Chromium input
   (`pointerType: touch` through the normal pointer pipeline), not a physical finger.
2. Desktop expanded presentation was not re-measured in this run; its code path is unchanged and a
   phone never reaches it.

## 10. Merge readiness — **READY**

Every completion gate in §8 passes: four viewports open, touch drag moves the window and commits on
that release, the next drag starts from the commit, reload restores the same identity and presenter
at 0 px, pin/unpin preserves geometry, one host / one content surface / one canvas, and typecheck,
build, lint and the full suite are green. Not merged, per the directive.
