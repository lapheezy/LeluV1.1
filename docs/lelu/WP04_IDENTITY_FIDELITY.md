# WP04 — LÉLU identity-fidelity reconstruction

Authority: her canonical reference images in
`leluverse/assets/characters/lelu_character/references/` and
`identity/identity.json`. No generic specification or invented measurement:
every target below is measured on her references with the same tool that
measures the model.

## 1. Reference measurement

**Reference set.** The 21 reference files contain 13 unique images (md5); 14
files are byte-identical duplicates under two names (e.g. `ref10_face_primary`
= `face-front-closeup-alt`, `ref01_front_fullbody_A` = `body-front-neutral-nohood`).
Independent frontal faces: n = 6.

| id | source | size | IOD px | roll ° | yaw ° |
|---|---|---|---|---|---|
| ref10_face_primary | `ref10_face_primary.png` | 1024×1536 | 190.49 | -1.81 | -0.08 |
| ref17_head_front_unhooded | `ref17_head_front_unhooded.png` | 476×600 | 96.16 | -1.13 | 0.62 |
| ref08_face_upper_body | `ref08_face_upper_body.png` | 1024×1536 | 146.69 | 0.32 | 1.05 |
| ref01_front_fullbody_A--headcrop | `ref01_front_fullbody_A--headcrop.png` | 1227×1011 | 158.59 | -6.34 | -1.08 |
| ref11_front_apose_B--headcrop | `ref11_front_apose_B--headcrop.png` | 1227×1011 | 159.54 | -0.19 | -0.47 |
| ref14_front_apose_hooded_B--headcrop | `ref14_front_apose_hooded_B--headcrop.png` | 1227×1011 | 156.78 | 0.04 | -0.4 |

Full-body images (ref01, ref11, ref14) are measured on a head crop
(x 0.3–0.7, y 0–0.22 of the frame) upscaled ×3 (Lanczos); landmarks are mapped
back to the full frame.

**Method.** `scripts/asre/lelu-landmarks.py`: MediaPipe FaceLandmarker
(Apache-2.0, 478 landmarks incl. irises; a dev-time measurement tool, not an
application dependency, run offline on local files). Each face is
roll-corrected on the pupil line. **Coordinate system:** image pixels, x right,
y down; lengths in units of interpupillary distance (IOD, scale-invariant);
vertical positions as fractions of face height (landmark 10 upper forehead →
152 menton); tilt in degrees, positive = outer canthus higher. **Uncertainty:**
the standard deviation across the six independent images (detector noise,
expression, pose and stylisation together). A model metric passes when it lies
within ±2 σ of her mean (σ floored at 1 % of the mean).

**Skull and hair** are not visible to a face detector:
- hair silhouette: `lelu-silhouette.py`, MediaPipe multiclass segmenter
  (hair class) in her own face frame (origin pupil midpoint, unit IOD).
  Valid on ref01, ref10, ref17; ref11 and ref14 excluded (no hair found:
  dark hair on dark ground / hooded). Below the chin, dark hair over dark
  clothing is lost on both images, and the model's A-pose differs from ref01,
  so the silhouette is compared crown→chin.
- skull crown: her hair crown is 2.15 ± 0.03 IOD above the pupils; the skull
  target 2.05 ± 0.08 IOD assumes ~0.1 IOD of sleek hair over the crown
  (assumption recorded; covered by the wider σ).
- The golden ratio is not used anywhere.

## 2. Head reconstruction

The head is the CC0 MakeHuman surface deformed by morph targets; the targets
are **solved** (`scripts/asre/lelu-fit-face.py`): build only the head with a
candidate set of weights (`lelu-head-preview.ts`, 5.6 s), render it
orthographically under neutral light with no hair, detect, score the 25
metrics (+ the crown) as z, Gauss-Newton with a finite-difference Jacobian,
Tikhonov regularisation toward the start, bounds ±1, backtracking line search.
Every evaluation is kept (`artifacts/lelu/wp04/fit/`).

| pass | fitted | result |
|---|---|---|
| 1 | 18 parameters | fit RMS z 4.60 → 1.45 |
| — | brows and lips painted in her landmark units (were fixed mm offsets geometry could not move) | — |
| 2 | lips, brows, mouth, chin, aperture, forehead | 1.20 → 0.81 |
| 3 | + skull crown constraint, head round↔oval | crown 2.39 → 2.13 IOD (cone removed) |
| 4 | temples, cheeks, eyes, jaw, vault, crown held | 0.95 → 0.88 |

**Before vs after on the canonical head** (same render, detector and metrics):
**6/25 → 24/25 pass, RMS z 4.471 → 0.931**; skull crown 2.06 IOD.

| metric | reference mean ± σ (n=6) | before (z) | after (z) | |
|---|---|---|---|---|
| face_width_temple | 2.123 ± 0.031 | 2.412 (+9.38) | 2.116 (-0.21) | ✅ |
| face_width_cheek | 2.082 ± 0.034 | 2.367 (+8.33) | 2.066 (-0.45) | ✅ |
| face_width_jaw | 1.928 ± 0.044 | 2.178 (+5.66) | 1.903 (-0.56) | ✅ |
| face_width_gonion | 1.789 ± 0.054 | 2.001 (+3.89) | 1.768 (-0.39) | ✅ |
| face_width_chin | 1.121 ± 0.045 | 1.239 (+2.62) | 1.123 (+0.06) | ✅ |
| face_height | 2.293 ± 0.080 | 2.553 (+3.25) | 2.301 (+0.09) | ✅ |
| eye_width | 0.427 ± 0.008 | 0.457 (+3.64) | 0.404 (-2.83) | ❌ |
| eye_height | 0.137 ± 0.011 | 0.170 (+3.14) | 0.125 (-1.18) | ✅ |
| canthal_tilt_deg | 7.832 ± 0.703 | 9.543 (+2.44) | 8.613 (+1.11) | ✅ |
| intercanthal | 0.546 ± 0.011 | 0.520 (-2.38) | 0.544 (-0.13) | ✅ |
| nose_width | 0.486 ± 0.013 | 0.575 (+6.79) | 0.495 (+0.74) | ✅ |
| nose_length | 0.677 ± 0.024 | 0.806 (+5.46) | 0.681 (+0.20) | ✅ |
| mouth_width | 0.707 ± 0.028 | 0.794 (+3.09) | 0.699 (-0.30) | ✅ |
| upper_lip | 0.133 ± 0.016 | 0.095 (-2.39) | 0.112 (-1.34) | ✅ |
| lower_lip | 0.190 ± 0.015 | 0.167 (-1.48) | 0.163 (-1.76) | ✅ |
| brow_height | 0.402 ± 0.018 | 0.284 (-6.51) | 0.406 (+0.26) | ✅ |
| y_brow | 0.133 ± 0.004 | 0.162 (+8.29) | 0.127 (-1.69) | ✅ |
| y_eye | 0.333 ± 0.006 | 0.305 (-4.29) | 0.328 (-0.77) | ✅ |
| y_subnasale | 0.605 ± 0.011 | 0.618 (+1.19) | 0.603 (-0.20) | ✅ |
| y_stomion | 0.742 ± 0.012 | 0.754 (+0.96) | 0.751 (+0.76) | ✅ |
| y_lip_lo | 0.836 ± 0.012 | 0.825 (-0.89) | 0.832 (-0.30) | ✅ |
| jaw_to_cheek | 0.860 ± 0.016 | 0.845 (-0.91) | 0.856 (-0.24) | ✅ |
| face_aspect | 1.101 ± 0.030 | 1.078 (-0.79) | 1.113 (+0.40) | ✅ |
| eye_aspect | 0.321 ± 0.024 | 0.372 (+2.16) | 0.309 (-0.50) | ✅ |
| lip_ratio | 1.435 ± 0.100 | 1.766 (+3.30) | 1.457 (+0.22) | ✅ |

Sheets: `model-before/comparison-sheet.png`, `model-fitted/comparison-sheet.png`
(aligned in her frame, landmarks on both, mean reference shape ±σ vs model).
Bare-head orthographic front/side: `model-fitted/head-ortho-bare-*.png`.

## 3. Hair architecture

`src/core/asre/reference/hairArch.ts` — scalp hairline from her pupil line,
centre part, primary masses, ringlet clumps of varied diameter/pitch/length,
strands (14 per clump), part-line layer, flyaways, baby hairs ray-projected
onto her forehead mesh (0.3 mm lift). Strands are curves in a quantized gzip
sidecar rendered as native hair curves; the GLB keeps one tube per clump as
the realtime LOD. Silhouette (crown→chin IoU): vs ref01 0.589 → 0.618,
vs ref10 0.759, vs ref17 0.697 (`hair-silhouette/`).

## 4. Facial detail

Eyes, lid margins, lashes and liner are measured on her own head (ray-cast lid
margins); brows and lips are placed in IOD from her reference proportions;
the painted forehead ink swirls are replaced by real baby-hair geometry.

## 5. Build, occupancy and tests

| | |
|---|---|
| build | 1:03.76 wall, pipeline 58.5 s, peak RSS 1.07 GB |
| triangles | 2,853,352 (hair LOD 1,725,248) |
| GLB | 80.1 MB, re-read by GlbInspector: no problems |
| strands | 16,750 curves, 3,424,392 points, sidecar 20.0 MB |
| occupancy | IoU 1.000000 (831,301 cells, per-component = whole-object) |
| coverage | 100 % bust, pelvis, crotch, seat, thighs, shins |
| tests | 94/94; ASRE typecheck 0 errors |

## 6. Open, honestly

- Eye width 5.5 % short of her mean (z −2.83) after pass 4.
- Hair crown sits on the head with 9–18 mm clearance; the silhouette crown
  measured 1.95 vs 2.1–2.2 IOD before the skull fit and must be re-measured on
  the final render.
- Silhouette below the chin is not compared (segmentation, pose).
- Profile (ref18/ref20) is not yet measured: the landmark detector is
  unreliable at 90° yaw.
