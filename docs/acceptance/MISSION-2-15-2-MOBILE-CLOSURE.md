# MISSION 2.15.2 — MOBILE SPATIAL CLOSURE

- **Starting commit:** `febc5fa` (`claude/mission-2-15-1-closure`)
- **Branch:** `claude/mission-2-15-2-mobile-spatial-closure`, isolated worktree
- **Canonical:** `claude/master-integration` at `ce768e08` — untouched, not merged
- Remote tips verified before work: `febc5fa`, `5daaf69`, `68fd4f9`, `ce768e08`

## 1. Mobile placement — root cause found and corrected (code), UNVERIFIED at runtime

**The geometry defect is exact, not a guess.** On phones the sheet's height was
`mobileHeight = viewportHeight − 16 − reserve`, i.e. the *entire* usable height. Its own
vertical clamp is `max(TOP, min(y, viewportHeight − BOTTOM − height))`, so with
`height == viewportHeight − BOTTOM − TOP` the upper and lower bounds coincide at `TOP`:
vertical freedom was **mathematically zero at every phone viewport**, which is why touch
input arrived (down 1 / move 12 / up 1) and the rectangle still read dx 0, dy 0.

The correction in `GenesisModuleHost.tsx` is a different model, not wider clamps:

- A phone window is a **sheet of ~62 % of the usable height** (capped at 520 px, floor 300 px),
  leaving a real vertical band above the safe area.
- A drag **docks** to the nearest of three stops — top / middle / bottom — inside that band,
  and the docked rectangle is what is committed to the existing store.

**Runtime verification is BLOCKED.** At 360×640, 375×812, 390×844 and 430×932 the software
renderer closed during the drag itself, with both real touch events and pointer events
(`Target page, context or browser has been closed`). A drag-free probe showed the element
carrying `[data-lelu-module-window]` at 360×640 is 328×540 with a dock range of **−12 px**,
which cannot be the fixed host window (the host is `viewport − 16 = 344 px` wide) — so the
harness has been reading a different node in that tree, and that ambiguity is a second,
independent reason not to claim a measurement.

**Classification: code corrected, runtime behaviour UNVERIFIED.**

## 2. Mobile persistence — UNVERIFIED

Depends on a committed placement (§1). The harness uses `page.reload()` in the same tab, so
no second WebGL context is created; it never reached the reload step.

## 3. Creation Studio identity and restoration — UNVERIFIED (change made)

Investigated chain: rail control → `openPanel("creation")` → `MODULE_RENDERERS.creation` →
`GenesisModuleHost` → `ModuleLayoutStore.place(id, …)` → `KvStore` key
`lelu.lelu.layout.v2`. Entries are keyed by **`moduleId`** — the earlier probe looked for
`id`, which is why the entry appeared missing.

The 8 px discrepancy has a plausible cause in the restore path: `rawPosition`/size preferred
the module's own live `mod.position`/`mod.size` (a stale restack/size) over the stored rect.
The store is now authoritative when an entry exists (`rawPosition` and the desktop size both
read the stored rect first), so the saved rectangle is what reopens.

Not verified: the drag → pin → unpin → reload → compare sequence did not run to completion
in this environment (renderer deaths), so the 1 px requirement is unproven.

## 4. Renderer stability — BLOCKED (environment), incidents recorded

Deaths observed this mission: 360×640 (touch), 375×812 (touch), 390×844 (touch), 430×932
(timeout), 360×640 (pointer), plus one at the sign-in gate in 2.15.1. Every death occurs
while a module gesture is in flight over the live WebGL surface at phone size. No second
canvas or WebGL context is created by the harness (it reloads instead). This is consistent
with the recorded SwiftShader compositing instability, but it is **not** proven to be
environment-only, and no GPU run was possible here. Not marked resolved.

## 5. Gates on this tree

| Gate | Result |
| --- | --- |
| `bunx tsc -b --force` | **PASS** (exit 0) |
| `bun run build` | **PASS** (6.07 s) |
| `bun run lint` | **PASS** — 0 errors, 135 warnings |
| `bun run test` | **NOT RUN on this tree** — no result is claimed (2.15.1 baseline remains 1725 pass / 0 fail / 6 skipped) |

## 6. Files changed

- `src/app/scene/genesis/GenesisModuleHost.tsx` — sheet-height phone model, dock snapping on
  gesture end, and the layout store as the authoritative restore source.

## 7. Remaining blockers

1. Renderer deaths at phone size block every mobile measurement; a GPU-capable environment is
   needed to decide whether that is SwiftShader-only.
2. The mobile harness must target the fixed host window unambiguously (the node carrying
   `[data-lelu-module-window]` at phone size is not it).
3. Full test suite not yet run against this change.

## 8. Merge readiness — NOT READY

The product fix addresses the measured geometric cause and the tree typechecks, lints and
builds, but Gate A (measured nonzero mobile placement), Gate B (mobile persistence) and
Gate C (exact Creation Studio restoration) all remain UNVERIFIED, and Gate D is incomplete.
Nothing is merged; canonical is untouched.
