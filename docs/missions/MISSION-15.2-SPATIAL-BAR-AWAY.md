# Mission 15.2 — The Spatial bar is off the Home

The Spatial bar (◎ Spatial · core · voice · Creation Studio · portals · chat) sat at the bottom of the Home on every visit. On desktop it lay over the Home's own bottom navigation and the Cosmos orb.

## Now

- **Hidden by default, on every visit.** Only a small **SPATIAL** tab on the left edge shows.
- **Three ways to open it:**
  - tap the tab;
  - the **☰ menu** (App Library): its first tile is **Spatial navigation**;
  - ask LÉLU, e.g. "open the spatial menu" or "show me the spatial bar".
- **Three ways to put it away:**
  - the new ✕ on the bar;
  - Escape (only while the bar is on screen);
  - ask LÉLU, e.g. "hide the spatial bar".
- **Placement:** when open on desktop, it sits above the Home's bottom navigation instead of on top of it.
- **While travelling:** the tab shows the progress.

LÉLU's command runs first in the router, so "spatial" can no longer be taken as a request to build a 3D scene. Talk such as "what is spatial computing" or "spatial audio" is not a command.

## Also fixed (found while testing)

The ☰ menu sheets (App Library, Windows, Worlds) let every tap fall through to the Home cards behind them, so no tile in them could be pressed. `.lsh-backdrop` now takes the pointer.

## Evidence

- `tests/spatial-nav-hidden.test.ts`: 4 tests.
- `scripts/home/verify-spatial-hidden.mjs` runs in the real app (desktop and iPhone size, plus LÉLU through the real chat). It passed **19/19**, with a picture at every step in `m15-home/shots-15.2/`.
- `npm test`: the only failure was the new test file, written for the wrong runner and then rewritten. The fixed file passes 4/4 alone; the full suite was not re-run after the fix.
- Typecheck clean.
