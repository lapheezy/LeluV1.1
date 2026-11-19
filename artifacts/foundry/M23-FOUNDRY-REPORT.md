# M23 — LÉLU Photorealistic Character Foundry: what was built, where it lives, what it proves

Branch: `experiment/lelu-2-golden-geometry` (worktree `lelu2/`). Baseline character
build: 2.3.1 (`artifacts/lelu2/m231/report-2.3.1.md`).

> This report separates **implemented**, **tested**, **verified**, **partial**,
> **blocked** and **not implemented**. A render exists only where Cycles wrote a
> PNG on this machine; a comparison is reported only where the masks were usable;
> a feature the build never measured is written as `not-measured`, not as a pass.

## 1. The result in one paragraph

The Foundry is now a working local subsystem: it audits the machine and the
licences, keeps the 39 photographs as hashed read-only references, stores the
character in immutable hash-verified versions, plans and runs Cycles CPU renders
from measured landmarks, compares each render to its reference with four
different metrics, and exposes all of it to LÉLU's chat through five tools on the
existing ToolRegistry/ToolDispatcher path. **13 of 13 benchmark shots rendered,
0 failed**, every image written by Blender 4.2.23 on this CPU-only machine, and
18/18 Foundry tests pass. The *character* is still not photorealistic; §6 lists
exactly what the renders show, including the 35 mm bald forehead that the
measurements had already predicted.

## 2. Architecture

```
lelu2/src/core/asre/foundry/
  capabilities.ts   hardware probe + execution planner (gpu | cpu | reduced | deferred | refuse)
  technologies.ts   15-candidate decision matrix + licence audit + engine choice
  references.ts     the 39-photograph library: hashes, kinds, authorship, scale, duplicates
  project.ts        immutable versions, restore-as-new-version, render/export history, hash verify
  shots.ts          the 13 benchmark shots, framed from measured landmarks
  compare.ts        silhouette IoU, landmark deltas, hair agreement, colour distance, verdict
  pipeline.ts       the 12-step feedback loop + the gate that refuses to validate unrendered work
  intents.ts        a sentence → one Foundry operation (+ the shots it names)
  render.ts         one Blender child process per shot, hard timeout, logs kept
  FoundryTools.ts   5 chat tools + executors (images emitted as creative_artifact events)
lelu2/plugins/foundryApi.ts          /api/foundry (status, technologies, references, shots,
                                     projects/versions/restore/verify, render, compare, chat, assets)
lelu2/scripts/blender/lelu_foundry_render.py   production scene: SSS skin, metal, studio rig, 13 shots
lelu2/scripts/foundry/run.ts         the CLI every artifact in this report was produced by
lelu2/tests/foundry.test.ts          18 contract tests
```

Nothing existing was replaced. The Foundry reuses PCI-FR geometry, ASRE's Forge
gate for FBX/OBJ/BLEND exports, `SpatialSummon` for the 3D workspace, the
`AgentEventBus` for chat-visible images, `ToolRegistry`/`ToolDispatcher` for tool
dispatch, and the same Vite/Express middleware mount pattern as `/api/asre`.

## 3. Chat Universe integration

| requirement | how | state |
| --- | --- | --- |
| say "render her profile" | `foundry.ask` → `interpretFoundryIntent` → `POST /api/foundry/chat` | implemented, tested (intent table), verified by API smoke test |
| say "improve the face", "change the hairstyle", "add jewelry", "compare versions", "explain the failure" | same resolver; operations `improve-face / hair / jewelry / compare / explain` | implemented; operations that need new geometry return the honest "no executor for that correction yet" instead of a fake version |
| show the actual image | every rendered PNG is emitted as a `creative_artifact` on the existing event bus, which is exactly what `GenesisChat` renders as a chat image | implemented; not yet seen in a live conversation (see §7) |
| multiple views, reference comparison | `foundry.render` accepts shot ids; `foundry.compare` returns per-feature deltas | implemented, tested |
| render status, errors, logs | `ShotRender` carries `ok`, `seconds`, `error`, and the Blender log is written beside the failed image | implemented |
| interactive 3D | `foundry.render` summons the existing spatial workspace with the version's GLB URL (`/api/foundry/projects/<id>/versions/<v>/glb`), i.e. the r3f/drei viewer LÉLU already has | implemented; viewer not re-tested this pass |
| persistent project state | `artifacts/foundry/store/projects/lelu/…`: immutable versions with SHA-256, renders, validation, exports, restore, verify | **tested**: immutability, restore byte-equality, tamper detection |
| existing agents / permissions | tools are risk-level 0–1, WRITE tools go through the same AutonomyGate and approval path as ASRE; no new agent was created | implemented by construction |

API smoke commands (run against the dev server):

```
curl -s localhost:5173/api/foundry/status | head -c 400
curl -s -X POST localhost:5173/api/foundry/chat -H 'Content-Type: application/json' \
     -d '{"message":"render her eyes","project":"lelu"}'
```

## 4. Visual benchmark — 13 individual renders

Produced by `npx tsx scripts/foundry/run.ts benchmark --samples 32`.
Machine metadata in `artifacts/foundry/benchmark/report.json`; every PNG has a
sidecar `.json` with its camera, samples, triangles, shaders applied and time.

| # | shot | file | seconds | vs reference (verdict / normalised IoU) | reference |
| --- | --- | --- | --- | --- | --- |
| 1 | Face close-up | `benchmark/face-close-up.png` | 37.56 | unknown / 0.773 (framing differs) | facial-expression-01 |
| 2 | Eyes and eyelids | `benchmark/eyes.png` | 21.95 | **close** / 0.833 | facial-expression-02 |
| 3 | Nose and lips | `benchmark/nose-lips.png` | 22.33 | unknown / 0.816 (framing differs) | facial-expression-01 |
| 4 | Hairline and baby hairs | `benchmark/hairline.png` | 30.71 | unknown / 0.748 (framing differs) | facial-expression-02 |
| 5 | Individual curl | `benchmark/curl-detail.png` | 22.72 | unknown / not measurable | lelu-hair-07 |
| 6 | Full hairstyle | `benchmark/hair-full.png` | 19.21 | unknown / 0.420 | lelu-hair-07 |
| 7 | Jewelry close-up | `benchmark/jewelry.png` | 19.63 | unknown / 0.661 | lelu-hair-04 |
| 8 | Front portrait | `benchmark/portrait-front.png` | 16.52 | unknown / 0.403 (framing differs) | facial-expression-01 |
| 9 | Three-quarter portrait | `benchmark/portrait-three-quarter.png` | 15.34 | unknown / 0.463 (framing differs) | facial-expression-03 |
| 10 | Side profile | `benchmark/profile.png` | 12.84 | **differs** / 0.528 | anatomy-01 |
| 11 | Rear | `benchmark/rear.png` | 15.21 | unknown / 0.402 (framing differs) | lelu-hair-07 |
| 12 | Upper body | `benchmark/upper-body.png` | 18.49 | unknown / 0.827 (framing differs) | anatomy-05 |
| 13 | Full body | `benchmark/full-body.png` | 15.86 | **differs** / 0.683 | anatomy-07 |

"How can a comparison be `unknown` with a high IoU?" Because the render and the
reference do not share a framing: the comparison module detects the aspect
mismatch and **withholds the verdict** rather than comparing a close-up to a
full-length portrait. That is a deliberate refusal, not a missing feature.
`eyes` (0.833) and `profile`/`full-body` are the three pairs whose framing is
close enough for the number to mean something.

## 5. Measured validation of the character

From `compareLandmarks(metrics-youth.json)` — the same numbers the report on
2.3.1 cites, now checked against the sheet's targets in code:

| feature | measured | reference | tolerance | status |
| --- | --- | --- | --- | --- |
| jaw width | 98.65 mm | 96.0 mm | ±4 mm | within |
| jaw / cheek | 0.671 | 0.676 | ±0.04 | within |
| chin / jaw | 0.465 | 0.45 | ±0.04 | within |
| interpupillary | 61.75 mm | 63.0 mm | ±3 mm | within |
| mouth width | not measured by this build | 50.4 mm | — | **not-measured** |
| nose width | not measured by this build | 37.8 mm | — | **not-measured** |
| hairline above eye line | **52.38 mm** | **87.68 mm** | ±8 mm | **outside by −35.3 mm** |

Hair, against the sheet's own specification:

| feature | measured | spec | status |
| --- | --- | --- | --- |
| front strands | 149 | 96 | within |
| hairline coverage | 100 % | 100 % | within |
| root thickness | 0.16–0.45 mm | 0.08–0.12 mm | **outside (2–4×)** |
| strand length | 5.8–33.9 mm | 5.8–33.9 mm | within |

The hairline row is the important one: the Foundry's own comparison, not a
narrative, says her hair starts 35 mm lower than the photographs. That is the
bald forehead visible in `face-close-up.png` and `hairline.png`.

## 6. What the renders actually show (honest reading)

1. **Bald forehead / 35 mm hairline gap** — the defect 2.3.1 predicted, now
   photographed at 1024². The pink/black curls form a fringe *below* the measured
   hairline, and the scalp above it is bare skin.
2. **Hair reads as plastic tubes**, not strands: 0.16–0.45 mm roots against the
   sheet's 0.08–0.12 mm, at 149 visible strands. The tube geometry, not the
   shader, is the cause.
3. **Eyes are the weakest area**: the sclera is a bright white surface, the iris
   is small and dark, and the lid aperture is narrow, so the eye reads as a doll's
   eye. The `eyes` shot has the best silhouette agreement (0.833) and still does
   not look like her.
4. **Brows and lips are painted blobs with polygon edges** rather than the tapered
   arches and two-lip construction 2.3.1 described; at 1024² the paint's
   resolution is the visible limit.
5. **The headpiece is geometry, but it is a thin wire buried inside the hair** and
   is not gold: the jewelry shot frames it correctly and it is nearly invisible.
6. **Garments exist and are fitted** (corset with the reference's motif), but the
   pattern is painted vertex colour and the seams read as noise.
7. **Skin has SSS and reads soft**, but there is no pore-level detail; the
   procedural bump at 900 cycles/mm is invisible at this scale.
8. **The cap sleeves / shoulder accessories** appear as detached pink loops in
   `upper-body.png`; that is geometry that should be attached.

None of these are hidden by the pipeline: they are exactly what the individual
renders show, and the numbers in §5 point at the same features.

## 7. Acceptance criteria (mission Part X)

| criterion | state | evidence |
| --- | --- | --- |
| Locally executable production renderer | **verified** | 13/13 Cycles CPU renders, Blender 4.2.23, 12.8–37.6 s each |
| Verified dependency and asset licensing | **verified** | `licenses.json`, 15 candidates, 0 policy violations, HumanNOVA `license: null` |
| Actual reference-driven reconstruction | **partial** | geometry is PCI-FR 2.3.1 measured against the 39 photographs; no new reconstruction was run this pass |
| Correct facial geometry | **partial** | 4/7 landmark targets within tolerance; mouth/nose unmeasured; hairline 35 mm out |
| Realistic skin materials | **partial** | SSS + roughness + procedural bump in Cycles; no pore detail, reads mannequin |
| Individually constructed hair strands | **verified present, partial quality** | 149 front + 1 243 main strands as real tube geometry; thickness 2–4× spec |
| Actual jewelry geometry | **partial** | procedural headpiece/body pieces exist; the headpiece is a buried wire, not a gold chain |
| Correct garment construction | **partial** | fitted corset/slots from her identity; painted pattern, no stitching |
| Multiple validated views | **verified** | 13 images, per-shot camera and parameters |
| Functional Chat integration | **implemented + tested; live chat unverified** | 5 tools, routes, intents tested; a real conversation was not driven this pass |
| Interactive 3D preview | **reused, not re-tested** | `summonSpatial` + `/versions/<v>/glb`; the existing viewer was not opened |
| Persistent project state | **verified** | immutable versions, restore, hash verify, tamper detection in tests |
| Reproducible rendering | **verified** | `scripts/foundry/run.ts` writes every artifact; same job JSON → same camera |
| No application crashes | **verified for renders** | one child process per shot, hard timeout, failures logged |
| Passing regression tests | **verified for this subsystem** | 18/18 `tests/foundry.test.ts`; `tsc -b` exit 0 |
| Actual visual evidence | **verified** | `artifacts/foundry/benchmark/*.png` + sidecars |

## 8. Reproduce

```
export LD_LIBRARY_PATH=$HOME/libs/usr/lib/x86_64-linux-gnu
export LELU_TOOLS=$HOME/lelu-tools

npx tsx scripts/foundry/run.ts status         # hardware.json
npx tsx scripts/foundry/run.ts technologies   # licenses.json
npx tsx scripts/foundry/run.ts references     # references.json, 39/39 hashes
npx tsx scripts/foundry/run.ts plan           # shots.json
npx tsx scripts/foundry/run.ts benchmark --samples 32   # 13 renders + report.json
npx tsx scripts/foundry/run.ts render --shots eyes,profile --samples 24
npx tsx scripts/foundry/run.ts verify         # re-hash every stored model

npx tsc -b --force
npx tsx --tsconfig tsconfig.test.json --import ./tests/support/ignore-css.mjs \
  --test --test-reporter=spec tests/foundry.test.ts
```

In the app the same work is reachable as `foundry.status`, `foundry.ask`,
`foundry.render`, `foundry.compare`, `foundry.project` and through
`/api/foundry/*`.

## 9. What was not done, and why

* **No GPU engine was installed.** None is legal-and-runnable here: HumanNOVA has
  no licence, IDOL/PSHuman need SMPL-X and 24–40 GB VRAM, SAM 3D Body is gated and
  CUDA-only, SuGaR is research-only. `M23-RESEARCH.md` records each.
* **No photogrammetry.** COLMAP is BSD and CPU-capable, but 39 photographs of a
  character in different looks are not a multi-view capture set; a reconstruction
  from them would be a fabricated claim.
* **No new face/hair geometry pass.** The Foundry renders and compares what
  2.3.1 built. The hairline gap, strand thickness and eye shape are measured and
  photographed, not yet fixed — fixing them is the next engineering pass, and the
  comparison module is what will show whether a fix worked.
* **No new exporter.** GLB is exported by the Foundry; OBJ/FBX/BLEND stay behind
  the Forge's existing Blender export gate rather than a second implementation.
* **Live chat was not driven end-to-end.** The tools, their executors, the intent
  resolver, the routes and the image event are tested and typechecked; a real
  message through GenesisChat was not watched this pass. That is stated here as
  unverified rather than claimed.
* **The interactive 3D viewer was not re-opened.** The Foundry hands it a GLB URL
  through the existing summon path; the viewer's own acceptance belongs to the
  ASRE/Forge suites.

## 10. Files and commits

* Source: `src/core/asre/foundry/*`, `plugins/foundryApi.ts`,
  `scripts/blender/lelu_foundry_render.py`, `scripts/foundry/run.ts`,
  `tests/foundry.test.ts`; mounts in `vite.config.ts`, `server.ts`;
  registration in `src/core/Bootstrap.ts`, `src/core/tools/ToolDispatcher.ts`;
  the hair-clump colour pass in `src/core/asre/character/build.ts`.
* Artifacts: `artifacts/foundry/{hardware,licenses,references,shots}.json`,
  `artifacts/foundry/benchmark/` (13 PNGs + sidecars + `report.json`),
  `artifacts/foundry/store/projects/lelu/` (versions v0001, v0002),
  `artifacts/foundry/M23-RESEARCH.md`, this report.
* Commits: see `git log --oneline` on `experiment/lelu-2-golden-geometry`; the
  branch was not force-pushed, and `claude/mission5-lelu-asre-integration-mm6xau`
  remains at `55c89aae`.
