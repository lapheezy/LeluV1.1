# 02 · Integration report

## Commits incorporated into `integration/lelu-four-workforce-consolidation`

| # | Commit on canonical | Source | How |
|---|---|---|---|
| 1 | `1ff3829` | `claude/sharp-knuth-l3d7i3` @ `1ff3829` (Retro Terminal + Terminal Appearance Studio) | fast-forward: the identical commit, history preserved |
| 2 | `2d8fc85` | `7510070` from `claude/cosmos-integration-audit-t9ouny` (camera follows navigation, one flight at a time, first-paint sky) | `cherry-pick -x` (the message records the original hash); clean auto-merge of `CosmosLayer.tsx` |
| 3 | integration commit (see 07) | this mission | WP03 reconciliation, WP04 mobile, WP05 restoration, harness, tests, these reports |

Not incorporated:

- `b291a88`: a report-only update to the audit's suite count.
- The M15.3 line under the audit branch (`f290716` and its ancestors), which is not part of this mission.

## Files changed by this mission (commit 3)

| File | Change |
|---|---|
| `src/core/cosmos/CosmosNavigation.ts` | Pending restore of live-map destinations, trail and visits. Settles on sync; restored-arrival signal (05) |
| `src/core/cosmos/CosmosLiveMap.ts` | `applyCosmosSnapshot` calls `settleRestore()` after a sync |
| `src/app/scene/genesis/cosmos/CosmosRooms3D.tsx` | Requests a sync while a restore is pending; re-selects and frames a restored destination once the camera accepts it (05) |
| `src/app/scene/genesis/home/RetroTerminal.tsx` | `goto` / `back` no longer fly the camera themselves (03). Hero host in the viewport, `data-rt-prompt` on the command line (04) |
| `src/app/scene/genesis/home/retroTerminal.css` | Hero spot, caption width, gutter while the Spatial tab is shown (04) |
| `src/app/scene/genesis/avatar/presencePlacement.ts` | `[data-rt-prompt]` added to the shell controls the companion avoids (04) |
| `src/app/scene/spatial/SpatialNavigator.tsx` | `[data-rt-prompt]` added to the obstacles the rail lifts clear of (04) |
| `tests/live-map-restoration.test.ts` | New, 6 tests |
| `scripts/home/verify-retro-terminal-promotion.mjs` | New browser acceptance, 24 checks per viewport |
| `docs/missions/retro-terminal-promotion/` | These reports and their evidence |

## Conflicts resolved

- **Git:** none. The fast-forward has nothing to conflict with. The cherry-pick auto-merged `CosmosLayer.tsx` and kept canonical's M17.3 `setHazards` effect next to the audit's camera claim.
- **Behavioural:** see 06. The terminal's duplicate camera flight became redundant, and competed with the audit's navigation-following flight, once both were on one branch.

## Existing systems preserved (no second instance of any)

- **One layout system.** `homeComposition` `TEMPLATES` has 13 built-ins: the 12 originals plus `retro-terminal`. The unit test and the browser harness confirm the originals are present.
- **One persistence path.** `HomeStore` → `KvStore` (`lelu.home.*`, terminal appearance under `lelu.home.terminal.v1`) and `CosmosNavigation` → `KvStore` (`lelu.cosmos.nav.v1`, same payload shape). No new key, store or service.
- **One scene and canvas.** The same WebGL canvas element survives layout switches (browser, 3 viewports).
- **One navigation authority and one camera mover** (03).
- **Appearance Studio, theme model and command interpreter:** unchanged from `1ff3829` (`homeTerminal.ts`, `TerminalAppearanceStudio.tsx`, `terminalCommands.ts` not modified). `tests/retro-terminal.test.ts` 15/15 and the original browser acceptance 37/37 still pass.
