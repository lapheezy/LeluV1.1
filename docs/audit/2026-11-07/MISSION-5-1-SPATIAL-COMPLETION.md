# Mission 5.1 — Spatial shell completion, portal integration and live validation

## 1. Commits

- **Starting commit:** `095b7f9` (`claude/master-integration`, Mission 5 merge).
- **Ending commit:** the Mission 5.1 commit on the same branch (see `git log`; the report is committed with the work it describes).
- **Remote:** reconciled by `git fetch` + merge before pushing. No force-push, no reset, no file reclaimed from another executor.

## 2–3. Files

**Created**

- `docs/audit/2026-11-07/MISSION-5-1-SPATIAL-COMPLETION.md` (this report)
- `docs/audit/2026-11-07/evidence/mission-5-1/` — five screenshots, `full-suite.log`, `lint.log`, `build.log`, the dev-server log

**Modified**

- `src/app/scene/spatial/PortalRegistry.ts` — ring seeding (`scene:<destination>` identities), `update()`, persistence that reports failure instead of pretending.
- `src/app/scene/spatial/SpatialPortals.tsx` — the ring is built from the registry, not the static scene graph.
- `src/app/scene/spatial/SpatialNavigator.tsx` — portal creation / travel / removal UI and the auto-arrange + regenerate controls.
- `src/app/scene/spatial/SpatialExperience.tsx` — `lelu-portal-create` / `lelu-portal-remove` agent channel.
- `src/app/scene/genesis/layout/moduleLayout.ts` — pin policy in `autoArrange`, deterministic collision fallback.
- `src/app/scene/genesis/GenesisModuleHost.tsx` — pin toggle in the one window chrome, and the chrome-drag fix below.
- `tests/module-layout.test.ts`, `tests/spatial-portals.test.ts`, `tests/spatial-experience.test.ts`.
- `MULTICHAT_HANDOFF.md` — the coordination claim for this mission.

## 4. Architecture audit

The immutable decisions hold: one Genesis shell, one layout model (`moduleLayout.ts`), one persisted `ModuleLayoutStore`, one spatial scene + `SpatialRuntime` camera, one dock, one conversation/workspace model. This mission adds no store, renderer, dock, camera or scene.

The real integration points were:

- `SpatialPortals` built its ring from `PORTAL_SCENES` (a static filter of `SPATIAL_DESTINATIONS`), so registry portals had no way to appear.
- `SpatialNavigator` is the user-facing rail, and already carried travel, stop/reverse and capability groups — the natural place for portal and layout controls.
- `GenesisModuleHost` owns the only window chrome, so pin belongs there; `ModuleLayoutStore` is the only place pin state can live.
- `SpatialExperience` is the bridge between the runtime and the app, so the agent-facing event channel belongs there.

## 5. Portal integration

- `seedRing(scenes)` creates one stable record per built-in destination with id `scene:<destination>`. It is idempotent: a second call adds nothing, and a user portal to the same environment gets a different id (`portal:<destination>:<stamp>`), so the ring can draw both.
- The ring now maps `PortalRegistry.list()` (core/cosmos excluded, they are the world itself). A portal created by a person or an agent appears on the next registry notification and disappears when removed — no scene rebuild, no second canvas.
- A second portal to the same destination orbits beside the first by a deterministic golden-angle offset instead of stacking on it.
- Clicking a portal calls `runtime.travel(destination)` — the same travel the rail uses, on the same camera.
- `persist()` returns whether the write happened. `create`, `update`, `remove` and `seedRing` refuse (and roll back) when storage fails, so nothing is reported as created that would vanish on reload.

## 6. User-created portals

The rail's ◇ control opens a panel with a destination selector (every destination except core/cosmos), a name field, a Create button, the list of created portals with a travel chip and a ✕ remove control, plus the auto-arrange / regenerate controls and a `placed · pinned` counter.

Verified live: created **“Client files” → Files** from the panel. The notice read `Portal “Client files” created.`, the chip appeared, and `lelu.spatial.portals.v1` (KvStore prefixes it to `lelu.lelu.spatial.portals.v1`) held exactly:

```json
[{"id":"portal_files_mw5wrytn_g2ft","destination":"files","label":"Client files",
  "createdBy":"user","createdAt":1794026028299,"workspace":"default"}]
```

## 7. Agent-created portals

`window.dispatchEvent(new CustomEvent("lelu-portal-create", { detail: { destination, label, workspace, requestId } }))` creates a portal through the same registry with `createdBy: "agent"` and answers with `lelu-portal-created` carrying `{ ok, portal | reason, requestId }`. `lelu-portal-remove` answers similarly. Validation is the registry's: an unknown destination returns `{ ok: false, reason }` and writes nothing. **The channel is implemented and unit-tested at the registry level; it was not exercised live** (see the matrix).

## 8. Auto-layout controls

The rail panel exposes:

- **Auto-arrange** → `store.arrange()`: tiles the automatic windows, leaves hand-placed and pinned ones exactly where they are.
- **Regenerate layout** → `store.restore()`: returns every window to automatic placement and reports how many moved, with the notice spelling out that data, dock order and visibility are untouched. It is deliberately labelled differently from any data reset.

Verified live: `Auto-arranged the automatic windows; your placed windows stayed put.` and `Layout already matches the automatic arrangement.`; the persisted layout held `{"moduleId":"knowledge","manual":false,"pinned":false,"rect":{"x":8,"y":16,"width":304,"height":416}}`.

Collision handling was made deterministic too: a window that a clamp pins in place now shrinks and scans for a free slot instead of looping on top of the obstacle.

## 9. Pin / unpin

The window chrome carries a pin button (`data-lelu-module-pin`), reflecting `aria-pressed` and persisting through `ModuleLayoutStore`.

**Pin policy, stated plainly:**

| State | Owner | Meaning |
|---|---|---|
| `manual` | the person | this rect was placed by hand; auto-arrange never moves it |
| `pinned` | the person | auto-arrange leaves the rect alone and the dock lists it first; an explicit *Regenerate layout* overrides the geometry but keeps the flag |
| hidden | the dock's own `lelu.dock.v1` settings | the item is not in the rail's tabs; it is kept, not deleted |
| visible | the module host | the module is presented inline/expanded; minimized modules keep running |

These are four separate states and none of them deletes anything.

**Defect found and fixed:** the title bar's drag handler called `preventDefault()` on `pointerdown` for every pointer, which suppressed the click on *all* chrome buttons (pin, minimize, expand, close). The first live pin click did nothing; after the fix (drag is ignored when the pointer starts on a button/input/select/textarea/a) the same click flipped `aria-pressed` true → false and persisted `pinned`.

## 10. Responsive behaviour

The layout engine reflows and clamps (unit-tested at 390×844 and 1440×900); the module host clamps geometry per breakpoint. **Pixel verification at 390×844, 375×812, 1440×900 and 1920×1080 was not obtained** — see §18. The five captured screenshots are at the cloud browser panel's native 328×528 viewport, which exercises the compact/phone path of the same code.

## 11–14. Gates

| Gate | Result |
|---|---|
| `npx tsc -b --force` | **PASS** — 0 errors |
| `bun run test` | **PASS** — 1629 tests, 1627 pass, 0 fail, 2 skipped |
| `bun run lint` | **PASS** — 0 errors, **114 warnings** (baseline 113: one new warning, not silenced) |
| `bun run build` | **PASS** — exit 0 (`✓ built in 4.63s`) |

New/expanded tests: 18 in `tests/module-layout.test.ts` and 8 in `tests/spatial-portals.test.ts` — auto-arrange, collision fallback, manual preservation, pinned preservation + regenerate override, viewport reflow, deterministic restore, migration with skipped counts, stored-layout re-validation, dock order/pin/reorder, workspace separation; portal creation, duplicate prevention, ring seeding idempotency, invalid destinations, metadata update, persistence-failure refusal, migration, travel plan, removal.

One test was updated rather than weakened: `spatial-experience.test.ts` asserted the exact portal memo dependency list, which now also contains the registry list; it asserts that list is not re-read per frame as well.

Logs: `evidence/mission-5-1/{full-suite,lint,build}.log`.

## 15. Screenshots (live, this worktree, this mission)

`evidence/mission-5-1/`

1. `desktop-01-genesis-shell.png` — the shell booted (`spatialScene: core`, `webgpu`, spatial rail present).
2. `desktop-02-portal-panel.png` — the portal panel with the destination selector and empty custom list.
3. `desktop-03-portal-transition.png` — mid-flight: `spatialTransition: workspace-expand`, stop/reverse offered, portal chip listed.
4. `desktop-04-portal-destination.png` — arrival at Files: real Knowledge module window, pin control in the chrome.
5. `desktop-05-pin-and-layout.png` — after auto-arrange from the same panel.

Reproducible procedure: install `.env.local` as in this workspace, `bun install`, `npx vite --host 0.0.0.0 --strictPort --port 3013` with `__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS=<preview hostname>`, open the preview origin, click ◇ in the spatial rail, pick a destination, name it, Create, then click the chip.

## 16–17. Performance and memory

| Measurement | Value | Status |
|---|---|---|
| Idle rAF rate | 1 fps sampled | **UNVERIFIED** — the cloud browser tab is throttled/backgrounded; rAF does not run at display rate there |
| FPS during portal transition | not measured | **UNVERIFIED** — same throttle |
| FPS during module movement | not measured | **UNVERIFIED** |
| JS heap before navigation | 476 MB | observed sample |
| JS heap after navigation | 517 MB | observed sample, **not** a leak test |
| Repeated-transition leak test | not run | **UNVERIFIED** |
| `<canvas>` count, core | 3 | observed |
| `<canvas>` count, inside a workspace module | 0 | observed — the 3D scene is not painted while a workspace owns the screen |
| Module windows | 1 (`knowledge`) | observed |
| Portal records | 1 built-in-seeded set + 1 created | observed |

No number here is inferred or estimated.

## 18. Remaining blockers

1. **`preview_playwright` is unavailable in this environment** — every call, including a one-line `page.title()`, fails with `The property 'options.mode' must be one of: 'strip'. Received 'transform'`. Without it there is no viewport control, so the four required viewport sizes could not be captured.
2. **The cloud browser panel viewport is fixed at 328×528.** Probes that loaded several app iframes at once then exceeded the 10 s evaluation limit, and one `Page.captureScreenshot` failed with an internal error.
3. **The agent portal channel was not driven live;** it is covered by registry-level tests only.
4. **Conversation preservation was not exercised live** — the chat was not open during the portal travel, so while nothing in the code path unmounts it, there is no captured evidence for that specific criterion.
5. **The dev server died when the runner restarted mid-mission.** The app was verified working before that; restart it with the command in §15 to reproduce.

## 19. Known limitations

- Pinned portals cannot be reordered by dragging in the new panel; ordering comes from the registry's creation time.
- The register/deregister of a portal into the 3D ring was verified in code and in the DOM/registry, but the newly created *seam* was not visually confirmed in the WebGPU canvas (the ring sits behind the shell at 328 px width).
- `restoreAutoLayout` intentionally overrides pin geometry; it preserves the pin flag itself.

## 20. Acceptance matrix

| Criterion | Result | Evidence |
|---|---|---|
| Registry → ring integration | **PASS (code + tests), UNVERIFIED (3D pixels)** | ring maps `PortalRegistry.list()`, subscription-driven add/remove |
| Dynamic portal appears / disappears | **PASS** | live chip created; `remove` tested with persistence rollback |
| Built-in destinations keep working | **PASS** | `seedRing` idempotency test; ring seeded on mount |
| Duplicate identities prevented | **PASS** | `scene:` vs `portal:` namespaces, test |
| Stable ids across reloads | **PASS** | same-port reload test; live persisted record |
| User-created portal: create, name, travel, remove | **PASS** | live create + travel; removal unit-tested |
| Metadata edit | **PASS (tests)** | `update()` test, invalid destination refused |
| Agent-created portal | **PARTIAL** | channel implemented; not exercised live |
| Navigation reuses one scene/camera | **PASS** | live `workspace-expand` transition, one runtime |
| Conversation preservation during travel | **UNVERIFIED** | chat closed during the test |
| Workspace preservation | **PASS** | arrival opened the canonical `knowledge` panel |
| Persistence of create/remove/update | **PASS** | live create; tests for the rest |
| Legacy portal migration | **PASS (tests)** | `readPortals` counts skips |
| Auto-arrange control | **PASS** | live notice + persisted entries |
| Regenerate layout control | **PASS** | live notice; distinct from data reset in copy |
| Manual placement preserved | **PASS (tests)** | engine + store tests |
| Pin / unpin UI | **PASS** | live toggle after the chrome fix |
| Pin persistence | **PASS** | `lelu.layout.v2` `pinned` flag |
| Responsive at 390/375/1440/1920 | **UNVERIFIED** | tooling blockers §18 |
| One shell, no parallel architecture | **PASS** | no new store/renderer/dock/camera/scene |
| Typecheck / tests / lint / build | **PASS** | 0 errors, 1627 pass, 0 lint errors, build 0 |
| FPS and memory under load | **UNVERIFIED** | throttled tab §16 |
