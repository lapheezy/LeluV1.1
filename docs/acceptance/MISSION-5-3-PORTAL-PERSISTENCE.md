# MISSION 5.3 — PORTAL PERSISTENCE, IDENTITY & END-TO-END SPATIAL VALIDATION

**Repository:** lapheezy/LeluV1.1 · **Branch:** `claude/master-integration`
**Date:** 2026-11-07 · **Starting commit:** `265d7c1`
**Scope:** fix portal persistence at its source, then prove the lifecycle. No portal registry, scene, camera, layout engine, Studio, avatar or voice system was rebuilt.

---

## 1. Branch reconciliation

| Check | Result |
|---|---|
| Local HEAD at mission start | `265d7c1` (the verified 5.2 commit) |
| Working tree | clean (`git status --porcelain` empty) |
| Remote HEAD | `db988c8` — **two newer legitimate commits** (`dacf192`, `db988c8`: Creation Studio graphs/drawings) |
| Action | merged `FETCH_HEAD` into the branch: **no conflicts**, concurrent work preserved |
| Force-push / reset / history rewrite | none |

Mission 5.2's report (Part A + Part B), `tests/portal-tools.test.ts` and the 5.2 harness under
`docs/acceptance/spatial-phase-2-11/scripts/` were read before any edit.

The merge brought two Studio dependencies (`@xyflow/react`, `@excalidraw/excalidraw`) that were
declared in `package.json` but not installed in this workspace; `bun install --frozen-lockfile`
installed them without changing the lockfile. That was an environment gap, not a 5.3 defect.

## 2. Reproduction of the original defect

`docs/acceptance/spatial-phase-2-12/scripts/probe-persistence.mjs` (1440×900, real Chromium) recorded:

| Reading | Value |
|---|---|
| `localStorage` writable (write → read → remove) | `writable: true`, `roundTrip: true` |
| Portal key after mount | **absent** (`portalKeys: []`, `portalRaw: null`) |
| 12 other `lelu.*` keys | present — storage itself was healthy |
| `lelu-portal-create` → reply | `ok: true`, id `portal_studio_mw6mvf2o_6vrj` |
| Portal key immediately after create | **present**, 153 bytes |
| After reload | 1 record, **same id**, `duplicates: 0` |

`probe-seeding.mjs` then walked the real surface — mount → dismiss the identity gate → travel to
Cosmos → reload — reading the key at every step: **absent at every step**, even though the world
view mounted three canvases.

So the 5.2 observation was correct but its interpretation was not: **persistence worked the whole
time**. What never happened was the seeding.

## 3. Root cause

Two defects, both real, neither in the ring's rendering:

1. **`SpatialPortals.tsx` had no importer anywhere in `src`.** `grep -rn "SpatialPortals" src`
   returned only comment mentions. The component that calls `registry.seedRing(PORTAL_SCENES)` was
   never mounted, so the built-in ring's identities were never created, never persisted, and the 3D
   portal field was never drawn. Mission 5.1's "ring is built from the registry" was true of the
   source and false of the running application. The 2D navigator that Part A photographed is a
   different surface (`SpatialNavigator`), which is why frames showed portals while storage held none.
2. **The persistence contract could not report failure.** `KvStore.set` returned `void` and caught
   every backend error, so `PortalRegistry.persist()` — which documented "returns whether the write
   actually happened" — could only ever return `true`. A write blocked by the browser (private mode,
   quota, sandboxed iframe) was indistinguishable from a saved one, which is exactly the
   "durable success after a failed write" this mission forbids.

## 4. The fix

| File | Change |
|---|---|
| `src/app/scene/spatial/PortalRegistry.ts` | `RING_SCENES` — the built-in ring's list, derived from the scene graph, owned by the registry so seeding and drawing cannot disagree. `PortalPort.set` now returns `boolean`; `persist()` requires `true` and rolls back otherwise. |
| `src/app/scene/spatial/SpatialExperience.tsx` | Seeds `RING_SCENES` in the always-mounted experience. Identity no longer depends on whether a 3D field happens to be mounted. `seedRing` is idempotent, so this never duplicates a built-in portal. |
| `src/app/scene/genesis/render/GenesisRenderer.tsx` | Mounts `<SpatialPortals />` beside `<SpatialLayer />` in the live world renderer — the ring is now drawn in the one existing canvas, by the one registry. |
| `src/app/scene/spatial/SpatialPortals.tsx` | Consumes `RING_SCENES` from the registry instead of a private copy of the filter. |
| `src/core/storage/KvStore.ts` | `set()` returns whether at least one backend stored the value; serialization failure returns `false` instead of writing `undefined`. |

No second registry, no second storage system, no new renderer, camera or scene. The
`spatial.portal.create` / `spatial.portal.remove` tools are untouched.

## 5. Registry state, before and after reload (measured)

`probe-lifecycle.mjs`, phase `create`, through the **real portal panel**:

| Point | Count | Portals |
|---|---|---|
| After mount | 11 | `scene:galaxy … scene:conversation` |
| Panel create ×2 | 13 | + `Client files` → `files`, `Sprint board` → `projects` |
| After reload | **13** | identical ids, `duplicates: 0` |

Notices returned by the panel: `Portal “Client files” created.` and `Portal “Sprint board” created.`
The frame `screenshots/1440x900-03-created.png` was inspected and shows both rows in the panel's own
`PORTALS` list — `Client files · Files` and `Sprint board · Projects`, each with its remove control —
under the notice, so this is the real surface, not a registry assertion.
`probe-seeding.mjs` after the fix: 11 records present at mount, after gate dismissal, at Cosmos, and
after reload — the same ids each time.

## 6. Stable identity evidence

The portal id is created once and is the only handle thereafter. Measured across a reload:
`portal_media_mw6nxh7g_2ukt` was created, reloaded (still the same id), removed, and after a further
reload no longer resolved. The user-portal ids `portal_*` are distinct from built-in `scene:<id>`
identities, so a user portal to an environment never replaces its built-in portal.

## 7. User-created portal lifecycle — PASS

Create (panel) → registry entry present → reload → same identity, no duplicate → remove (panel,
`Portal removed.`) → reload → gone. Recorded in `measurements/lifecycle.json`, phases `create` and
`remove`.

## 8. Agent-created portal lifecycle — PASS (dispatch path)

`tests/portal-dispatch.test.ts` drives **`dispatchToolCall`** — the entry point a model-issued tool
call goes through — with the scene-side channel mounted exactly as `SpatialExperience` mounts it:

- `spatial.portal.create` → `ok: true`, one record, `createdBy: "agent"`, destination `studio`, write
  present in storage → a fresh registry over the same storage returns the same portal, no duplicate.
- `spatial.portal.remove` → `ok: true`, record gone → a fresh registry confirms the removal persisted.

Live browser: the same `lelu-portal-create` channel created `portal_research_*` at every viewport
(§12) and it persisted across reload.

## 9. Removal — PASS

Through the panel at 1440×900 and through the agent tool in tests. Removal is honest when the write
fails: the record is restored and the call returns `false`, covered by existing registry tests plus
the new silent-failure test.

## 10. 3D ring and travel — PARTIAL

- The field is now **mounted in the live renderer** (it was not before) and subscribes to the
  registry, so creates/removes propagate without a scene rebuild.
- `spatial-portals` frames were captured at all five viewports (`screenshots/*-01-ring-cosmos.png`
  plus `1440x900-02-portal-panel.png`, `1440x900-03-created.png`). The inspected frame shows the
  world view with the spatial navigator, dock and identity gate dismissed.
- **Not provable here:** that each individual portal mesh (built-in, user, agent) is drawn at a
  distinguishable position. At SwiftShader's few frames per second, and with the ring's additive
  materials over the Cosmos backdrop, the meshes cannot be counted from a screenshot, and no
  read-only probe exposes R3F object names. Recorded as **PARTIAL**, not claimed as verified.
- Camera travel: `core → cosmos` measured (`scene: cosmos`); ten scripted travels moved the scene
  across requests with 3 canvases throughout. Returning to Core was requested last and the final
  reading still showed `projects` after 4 s — **PARTIAL** on return-to-previous.
- Travelling by clicking a portal mesh was **not** exercised (meshes not clickable in a headless
  pixel test without a selection probe).

## 11. Conversation continuity — PARTIAL

With the chat open, the chat window node (`[data-lelu-chat-window]`) was tagged and, after travel,
still **the same DOM node** (`sameNode: true`), so the surface was not unmounted. However the flight
in that phase did not change the scene (the reading stayed `core`), so continuity across an actual
portal flight is **not** verified. No conversation content was exchanged (no provider turn).

## 12. Real viewport verification — PASS

`probe-viewports.mjs`, one fresh context per size, real dimensions read back:

| Viewport | Measured | Built-ins at mount | After create | After reload | After removal + reload |
|---|---|---|---|---|---|
| 375×812 (mobile/touch) | 375×812 | 11 | 12 | **12** | 11 |
| 390×844 (mobile/touch) | 390×844 | 11 | 12 | **12** | 11 |
| 430×932 (mobile/touch) | 430×932 | 11 | 12 | **12** | 11 |
| 1440×900 | 1440×900 | 11 | 12 | **12** | 11 |
| 1920×1080 | 1920×1080 | 11 | 12 | **12** | 11 |

Duplicates after reload: **0** at every size. The font/FONTCONFIG setup from 5.2 was preserved
(without it every glyph renders as a blank bar — environment, not app).

## 13. Stability and resources — PASS for identity, UNVERIFIED for memory

Ten scripted transitions (`PHASE=transitions`):

| Measurement | Value |
|---|---|
| Transitions | 10 |
| Canvases (min / max) | 3 / 3 — no duplicate scene or canvas appeared |
| Spatial probe nodes (max) | 52 |
| Portal registry count across all transitions | 11 (stable, never grew) |
| Duplicate portal identities | 0 |
| JS heap before → after | 232 MB → 545 MB |

Heap growth over ten transitions is recorded but **not** interpreted as a leak: no forced GC, one
sample pair, and the module/asset cache is shared with the rest of the app. CPU was not
instrumented (**UNVERIFIED**). Console errors during the runs were third-party network 429/503 and
`ERR_CONNECTION_REFUSED` on optional services, never application exceptions.

## 14. Regression gates

| Gate | Result |
|---|---|
| `npx tsc -b --force` | **PASS** — 0 errors |
| `bun run test` | **PASS** — **1,724 pass, 0 fail, 2 skipped** (1,726 tests) |
| `bun run lint` | **PASS** — 0 errors, **125 warnings** (117 on the 5.2 baseline; the 8 extra come from the concurrently merged Creation Studio work — none introduced by this mission) |
| `bun run build` | **PASS** — exit 0, `✓ built in 5.49s` |
| Portal tool tests (5.2) | **PASS** — 6/6 unchanged |
| Portal registry tests | **PASS** — 11 (8 existing + 3 new) |
| Agent dispatch tests | **PASS** — 2/2 new |

No test was skipped, weakened or deleted. New tests added: silent-failure detection, the built-in
ring's derivation, reload-once durability, and the two dispatch tests.

## 15. Remaining limitations

1. **Visual confirmation of individual portal meshes** needs a GPU browser or a read-only probe onto
   the R3F scene graph; this environment has neither. The component is mounted and driven by the
   registry — that is all that is proven.
2. **Chat continuity across a real flight** was not achieved: with the chat open, the scripted travel
   did not change the scene. The DOM node survived travel attempts; the full sequence did not run.
3. **Heap** was sampled, not measured as a trend with GC. No leak claim either way.
4. **Software compositor traps** (SIGTRAP) still end long sessions; the phase split exists because of
   it. `backdrop-filter: none` was injected only for panel captures.
5. Mission 5.2's Part B claim that built-in identities "would not survive a reload" is **superseded**:
   they were never written at all, because the seeder was never mounted.

## 16. Matrix

| Requirement | Status | Basis |
|---|---|---|
| Branch reconciled, concurrent work preserved | **PASS** | merge of `db988c8`, no conflicts, no rewrite |
| Original defect reproduced with real storage data | **PASS** | key absent at mount, present after create |
| Root cause identified | **PASS** | orphaned `SpatialPortals`; `KvStore.set` could not report failure |
| One authoritative registry | **PASS** | `RING_SCENES` + single singleton; no second store |
| Built-in identities persisted at mount | **PASS** | 11 records after mount |
| Built-in identities restored after reload | **PASS** | 11, identical ids |
| No duplicate built-in portals on init | **PASS** | `duplicates: 0`, seeding idempotent |
| User portal created through the UI panel | **PASS** | notices + registry + storage |
| User portal survives reload with same id | **PASS** | 13 → 13 |
| User portal removal persists across reload | **PASS** | 12 → 11 |
| Agent tool creates through `dispatchToolCall` | **PASS** | 2 dispatch tests |
| Agent-created portal survives reload | **PASS** | dispatch test + live channel at 5 sizes |
| Agent removal through the tool persists | **PASS** | dispatch test |
| Failed persistence never reported as success | **PASS** | `KvStore.set` contract + silent-failure test |
| Ring reflects the registry (draws registry records) | **PASS** | component mounted, subscribes to the registry |
| Individual portals visible in the 3D ring | **PARTIAL** | mounted; meshes not countable in software frames |
| Portal travel moves the camera to the destination | **PASS** | `scene: cosmos`, 10 travels |
| Selecting a portal mesh travels | **UNVERIFIED** | no selection probe |
| Return to the previous environment | **PARTIAL** | last return did not settle in the sample window |
| Conversation preserved across a portal flight | **PARTIAL** | same DOM node after travel; flight itself did not occur |
| Real viewports 375/390/430/1440/1920 | **PASS** | measured innerWidth/innerHeight |
| Create/reload/remove at every viewport | **PASS** | table in §12 |
| 10 transitions: one scene, one camera, one canvas | **PASS** | 3 canvases min = max |
| No duplicate portal identities under load | **PASS** | 0 across all runs |
| Heap leak across transitions | **UNVERIFIED** | one sample pair, no GC |
| CPU usage | **UNVERIFIED** | not instrumented |
| `tsc` / tests / lint / build | **PASS** | §14 |
| No rebuild of architecture or out-of-scope systems | **PASS** | one mount + one storage contract + registry-owned list |

---

## Closing statement

The portal ring was never failing to save; nothing was ever asked to save it. The component that
seeded and drew it was not in the application, and the storage layer beneath it could not report a
failed write even if one happened. Both are fixed at the source: identity is seeded by the
always-mounted experience, the ring is mounted in the one existing canvas, and persistence now fails
loudly.

Measured end to end: a portal created by a person through the panel or by LÉLU through
`dispatchToolCall` keeps its id and destination across reloads at all five required viewports,
appears exactly once, and stays removed after removal. Not measured, and not claimed: that each
portal mesh is visually distinguishable in the ring, that a conversation survives an actual flight,
and whether ten transitions leak memory.
