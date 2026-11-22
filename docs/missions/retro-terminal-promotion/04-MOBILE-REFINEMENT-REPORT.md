# 04 · Mobile refinement report

## What was wrong (measured before the fix, `1ff3829` + `7510070`)

| Viewport | Companion | Spatial tab | Overlap |
|---|---|---|---|
| iPhone 13 (390×664) | `planned` · "resting against the screen edge", box `[276,426 → 380,568]` | `[0,287 → 24,376]` | The companion covered the command line `[22,520 → 368,560]` and RUN. The tab covered the panes' left edge (x 10–24) |
| iPad Mini (768×1024) | the same rule, `[654,786 → 758,928]` | `[0,467 → 24,556]` | The companion covered RUN. The tab covered the body's left column |
| 1440×900 | the same rule, `[1326,662 → 1430,804]` | `[0,405 → 24,494]` | The companion covered RUN. The tab covered the directory's left edge |

### Root cause

The companion asks the Home for a hero spot (`[data-lelu-hero-host]`, the existing contract that the Lélu module fulfils). The terminal had no visible host: the module's host collapses to width 0 inside the terminal panes. So the companion fell back to the space planner. The planner avoids only the elements it knows: the `[data-lelu-composer]` and the shell's controls listed in `presencePlacement.EXTRA_CONTROLS`. The terminal's command line was in neither, so the planner's "free right edge" landed on it.

The Spatial tab is a fixed 24 px tab at `left:0; top:50%` over every Home. The terminal used a 10 px side padding.

## Resolution (no element hidden; both keep their function)

1. **The avatar has a place in the terminal.** `RetroTerminal.tsx` adds `<span class="rt-view-hero" data-lelu-hero-host>` inside the Live Cosmos viewport frame, top-right. It sits above "Full view", and the caption stops short of it. It is sized `clamp(64px, 12%, 112px)` × `min(160px, 100% − 64px)`. The companion takes it through the existing hero rule (`choosePlace` → `"hero"`). She stands in the live Cosmos and stays tappable and draggable. If the user drags her somewhere that covers nothing, the existing `placed` rule still wins.
2. **The planner knows the command line.** `presencePlacement.EXTRA_CONTROLS` gains `[data-rt-prompt]`. Whenever she is not on the hero spot (chat open, workspace in use), the planner and `blocksSomething` keep her off the prompt.
3. **The Spatial tab gets a gutter while it is shown.** `retroTerminal.css`: `body:has([data-spatial-nav-tab]) .lch.lch-m15.rt[data-device] { padding-left: max(30px, safe-area-left) }`. While the tab is hidden, or when the bar is open instead, the terminal keeps its 10 px padding. The tab itself is unchanged: 24×89 px, the same place, the same behaviour.
4. **The opened Spatial bar clears the command line.** `SpatialNavigator`'s rail already measures obstacles (the chat composer and the Home navigation bar) and lifts itself clear. `[data-rt-prompt]` was added to that list. Measured lift: 68 px on phone, 52 px on tablet and desktop.

Scope: (1) and (3) exist only inside the Retro Terminal. (2) and (4) match an element that exists only in the terminal. Other Home layouts are unaffected (see the regression harness below).

## Verification (`scripts/home/verify-retro-terminal-promotion.mjs`)

At each viewport:

- the companion covers no header button, caption, Full view, tab strip, command line or RUN;
- the companion lies inside the Live Cosmos frame;
- the Spatial tab covers no terminal region, and its touch target is ≥ 24×44;
- `scrollWidth − innerWidth = 0`;
- the command line and RUN are inside the viewport;
- the opened Spatial bar is clear of the command line;
- the Appearance Studio fits the viewport and its close control is the topmost element at its centre.

| Viewport | Result | Positions after |
|---|---|---|
| iPhone 13 | all layout checks PASS | companion hero `[303,76 → 367,156]`; tab `[0,287 → 24,377]`; content starts at x 30 |
| iPad Mini | all layout checks PASS | companion hero `[658,76 → 745,208]` |
| 1440×900 | all layout checks PASS | companion hero `[1035,76 → 1138,227]` |

Screenshots: `evidence/shots/{phone,tablet,desktop}-{terminal,studio,restored}.png`.

The original Retro Terminal acceptance (`verify-retro-terminal.mjs`) still reports **37/37**. That includes its no-overflow checks at all three sizes and the switch to an original layout. Evidence: `evidence/regression-verify-retro-terminal.txt`.

Visible change on desktop and tablet: the companion now stands in the viewport frame instead of on RUN, and the terminal content starts 20 px further right while the Spatial tab is shown. Nothing else moved.
