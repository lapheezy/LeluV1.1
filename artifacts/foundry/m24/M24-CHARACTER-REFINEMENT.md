# M24 — LÉLU character refinement: anatomy, hair, materials, rig

Source of truth: the owned Meshy LÉLU, `leluverse/assets/characters/lelu_character/rig/v005_faceshapes_mvwaqbim/lelu.glb`
(sha256 `80089844d989c413dd1ce66bf8c70bf11441831e1256ad6854ab28e5db67e2ce`, registered as Foundry **v0003**).
Every number below was measured on this machine from that file. Where a required
measurement could not be taken, the section says so instead of estimating.

## The one thing that changed

**`lelu_head` is now two objects: `lelu_hair` (162,364 triangles) and
`lelu_scalp` (20,191 triangles), split by the base-colour texture each triangle
carries, with no vertex moved.** The union of the two is the original head,
triangle for triangle. Registered as **v0004**
(`artifacts/foundry/m24/assets/lelu-m24-hair-split.glb`, sha256 `6b9bccbe…`,
224,233 triangles). The re-export also dropped the stray 80-triangle `Icosphere`, so
v0004 is v0003 minus that object and with the head split in two — 224,313 → 224,233
triangles, and every other triangle accounted for.

Verified non-destructive: the same camera, lights and samples rendered both
assets; the 1024² face close-up differs by **pixel RMS 2.03 / 255 (0.8 %)**, all
of it on strand edges where the denoiser integrates a different split of the same
triangles. No vertex position, UV, material, weight or shape key changed meaning.

Everything else in this document is **measurement and specification, not
correction**, and is marked as such.

## WP01 — anatomy

`anatomy/measurements.json`. Bone pivots give segment lengths; vertex extents give
widths; the eye patches give the interpupillary distance.

| measurement | measured | reference (spec sheets) | verdict |
| --- | --- | --- | --- |
| stature (body bounds) | 1.4719 m (1.7185 m to hair top) | 1.70 m | consistent with a 1.72 m silhouette |
| eye height | 1592.85 mm | — | 92.7 % of total height, anatomically normal |
| **interpupillary** | **51.17 mm** | **63.00 mm** | **outside by −11.83 mm** |
| **mouth width** | **31.13 mm** | **50.40 mm** | **outside by −19.27 mm** |
| mouth centre height | 1546.65 mm | — | 46.3 mm below the eye line |
| neck (bone) | 71.01 mm | — | short, stylised |
| shoulder width (arm pivots) | 313.35 mm | — | narrow for 1.47 m |
| hip width (leg pivots) | 217.99 mm | — | narrower than the shoulders |
| upper arm | 203.54 mm | — | — |
| forearm | 214.81 mm | — | forearm longer than upper arm: flagged |
| thigh (hip→knee) | 370.65 mm | — | — |
| **calf (knee→ankle)** | **433.79 mm** | — | **longer than the thigh: flagged as a rig pivot defect** |
| elbow height | 1173.27 mm | — | 68 % of stature, low for a human (72–75 %) |
| wrist height | 1007.14 mm | — | 59 % of stature |
| crotch height | 1001.85 mm | — | legs = 59 % of stature |

Not measured, and why: skull height without hair (hair is fused into the head mesh
in v0003 — measured in v0004 below), nose width/projection (no landmark geometry),
finger lengths (hand shells too small to segment reliably), girths (no
cross-section tool in this pass).

Face width at eye level measured 257.68 mm and depth 235.91 mm, but both bands
include hair shells, so they are **not** facial widths and are not used.

## WP02 — hair engineering

`hair/hair-geometry-analysis.json`, `hair/hair-split.json`.

**The "86,228 hair shells" are not curls.** Measured distribution: median **3
vertices** per shell, median bounding diagonal **6.58 mm**, p90 14.91 mm; 64,170
shells are ≤10 mm. The head mesh is **unwelded triangle soup** (355,437 vertices
for 182,555 triangles), so a "shell" is one triangle with its own vertices. Any
plan that treats 86,228 as follicles or strands is measuring the exporter, not the
hair.

What the hair actually is, once classified by albedo (two-means on the base-colour
luminance, cut 0.2495):

| | value |
| --- | --- |
| hair triangles | 162,364 (88.9 % of head triangles) |
| scalp/face/skin triangles | 20,191 (11.1 %) |
| hair surface area | 1,149,442 mm² (1.15 m²) |
| scalp surface area | 221,959 mm² |
| hair share of the head surface | 83.8 % |
| top of hair | 1718.5 mm |
| **lowest front hair** (midline strip, 1st percentile) | **1516.2 mm — 76.6 mm below the eye line** |

Hairline verdict: the photographs expose **87.68 mm** of forehead above the eye
line; this asset's front curls **hang to 76.6 mm below the eye line**, i.e. the
fringe covers the entire forehead and 164 mm more hair sits in front of the face
than the reference. That is a real, measured difference from her photographic
identity — and the reason the forehead reads as covered in every front view.

Separation achieved: hair and scalp are now independently addressable, and the
accessories travel with the hair. Separation *not* achieved, and not claimed:
primary vs secondary curls, fine strands, baby hairs — the geometry has no strand
structure to divide, so those categories would have to be rebuilt as a new hair
system rather than extracted.

## WP03 — materials and textures

`materials/texture-audit.json`.

| material | images | resolution |
| --- | --- | --- |
| `Material_0` (body, clothing, boots) | 3 | 3 × 2048² |
| `Material_0.001` (head, hair) | 3 | 3 × 4096² |
| `eye_patch_l_mat` / `eye_patch_r_mat` | 1 each | **121 × 83 / 121 × 78** |
| `lelu_mouth`, `lelu_teeth` | none | flat colours |

UV stretch on the body (3D area ÷ UV area, per triangle): median 161,407;
p10 50,133; p90 365,380; p99 652,544; max 3,110,430 — **1.04 % of body triangles
exceed 4× the median and 0.015 % exceed 10×**. So the visible smearing on the
torso and upper arms is *not* primarily an extreme-stretch artefact: it is texel
density and texture content. A 2048² map covers the whole body, and the eye
patches carry a **10,000-pixel** texture, which is why the eyes fall apart in a
close-up.

Not repaired in this pass: repairing the albedo requires re-projecting the body
UVs from the photographs, which changes the asset's appearance and must be its own
version with its own acceptance renders. Documented precisely instead.

## WP04 — rig and facial performance

`rig/rig-validation.json`.

* 24 bones, humanoid naming, one action in the GLB (`Armature|clip0|baselayer_Armature`,
  **frame range 0–0**, 240 F-curves) — i.e. a single-frame baseline pose, not a clip.
* Skinning: body 83,133 vertices, **0 unweighted**, max **4 influences**, 24 vertex
  groups, armature modifier present.
* Shape keys: 12 on `lelu_head` and 12 on each eye patch.
* 31 animation clips exist on disk as separate `motion.glb` files, authored against
  this rig; they are not embedded in the character GLB.

What was actually evaluated: **the shape keys were driven and rendered** — blink
(both lids fully closed) and jawOpen 0.8 + smile 0.7 — see
`rig/renders/shape-blink.png` and `rig/renders/shape-jawOpen-smile.png`. They deform,
and the lids close over the painted eyes rather than leaving a hole.

What was **not** evaluated: walking, running, sitting, arm elevation, wrist and
hand articulation. Those live in the 31 `motion.glb` files, which were not loaded
in this pass; the two `pose-walk-f1x` frames rendered here are frames of the
single-frame baseline action and therefore contain **no motion** — they are kept
only as a record that the rig was posed, not as walk evidence. Claiming otherwise
would be the exact failure the brief forbids.

## WP05 — clothing and accessory modularity

`clothing/modularity-report.json` (generated from the same measurements).

* Clothing is **fused into `char1`** and shares `Material_0` with the skin: no
  garment object, no garment material. It cannot be selected by material.
* Accessories are **inside the head mesh** and now inside `lelu_hair`, so they
  travel with the hair — good enough to recompose hair and ornaments together,
  not good enough to swap a single ring.
* What works today: hair + accessories as one unit, eyes as two units, mouth, teeth
  and body+outfit. That is a real modular layer (5 addressable parts) and is what
  v0004 delivers.
* What a wardrobe needs: a per-triangle garment/skin split of `char1` by the same
  albedo method used for hair, plus a garment UV set. Feasible, not done.

## WP06 — visual acceptance

`acceptance/` holds 12 views of v0004, all with the same camera, lens, lights and
resolution as the v0003 sheet, plus the v0003/v0004 pair at the face.

| # | view | file |
| --- | --- | --- |
| 1 | front facial close-up | `renders/face-close-up.png` |
| 2 | three-quarter facial | `renders/portrait-three-quarter.png` |
| 3 | side facial profile | `renders/profile.png` |
| 4 | full-body front | `renders/full-body.png` |
| 5 | full-body three-quarter | `renders/portrait-three-quarter.png` (portrait framing) |
| 6 | full-body side | `renders/profile.png` |
| 7 | full-body rear | `renders/rear.png` |
| 8 | hairline close-up | `renders/hairline.png` |
| 9 | curl structure close-up | `renders/curl-detail.png` |
| 10 | hands and fingers | `renders/nose-lips.png` framing does **not** cover the hands — **not delivered** |
| 11 | anatomical proportions | `renders/portrait-front.png`, `anatomy/measurements.json` |
| 12 | material and skin inspection | `renders/upper-body.png`, `renders/jewelry.png` |

Honest gaps: view 5/6 reuse the portrait and profile cameras rather than a
full-length three-quarter; view 10 (hands) has no camera in this set and was not
rendered; every render is 16–32 samples, not the 64-sample production setting.

## Deliverables

| required | file | state |
| --- | --- | --- |
| mission report | `M24-CHARACTER-REFINEMENT.md` | this file |
| anatomy | `anatomy/measurements.json` | measured |
| deformation report | `anatomy/deformation-report.json` | proposals only, nothing applied |
| hair analysis | `hair/hair-geometry-analysis.json` | measured |
| hair specification | `hair/hair-specification.json` | measured + derived targets |
| texture audit | `materials/texture-audit.json` | measured |
| rig validation | `rig/rig-validation.json` | measured |
| animation validation | `rig/animation-validation.json` | inventory + what was and was not played |
| clothing modularity | `clothing/modularity-report.json` | measured |
| acceptance | `acceptance/` + 12 renders | 11 of 12 views |
| verification | `verification/verify.json` | checksums, version diff, test results |
| new GLB | `assets/lelu-m24-hair-split.glb` | v0004, 102,886,260 bytes |

Checksums: v0003 `80089844d989c413dd1ce66bf8c70bf11441831e1256ad6854ab28e5db67e2ce`;
v0004 recorded in `verification/verify.json` and in the Foundry version v0004.

## Reproduce

```
export LD_LIBRARY_PATH=$HOME/libs/usr/lib/x86_64-linux-gnu LELU_TOOLS=$HOME/lelu-tools
B=$LELU_TOOLS/blender-4.2.23-linux-x64/blender

$B -b --factory-startup --python scripts/blender/lelu_m24_analyse.py -- /tmp/m24.json
$B -b --factory-startup --python scripts/blender/lelu_m24_hairsplit.py -- /tmp/m24hair.json
$B -b --factory-startup --python scripts/blender/lelu_m24_hairline.py -- /tmp/m24hl.json
npx tsx scripts/foundry/run.ts m24-ingest
npx tsx scripts/foundry/run.ts meshy-render --model artifacts/foundry/m24/assets/lelu-m24-hair-split.glb \
  --shots face-close-up,portrait-front,portrait-three-quarter,profile,rear,eyes,hairline,curl-detail,jewelry,full-body,upper-body,nose-lips --samples 16
npx tsc -b --force
npx tsx --tsconfig tsconfig.test.json --import ./tests/support/ignore-css.mjs --test --test-reporter=spec tests/foundry.test.ts
```

`/tmp/m24*.json` are the job files documented at the top of each script; the
analysis job is `{"input": "<v0003 glb>", "out": "<lelu2>/artifacts/foundry/m24"}`.
