# Mission 5 — WP00 audit: LÉLU native ASRE/NRE integration

Date: 2026-11-17. Every statement below was checked against the code at the
stated commit, not taken from earlier reports.

## 1. Branch and baseline

| | |
| --- | --- |
| Preserved research branch | `origin/claude/blissful-cray-lqhs6g` → `ed5777ee64705e4e2e15ec5ec37832a32a5bd853` (verified with `git ls-remote`) |
| Its parent line | `f290716` (M15.3) + the 23 Mission 3/3.5/4 commits `a93f947 … ed5777e` (verified with `git log f290716..ed5777e`) |
| Mission 5 branch | `claude/mission5-lelu-asre-integration-mm6xau`, fast-forwarded to `ed5777e` |
| Branch name note | The mission text asks for `mission5/lelu-native-asre-integration`. This session is only authorised to push to `claude/mission5-lelu-asre-integration-mm6xau`, so that branch carries the work. The preserved branch is never written to. |

## 2. What exists (verified)

### 2.1 ASRE / NRE core — `src/core/asre/` (3,707 lines, pure TS, no DOM/Node imports)

| Module | Provides | Tests |
| --- | --- | --- |
| `nre/` | `SparseVoxelGrid` (Morton-keyed sparse cells, noisy-OR fusion, fingerprint de-dup), provenance bitmask OBSERVED/INFERRED/SYNTHESIZED/INTERPOLATED, `.lnre` container v2 (CRC + SHA-256, codec, v1 migration), `canonicalJson`, `sha256Hex` | `asre-nre.test.ts` |
| `temporal/SnapshotStore.ts` | diff-based snapshots, verified replay, `restore`, lineage, hash integrity errors — **in-memory only** | `asre-temporal.test.ts` |
| `temporal/compare.ts` | `compareGrids` → unchanged / rigid-translation / expansion / contraction / deformation | same |
| `temporal/Flipbook.ts` | multi-observation fusion with conflict carving and preservation of supported regions | `asre-flipbook.test.ts` (simulated views only) |
| `volume/volumetric.ts` | boundary/interior, fill, boundary-loss, EDT, SDF interpolation, uncertainty report, representation selector | `asre-volumetric.test.ts` |
| `volume/mesh.ts`, `gltf/GlbWriter.ts` | voxel-face and surface-nets meshing, `analyzeMesh`, `voxelizeMesh`, GLB writer (Z-up→Y-up conversion) | `asre-geometry.test.ts` |
| `analysis/coverage.ts` | per-side support, ranked "next view" requests | `asre-integration.test.ts` |
| `character/` | `CharacterSpec` (identity/body/face/hair/clothing/accessories/materials/pose), 15 components with declared deps and content keys, `ComponentCache` (full key → reuse, geometry key → recolour), whole-object baseline | `asre-character.test.ts` |
| `scheduler/Scheduler.ts` | gain/cost scheduler, cost model, slots, memory budget, deadlines | `asre-scheduler.test.ts` |
| `AsreTools.ts` | 4 tools: `asre.status`, `asre.reconstruct`, `asre.job`, `asre.character` (registered in `Bootstrap.ts:197`, executors merged in `ToolDispatcher.ts:2648`) | `asre-integration.test.ts` |

### 2.2 Server side

* `plugins/asreApi.ts` — mounted at `/api/asre` in **both** runtimes (`vite.config.ts:112-124`, `server.ts:516`). Routes: `status`, `reconstruct`, `jobs/<id>`, `character`, `assets/*`.
* `scripts/asre/runtime.ts` — Blender discovery through the existing `plugins/blenderStage.findBlender`; Python worker spawn with a timeout.
* `services/asre-reconstruct/` — `triposr_worker.py`, `analyze_worker.py`, `blender_render.py`, `setup.sh`.
* `scripts/asre/` — CLI experiments (`wp1-hypotheses.ts`, `wp5-variations.ts`, `wp6-benchmark.ts`), `pool.ts` (worker-thread component pool), `triposr-ingest.ts` (exported `ingest()`).

### 2.3 Existing LÉLU authorities ASRE must plug into

| Authority | Location | Relevant facts |
| --- | --- | --- |
| 3D Forge | `plugins/meshyForge.ts`, `plugins/forgeStore.ts`, `plugins/meshyForgeApi.ts`, `src/core/forge/*` | Disk ledger per "character" (`leluverse/assets/characters/<id>/generation_logs/jobs.json`), stateless `ForgeStore` (safe to share across instances), version folders created exclusively (never overwritten). Job `kind` already admits a **local, zero-credit kind** (`"blender"`). `library()`, `place()`, `exportFormats()` key off `status === "SUCCEEDED"`, an output file with role `model`, and `validation.verdict.meshValid` from `inspectGlb`. |
| Export gate | `plugins/blenderStage.ts:exportFormats` | Refuses unless the source job SUCCEEDED and its GLB passed inspection; produces `.blend/.glb/.obj/.stl/.fbx` as a new derived job. |
| GLB validation | `src/core/forge/GlbInspector.ts:inspectGlb` | The production verdict (`meshValid`, `rigValid`, problems). |
| Tools | `ToolRegistry` (declares), `ToolDispatcher` (executes; `executableToolIds`, `toolPermitted` via AutonomyGate), `ToolSchemas.selectToolSchemas` | Model-facing schemas are the intersection of the three; per-turn byte budget and `FAMILY_HINTS` routing decide which schemas a turn carries. No ASRE family hint exists today. |
| Character presentation | `src/core/avatar/LeluCharacterStore.ts` | Client-side (KvStore) choice of look (`gothic`/`earthy`), form, framing. Has **no** link to an ASRE identity. |
| Genesis UI | `GenesisInterface.tsx` (lazy panel map), `GenesisDock.tsx` (`DOCK_ITEMS`), `GenesisVisualStudio.tsx` (Render/Sketch/Avatar modes) | A new native workspace belongs as a mode of the Visual Studio (the "one visual environment" rule stated in that file). |
| 3D viewer | `src/app/scene/genesis/chat/Model3DView.tsx` | three.js / drei viewer for GLB/GLTF/STL/OBJ from any URL; orbit controls, bounds, triangle count, download. Reusable for the rendering workspace. |
| Cosmos placement | `MeshyForge.place` → `PlacedModel.tsx` | Accepts any SUCCEEDED, `meshValid` job. |

## 3. Gaps (integration points that are missing in code)

1. **Job lifecycle.** `asreApi` keeps jobs in a `Map` only; no cancellation (the Python child cannot be killed from outside), no restart recovery, no `cancelled`/`interrupted` state, job list not available.
2. **Hypotheses not in the job.** `runReconstruction` runs TripoSR → analyses → ingest → coverage, but the hypothesis comparison/fusion lives only in the CLI script `scripts/asre/wp1-hypotheses.ts` (top-level code, not callable).
3. **No reconstruction without the Python toolchain.** With `/opt/lelu-tools` absent every job fails; there is no TS-native path (e.g. silhouette hull) that keeps CPU/offline operation possible on a machine without torch.
4. **Multi-observation is test-only.** `Flipbook` is never reachable from the API or tools.
5. **Forge does not know ASRE.** ASRE GLBs live under `leluverse/assets/asre/` and never enter the Forge ledger, so library, placement, inspection history and the export gate do not apply to them.
6. **Character not persistent.** `POST /api/asre/character` always starts from `BASE_CHARACTER`; the component cache is in memory and keyed only by content (no builder version in the key, so a code change could reuse stale geometry across a long-lived process); no versions, undo/redo, restore or diffs; `identity.leluLook` is not linked to `LeluCharacterStore`.
7. **Temporal engine not connected to editing.** `SnapshotStore` is used only by tests and scripts.
8. **Evidence vocabulary.** NRE uses `SYNTHESIZED`; the mission's reasoning vocabulary is OBSERVED / INFERRED / INTERPOLATED / GENERATED / UNKNOWN. A single mapping is needed so tools and UI speak the same words (`SYNTHESIZED → GENERATED`, no evidence → `UNKNOWN`).
9. **No UI.** Nothing in Genesis/Cosmos calls `/api/asre`.
10. **No routing hint.** A turn that says "reconstruct this photo in 3D" is not steered to `asre_*` tools.

## 4. Risks

* **Tool-schema budget**: adding many ASRE tools could push other tools out of a turn. Mitigation: few tools with an `operation` argument; family hint only raises them when the turn is about reconstruction/characters.
* **Paid fallback**: Forge's other path is Meshy (paid). ASRE ingestion must never call Meshy or spend policy; the new kind records `estimatedCredits: 0`, `consumedCredits: 0`, and tests assert no network call.
* **Main-thread blocking**: the server is single-process (Bun/Vite). Python work already runs as a child process; TS-native reconstruction and character builds are CPU-bound and must stay bounded (small lattices) or run in the existing worker pool.
* **Disk**: TripoSR toolchain ≈ 6 GB in `/opt/lelu-tools`; ASRE outputs are kept out of git except small evidence files.
* **Pre-existing test fragility**: see §6 (first full run aborted without a summary).

## 5. Implementation order

| WP | Work |
| --- | --- |
| WP01 | `src/core/asre/contracts.ts` (typed job/result contracts, evidence classes), `AsreJobManager` (persisted lifecycle, cancellation via `AbortSignal` → child kill, restart recovery), TS-native PNG decode + silhouette reconstruction, hypothesis comparison as a library function, multi-observation `observe` job through `Flipbook`. |
| WP02 | Forge intake: ASRE GLB → Forge job of kind `"asre"` (inspected, provenance, confidence, parent chain); GLB import; a TS GLB editor (transform/material) that produces a new version; export through the existing gate. |
| WP03 | `Spatial` mode in the Visual Studio: Reconstruct / Numerical / Create / Render workspaces bound to the real API. |
| WP04 | Persistent character identity store on disk (versions, content-addressed component cache with builder version, dependency-aware rebuild), link to `LeluCharacterStore`. |
| WP05 | Version graph with operations, undo/redo/branch/restore, component and geometry diffs via `SnapshotStore`/`compareGrids`, immutability checks. |
| WP06 | Tools on the existing registry/dispatcher, evidence-class explanations, family hint. |
| WP07–WP09 | End-to-end tests, integrated benchmark, offline run, full gates, report. |

## 6. Baseline results (this container, before any Mission 5 change)

Toolchain: `/opt/lelu-tools` was absent in this fresh container and was re-installed with `services/asre-reconstruct/setup.sh` (needed `pip install scikit-build-core` first for the optional `torchmcubes` build — a setup.sh gap, fixed in WP01). TripoSR `model.ckpt` SHA-256 `429e2c6b…970ee` matches the pinned value. Depth-Anything-V2-Small downloaded at the pinned revision.

| Check | Result |
| --- | --- |
| `bun install --frozen-lockfile` | 957 packages |
| `tsc -b --force` | exit 0 |
| `oxlint` | exit 0 (warnings only) |
| `npm test` | **2,351 tests: 2,345 pass, 0 fail, 6 skipped**, 274 s (identical to the Mission 4 handoff) |

The first full `npm test` in this container ended at test 312 of `broker-unification.test.ts` with exit 1 and no TAP summary while `tsc -b --force` and the toolchain install ran at the same time; the rerun alone completed cleanly. Recorded as a pre-existing environment sensitivity (resource contention), not a code failure. Later gates run the suite alone.
