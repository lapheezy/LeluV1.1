# MISSION 2.15.1 — SPATIAL WORLD ACCEPTANCE CLOSURE

Closes the evidence gaps left by Mission 2.15. Every item is classified
VERIFIED / PARTIALLY VERIFIED / UNVERIFIED / FAILED / BLOCKED.

- **Starting commit:** `5daaf69` (`claude/mission-2-15-spatial-world`)
- **Mission branch:** `claude/mission-2-15-1-closure`, isolated worktree
- **Canonical:** `claude/master-integration` at `ce768e08` — untouched, nothing merged
- Remote tips verified before starting: `5daaf69` (2.15), `68fd4f9` (5.2 evidence), `ce768e08` (canonical)

## 1. Full-suite failure — diagnosed and corrected (VERIFIED)

**The assertion was wrong, and now it is proved to be wrong.** `tests/self-view.test.ts`
hard-coded the min-content width of a `<button>Identity</button>`:

```
... → button "Identity" (width 200px, needs at least 59px, min-width auto)
```

`needs at least` is the element's **min-content width** — the label's text width plus
padding and border. It depends on which font the host actually has, not on layout:

| Host condition | Same page, measured |
| --- | --- |
| Machine the test was written on | 59 px (the hard-coded value) |
| This VM with `FONTCONFIG_FILE=/tmp/lelu-fonts.conf` | **66 px** (the reported failure) |
| This VM with no usable font at all | **16 px** (zero-width text) |

Probe: `docs/acceptance/spatial-phase-2-15-1/font-metrics-probe.json`.

The report was correct in every structural particular; only the font-dependent number
differed. The test now measures that number from the same page immediately after the
layout report runs, so it asserts what the report must actually be right about (that it
names **this** element and its real min-content) instead of a constant from another host.

- Single test, host fonts: **15/15 pass**
- Single test, no font config: **15/15 pass**
- **Full suite: 1731 tests, 1725 pass, 0 fail, 6 skipped, exit 0** (226 s)

Nothing was lowered or loosened; the structural expectations (the row chain, 520 px in
358 px, 414 px, `min-width auto`) are untouched.

## 2. Mobile touch placement — FAILED (measured, with the reason)

Measured at **360×640**, real CDP touch events, `60 s` settle window:

| Reading | Value |
| --- | --- |
| Opened via | `Studio` tile (touch) |
| Window | 328×540 at (16, 50) |
| Touch events reaching the header | pointerdown 1, pointermove 12, pointerup 1 |
| **Rectangle before → after** | (16, 50) → **(16, 50)** |
| **dx / dy** | **0 / 0** |
| Committed placement | `0 placed · 0 pinned` |

So input is delivered and the window does not move. This is not an input failure and not
a harness failure: at phone width the module is a **sheet whose geometry is clamped to the
viewport**. With a 540 px sheet in a 640 px viewport there is no room to travel — the x
range is 0–32 px and the y range collapses to a few pixels — so a drag has nowhere to go
and no placement is committed. The same measurement at 375×812 earlier produced the same
result before the renderer died.

**Consequence:** mobile touch placement is FAILED as an acceptance criterion, and mobile
persistence is therefore UNVERIFIED (there is nothing to restore). Fixing this is a design
decision (should a phone sheet be placeable at all, and within what bounds while keeping
safe areas and controls usable), not something this mission may decide by widening clamps.

Evidence: `docs/acceptance/spatial-phase-2-15-1/mobile-lifecycle-360x640.json`.

## 3. Mobile persistence — UNVERIFIED

Dependency on §2. The persistence harness now uses `page.reload()` in the **same tab**
(the application destroys and recreates its own renderer), so no second WebGL context is
created — that specific blocker from 2.15 is removed. It could not complete because there
was no committed placement to restore.

## 4. Creation Studio lifecycle — PARTIALLY VERIFIED

Measured at 1440×900 through the real rail control and the shared module host:

| Step | Result |
| --- | --- |
| Open from rail | window `creation`, one module window |
| Shared host | module chrome + pin present, `[data-lelu-studio-library]` present |
| Drag | rectangle moved (dx, dy measured before/after) |
| Pin | `aria-label="Unpin Creation Studio"`, `aria-pressed="true"` |
| Reposition while pinned | (128, 38) → (110, 50): **dx −18, dy +12** |
| Unpin | `aria-pressed="false"` |
| Layout stores | only `lelu.lelu.layout.v2` — no duplicate store, no competing host |
| Reload → reopen | (110, 50) 1338×818 → (102, 50) 1340×820: **dx −8, dy 0** |

Placement, pin, pinned reposition and unpin are real. **Restoration is off by 8 px
horizontally (and 2 px in width)**, so "reopen restores the exact rectangle" is not met.
Also, the committed layout entry could not be located under the id `creation` by the probe,
so the persisted-entry assertion is inconclusive rather than passed.

Evidence: `docs/acceptance/spatial-phase-2-15-1/creation-lifecycle-1440x900.json`.

## 5. Renderer stability — BLOCKED (environment), with evidence

Repeated, reproducible renderer deaths under software rendering in this VM:

- Portal panel composited over the live canvas during a long transition (2.15, 900×650).
- Mobile touch-drag runs at 375×812 and 360×640 (browser closed mid-gesture).
- Creation Studio run died at the sign-in gate on one attempt.

Canvas count is **1** on the phone boot path and returns to a stable 3 on desktop after
transitions; the deaths are not caused by creating extra contexts — the harness deliberately
avoids a second context (reload instead of a second page). The failures are consistent with
SwiftShader/compositing instability on this host (`chrome` traps recorded in
`MULTICHAT_HANDOFF.md`), but this mission did **not** prove the application is faultless on
real GPU hardware. Classified BLOCKED: not shown to be an application defect, and not shown
to be safe either.

## 6. Preserved from Mission 2.15 (not re-measured here)

- Eleven built-in destinations reachable through the navigator, through
  `planTravel()` → `SpatialRuntime.travel()`; ten verified transitions with active-scene
  checks (`docs/acceptance/spatial-phase-2-15/transitions-720x520-run{1,2}.json`).
- Desktop pointer placement, pin, reposition, unpin and fresh-document restore (dx 0, dy 0)
  at `68fd4f9`.
- Visual Studio intact; Creation Studio and Visual Studio share one host and one store.

## 7. Gates on this tree (`5daaf69` + the test fix)

| Gate | Result |
| --- | --- |
| `bunx tsc -b --force` | **PASS** (exit 0) |
| `bun run build` | **PASS** (exit 0, 6.88 s) |
| `bun run lint` | **PASS** — 0 errors, 130 warnings |
| `bun run test` | **PASS** — 1731 tests, 1725 pass, 0 fail, 6 skipped |

## 8. Remaining blockers

1. **Mobile touch placement does not move the sheet** (dx 0, dy 0) — a design decision
   about placeable phone sheets is required before persistence can even be attempted.
2. **Creation Studio restore is off by 8 px**, and its persisted entry was not located by
   the probe.
3. **Renderer instability** under SwiftShader compositing cannot be separated from an
   application defect with the tools available here.

## 9. Merge readiness — NOT READY

The suite failure is genuinely resolved and the gate is green, which was the largest
blocker. But the final acceptance list requires a measured nonzero mobile placement, mobile
persistence, and exact Creation Studio restoration — and two of those are currently FAILED
or PARTIALLY VERIFIED. The branch is published for review; nothing was merged.
