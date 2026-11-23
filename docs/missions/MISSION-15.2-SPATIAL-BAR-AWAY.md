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

## Closeout (2026-11-16, WP03)

Final verification, with three corrections to this report, is in [`MISSION-15.2-CLOSEOUT-WP03.md`](MISSION-15.2-CLOSEOUT-WP03.md).
- **Full suite rerun:** 2266 tests, 2260 pass, 0 fail, 6 skipped.
- **Lint:** "lint could not run" above was the wrong command (`eslint`). The project lint is `oxlint`; it exits 0 with 0 errors.
- **Defects found and fixed:**
  - "show me the spatial bar" also opened the Earth map, so the claim above that LÉLU no longer misroutes held only for "open the spatial menu";
  - the open bar overlapped the Cosmos orb on phones;
  - the side tab sat over open menu sheets.
- **Physical iPhone:** NOT VERIFIED.
