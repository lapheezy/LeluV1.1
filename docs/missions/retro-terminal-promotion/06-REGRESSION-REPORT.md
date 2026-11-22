# 06 · Conflict audit and regression report

## A. Cross-system conflict audit (WP06)

| # | Conflict | File(s) | Root cause | Sev | Correction | Verification |
|---|---|---|---|---|---|---|
| X1 | Two camera controllers on one navigation | `home/RetroTerminal.tsx` `goToNode`, `back`; `cosmos/CosmosRooms3D.tsx` | The terminal flew the camera itself because, on canonical, navigation did not reach the camera. After `7510070`, CosmosRooms3D flies every `currentId` change, so each `goto` / `back` started two flights. | P1 | The terminal no longer flies. It re-centres only when the target is already current, the same rule as a ring tap. | Browser: `goto` / `back` reach the framing at 3 viewports. One flight loop (unit) |
| X2 | Two different answers for "go to the core" | same | The terminal flew to the core ring framing `(0,0,−15)`. CosmosRooms3D resets to the Genesis view `(0,0,6.8)`. The later of the two won. | P1 | Resolved by X1: one answer, the Genesis view | Audit harness: "navigating to the core returns to the Genesis view" ×3 |
| X3 | Live-map destination lost on reload; trail and visits wiped by the first write | `core/cosmos/CosmosNavigation.ts` | `load()` runs before live-map ids exist, and the next `persist()` overwrote storage | P1 | Pending restore (05) | Unit 6/6; browser ×3 |
| X4 | Restore never resolves on most Homes | `CosmosRooms3D.tsx` / `CosmosLiveMap.ts` | Only the panel, the terminal and LÉLU's tool synced the live map | P2 | The scene requests one sync while a restore is pending | Browser: reload on "My Home" restores, ×3 |
| X5 | Companion over the terminal's command line and RUN (all sizes) | `RetroTerminal.tsx`, `avatar/presencePlacement.ts` | No visible hero host in the terminal, and the command line unknown to the planner | P2 | Hero host in the viewport frame; prompt registered as a control (04) | Browser ×3 |
| X6 | Spatial tab over the terminal's left edge | `retroTerminal.css` | Fixed 24 px tab against a 10 px padding | P2 | Gutter while the tab is shown (`:has`) | Browser ×3 |
| X7 | Opened Spatial rail over the command line | `spatial/SpatialNavigator.tsx` | The rail's obstacle list did not know the terminal prompt | P2 | Added to the existing lift-clear list | Browser ×3 (lift 68 / 52 / 52 px) |
| X8 | Restore framing lost on a double mount | `CosmosRooms3D.tsx` (this mission's own code) | The arrival was consumed on read; StrictMode's mount, cleanup and mount cancelled the only attempt. The retry was bounded by rAF ticks, which expire before a slow device mounts the scene. | P2 | Read without consuming, clear when the flight is accepted; a 60 s time bound | Debug trace (camera reaches `(0,20,−21)`, owner cinematic); browser ×3 |

Checked, no conflict found:

- **Theme persistence.** The terminal appearance is a `HomeStore` slice under its own key, and presentations and layouts keep theirs. The Retro Terminal harness confirms the theme survives layout switches and reloads.
- **Layout definitions.** One `TEMPLATES` table.
- **Scene initialisation.** One canvas, kept across layout switches.
- **State owners.** CosmosNavigation (where), CosmosFocus (selection), InfiniteCosmos (camera and chunks), HomeStore (layout and theme) are distinct concerns.
- **Subscriptions.** Every terminal and Rooms3D subscription and interval returns its cleanup, and the restore attempt is cancelled on unmount.
- **CSS stacking.** The studio is portalled above the navigation bar. The terminal z-index is unchanged.
- **Unnecessary rendering.** No per-frame work was added. The restore retry runs only until accepted.
- **`syncCosmosMap` from both panel and terminal** is idempotent by id (`tests/cosmos-live-map.test.ts`). Noted (P3), no change.

Known and deferred (pre-existing, not introduced here):

- Audit C7: 17 `window.innerWidth` breakpoint reads.
- Audit C8: the stale `verify-workspace-layout` / `verify-mobile-chat` harnesses, re-run below with an identical result.
- The M15.3 line under the audit branch is still not on canonical.

## B. Gates (WP08), run on the integrated tree

| Gate | Result | Historical baseline | Evidence |
|---|---|---|---|
| Full suite `npm test` | **2434 tests, 2428 pass, 0 fail, 6 skipped** | 2416 / 2410 / 0 / 6 | `evidence/gate-full-suite.summary.txt` |
| New tests | +12 (audit: `infinite-cosmos` 8, `camera-flight` 4), +6 (`live-map-restoration`) | — | 2416 + 18 = 2434 |
| Retro Terminal, Cosmos, workspace, camera, layout and theme unit tests | 235/235 in a targeted run during integration; all are also in the full suite | — | |
| Typecheck `tsc -b --force` | exit 0 | clean | `evidence/gate-typecheck.txt` |
| Lint `oxlint` | **0 errors, 184 warnings** | 0 / 184 | `evidence/gate-lint.txt` |
| Production build `vite build` | OK (9.2 s). RetroTerminal 18.58 kB (5.81 gz), Studio 21.83 kB (6.50 gz), CosmosLayer 15.98 kB | build OK | `evidence/gate-build-bundle.txt` |
| Bundle check `verify:bundle` | PASS: no test files in dist (1909 files) | PASS | same |

## C. Browser results (Chromium + SwiftShader, dev server)

| Harness | Result | Evidence |
|---|---|---|
| `verify-retro-terminal-promotion.mjs` (new; iPhone 13, iPad Mini, 1440×900; 24 checks each) | Run 1: phone **24/24**, desktop **24/24**, tablet 21/24. Tablet run 2 alone: **24/24** | `evidence/browser-run-1-all.*`, `evidence/browser-run-2-tablet.*`, `evidence/shots/` |
| `verify-retro-terminal.mjs` (original Retro Terminal acceptance) | **37/37** | `evidence/regression-verify-retro-terminal.*`, `evidence/regression-retro-terminal-shots/` |
| `verify-cosmos-integration.mjs` (audit harness: first-paint sky, navigation → camera, streaming and cap, phone chat ↔ Home) | **30/30** | `evidence/regression-verify-cosmos-integration.txt` |
| `verify-workspace-layout.mjs` | 23 pass / 7 fail, **identical check-for-check to the pre-existing baseline** (audit C8: stale chat selectors) | `evidence/regression-verify-workspace-layout.txt` vs `docs/missions/evidence/cosmos-integration/verify-layout-baseline.txt` |

About tablet run 1: the three tablet failures were all downstream of the first check. The lazily loaded Cosmos layer did not mount within 90 s, so the camera stayed at `(0,0,0)` and `goto` / `back` could not be measured. In the same session, after a reload, every restoration check passed with the camera at the planet. The audit recorded the same tablet starvation under SwiftShader (`browser-after-tablet-reruns.txt`). Tablet alone passed 24/24.

One run (not counted) was invalidated by the operator: a `git stash` taken to compare lint counts hot-reloaded the dev server mid-run. It was discarded and the harness re-run on a fresh server.

**Not tested:** any physical phone or tablet, or a real GPU. The mobile results are viewport emulation in Chromium.

Screenshots are illustrations, not measurements. Under SwiftShader the page paints a few frames per second, so a shot can show an older paint than the state the check measured. For example, `phone-restored.png` shows the readout `0.00 · 0.00 · 5.00` and the companion not yet drawn, while the check had just read the camera at `(0, 20, −21)` from the same `InfiniteCosmos.getCameraPosition()` the readout polls. Every PASS / FAIL above comes from DOM geometry or engine state, never from a picture.
