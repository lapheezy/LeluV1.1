# Session handoff — LÉLU ASRE

Living document: update it and commit it at the end of every session. The next session must be able to continue from the repository and this file alone.

## Repository state (end of session 1 of the rebuild, 2026-11-17)

| | |
| --- | --- |
| Branch | `claude/blissful-cray-lqhs6g` |
| Starting SHA | `f29071614aa27b07bd3c889fae32c7b73c81ede8` |
| Ending SHA | the commit that adds this file (see `git log -1`; recorded in the session report) |
| Pushed | **No.** Commits are local to the session container. A push to the branch was attempted once and refused under "no push without explicit authorization"; the owner must authorise a push or the work is lost when the container is reclaimed. |
| Working tree | clean after the final checkpoint, except ignored reproducible outputs (`artifacts/asre/**/*.npy`, `*.lnre`, most `*.glb`) |

Container restarts happened twice during this session; both times the committed work survived, and the uncommitted integration work (which survived by luck) was committed immediately afterwards. The WP6 benchmark is journaled so a restart only loses the trial in flight.

## Completed work

| Area | Status | Code | Tests |
| --- | --- | --- | --- |
| NRE: schema, provenance bitmask, Morton, sparse grid, noisy-OR with fingerprint dedup, `.lnre` container (CRC + SHA-256, codec, v1→v2 migration) | VERIFIED | `src/core/asre/nre/` | `tests/asre-nre.test.ts` |
| Temporal: diff snapshots, verified replay, restore, change classification | VERIFIED | `src/core/asre/temporal/SnapshotStore.ts`, `compare.ts` | `tests/asre-temporal.test.ts` |
| Volumetric: boundary/interior, fill, loss measurement, representation selector, exact EDT, motion-compensated SDF interpolation, uncertainty | VERIFIED | `src/core/asre/volume/volumetric.ts` | `tests/asre-volumetric.test.ts` |
| Meshing (voxel faces, surface nets), mesh validation, GLB writer (Z-up→Y-up) | VERIFIED | `src/core/asre/volume/mesh.ts`, `gltf/GlbWriter.ts` | `tests/asre-geometry.test.ts` |
| Blender Cycles CPU renderer | VERIFIED | `services/asre-reconstruct/blender_render.py`, `scripts/asre/runtime.ts` | smoke + every artifact |
| Offline TripoSR CPU worker, NRE ingest, upstream validation | VERIFIED | `services/asre-reconstruct/triposr_worker.py`, `scripts/asre/triposr-ingest.ts` | `artifacts/asre/triposr/police_woman/ingest.json` |
| WP1 analyses + hypotheses | VERIFIED | `analyze_worker.py`, `scripts/asre/wp1-hypotheses.ts` | `artifacts/asre/wp1/police_woman/` |
| WP2 flipbook | VERIFIED (simulated views) | `src/core/asre/temporal/Flipbook.ts` | `tests/asre-flipbook.test.ts` |
| WP3 components | VERIFIED | `src/core/asre/character/` | `tests/asre-character.test.ts` |
| WP4 scheduler + worker pool | VERIFIED | `src/core/asre/scheduler/Scheduler.ts`, `scripts/asre/pool.ts` | `tests/asre-scheduler.test.ts` |
| WP5 67 rendered variations, 40 hairstyles | VERIFIED | `scripts/asre/wp5-variations.ts` | `artifacts/asre/character/variations/` |
| WP6 controlled benchmark | VERIFIED | `scripts/asre/wp6-benchmark.ts` | `artifacts/asre/wp6/` |
| LÉLU integration: API + 4 tools + coverage/next-view | PARTIAL (no UI yet) | `plugins/asreApi.ts`, `src/core/asre/AsreTools.ts`, `analysis/coverage.ts` | `tests/asre-integration.test.ts` |
| O-Voxel / `.vxz` adapter | NOT IMPLEMENTED (spec not available to verify) | — | — |

Reports: `docs/asre/00-BASELINE-AUDIT.md`, `01-MISSION-3-3.5-REBUILD.md`, `02-MISSION-4-ASRE.md`.

Checks at the end of this session: full `tsc -b --force` exit 0; full `npm test`: **2,351 tests, 2,345 pass, 0 fail, 6 skipped** (baseline before this session: 2,298 / 2,292 / 0 / 6; the difference is the new ASRE tests).

## Known defects and gaps

- Component meshes keep surfaces hidden under clothing/hair: +79% triangles vs a single mesh (same occupancy). Add an export-time merge/cull.
- Adaptive parallel strategy does not help single-component edits (worker round trip > work); scheduler should run small edits inline. Not implemented.
- Historical TripoSR figures (15,950 vertices, 45,475 cells, 9.84:1, 38.4 s) were not reproduced: the historical input is unknown; this session's numbers for `police_woman.png` are recorded with their reasons in `01-MISSION-3-3.5-REBUILD.md`.
- `.lnre` compression is 5.42:1 for the TripoSR grid because each cell stores a float64 density-derived probability; quantising probabilities would shrink it (would be a schema v3 change).
- Back-mounted hairstyles are hard to see in the front three-quarter renders; add a back view to the variation renders.
- No UI: ASRE jobs are reachable through tools and the API, not yet from Genesis/Cosmos. ASRE GLBs are not yet placed through the Forge placement path; `identity.leluLook` is not linked to `LeluCharacterStore`.
- `npm ci` fails because `package-lock.json` is out of sync with `package.json` (pre-existing); use `bun install --frozen-lockfile`.

## Exact next step

1. Get authorisation to push `claude/blissful-cray-lqhs6g`.
2. Inline-vs-worker decision in the adaptive scheduler (predicted cost < IPC overhead → run inline); re-run WP6 to confirm per-edit latency ≤ incremental.
3. Second real observation for WP2 on real images (e.g. a side view from another TripoSR example or a rendered side view of the reconstruction) through `Flipbook`, measuring coverage improvement with `assessCoverage`.
4. UI surface for `asre.job` in Genesis (intermediate results, next-view request) and placement of ASRE GLBs via the Forge placement path.

## Reproducibility

```bash
# dependencies (repo)
bun install --frozen-lockfile
# offline toolchain (Blender 4.2.23 LTS, CPU torch venv, TripoSR @107cefd, torchmcubes @a9ac95a, weights) → /opt/lelu-tools
services/asre-reconstruct/setup.sh
# Depth model for WP1 (Apache-2.0)
HF_HOME=/opt/lelu-tools/hf-home /opt/lelu-tools/asre-venv/bin/python -c "from huggingface_hub import snapshot_download; snapshot_download('depth-anything/Depth-Anything-V2-Small-hf', revision='5426e4f0f36572d16453bbda7a8389317b1bef99', allow_patterns=['*.json','*.safetensors'])"

# tests and checks
npx tsx --tsconfig tsconfig.test.json --test tests/asre-*.test.ts
npm run typecheck
npm test

# experiments
export HF_HOME=/opt/lelu-tools/hf-home HF_HUB_OFFLINE=1 LELU_TRIPOSR_SRC=/opt/lelu-tools/TripoSR
/opt/lelu-tools/asre-venv/bin/python -I services/asre-reconstruct/triposr_worker.py '{"image":"/opt/lelu-tools/TripoSR/examples/police_woman.png","out_dir":"artifacts/asre/triposr/police_woman","upstream_check":true}'
npx tsx scripts/asre/triposr-ingest.ts artifacts/asre/triposr/police_woman
/opt/lelu-tools/asre-venv/bin/python -I services/asre-reconstruct/analyze_worker.py '{"image":"/opt/lelu-tools/TripoSR/examples/police_woman.png","triposr_dir":"artifacts/asre/triposr/police_woman","out_dir":"artifacts/asre/wp1/police_woman"}'
npx tsx scripts/asre/wp1-hypotheses.ts artifacts/asre/triposr/police_woman artifacts/asre/wp1/police_woman
npx tsx scripts/asre/wp5-variations.ts
npx tsx scripts/asre/wp6-benchmark.ts --trials 5 --res 0.008   # resumable; delete artifacts/asre/wp6/raw-res0.008.jsonl to start over
```

Environment: Linux x86-64, Node 22, Python 3.13, ~6 GB free disk for the toolchain, no GPU needed. Licences: TripoSR code + weights MIT; Depth-Anything-V2-Small Apache-2.0; DINO ViT-B/16 config Apache-2.0; Blender GPL (separate program); no paid API, account or key anywhere.
