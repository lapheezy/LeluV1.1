# ASRE — Clean-Session Baseline Audit

Date: 2026-11-17. Session: clean reconstruction after the lost Freebuff session.

## What this session starts from

| Item | Value |
| --- | --- |
| Branch | `claude/blissful-cray-lqhs6g` (isolated development branch, cloned fresh) |
| Starting HEAD | `f29071614aa27b07bd3c889fae32c7b73c81ede8` (`M15.3 WP05: walks that start before her world exists…`) |
| Historical refs `temporal-studio/asre-core`, `3f8094e` | **Not present** in this repository (no such branch; SHA not reachable). Treated as historical references only. |
| Lost session | Nothing recovered. No file, commit, or result from it is claimed here. |

## Existing committed infrastructure that ASRE reuses (not duplicated)

| Area | Location | Use by ASRE |
| --- | --- | --- |
| GLB validation | `src/core/forge/GlbInspector.ts` (`inspectGlb`) | Every GLB ASRE writes is re-read and validated by the existing inspector. |
| Blender pipeline | `plugins/blenderStage.ts` (`findBlender`, `LELU_BLENDER_BIN` / `LELU_BLENDER_PYTHON`), `scripts/blender/*.py` | ASRE renders resolve Blender the same way. |
| Script-only Blender emitter | `src/core/runtime/local/LocalBlenderAdapter.ts` | Left unchanged (browser-side, script generation only). |
| Character state | `src/core/avatar/LeluCharacterStore.ts`, `LeluRig.ts` (looks/forms/framing) | ASRE character identity is a separate, numerical layer; the store's look ids are kept as the persona link. |
| Image→3D (paid) | `src/core/avatar/Avatar3DReconstructor.ts`, `plugins/meshyForge.ts` | **Not used** (Meshy is paid). ASRE provides the zero-spend local alternative. |
| Tool registry | `src/core/tools/ToolRegistry.ts`, `src/core/forge/ForgeTools.ts`, `Bootstrap.ts` | ASRE tools register in the same registry. |
| Spatial / Cosmos | `src/core/spatial/*` (scene graph, object registry, placeInWorld) | ASRE outputs are GLB assets placeable through the existing spatial path. |
| Tests | `node:test` via `tsx` (`npm test`), `tests/support/glbFixture.ts` | ASRE tests follow the same runner. |

No prior NRE, voxel, snapshot or temporal-reconstruction code exists in the repository (searched `voxel|asre|triposr|vxz|o-voxel`): only incidental words matched. Missions 3 and 3.5 must therefore be rebuilt from the handoff specification.

## Toolchain found / installed in this container

| Tool | Status |
| --- | --- |
| Node 22, bun | present; dependencies installed with `bun install --frozen-lockfile` (npm `package-lock.json` is out of sync with `package.json`, so `npm ci` fails — pre-existing, not changed). |
| Python 3.13, numpy 2.5 | present |
| Blender 4.2.23 LTS | installed to `/opt/lelu-tools/blender-4.2.23-linux-x64` (GPL, free download, not committed) |
| CPU torch + TripoSR deps | installing into `/opt/lelu-tools/asre-venv` (not committed) |
| TripoSR code | `VAST-AI-Research/TripoSR` @ `107cefdc244c39106fa830359024f6a2f1c78871`, MIT licence |
| TripoSR weights | `stabilityai/TripoSR` on Hugging Face (MIT), reachable without an account |
| Hardware | 4 vCPU, 15 GB RAM, no GPU |

## Architecture decision (initial)

- `src/core/asre/` — pure TypeScript, no Node or DOM imports, runs in the browser and in the server: NRE schema, Morton ordering, sparse grids, serialization, temporal snapshots, volumetric operations, components, scheduler logic, character variation model, GLB writer.
- `scripts/asre/` — Node-only runners (files, worker threads, child processes to Python/Blender), experiments and benchmarks.
- `services/asre-reconstruct/` — offline Python worker (TripoSR CPU, image analysis) and Blender render script.
- Large binaries (weights, Blender, venv) are never committed; setup scripts and provenance records are.
