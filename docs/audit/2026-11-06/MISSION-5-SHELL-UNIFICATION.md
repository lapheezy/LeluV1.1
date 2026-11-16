# Mission 5 — Dock, auto-layout and spatial portals

Starting commit `3c43616`, branch `claude/master-integration`.

## What was already in the canonical shell (audited, not rebuilt)

| Capability | Canonical implementation | State before this mission |
|---|---|---|
| Dock | `GenesisDock.tsx` — three breakpoints (desktop rail / tablet rail / phone LÉLU menu), persisted order + hidden set + size (`lelu.dock.v1`), drag-to-reorder, tab editor, `data-lelu-dock` marker at every breakpoint | **Working** |
| Floating module windows | `GenesisModuleHost.tsx` — one `FloatingModuleWindow`, drag/resize/minimize/expand/close through `GenesisCore` actions | **Working**, but geometry lived only on `ModuleState` |
| Auto-tiling policy | `windowLayout.ts` — `layoutWindowRects`, equal columns / one column, `rectsOverlap` | **Present but called only by its tests** |
| Spatial portals | `SpatialPortals.tsx` + `SpatialExperience.tsx` inside the persistent `GenesisScene`; `SpatialRuntime`, `SpatialScenes`, `capabilityGroups` | **Rendered**, but portals had no identity |
| Camera ownership | `GenesisCameraController` → `useSpatialCamera` (cinematic / user / autonomous) | **Working** |

The `layoutIndex`, `layoutWindowRects`, `manualPlacement` and `autoLayoutModules` fields the Session 3C shell referenced never existed in the canonical `GenesisCore`. Rather than copy that shell's state shape in, this mission adds the missing *model* and keeps the one shell.

## What this mission added

### `src/app/scene/genesis/layout/moduleLayout.ts` — one authoritative layout model

Pure functions over `ModuleLayoutEntry { moduleId, rect, zIndex, manual, pinned, minimized, workspace }`:

- `autoArrange` — tiles every non-manual, non-minimised entry with the shared policy, then de-overlaps it against everything already placed (manual included). **A manual rect is returned untouched.**
- `resolveCollisions` — steps a rect aside, and when the clamp pins a full-width window it shrinks it instead of looping in place.
- `placeManual` / `releaseManual` — a person's placement becomes `manual: true`; releasing hands the module back to auto-arrange.
- `restoreAutoLayout` — explicit regeneration, deterministic, and it reports which modules moved.
- `reflowForViewport` — auto rects re-tile, manual rects are only clamped back on screen, never moved on purpose.
- `setPinned` / `setMinimized` / `reorder` / `dockOrder` / `workspaceEntries` / `addEntry` / `removeEntry`.
- `migrateLayout` — legacy per-module geometry becomes manual entries, a hidden dock item becomes `pinned: false` (kept, not deleted), and unreadable geometry is **counted as skipped**.
- `readLayout` — re-validates a stored layout and reports corrupt entries.

### `src/app/scene/genesis/layout/ModuleLayoutStore.ts` — one store, persisted

Singleton over the existing `KvStore` (`lelu.layout.v2`), migrating `lelu.dock.v1` and legacy module geometry on first use. One instance for the dock, the module host and LÉLU's own actions — no competing layout store.

### `GenesisModuleHost` — wired, not decorative

- A module with no position of its own now opens at the store's rect, and `store.ensure()` auto-arranges the modules that have no manual placement.
- A drag or resize writes back through `store.place()`, so it is recorded as manual, is never moved by auto-arrange, and survives a reload.

### `src/app/scene/spatial/PortalRegistry.ts` — persistent portal identity

A portal record is `{ id, destination, label, createdBy, createdAt, workspace }`, and `destination` must exist in `SPATIAL_DESTINATIONS` — a portal to nowhere is refused with a reason and nothing is written. `planTravel` returns the travel plan over the **same** persistent scene with the existing `cinematic` camera ownership and `preservesConversation` / `preservesWorkspace` both true: no second canvas, no crossfade, nothing unmounts. `readPortals` migrates a legacy list and counts invalid entries.

## Validation

| Gate | Result |
|---|---|
| `npx tsc -b --force` | **PASS** — 0 errors |
| `bun run test` | **PASS** — 1625 tests, 1623 pass, 0 fail, 2 skipped |
| `bun run lint` | **PASS** — 0 errors, 113 warnings |
| `bun run build` | **PASS** — exit 0 |

New tests: `tests/module-layout.test.ts` (10) and `tests/spatial-portals.test.ts` (5). They pin: no overlap after auto-arrange, a manual rect is never moved, restore is reproducible, a phone viewport keeps every rect usable, dock order/pin/reorder, workspace separation, legacy migration (manual geometry, hidden → unpinned, skipped count), stored-layout re-validation, and portal identity/validation/persistence/travel.

Evidence: `evidence/mission-5/` (`lint.log`, `full-suite.log`, `build.log`).

## Honest status against the acceptance criteria

| Criterion | Status |
|---|---|
| Dock functional inside Genesis | **PASS** — pre-existing, verified by `spatial-dock-groups` and the dock's own settings path |
| Module auto-layout works | **PASS (logic)** — engine + store wired into the module host; **UNVERIFIED visually**, see below |
| Manual positioning persists | **PASS (logic)** — written on drag/resize, migrated from legacy, restored on open |
| Spatial portals navigate environments | **PARTIAL** — the ring renders and `SpatialRuntime` travels; `PortalRegistry` gives identity, validation and travel plans, but **the ring is not yet reading the registry**, so a user-created portal is stored and resolvable yet not drawn as an extra portal |
| Camera continuity | **PASS (by construction)** — one canvas, one camera, `planTravel` declares cinematic ownership; **no live measurement** |
| Chat/project context persist | **PASS (by construction)** — navigation does not unmount the conversation; no live measurement |
| One shell, no competing architecture | **PASS** — no second store, renderer or navigation system was added |
| Studio intact | **PASS** — 1625 tests green, studio suites included |

### Not verified

- **No screenshots and no browser run.** There is still no `.env` here (no Supabase or provider credentials), so the app cannot boot into a capturable Studio. Nothing visual is claimed.
- **No FPS or memory measurements.** No running app, so no numbers; reporting any would be fabrication.
- **Dock pin/unpin** is the existing dock behaviour (hide/restore + reorder in the tab editor); the layout store's `pinned` flag is the module-side mirror. There is deliberately not a second dock settings store.

## Next, in order

1. Draw registry-created portals: have `SpatialPortals` append `PortalRegistry.list()` entries to its ring and route their selection through `planTravel`, so a user/agent portal is visible and travellable.
2. Surface auto-layout explicitly: a "regenerate layout" control and `store.restore()` from the dock's tab editor.
3. With credentials: capture desktop + iPhone viewports, and measure FPS/memory during a portal transition.
