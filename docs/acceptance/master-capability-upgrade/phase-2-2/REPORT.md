# PHASE 2.2 — SPATIAL WORLD INTEGRATION, COMPOSITION, CAMERA & VERIFICATION

**Branch:** `freebuff/phase-2-2`
**Baseline merged in:** `claude/master-integration` (tip `1549194`) — Creation Studio, the four studios, capability gateway and all their tests.
**Spatial core carried across:** Phase 2.1 commit `791cdfd`, replayed on that baseline as `9b2ac00`.
**Date:** 2026-11-06. **Environment:** cloud VM, Vite dev server `0.0.0.0:3014`, Cloud browser (Chromium panel), no physical device.

## 1. Repository baseline and integration

`git merge-base HEAD claude/master-integration` = `e7b667b`. My branch was one commit (`791cdfd`) on that same base while `claude/master-integration` was 119 commits ahead, so nothing was merged blindly: the spatial commit was cherry-picked onto `1549194` and the single conflict (`GenesisV2Scene3D.tsx`, an import line) was resolved by keeping **both** the master-integration `useState` import and the spatial layer import. `bun install --frozen-lockfile` restored the new Creation Studio dependencies (`docx`, `exceljs`, `pdf-lib`, `pptxgenjs`, `fflate`, `jszip`) already declared on that branch; the lockfile was not modified.

Creation Studio, `/api/integration/*`, `AdapterRegistry`, Cosmos, Genesis, VoiceEngine, the 54-engine scene and the provider priority were not edited by this phase. `git diff --stat claude/master-integration` for this branch lists only spatial files, the spatial resolver, the spatial layer, its test file and docs.

## 2. Architecture map (as inspected, not assumed)

| Concern | Authoritative owner | Phase 2.2 reads it | Phase 2.2 writes it |
|---|---|---|---|
| Authored scene objects | `SpatialSceneGraph` + `SpatialObjectRegistry` | yes | only through the sealed commit |
| Universe scalars (age, chaos, evolution…) | `GenesisState` | no (not entities) | never |
| Cosmos entities (tabs, panels, agents) | `CosmosEntityRegistry` | yes | never |
| World destinations | `WorldRegistry` | yes | never |
| Live meshes, materials, camera | three.js scene inside the R3F canvas | yes (read-only provider) | never directly |
| Camera motion | `genesisCameraIntentBus` + `genesis-v2-camera` DOM bridge → `GenesisV2CameraRig` | yes | only through the applier's `fly`/`reset` intents |
| Studio capabilities | `AdapterRegistry` / `/api/integration/*` | untouched | untouched |
| Spatial permissions | `SpatialTierGuard` | yes | unchanged model, one documented approval rule added |

`GenesisState` holds numeric universe state, **not** entities, so "discover Genesis entities" is answered by the live three.js node graph plus the Cosmos/World registries, which is where Genesis entities actually live. This is stated instead of inventing a `GenesisEntityRegistry` that does not exist.

## 3. Gate B/C — `SpatialAdapter` (read-only world discovery)

`src/core/spatial/SpatialAdapter.ts`, with the framework-free seam `src/core/spatial/SpatialLiveScene.ts` (the R3F layer registers a provider; the core never imports React or three.js).

- Sources: authored objects, Cosmos entities, world destinations, live scene nodes.
- Identity: namespaced (`<spatial id>`, `cosmos:<id>`, `world:<key>`, `scene:<name>`), so the same entity cannot appear twice. Authored meshes (`spatial:<id>`) are filtered out of the scene layer, which is the duplicate-suppression test.
- Lifecycle: a registered destination or Cosmos entity that is absent from a mounted live scene is reported `stale: true`, never dropped.
- Resolution order: exact ref → registry id/name → scene name → exact label → unique partial. Ambiguity returns `null` plus candidates; it never guesses.
- Read-only proof: the inspection test asserts the revision, object count, spatial registry and Cosmos registry are unchanged after `list()`, `inspect()` and `stats()`.

## 4. Gate D/E — composition engine

`src/core/spatial/SpatialComposition.ts`.

- `scene.compose` (Tier 3, **non-mutating**, no approval): parses a request into a plan — objects (kind, name, position, scale, colour, role), typed links, optional updates of existing objects, the revision it was planned against, and a human summary. **Planning writes nothing** (asserted: revision and object list unchanged).
- `scene.commit` (Tier 4, approval required): builds real registry ids/names, one `graph.commit` batch, then verifies and rolls back on failure. The plan is bound to its planning revision, so a scene that moved in between returns `stale-revision` and applies nothing.
- The tier guard change is narrow and documented in code: an **owner-approved Tier 4** batch may run above the configured grant for that one authorization; Tier 5 stays unreachable, approval records are single-use, and a second attempt is reported `approval-invalid`.
- Templates implemented: research station (3 objects + 2 links), observatory (3 + 2), laboratory with N zones (hub + zones), planetary system (star + N planets, `orbits` links), N interconnected structures (ring of boxes, `connected` links), symmetrical formation (repositions existing authored objects).
- Atomicity: a 3-object research station is **one** revision; a rejected batch leaves the scene byte-identical.

## 5. Gate F — camera applier

`src/core/spatial/SpatialCameraApplier.ts`, driving the existing rig.

- Focus/frame/orbit/zoom/reset; geometry-aware framing from the bounding sphere of the targets, with the distance derived from the **smaller** of vertical and horizontal FOV (`effectiveHalfFov`) and the live aspect ratio. A 20-unit system frames dramatically further back than a 0.6-unit orb, and a portrait viewport frames further back than landscape (both asserted).
- Bounds match the rig (`minDistance 1.8`, `maxDistance 64`, `world ±36`, `y −12…30`); out-of-world destinations are refused before dispatch.
- Dispatch uses `genesisCameraIntentBus.emit({type:"fly"…})` for v1 and `dispatchV2CameraCommand({intent:"fly"…})` for v2 — the same commands the UI already uses. Camera operations never change the scene revision (asserted).
- `restore()` returns the previous pose; `reset()` returns the opening Genesis view; every request is bounded and cancellable; the rig's own user-gesture handler already cancels autonomous flights, so typing/gestures win.

## 6. Gate G — verification engine

`src/core/spatial/SpatialVerification.ts`.

| Layer | What it checks | Absent-context behaviour |
|---|---|---|
| graph | object exists, committed local position, colour, visibility | pass/fail |
| renderer | live mesh exists, **local** position, live material colour, visibility | **skipped** when no renderer |
| camera | live camera arrived at the requested pose | skipped when no camera |
| framing | target inside the camera's field of view | skipped when no camera |
| screenshot | never claimed by the core | `not-captured` |

Local position is used deliberately: world positions inherit the rotating Genesis parent, so comparing world coordinates would be a lie over time. A renderer disagreement triggers `guard.authorize(["scene.undo"])`, a real undo commit, and the reply says "I rolled that back" — verified by test (the batch disappears and Nova remains).

## 7. Gate H — chat integration

`AIRouter` stage **1.6 SPATIAL** unchanged and still **before any provider**, so all of this works with no AI provider configured. New utterances:

- `show me Nova`, `close-up of Comet`, `focus on X` → `camera.focus`
- `zoom out and show the entire …` / `show everything` → `camera.frame`
- `orbit around X by 45 degrees` → `camera.orbit`
- `zoom in` / `zoom out` → `camera.zoom`
- `return to the original Genesis view` / `reset the camera` → `camera.reset`
- `build a research station beside Nova`, `create an orbital observatory around Nova`, `build a futuristic laboratory with separate research zones`, `create a planetary system with … planets`, `create three interconnected structures …`, `arrange these objects into a symmetrical formation` → `scene.compose` (plan, then approval)
- `I approve` alone → commits the pending plan (or answers honestly that nothing is prepared)

A compose sentence carrying an inline approval plans first and commits **that exact plan** with a single-use ticket. Replies carry ids, positions, materials, revision and the verification status of each layer that could be measured. Refusals carry the code, the required tier, and the revision that stayed unchanged.

## 8–10. Visual and runtime results — what was and was not possible

Measured in this session, Cloud browser panel:

- Viewport was **328×528** (mobile layout). At that width the app mounts the LÉLU avatar window (one canvas, 120×174) and **no Genesis R3F canvas**, so `window.__leluSpatialProbe()` reported `nodes: 0`, `objects: []`, revision 0. Reading saved verbatim in [`probe-readings.json`](probe-readings.json).
- `preview_playwright` (needed to resize the viewport to desktop) failed with an internal tool error (`options.mode` must be `strip`), so the viewport could not be widened from here.
- Consequence, stated plainly: **no Phase 2.2 rendered-mesh or camera screenshot exists**, and none is claimed. Renderer and camera verification are exercised by the automated suite with a synthetic provider and synthetic camera; the live layers report `skipped` in this context rather than `pass`.
- Phase 2.1's desktop screenshots in `../phase-2-1/` remain the last captured visual evidence of the scene and are unaffected by this phase.

Desktop/Android/iPhone checks that could not be performed here: iPhone Safari, Android browser, desktop Safari, touch pinch/orbit, and layout-vs-composer geometry. Existing mobile layout tests still pass (they run in the suite), but they are structural, not visual.

## 11–12. Files

**Created:** `src/core/spatial/SpatialAdapter.ts`, `SpatialLiveScene.ts`, `SpatialComposition.ts`, `SpatialCameraApplier.ts`, `SpatialVerification.ts`, `tests/spatial-integration.test.ts`, this report, `probe-readings.json`.

**Modified:** `SpatialTypes.ts` (camera/compose/commit intents, verification types, view limits), `SpatialTierGuard.ts` (operation table + approved Tier 4 rule), `SpatialIntentBus.ts` (camera/compose/commit dispatch, 1.3 s wait for camera settle before verification), `SpatialResolver.ts` (camera/compose/approval parsing, verification in replies), `SpatialLayer.tsx` (live provider + camera probe), `SpatialCapabilityManifest.ts`, `index.ts`.

## 13. Tests (measured)

| Check | Result |
|---|---|
| `bun run typecheck` | exit 0 |
| `tsx --test` spatial core + chat + integration | **46 tests, 46 pass, 0 fail** (26 Phase 2.1 preserved + 20 new) |
| `bun run test` (full) | **1392 tests, 1386 pass, 0 fail, 6 skipped**, exit 0 (log `.lelu-sandbox/audit/test-phase22.log`) |
| `bun run lint` | **1 error, 108 warnings** |

The lint error is `react-hooks(rules-of-hooks)` in `src/app/scene/genesis/GenesisChat.tsx:1503` (`useChatExpanded` called conditionally). That file is **byte-identical to `claude/master-integration`** (empty `git diff` against that ref), so this is a pre-existing defect in the merged baseline, not something this phase introduced. It is left unfixed on purpose: changing the chat mount path is outside Phase 2.2 and would risk the four studios' chat surface. It must be fixed before lint can be used as a gate on this branch.

Coverage added: adapter discovery/identity/duplicates/read-only/staleness, plan-is-not-a-commit, unapproved commit refusal, atomic one-revision batch, stale plan rejection, renderer-disagreement rollback, planetary template shape, size-aware and portrait-aware framing, camera focus/reset/unknown-target refusal, camera verification pass/fail, renderer missing/mismatched/skipped, chat parsing for every new utterance, end-to-end plan→approve→commit, manifest truth, and Tier 4 approval single-use.

## 14. Evidence references

- [`probe-readings.json`](probe-readings.json) — the verbatim probe reading from the live app, including the `nodes: 0` limitation.
- `../phase-2-1/` — Phase 2.1 chat transcripts, scene screenshots and probe readings (desktop viewport, meshes rendered).
- Test logs: `.lelu-sandbox/audit/test-phase22.log`, `.lelu-sandbox/audit/lint-phase22.log`.

## 15. Known limitations

1. No visual proof of Phase 2.2 geometry or camera framing in this environment (no Genesis canvas at 328×528; viewport resize unavailable).
2. Screenshot verification is deliberately not automated; the core reports `screenshot: not-captured` rather than inferring pixels.
3. Existing Genesis/Cosmos entities are discoverable but **not movable by spatial operations** — they remain owned by their systems, as required by the phase's read-only adapter rule.
4. No performance measurements were taken (no GPU/desktop viewport available); nothing is claimed about frame time or mobile memory.
5. Round-trip camera ops add a measured 1.3 s settle wait before verification; that is a deliberate verification cost, not a rendering change.
6. The pre-existing `GenesisChat.tsx` conditional hook (baseline) keeps lint non-zero until fixed.

## 16. Capability manifest

`spatial-adapter`, `spatial-camera`, `spatial-verification` and `spatial-orchestrate` (`available`); `spatial-autonomous` stays `not_configured` because no operation is Tier 5 and no applier exists. `SPATIAL_OPERATIONS` was updated to match reality: `scene.compose` Tier 3 non-mutating, `scene.commit` Tier 4 with approval, five camera operations Tier 2.

## 17. Final state

Commit and tree hashes are recorded in the closing message and in the git history of `freebuff/phase-2-2`. Nothing was pushed.

## 18. Recorded hashes

- Implementation commit: `3d6148f7384ce3d608739479fdfbd89db21b747c`
- Implementation tree: `1f6953381fa59276e5ae673c7a864113200713f2`
- Branch: `freebuff/phase-2-2`, based on `claude/master-integration` `1549194`, with the Phase 2.1 spatial core replayed as `9b2ac00`.

This addendum is committed immediately after that implementation commit; the branch tip therefore differs
from the recorded implementation commit by this documentation-only change.
