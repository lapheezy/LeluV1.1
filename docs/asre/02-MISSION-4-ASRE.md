# Mission 4 — Adaptive Spatial Reconstruction Engine (ASRE)

All numbers below were measured in this session on 4 vCPU / 15 GB RAM, no GPU (Node 22, torch 2.15 CPU, Blender 4.2.23 LTS). Artifacts are under `artifacts/asre/`; GLBs and bulk arrays are reproducible and kept out of git.

## Status by work package

| WP | Status | Evidence |
| --- | --- | --- |
| WP1 One image → many analyses → competing hypotheses | **VERIFIED** | `services/asre-reconstruct/analyze_worker.py`, `scripts/asre/wp1-hypotheses.ts`, `artifacts/asre/wp1/police_woman/` |
| WP2 Flipbook reconstruction | **VERIFIED** (on simulated depth views with known truth) | `src/core/asre/temporal/Flipbook.ts`, `tests/asre-flipbook.test.ts` |
| WP3 Component-based reconstruction | **VERIFIED** (procedural components) | `src/core/asre/character/*`, `tests/asre-character.test.ts` |
| WP4 Parallel and adaptive computation | **VERIFIED** | `src/core/asre/scheduler/Scheduler.ts`, `scripts/asre/pool.ts`, `tests/asre-scheduler.test.ts` |
| WP5 Persistent character identity + variations | **VERIFIED** | `scripts/asre/wp5-variations.ts`, `artifacts/asre/character/variations/` |
| WP6 Controlled performance experiment | **VERIFIED** — hypothesis supported, with caveats | `scripts/asre/wp6-benchmark.ts`, `artifacts/asre/wp6/` |
| LÉLU integration | **PARTIAL** (server API + tools wired and tested; no UI surface yet) | `plugins/asreApi.ts`, `src/core/asre/AsreTools.ts`, `tests/asre-integration.test.ts` |

## WP1 — one image, many analyses, competing hypotheses

Input: TripoSR example `police_woman.png`. One image starts a dependency graph of analyses on a thread pool: load+crop → RGB palette (k-means), foreground segmentation → silhouette → landmarks (silhouette width profile: head top, neck, shoulders) → components (head / neck / torso bands) → spatial measurements; Depth-Anything-V2-Small (Apache-2.0) → surface normals/curvature. **4.34 s wall for 7.11 s of operations (1.64× overlap).**

Three hypotheses on the same lattice and camera as TripoSR:

| Hypothesis | Provenance | Cells | Silhouette IoU | Depth rank-corr. | Compute | Quality |
| --- | --- | --- | --- | --- | --- | --- |
| TripoSR | SYNTHESIZED | 706,026 | 0.879 | **0.861** (independent model) | 8.24 s | **0.815 — selected** |
| Ellipse hull (silhouette × cross-section prior) | INFERRED | 1,030,802 | 0.934 | 0.657 | 0.35 s | 0.758 |
| Depth lift (depth front, mirrored back) | INFERRED | 1,298,569 | 0.944 | 0.996 — **circular, excluded** | 0.10 s | 0.515 |

Quality = 0.45·silhouette + 0.40·independent depth agreement + 0.15·prior. Depth-lift is built from the depth map it would be scored against, so that check is excluded (recorded in `hypotheses.json`). The ellipse hull gives ~22× more quality per second, which the scheduler can use when time is short. The consensus grid keeps 16,632 OBSERVED (front-visible, inside the silhouette), 1,476,666 INFERRED and 706,026 SYNTHESIZED cells distinguishable.

`assessCoverage` turns this into a request: for a single front view the back is 100% synthesized-only and is ranked first as the next observation (`asre.job` reports it).

## WP2 — flipbook

Each page: new cells, conflicts (free-space evidence through occupied cells), affected 8³ blocks; refine only there; cells outside are verified identical to the previous page; Bayesian carving `P = c(1−q)/(c(1−q)+(1−c)q)`; duplicate fingerprints produce no snapshot and no confidence change; every page is a replayable snapshot.

Measured on a prior hull and six simulated depth views of a known shape: IoU rises monotonically to 1.0; a close-up page preserves > 80% of cells untouched (verified); weak free-space evidence against a confident cell is recorded, not carved. Limitation kept explicit: a sealed internal cavity is never observed, so it stays as INFERRED prior cells (test asserts it is never marked OBSERVED).

## WP3 — components

15 components (torso, pelvis, neck, head, face, hair, arms, hands, legs, feet, top, bottom, shoes, head accessories, body accessories) on one shared lattice. Content key = hash(the parameter slice the component reads + dependency keys); geometry key excludes materials. Head, face, hair and head accessories are built in a head-local frame and placed by a lattice-snapped anchor.

| Change | Regenerated | Not regenerated |
| --- | --- | --- |
| Hairstyle | hair | all 14 others (cells verified identical) |
| Sleeves | clothing.top | everything else, including the face |
| Body proportions (height) | torso, pelvis, neck, arms, hands, legs, feet, top, bottom, shoes | head, face, hair — **moved, reused** |
| Pose (tank top + skirt) | arms, hands, legs, feet, shoes | top and skirt (no limb dependency) |
| Skin colour | nothing (recoloured cached meshes) | — |

The component union equals the whole-object build exactly (IoU 1.0), including with accessories and a T-pose. Two defects found while testing and fixed: 1-cell garment shells aliased at 6 mm (now solid offsets); the skirt hem used the posed knee, coupling it to pose (now rest proportions).

## WP4 — scheduler and parallelism

`Scheduler` runs a DAG on N slots, choosing among ready tasks by expected information gain ÷ predicted cost, with a memory budget, anytime deadline, time-to-first-usable and gain curve; `CostModel` learns cost per unit size (EWMA) from measured runs. On a deterministic clock, gain/cost reaches the usable state at 13 ms vs 103 ms FIFO for the same total work. `ComponentPool` runs component builds on worker threads (transferring buffers): base character 1.22 s on 4 workers (cold) vs 1.94 s sequential.

Honest note: procedural components are pure functions of the spec, so dependencies are resolved at invalidation time and do not block execution; in observation-driven reconstruction they would.

## WP5 — persistent identity, variations

67 variations rendered with Blender Cycles from real geometry: **40 hairstyles** (21 styles × 2 length/volume variants, 7 colours), 8 outfits, 4 body variants, 5 poses, 5 accessory sets, 4 material sets — `sheet_hair.png`, `sheet_variations.png`, `manifest.json`. Through one cache they needed **190 component builds instead of 1,005**, and the head+face geometry hash is identical in all 67. Caveat: back-mounted styles (bun, ponytail) are hard to see in three-quarter front renders; their geometry is distinct (tested), the renders undersell it.

## LÉLU integration

- `plugins/asreApi.ts` mounted in both the Vite server and `server.ts`: status, reconstruct job (TripoSR → analyses/hypotheses → NRE/GLB/renders → coverage), job inspection with intermediate results and the next-view request, character variations with reuse, asset serving; cross-origin and path-traversal refusals (tested over real HTTP).
- `asre.status / asre.reconstruct / asre.job / asre.character` registered in the shared `ToolRegistry` and dispatcher next to the 3D Forge. Zero spend.
- Not yet done: a UI surface in Genesis/Cosmos for ASRE jobs, placing ASRE GLBs through the Forge placement path, and linking the persona look (`identity.leluLook`) to `LeluCharacterStore`.

## WP6 — controlled performance experiment

**Setup.** Same input for all strategies: the base character, then 10 edits (hair → bob, long sleeves, hair colour, glasses, wave pose, taller body, ponytail, skirt, hat + glasses, relaxed pose) = 11 states. Same 8 mm lattice, same machine (Intel Xeon @ 2.10 GHz, 4 vCPU, Node 22). Strategies interleaved across 5 trials; each trial is a **fresh process** (cold: JIT cold, caches empty, workers spawned), followed by a **warm** pass in the same process with caches cleared. Quality is measured outside the timed region against the whole-object build of the same final state. Raw data: `artifacts/asre/wp6/raw-res0.008.jsonl`, summary `benchmark.json`.

Whole-object is the **competent** baseline: one implicit function for the character with per-component bounding-box culling (the first version without culling was ~4× slower and would have flattered the alternatives).

Medians [IQR], cold start, n = 5:

| Strategy | Session wall | CPU | Peak RSS | First usable | Edit latency (n = 50) | Regenerated / recoloured / reused (10 edits) | Samples | Final IoU vs whole | Triangles |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 Whole-object | 21.85 s [20.97–21.88] | 22.37 s | 300 MB | 1.40 s | 2,061 ms [1,451–2,425] | 150 / 0 / 0 | 19.3 M | 1 | 114,188 |
| 2 Component (no reuse) | 18.85 s [18.31–19.48] | 19.19 s | 326 MB | 1.26 s | 1,666 ms [1,266–2,028] | 150 / 0 / 0 | 30.3 M | 1 | 204,536 |
| 3 Incremental | **7.35 s** [6.81–7.81] | **7.70 s** | 294 MB | 1.19 s | **210 ms** [27–641] | **30 / 2 / 118** | **10.6 M** | **1** | 204,536 |
| 4 Adaptive parallel (4 workers) | **4.85 s** [4.67–5.04] | 10.36 s | 506 MB | **0.93 s** [0.85–1.07] | 241 ms [47–495] | 30 / 2 / 118 | 10.6 M | 1 | 204,536 |

Warm pass (JIT warm, caches cleared): whole 21.99 s, component 18.21 s, incremental 6.83 s, adaptive 4.86 s; first usable 1.29 s / 1.02 s / 1.00 s / **0.60 s**.

**Verdict on the hypothesis** ("incremental reconstruction reduces work and processing time without sacrificing quality"): **supported** for this workload.
- Work: 45% fewer SDF samples than whole-object, 65% fewer than non-incremental components; 30 of 150 component builds over the 10 edits.
- Time: 3.0× less session wall time and 2.9× less CPU than whole-object; median edit latency ~10× lower.
- Quality: final occupancy identical to the whole-object build (IoU 1.0 in every trial).

**Caveats, measured, not hidden.**
- Component outputs carry **79% more triangles** than the single whole-object mesh: surfaces hidden under clothing and hair are kept (each component is a closed mesh). Same occupancy, heavier asset; a merge/cull pass at export would remove it.
- Splitting into components without reuse saves little (18.9 s vs 21.9 s) and evaluates *more* samples (overlapping boxes); the gain comes from reuse.
- Parallelism helps the **initial build** (first usable 0.93 s cold / 0.60 s warm vs 1.19 / 1.00 s) and total wall time, but **not single edits**: most edits invalidate 1–2 components, and the worker round trip costs more than it saves (241 vs 210 ms median). It also costs 35% more CPU and ~1.7× peak memory (worker isolates). The scheduler should run small edits inline and use workers only when several components are invalid; this is not implemented yet.
- Edit-latency spread is wide by design: a hair or material edit costs ~20–50 ms, a body-proportion edit rebuilds 10 components (~640 ms+).
- Single machine, procedural components; reconstruction from observations will have different cost profiles.
