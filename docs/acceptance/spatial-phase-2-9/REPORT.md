# Phase 2.9 — Studio & Workspace reachability

Baseline `3092cd8` (tree `3def905`). Branch `freebuff/phase-2-2`. Not pushed, not merged.

No new placement pipeline, scene, graph, canvas or shell was added. The one
pipeline (`placeInWorld → SpatialIntentBus → commit → verify → reveal`) is
unchanged; this phase made the existing entry points reachable and measured.

## Root causes found

1. **Immersive had no reachable exit from the dashboard's own UI in the
   automation path.** `CosmosHome` hides on `HomeStore.immersive`; the way back
   is the Cosmos orb (`.lsn-orb`) or the Home item. Both work — verified — but
   the app-library sheet alone does not clear immersive, so a driver that only
   opened the library appeared trapped. Fix: the exit path is now exercised and
   documented, and `setImmersive` publishes `window.__leluImmersive` so the
   state is observable instead of inferred.
2. **Creation Studio has no app-library entry name of its own.** It *is* the
   `creation` panel, labelled "Documents" with the hint "Docs, decks and
   spreadsheets". Anyone looking for "Studio" finds `visualstudio` (Sketch /
   Render / Avatar) instead. That naming is the reason the earlier phase could
   not reach it, not a missing feature.
3. **The app-library sheet button did not open its panel under a synthetic
   pointer click** (the sheet stayed mounted, no panel). Dispatching the click
   on the real `.lsh-app` element opens it. Real-user clicks were not
   distinguishable from synthetic ones in this environment, so this is recorded
   as an automation caveat, not fixed.
4. **On phones the Studio card action is clipped outside the viewport.** A
   pointer click fails with "element is outside of the viewport"; the button
   exists and dispatches correctly via the DOM. This is a genuine mobile
   reachability defect (the card action is not reachable by touch at 375×812).
5. **A reveal raised while a panel covers the world is deferred, not lost.** It
   frames when the world becomes visible again. This is correct, but it means a
   stale `__leluReveal` can be read while the panel is open — an earlier check
   of mine wrongly accepted it, and the harness now closes the panel first.

## Evidence

| Check | Viewports | Result |
| --- | --- | --- |
| Dashboard → Place in World → reveal | 1440×900 | **PASS** — `Jewelry`, revision 1, framed |
| Leave immersive → dashboard returns | all runs | **PASS** — orb/Home exit, `home: true`, `immersive: false` |
| Studio → Place in World | 1440×900 | **PASS** — library via Documents, two artifacts, unique identity (`Untitled document`, `Untitled document 2`), revision 3, reveal **targets the second artifact** after closing the panel |
| Studio → Place in World | 375×812 | **PARTIAL** — commit, identity (`Untitled document`, `Untitled presentation`), revision 3, return to Studio and reload persistence all pass; the post-close reveal still reported the earlier `Jewelry` frame (stale), so reveal targeting on mobile is **FAIL** |
| Return to Studio after reveal | 375×812, 1440×900 | **PASS** |
| Artifact persistence across reload | 375×812 | **PASS for artifacts** — 2 cards; **graph does not persist** (0 objects after reload, by design: the scene is per-session) |
| Workspace → In world → reveal | 1440×900, 375×812, 430×932 | **PASS** — system world opened through Worlds → System, placement committed (`Jewelry 2`, revision 2), reveal framed it after returning to Genesis |
| Chat remains functional | — | not driven this phase; chat was not modified |
| Camera pose during navigation | — | ownership unchanged from 2.8 (cinematic/user/autonomous); no regression observed in continuity runs |

Screenshots and JSON per viewport are alongside this file; traces in `traces/`.

## Gates

`bun run test` — **1414 pass, 0 fail, 6 skip** (1420) · `bun run typecheck` — 0 ·
`bun run lint` — 0 errors, 108 warnings · `bun run build` — 0 (~6.5 s).

## Remaining blockers

* Mobile Studio reveal target (stale frame after closing the panel) — open.
* Mobile Studio card action is clipped; not touch-reachable at 375×812.
* `visualstudio` vs `creation` naming makes Creation Studio undiscoverable.
* Chat lifecycle not re-driven; camera continuity not re-measured after 2.9
  (2.8 numbers stand, code path untouched).
* Spatial graph does not survive reload; only artifacts do.
* Token usage and provider cost: not measurable from inside this run.

## Files changed

* `src/app/scene/genesis/home/homeStore.ts` — publish `__leluImmersive` diagnostic on every immersive change.
