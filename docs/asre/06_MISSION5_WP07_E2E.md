# Mission 5 — WP07: end-to-end creation

Date: 2026-11-18. Branch `claude/mission5-lelu-asre-integration-mm6xau`, from `a0c1240`.
Every number below came from the running application; nothing is estimated.

## What was run

`scripts/asre/wp7-e2e.mjs` drives the real `/api/asre` and `/api/forge` routes of
the vite dev server, and `scripts/asre/render.mjs` renders the resulting GLBs
with the offline Blender toolchain (Cycles CPU, no GPU, no display).

| Test | What it proves | Status |
| --- | --- | --- |
| A | image → analysis → hypotheses → reconstruction → NRE → mesh → validation → Forge → asset → export | VERIFIED |
| B | several observations: refinement, confidence, contradictions, preservation, OBSERVED vs INFERRED | VERIFIED |
| C | one persistent character: hair, clothing, body, material, pose, compare, restore, undo/redo, export | VERIFIED |
| D | the same pipeline with every outbound connection refused | VERIFIED |

Checks: A+B+C = **29/29** on a cold asset root; D = **3/3**, **0** blocked outbound attempts.

## Environment actually available

- Node 26, Blender 4.2.23 LTS at `~/lelu-tools` (with `LD_LIBRARY_PATH=~/libs/usr/lib/x86_64-linux-gnu`
  for the X libraries Blender links but never loads headless), Chromium for screenshots.
- **TripoSR / torch: NOT INSTALLED.** `services/asre-reconstruct/setup.sh` needs a CPU torch venv
  (~2.5 GB) plus the pinned weights; that was not downloaded in this container. `/api/asre/status`
  reports `engines.triposr: false` and `python: null`.
- Consequence: every reconstruction below is the **native TypeScript silhouette engine** (`engine:
  "silhouette"`), the offline path WP01 added. The TripoSR engine remains unexercised here and is
  reported as BLOCKED, not as working.

## Test A — image to 3D to export

Input: TripoSR's `examples/chair.png` (512×512 RGBA). Voxel resolution 64.

| Measurement | Value |
| --- | --- |
| Job | succeeded, 7 steps (decode, hypotheses, refine skipped, mesh, coverage, persist, render, forge) |
| Grid | 21,120 cells, resolution 64 |
| Mesh | 15,860 triangles, `meshValid: true` |
| Hypotheses | 4 scored, one selected, pairwise IoU recorded |
| Evidence | OBSERVED 1,405 · INFERRED 9,155 · GENERATED 10,560 |
| Coverage | ranks **back** first ("100% of the back rests only on synthesized evidence, mean confidence 0.40") |
| Forge | filed as a job in the same ledger (`forgeJobId` present, history readable) |
| Export | SUCCEEDED through the Forge gate: `editable.blend`, `runtime.glb`, `source.obj`, `source.stl`, `report.json`, `render.png` |

Evidence: `artifacts/mission5/WP07/A-image-to-3d/`
(`08-summary.json`, `01-job.json`, `02-slices.json`, `05-forge.json`, `07-export.json`,
`renders/{front,side,back,three-quarter,three-quarter-wireframe,numerical-x,numerical-y,numerical-z}.png`).

## Test B — several observations

| Step | Result |
| --- | --- |
| Same image again (B1) | refused as a **duplicate**: 0 new cells, mean confidence delta **0** |
| Side view (B2) | the reconstruction rendered from +X and submitted as `left`: **114 new**, **863 reinforced** cells, `preservedCells` > 0, `unaffectedVerified: true` |
| Contradicting view (B3) | the front image submitted as `back`: **653 conflicts** recorded, geometry kept |
| Lineage | 3 steps in order: `reconstruct → observe(left) → observe(back)` with per-step evidence and confidence |

Two API behaviours worth recording, because they are *guards*, not bugs:

1. Observing the **same view twice is refused** ("the left view is already part of this reconstruction").
2. A repeated **image** is refused by fingerprint with a zero confidence delta.

Evidence: `artifacts/mission5/WP07/B-multi-observation/` including `02-duplicate-observation.json`,
`04-side-observation.json`, `05-contradiction.json`, `06-lineage.json`, `07-summary.json`.

Honest caveat: B2's second view is **rendered from the first reconstruction**, not captured
independently. It exercises the observation path on a genuinely different projection; it does not
add new information about the real chair. A real second photograph would be needed to claim
information gain.

## Test C — one persistent character

`wp7-lelu`, cold component cache, five edits in sequence:

| Edit | Regenerated | Recoloured | Reused |
| --- | --- | --- | --- |
| hair → afro (volume 1.3) | `hair` | — | 14 components |
| clothing → jacket/pants | `clothing.top` | — | 14 |
| body → height 1.78, build 1.05 | torso, pelvis, neck, arms, hands, legs, feet, clothing.top, clothing.bottom, clothing.shoes, accessories.body | — | 4 |
| materials → hair colour | **none** | the hair material | 13 |
| pose → wave | arms, hands, legs, feet, clothing.top, clothing.bottom, clothing.shoes | — | 8 |

Also verified: `impact` names the affected components without building anything; `compare(v0001, head)`
returns a geometry diff (IoU < 1); `verify` reports the history is immutable; `restore --groups hair`
mints a **new** version instead of rewriting; `undo` moves the head back and `redo` restores it;
`export` files the character into the Forge as a job. 7 versions total.

Evidence: `artifacts/mission5/WP07/C-character/` — `02-edits.json`, `03-timeline.json`,
`04-verify.json`, `05-compare-v1-head.json`, `11-summary.json`, and renders for every edit plus
front/side/back/three-quarter/wireframe of the final head.

## Test D — offline

A second vite server on :5174 with its own cold asset root, driven by a child harness preloaded with
`scripts/asre/offline-guard.mjs`, which refuses and counts every non-loopback TCP connect, DNS lookup
and `fetch`.

| Result | Value |
| --- | --- |
| Harness exit | 0 |
| Blocked outbound attempts | **0** |
| Reconstruction offline | yes (same artefact set) |
| Character built offline | yes (cold cache, real regeneration) |

Evidence: `artifacts/mission5/WP07/D-offline/` (`guard-summary.json`, `summary.json`, `run.log`,
`run/…`).

## Limitations, stated rather than hidden

- **TripoSR engine unexercised** (no torch toolchain in this container). BLOCKED, not VERIFIED.
- **In-app walkthrough not re-driven.** The WP03 Playwright flow (`scripts/asre/m5-ui-flow.cjs`)
  reached the Spatial Studio through a "Studio" button that the current home shell no longer exposes;
  clicks were intercepted and the command palette did not navigate. This run therefore proves the
  pipeline at the API and asset level plus real Blender renders. The workspaces' own UI evidence
  remains the WP03 screenshots committed at `a0c1240` (`docs/asre/m5/screenshots/`). `scripts/asre/wp7-ui.cjs`
  is committed ready for a session where the shell navigation is fixed — it is NOT evidence.
- Renders are 512×512, 16 samples, CPU. They prove geometry and bounds, not photoreal quality.
- CPython 3.12 and Node 26 here; the toolchain notes in the handoff assume Node 22.
