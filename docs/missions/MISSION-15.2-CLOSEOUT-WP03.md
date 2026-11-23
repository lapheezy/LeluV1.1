# Mission 15.2 — Work Package 03 closeout: final verification and regression

Prompt `M15.2-WP03-P01` v1.0 · closeout dated **2026-11-16** · branch `claude/charming-hamilton-icbyrb`
Repository: <https://github.com/lapheezy/LeluV1.1>

This report follows `MISSION-15.2-SPATIAL-BAR-AWAY.md`, which is left as written. It records what was actually proven, three defects found by this pass and fixed, and what is still unverified. **It does not close Mission 15 as a whole** (see `MISSION-15-HOME-UNIVERSE.md` §7, which still has open items).

## 1. Chronology and provenance

| Order | Commit (full SHA) | Parent(s) | Time (UTC) | What |
|---|---|---|---|---|
| 1 | `376ac69a2ab44978881a5f4098474036b5fb539c` | `8101ec2b…`, `fe0cc0d4…` | 2026-11-15 20:11 | Merge of Mission 15 (`origin/claude/beautiful-euler-m3v9i5`, head `fe0cc0d`) into this branch |
| 2 | `94e96cb5e518b2f1488767e1ea438e18b4b4d192` | `376ac69a…` | 2026-11-15 21:23 | **Mission 15.1** feature work: Home Studio, all sixty concepts, blend/merge/create, themes, fonts, elemental borders |
| 3 | `6bf290ec0b5903de195d12a62cd3c58114c84d61` | `94e96cb5…` | 2026-11-15 23:39 | **Mission 15.2** correction: Spatial bar off the Home (side tab, menu entry, LÉLU command), plus the menu-sheet pointer fix |
| 4 | this commit (child of `6bf290e`) | `6bf290ec…` | 2026-11-16 | **WP03** verification, three fixes, this report |

- **The two SHAs:** `94e96cb` is the direct parent of `6bf290e` (`git merge-base --is-ancestor` confirmed). They are two separate, sequential commits, not a conflict. `94e96cb` was the 15.1 report's head; `6bf290e` was the 15.2 head.
- **State at the start of this pass:** the local and remote heads were both `6bf290e`, and the worktree was clean.
- **History:** nothing was reset, rebased or force-pushed.

`6bf290e` changed 30 files (+505/−2): 10 code/script/test/doc files and 20 screenshots.

## 2. Defects found by this pass (all fixed in this commit)

| # | Defect | Found by | Introduced in | Fix |
|---|---|---|---|---|
| D1 | **"show me the spatial bar" also opened the Earth map.** The chat's client-side shortcut `ExplorationController.parseCommand` sends any "show me X" to Earth as a place search, and it runs before the router. The 15.2 report said the command no longer misroutes; that was true only for "open the spatial menu". | Closeout run: no composer, an Earth window instead; then an event probe showed `genesis-show-surface {"panel":"earth"}` | `6bf290e` (the phrase was advertised there) | The parser moved to `src/core/router/spatialNavCommand.ts`, shared by `SurfaceResolver` and `ExplorationController`. The shortcut now leaves these phrases to the router. Probe after the fix: no Earth or other surface event for any of the four test phrases. |
| D2 | **On phones the open bar overlapped the Cosmos orb.** The orb rises above the bottom navigation, and the bar's box intersected it (the orb stayed tappable). | Box-intersection check, phone portrait and landscape | `6bf290e` (phone placement unchanged from before) | While open, the bar measures `.lsn-orb` and sits 8 px above its top, re-measuring on resize and orientation change. |
| D3 | **The SPATIAL tab drew over an open App Library / Windows / Worlds sheet**, on its left-hand tiles. | Phone screenshot | `6bf290e` | `body:has(.lsh-backdrop) [data-spatial-nav-tab] { display: none !important }` in `index.css`. `!important` is needed because the tab's display is an inline style. |

## 3. Evidence

### Full test suite: the actual final result

- **Command:** `npm test`. This is the canonical script: `tsx --tsconfig tsconfig.test.json --import ./tests/support/ignore-css.mjs --test --test-concurrency=1` over `tests/*.test.ts(x)` minus `autonomy-end-to-end`, 233 files.

| Run | Code | Tests | Pass | Fail | Skipped | Duration |
|---|---|---|---|---|---|---|
| Earlier (15.2 report) | `6bf290e` before the test-runner fix | 2263 | 2256 | 1 | 6 | — |
| WP03 run 1 | `6bf290e` | **2266** | **2260** | **0** | 6 | 328 s, exit 0 |
| WP03 run 2 (final) | this commit's code | **2266** | **2260** | **0** | 6 | 310 s, exit 0 |

- **Comparability:** the earlier run is comparable. 2263 − 1 (the file that failed to load under `bun:test`) + 4 (the corrected tests) = 2266, and pass 2256 + 4 = 2260.
- **Not the canonical command:** plain `bun test` is not the project's suite. It also collects old copies under `docs/recovery/` and blocks network calls, which gave 136 failures in a session-side run. Do not compare against that number.

### Focused tests

- `tests/spatial-nav-hidden.test.ts`: **4/4 pass** under the project runner, before and after the parser moved.

### Typecheck and lint

- **Typecheck:** `npm run typecheck` (`tsc -b --force`) exits **0**. Run on `6bf290e` (37 s) and again on the final code.
- **The project's lint is `oxlint`**, not ESLint: `"lint": "oxlint"`, with `oxlint ^1.71.0` in `package.json`.
- **Why "lint unavailable" was reported before:** the 15.2 run used `npx eslint`. `eslint.config.js` is a stale file whose packages (`@eslint/js`, `typescript-eslint`, `globals`, the react plugins) are in neither `package.json` nor `bun.lock`. That was a mistaken command, not an environment fault. The ESLint config was left untouched.
- **Lint result:** `npm run lint` exits **0** with **0 errors and 178 warnings**. The only warning in a file changed by 15.2 or WP03 is `SpatialNavigator.tsx:121` (`useMemo` dependency), and `git blame` puts that line in an earlier commit, `14cf7ec`.

### Browser regression (Chromium viewport emulation only)

- **Script:** `scripts/home/verify-spatial-closeout.mjs`, served by Vite on :5173.
- **Result:** **37/37** steps. Each step has a picture in `m15-home/shots-15.2-closeout/`, and `verify.json` holds per-step notes and viewport sizes.

| Viewport | Size | Steps |
|---|---|---|
| Desktop | 1440×900 | 1–7 |
| Tablet | 820×1180 (touch) | 8–14 |
| Phone portrait | 393×852 (touch, mobile) | 15–21 |
| Phone landscape | 852×393 (touch, mobile) | 22–28 |
| LÉLU via the real Chat Universe | 1440×900 | 29–37 |

Each viewport proves the following, measured rather than inferred where possible:
- **Closed on load:** the bar is hidden, exactly one tab is present, and `elementFromPoint` at the tab's centre is the tab (nothing on top of it).
- **Repeated toggling:** tab → ✕ is repeated **3 times**, and each cycle is checked (bar shown, exactly one bar, tab gone; then the reverse).
- **Clearance:** the open bar's box does not intersect the bottom navigation or the orb, and the orb is the topmost element at its centre.
- **Escape:** closes the open bar; a second Escape with the bar closed changes nothing.
- **App Library:**
  - the Spatial navigation tile is topmost;
  - every on-screen control of the sheet receives its own pointer, so taps never reach the Home cards;
  - the tab is hidden while the sheet is open;
  - the tile opens the bar and closes the sheet.
- **Reload:** the bar is hidden again, and the Home presentations, layouts and name (`lelu.home.presentations.v1`, `lelu.home.layouts.v1`) are byte-identical to before toggling.

LÉLU, run twice:
- "open the spatial menu" and "show me the spatial bar" each get LÉLU's reply, set the flag and open no 3D stage, and the bar is on the Home afterwards.
- "hide the spatial bar" gets the reply, the bar is away and the tab is back.
- "what is spatial computing?" leaves the bar alone.

### Older check script

- **What changed:** `scripts/verify-navigator-composer.cjs` now taps the side tab before using the bar's controls. The voice control was reached on the current code.
- **Result:** the script fails on all four of its viewports with `landed: false`; its test message never arrives.
- **Baseline:** the unmodified script was run on `94e96cb` (separate worktree, Vite on :5174) and fails identically.
- **Conclusion:** this is **pre-existing**. The script predates the current Chat Universe flow and is not a regression from 15.2. Its "voice stayed active" result is 3/4 on both commits, with a different viewport missing each time, so it looks flaky rather than broken. The script was not rewritten here.

### Physical iPhone

**NOT VERIFIED.** No physical iPhone, Safari or WebKit runner is available to this session. Every "phone" result above is Chromium viewport emulation. Touch reachability on hardware, safe-area insets, Safari's `:has()` support (Safari 15.4+), orientation change and reload behaviour on a device remain open.

## 4. Implemented vs browser-tested vs device-verified

| Behaviour | Implemented | Browser-tested (Chromium) | Physical iPhone |
|---|---|---|---|
| Hidden by default; left-edge tab | yes | yes, 4 viewports | not verified |
| Tab, menu tile, LÉLU open it; ✕, Escape, LÉLU close it | yes | yes, repeated | not verified |
| Clear of the bottom nav and orb when open | yes (orb measured) | yes, 4 viewports | not verified |
| Menu sheets take the pointer; tab steps aside | yes | yes, 4 viewports | not verified |
| LÉLU command never reaches Earth, 3D or another surface | yes | yes (event probe plus run) | n/a |
| Home state untouched by toggling | yes | yes (storage compared) | not verified |

## 5. Remaining defects and limitations

1. **Avatar over the menu sheet (pre-existing, not fixed: out of scope).** On phone portrait, LÉLU's floating companion (`[data-testid=lelu-companion]`, z-index 145, draggable) is drawn over the App Library sheet and takes taps meant for the tile under it ("Render" in this run). The closeout script records which tiles it covers. It needs a layering decision about the companion, not a change to the Spatial bar.
2. **Physical iPhone not verified** (§3).
3. **`scripts/verify-navigator-composer.cjs` is out of date**, failing on `94e96cb` too (§3).
4. **Earth window seen in the Chat Universe after repeated runs.** Before D1 was fixed, this was the "show me" misroute. No recurrence has been seen since, but the Universe restoring its last window is general app behaviour that this pass did not audit.
5. **`BuildStamp` overlay (pre-existing).** The commit/branch stamp in the bottom-right corner is deliberately temporary (`src/app/BuildStamp.tsx`), is not from this work, and is left alone.
6. **Stale `eslint.config.js`.** It is unused by `npm run lint` and was left unchanged. If ESLint is ever wanted, its packages must be added deliberately.

## 6. Objectives

| ID | Objective | Status |
|---|---|---|
| O01 | Repo, branch, ancestry, final SHA | VERIFIED |
| O02 | Full suite rerun after the runner fix | TEST-VERIFIED: 2266 / 2260 pass / 0 fail / 6 skipped, on `6bf290e` and on the final code |
| O03 | Focused Spatial tests | TEST-VERIFIED: 4/4 |
| O04 | Typecheck | VERIFIED: exit 0 |
| O05 | Lint investigated | VERIFIED: `oxlint` exit 0, 0 errors; the earlier "unavailable" was the wrong command |
| O06 | Tab, App Library, close, LÉLU regression | TEST-VERIFIED (Chromium); three defects fixed |
| O07 | Desktop, phone portrait/landscape and tablet evidence | TEST-VERIFIED (viewport emulation): 37 pictures |
| O08 | Physical iPhone status recorded | VERIFIED as recorded: the iPhone itself is **NOT VERIFIED** |
| O09 | Reports and roadmap updated | VERIFIED: this file, cross-links in 15.2, 15.1, 15 and the master roadmap |
| O10 | Git delivery and worktree state | Recorded in the session's final report after the push |

**Closeout decision for WP03: COMPLETE, with recorded limitations.**
- **Full suite:** green on the final code.
- **Regressions:** the three this pass found in the Spatial bar work (D1–D3) are fixed and re-verified.
- **Physical iPhone:** NOT VERIFIED. Under the prompt's rule, that is recorded and does not block the browser verification.
- **Avatar over the sheet:** pre-existing, not a regression from this work (before `6bf290e` the whole sheet ignored taps). It stays open as §5.1.
- **Mission 15 as a whole:** not complete.
