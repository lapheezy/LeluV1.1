# M25 — LÉLU visual fidelity reconstruction

**Baseline:** `experiment/lelu-2-golden-geometry` @ `d4667d78` (M24, v0004).
**Branch:** `experiment/m25-visual-fidelity-reconstruction`.
**New version:** Foundry **v0005**, `assets/lelu-m25-visual-fidelity.glb`
(sha256 `1170e1ff52414be0786e2f280d1717023be26907b135b4e8ec83cfed4207e0ee`, 53,137,492 bytes,
604,591 triangles), parent v0004. v0003, v0004, PCI-FR and every photograph are
byte-identical to their records (`verification/checksums.json`).

All numbers are measured on this machine (4 vCPU, no GPU, Blender 4.5.9 LTS Cycles
CPU). The final judgement belongs to the renders in `acceptance/`; where a metric and
the pictures disagree, the pictures win and this report says so.

## What actually changed, and what did not

| | v0004 | v0005 |
| --- | --- | --- |
| skin ΔE2000 to the photographs (neutral studio, front face) | 10.23 | **3.38** |
| (the M24 render of the same v0004 file) | 32.16 | — |
| flat-shaded triangles, char1 / lelu_hair / lelu_scalp | 28.7 % / 22.6 % / 20.1 % | 4.3 % / 0.6 % / 10.9 % |
| shared positions with > 30° shading crease, lelu_hair | 80.5 % | 37.1 % |
| welded median dihedral, lelu_hair | 31.9° | 25.1° |
| shoulder triangles bending > 45° (char1) | 61.1 % | **56.1 % — still FAIL** |
| primary hair representation | folded ribbon soup | 516 rounded helical ringlets over an opaque foundation |
| crown: hair share of hair + visible scalp (back-top mask) | 0.926 | 0.967 |
| eye texture | 121 × 83 / 121 × 78 | unchanged — no legitimate source |
| face geometry (eyes, mouth) | — | unchanged — landmark ratios already match |
| shape-key deltas | — | identical (max error 0.0002 mm on matched vertices) |

Nothing was welded, no UV was written, no global smoothing or global colour change
was applied. v0004 → v0005 is reproducible from `build-job.json`.

## WP01 — visual defect audit

`visual-defect-audit.json`, `visual-defect-map.json`, `visual-defect-map/*.png`,
`root-cause-report.md`. The decisive findings:

1. **The washed-out complexion was the renderer.** The same v0004 bytes measure
   L\* 80 in the M24 render and L\* 51 under a grey-card exposure (cause H/F). The
   M24 material pass matched no object (`materials_applied: []`).
2. **The metallic hair and plastic skin are the asset's own metallicRoughness maps**
   (metallic to 0.68 on hair texels, roughness to 0.09 on the head), lit too hard (C+H).
3. **The crystals on shoulders/back/chest are real folded geometry** (median per-triangle
   dihedral 51.7° on the shoulders; 31–51 % of those triangles carry hair albedo: Meshy
   fused the over-shoulder hair into the body), drawn with per-face normals (A+B).
   No degenerate, duplicate or inverted triangle exists in v0004; winding errors are
   18/66/28 edges; there is no transparent surface to mis-sort.
4. **Hair ribbons are folded strips** (23.8 % of adjacent pairs bend > 60°) (A+B+C).
5. **Eyes are limited by texture content** and nothing better exists to recover from (D).
6. **IPD/mouth "discrepancies" were a registration error** (WP05).

Also corrected from M24's record: the "Icosphere" seen on import is Blender's glTF
bone-display shape, not in either file.

## WP02 — hair reconstruction (hybrid)

`hair/hair-reconstruction.json`, `hair/curl-validation.json`, `hair/ringlet-guides.json`.

* **Foundation** — the existing `lelu_hair` (lashes, brows and fringe inside the face
  zone pinned: 3,300 triangles) Taubin-smoothed 4 iterations, ≤ 6 mm, mean 1.19 mm;
  the char1 hair cape 12 iterations, ≤ 15 mm. Metallic 0, roughness ≥ 0.55, normal-map
  strength 0.6, normals rebuilt with an 80° limit. Opaque, near-black (asset albedo).
* **Primary curls** — `lelu_hair_ringlets`: 516 ringlets, 321,144 triangles. Each axis
  is grown down the outer hair surface (gravity + surface projection, pushed off skin);
  around it a helix whose radius opens over the first 15 mm (straighter root) and
  tightens 15 % at the tip, swept as a 6-sided smooth-shaded tube. Measured: curl
  diameter p10–p90 **9.1–12.7 mm**, pitch 10.4–15.4 mm, fall-axis kink p90 39°. 10 %
  of ringlets carry a dark burgundy highlight material. 10 centre lines were cut where
  they entered the face zone.
* **Secondary** — `lelu_hair_strands`: 434 curled flyaways (0.16–0.28 mm radius) and 48
  baby-hair spirals laid 0.4 mm off the forehead along the hairline; 59,214 triangles.
* Skinned Head → Spine02 by height; 0 unweighted vertices.

Honest limits: the ringlets are smooth tubes with no fibre texture, so in the
extreme close-up (`09-ringlet-close-up`) they read as glossy coils rather than hair
fibre; **20.7 % of ringlet centre-line points interpenetrate a neighbour** (FAIL);
**8 ringlet triangles** have a loop normal inverted against the face (FAIL, < 0.003 %).

## WP03 — triangular artefacts

`topology/topology-audit.json`, `topology/normal-validation.json`, `topology/repair-report.json`.
Normals: custom split normals rebuilt from area-weighted face normals at coincident
positions with class limits (hair 80°, skin 50°, fabric 40°, metal 30°, face zone
45°). Geometry: the localised Taubin passes above plus folded shoulder/upper-arm
triangles (6 iterations, ≤ 8 mm, any vertex touching an unfolded triangle pinned),
with every shape-key block moved by the basis displacement.

**Result:** the faceted shading is largely gone; the crumpled silhouette on the
shoulders, upper back and chest is reduced but **still visible** (`13-shoulder-chest`,
`09-ringlet-close-up`, lower half). It is real 12–17 mm geometry pinned by its UV
seams; removing it needs a retopology plus texture re-projection, which would be its
own version. Recorded as FAIL.

## WP04 — skin and face materials

`materials/skin-material-audit.json`, `materials/texture-audit.json`.
Skin colour is measured automatically on landmark-located cheek/forehead/chin patches
(brightest 20 % dropped, CIELAB D65). Photograph median L\* 44.9, a\* 34.1, b\* 32.6.

* Skin texels only (UV footprint of skin-classified triangles ∩ per-texel skin test):
  L\* × 0.88 (darker — never lighter), a\* +12, b\* +8. A first attempt with a pure chroma
  gain (× 1.89 / × 1.41) hit the numbers but amplified the painted blush into red
  blotches and was rejected on the renders.
* Skin texels: metallic → 0, roughness 0.48–0.85. Hair texels: metallic → 0, roughness
  ≥ 0.55. Metal texels (map ≥ 0.5) untouched: jewellery stays rose-gold metal.
* Freckles, star marks, forehead ornament, eyeliner, berry lips, septum jewellery are
  the asset's own texture and geometry; nothing was painted over.
* Cycles-only: random-walk-skin SSS on `m25_skin_*` at render time (glTF cannot carry it).

| v0005 skin ΔE2000 to photographs | neutral studio | soft frontal | directional key | warm environment |
| --- | --- | --- | --- | --- |
| front face | 3.41 | 2.18 | 3.63 | 5.84 (reported, not thresholded) |

**Eyes:** the patches are 121 × 83 / 121 × 78 px; the sockets beneath them are empty;
the photographs carry 40–84 px per eye. No source holds more eye detail, so the
textures were **not** enlarged (FAIL on the resolution metric, by design).

Remaining skin defects visible in `10-skin-close-up` and `12-lip-close-up`: polygon
facet lines and UV-seam lines on the cheeks, and the rectangular edge of the painted
lower-lip patch. Both are texture/geometry content of the original, not fixed here.

## WP05 — facial proportions

`anatomy/facial-landmarks.json`, `anatomy/landmark-ratios.json`. MediaPipe Face
Landmarker on five front photographs and on the renders, scale-free ratios only.
v0005 deviation from the photograph median: IPD/face width +5.6 %, mouth/IPD −4.1 %,
eye width/IPD −3.5 %, eye-to-mouth/IPD −4.5 %, eye-to-chin/IPD −4.8 %, lip height/mouth
+7.2 % — all within ±8 %. M24's 63 mm / 50.4 mm targets came from a sheet scaled by an
*assumed* 142 mm face and contradict the photographs (50.4 / 63 = 0.80 vs 0.66–0.69),
so **no deformation was applied**: moving her eyes or mouth would have moved her away
from the photographs.

## WP06 — clothing and body surface

char1 now has three material slots (`m25_body`, `m25_skin_body`, `m25_hair_body`) from
per-triangle classification — the technical foundation for wardrobe separation. The
honest limit: char1 has 39,166 triangles for body and outfit, its texture features
are smaller than its triangles, and per-triangle classes on it are coarse
(`visual-defect-map/classes-v0004-front.png`). Camo definition is limited by one
2048² map; shoulder crumple is reduced, not removed. **FAIL** for fabric definition
and shoulder transitions.

## WP07 — material and lighting calibration

`scripts/blender/lelu_m25_render.py`: every shot is exposed against an 18 % grey card
rendered at the subject with the same camera and lights, AgX with no look. Four
presets: neutral studio (acceptance), soft frontal, directional key (sun), warm
environment. `acceptance/lighting/` holds the front face for both versions and a
v0005 bust under all four; she stays recognisable under each, and the skin ΔE stays
≤ 3.7 under the three non-warm conditions. Material profiles: m25_skin_head/body,
m25_hair_foundation/body, m25_hair_curl, m25_hair_highlight, m25_hair_strand,
m25_head_detail (metal, flowers), m25_body (fabric); eyes, mouth, teeth unchanged.

## WP08 — rig and facial performance

`rig/rig-regression.json`, `rig/renders/`. 24 bones identical; 0 unweighted vertices on
every mesh including the new hair; max 4 influences; 24 vertex groups on char1;
shape-key names identical; every shape-key delta identical to v0004 (max error
0.0002 mm, vertices matched by UV then position because the glTF export splits
vertices by normal). Rendered: neutral, blink, jawOpen + smile, eyeWide + browInnerUp,
frown + browDown.

**Locomotion was actually played this time:** `motion.glb` carries its clip on bare
joint nodes, so its 66 animation channels are merged into the character GLB by joint
name and re-imported; the `walk` clip (frames 0.8–24) moves 22 bones at frames 1, 12
and 24 (`rig/renders/walk-f*.png`), with the hair layers following the head. Only this
one clip was played; the other 30 were not.

## WP09 — photographic acceptance

`acceptance/v0004/` and `acceptance/v0005/`: the fifteen required views as separate
1024 px images (full body 1024 × 1536), identical camera, lights and samples per view,
**64 samples**, adaptive threshold 0.01, OIDN denoise, no post-processing.
`acceptance/compare/*.jpg` are side-by-side conveniences only;
`acceptance/compare/photo-vs-v0005-front-face.jpg` puts a photograph beside the render.
Render times (v0005): 60–140 s per view on 4 CPU threads. Render noise between two
seeds: RMS 1.46 / 255.

Reviewed verdicts (visual judgement on the pairs — not a metric):

| view | verdict |
| --- | --- |
| 01 front face | improved: deep brown complexion, black curls, face uncovered; resemblance closer, not identical (photographs are more saturated and softer-lit) |
| 02 three-quarter | improved |
| 03/04 profiles | improved hair; profile shape unchanged (none was required) |
| 05/06 full body | hair volume and colour improved; outfit unchanged |
| 07 hairline | centre part and baby hairs read; fringe curls unchanged |
| 08 crown | sleek centre-parted foundation with ringlets at the sides, like the photographs |
| 09 ringlet close-up | **rounded continuous spirals replace the folded metallic strips**; smooth tubes, no fibre detail |
| 10 skin close-up | colour correct; **facet and seam lines remain — FAIL** |
| 11 eye close-up | unchanged detail (texture limit) |
| 12 lip close-up | berry gloss kept; **lip-patch edge remains — FAIL** |
| 13 shoulder/chest | **crumple reduced, still visible — FAIL** |
| 14 clothing | metallic sheen on fabric reduced; camo texel density unchanged — FAIL for definition |
| 15 jewellery | metal preserved |

## WP10 — automated validation

`verification/validation.json` (scripts/foundry/m25_validate.py). Technical and
perceptual metrics are scored separately:

* **Technical: 23 PASS, 4 FAIL, 1 NOT MEASURABLE.** FAIL: 8 inverted ringlet loop
  normals; shoulder/back/chest crumple residual (56 % / 52 % / 41 % > 45°); ringlet
  interpenetration 20.7 %; eye texture resolution. NOT MEASURABLE: UV stretch (UVs not
  written by M25; not re-measured).
* **Perceptual: 3 PASS, 0 FAIL, 2 NOT MEASURABLE.** PASS: skin ΔE 3.38; skin ΔE ≤ 10
  under three lighting conditions; landmark ratios within ±8 %. NOT MEASURABLE:
  per-view pixel change (reported, a change is not an improvement); overall
  photographic resemblance (decided on the renders, above — not by a number).

Passing these does not make her LÉLU: three reviewed views are still FAIL.

## Acceptance criteria

| criterion | state |
| --- | --- |
| root cause of crystalline artefacts identified | **done** — real folded geometry + per-face normals + over-bright renderer |
| hair ribbons no longer metallic folded strips | **done** for the visible primary layer; foundation still folded underneath |
| rounded natural ringlets | **done** (9–13 mm diameter); fibre detail missing |
| dense opaque hair foundation | **done** |
| hair coloration restored | **done** — near-black with burgundy highlights |
| original complexion preserved | **done** — ΔE 3.4, darkened, never lightened |
| facial proportions verified against landmarks | **done** — within ±8 %, no change needed |
| eye texture limitations addressed | **documented, not improved** — no legitimate source |
| skin materials calibrated | **done**; facet/seam lines in close-up remain |
| clothing and shoulder artefacts addressed | **partial — FAIL** |
| surface normals verified | **done** (8 ringlet triangles inverted — FAIL recorded) |
| shape keys preserved and retested | **done** |
| rig preserved | **done**; walk clip played |
| fifteen individual acceptance views | **done**, both versions |
| high-quality renders | **done**, 64 spp |
| before/after comparisons | **done** |
| automated validation executed | **done** |
| original assets untouched | **done** — checksums and git diff |
| new version registered | **done** — Foundry v0005 |
| remaining failures documented | **this table, WP09 and validation.json** |

## Reproduce

```
B=~/lelu-tools/blender-4.5.9-linux-x64/blender          # blender-4.5.9-linux-x64.tar.xz from download.blender.org
$B/../4.5/python/bin/python3.11 -m pip install pillow     # UV-mask rasteriser inside Blender
pip install mediapipe scipy pillow                       # landmarks/colour (Apache-2.0, local CPU)
curl -o ~/lelu-tools/models/face_landmarker.task \
  https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task
# (mediapipe needs libegl1 + libgles2 on headless Linux)

echo '{"input":"artifacts/foundry/m24/assets/lelu-m24-hair-split.glb","out":"artifacts/foundry/m25/topology/audit-v0004.json","label":"v0004"}' > /tmp/a.json
$B -b --factory-startup --python scripts/blender/lelu_m25_audit.py -- /tmp/a.json
$B -b --factory-startup --python scripts/blender/lelu_m25_build.py -- artifacts/foundry/m25/build-job.json
python3 scripts/foundry/m25_acceptance.py views --samples 64
python3 scripts/foundry/m25_acceptance.py lighting --samples 64
python3 scripts/foundry/m25_acceptance.py noise --samples 64
python3 scripts/foundry/m25_acceptance.py rig --samples 48
python3 scripts/foundry/m25_validate.py
python3 scripts/foundry/m25_reports.py
npx tsx scripts/foundry/run.ts m25-ingest
npx tsc -b --force
npx tsx --tsconfig tsconfig.test.json --import ./tests/support/ignore-css.mjs --test tests/foundry.test.ts tests/foundry-m25.test.ts
```

The visual-defect class maps: `lelu_m25_classmap.py` with the job documented in its
header (`crumpled: true` for the fold map).

## Tests at the final commit

`npx tsc -b --force`: 0 errors. Foundry tests: see the commit message / `verification/test-output.txt`.
One failure is pre-existing on the untouched M24 commit and unrelated to M25:
*"the three sources are ordered per component"* asserts the repository sits inside a
`lelu2/` workspace directory (`locateSources({workspace: ROOT/..})`), which this
checkout does not.
