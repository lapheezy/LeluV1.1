# PCI-FR 2.2 — true volumetric hair reconstruction

Baseline: `22c8189e` (PCI-FR 2.1 displaced shell).
Scope: hair only. No jewellery, no garment, no anatomy work.
Status: **not accepted.** The hair is now real geometry from every angle, but it
does not yet read as LÉLU's glossy, near-black ringlets. The failures are
measured and listed below; nothing here is declared a pass because it has more
polygons or because the render finished.

---

## 1. What was kept

* All 25 hair reference sheets, plus the anatomy and expression references.
* The documented measurements transcribed from the sheets' own panels
  (`scripts/perception/lelu_hair.py::SPEC`) and the head-width scale assumption.
* The three measured baby-hair spirals (radii 8 / 11 / 5 mm, lengths 42 / 56 /
  31 mm) — re-seated on the new head, unchanged as geometry.
* The existing perception/detection pipeline (`lelu_perception`,
  `lelu_hair`, `lelu_replicate`) and its validation helpers.
* Branch history and the PCI-FR 2.1 artifacts.

## 2. The abandoned 1,855-lock experiment, assessed

It was abandoned for a rendering reason, not a geometry reason. At the scale of
the 2.1 portrait (≈2.5 px/mm) each strand was 0.07 mm — one fifth of a pixel — so
1,855 of them averaged into fur. Its root distribution and ringlet parameters
were sound; its failure was that a strand is not a visible unit at that scale,
and its roots were grouped by azimuth alone, which made every lock a vertical
ribbon running the whole length of the hair.

PCI-FR 2.2 keeps the model (roots → lock → ringlet) and fixes the two causes:
locks are now spatial clusters with their own bundle radius and curl family, and
each lock is rendered as a body of visible width with its strands inside it.

## 3. Geometry

World units: 1.0 = her face width (landmark 234↔454), 150 mm. +y up, +z towards
camera, face centre at the origin.

| element | value | source |
|---|---|---|
| head ellipsoid | rx 0.62, ry 0.80, rz 0.56, centre +0.24 | references (head width ≈ 1.24 fw, chin at −0.56) |
| hairline | arch 0.74 centre → 0.90 at \|x\| 0.28, down in front of the ears | measured hairline, `lelu-hair-03/20` |
| roots | 7,800 scalp samples above the hairline, 8.5 mm centre part | follicle spacing 1.0–1.6 mm (mission) / 1.8–2.5 mm (sheet panel); roots are clumps, ≈17 per clump |
| locks | ≈460 spatial clusters (k-means on roots), each with its own growth direction, shell depth, curl family, sway, length | — |
| strands | 7,800 individual paths, each rooted on the scalp and continuous to its tip | — |
| curl families | (r, pitch) mm: 8/26, 11/34, 14/44, 6.5/15, 4.2/11.8 | panels `lelu-hair-12/20` (curl Ø 14–28 mm, pitch 30–50 mm) and `lelu-hair-17/24` (8.4/11.8 and 13/15) |
| strand Ø | 0.07 mm (documented); drawn lock bundles 4–19 mm | `lelu-hair-17`, `lelu-hair-12` |
| length | tips at 3.2 fw below the chin = 480 mm | mission target |
| shells | 5 depth fractions 0.60–1.02 of the silhouette envelope | — |

**Path model (the part the 2.1 shell could not do).** Each lock has two phases.

1. *Scalp phase.* The point is computed on the head's own ellipsoid, offset along
   its normal, as the lock sweeps from its root azimuth to the azimuth where it
   will hang and descends the skull to the temple (front/side) or the nape
   (back). Because the point is literally on the skull, hair can never lie
   across the forehead or float in front of the head — the 2.1 shell's
   silhouette problem, and the reason for the discarded clamps that used to
   flatten curls into straight walls.
2. *Fall phase.* From the exit point the lock follows the silhouette envelope
   (measured half-width profile, 0.90 at the forehead → 1.00 at the shoulders →
   0.74 at the waist), with a slow S-wave and the lock's own ringlet wound around
   it in the plane of the fall, so curls read from the front and still have
   depth in profile.

Crown volume comes from locks that leave the skull just below the crown and
flare to the envelope above the widest part of the head; there is no shell and no
lifted "cap".

## 4. Rendering

`scripts/perception/lelu_hair_render` is not a separate file: the renderer lives
in `lelu_hair_volume.py`.

* Each lock is a **screen-space ribbon card**: width perpendicular to the lock's
  projected direction, so a lock keeps a constant apparent width through every
  bend and never twists like tape (the failure mode of a 3D ribbon with a
  transported width).
* Three vertices across the width carry cylinder normals (side, facing camera,
  side); the rasteriser interpolates them, giving dark edges, a lit ridge and a
  specular line along the lock.
* Shading: Kajiya–Kay anisotropic sheen on the lock's tangent (narrow copper
  lobe, smoothed along the path so the highlight does not facet), a broad
  normal-based lobe, a warm rim lobe, depth attenuation and inner-shell
  darkening.
* The hair is rendered into the same z-buffered pass as the head and shoulders,
  so occlusion between locks and head is geometric, not a painter hack.
* Context: textured head (the PCI-FR 1.0 face on a skin field) and a lofted
  neck/shoulder bust, so the four views are not isolated hair capsules.

## 5. Evidence

Individual images, no contact sheets:

| file | what it shows |
|---|---|
| `artifacts/pci-fr-2.2/hair/hair_front.png` | portrait, front |
| `hair_three_quarter.png` | yaw 42° |
| `hair_profile.png` | yaw 90° |
| `hair_rear.png` | yaw 180° |
| `hair_full_length.png` | full body to the waist |
| `hair_crown.png` | top-down, centre part |
| `hair_curl_closeup.png` | one curl cluster at 8 px/mm |
| `hair_babyhairs.png` | forehead spirals, close-up |
| `lelu_hair_volume.glb` | lock geometry (LOD) for the app viewer |
| `hair-volume.json` | geometry measurements |
| `hair-metrics.json` | validation |

## 6. Measured result

From `hair-metrics.json` (validator: `scripts/perception/lelu_hair_volume_validate.py`):

| check | measured | target | verdict |
|---|---|---|---|
| length, geometry | 486.9 mm max / 476.4 mm mean below chin | 480 mm | **pass** |
| length, full-length render (independent of the mesh) | 485.4 mm below chin = 3.24 fw | 480 mm | **pass** |
| curl spacing, close-up autocorrelation | 14.1 px at 8 px/mm = 1.8 mm, confidence 0.30 | 8.4–28 mm | **fail (not measurable — detector confidence below 0.35, so the number is noise, not spacing)** |
| silhouette IoU vs `lelu-hair-20` | IoU 0.048, but the reference's hair runs off the sheet, so its mask is clipped by the frame (recall 0.12 / precision 0.08 describe the crop) | ≥ 0.55, measurable | **fail (not measurable)** |
| hairline RMS | path found on both images (120 / 108 points) but the comparison yields no RMS (overlap 1.0, no comparable span) | ≤ 0.06 fw, measurable | **fail (not measurable)** |
| colour | render val 0.143 / sat 0.549 / hue 41.7 vs reference 0.198 / 0.507 / 30.8; Δval 0.054, Δsat 0.041 | Δval ≤ 0.06, Δsat ≤ 0.08 | pass on the numeric tolerance; the hue is still 11° too red |
| baby hairs re-detected | 17 filaments, 6 spirals on the render | ≥ 2 spirals | **pass** |
| four views | hair covers 61 % / 50 % / 63 % of the 3/4, profile and rear frames | all views | **pass** |
| structure | roots ≤ 0.47 mm off the scalp, no NaN paths, 7,800 strands / 458 locks | < 2 mm | **fail** — max step 20.9 mm inside a few nape locks (a curl-phase kink at the tip, not a rendered gap, but it is a real discontinuity) |

## 7. Why this is not accepted

The geometry passes its structural tests, but the images fail the actual
requirement — the hair must resemble her hairstyle from all four angles:

1. **It reads as a woven lattice.** The locks all fall with the same coherent
   wave, at similar widths, and the gaps between them show the head and body
   through the mass in profile and rear. Her hair is opaque; this is a net.
2. **The colour is flat.** The statistics land inside the numeric tolerance
   (Δval 0.054, Δsat 0.041) but the distribution is wrong: one brown-maroon tone
   everywhere, with no near-black foundation and no selective copper/pink
   highlights. A mean is not a palette.
3. **No curl clusters at the silhouette.** Individual curls are visible, but the
   irregular ringlet clusters of the references are not; the outer silhouette is
   a smooth envelope rather than a cloud of curls.
4. **Crown artefact.** The locks that comb across the top of the skull form a
   hard horizontal shelf, and the parting reads as a bald patch under it.
5. **Two acceptance tests could not be measured.** The curl-spacing
   autocorrelation returns confidence 0.30, and the hairline comparison yields no
   RMS. By the mission's rule both stay failures, not estimated passes.
6. **A structural kink remains** in a few nape locks (20.9 mm between samples),
   though the ribbons themselves are drawn continuously through it.

## 8. Reproduction

```bash
export LD_LIBRARY_PATH="$PWD/.libs/root/usr/lib/x86_64-linux-gnu:$LD_LIBRARY_PATH"
export GLOG_minloglevel=2

# geometry + all views (≈1 min per view)
.venv-perception/bin/python scripts/perception/lelu_hair_volume.py --out artifacts/pci-fr-2.2 --ss 1

# one view while iterating
.venv-perception/bin/python scripts/perception/lelu_hair_volume.py --out artifacts/pci-fr-2.2 --only front --ss 1

# validation
.venv-perception/bin/python scripts/perception/lelu_hair_volume_validate.py --out artifacts/pci-fr-2.2
```

## 9. What the next pass must change

1. Close the mass: an opaque inner layer of wide, dark locks (or 3–4× the lock
   count) so no background shows through from any angle.
2. Rebuild the colour pipeline around the reference palette
   (`#1e0c09 / #481f17 / #843720 / #bb5f41`): near-black base, highlight only on
   the lit crests, measured against the reference distribution rather than a
   global mean.
3. Cluster the curls: group locks into irregular ringlet clumps at the
   silhouette (the references show 2–3 cm clusters, not single locks).
4. Replace the crown combing shelf with locks that cross the part and fall from
   the crown, and make the parting a narrow scalp line, not a gap.
5. Then re-measure, including a silhouette reference whose full hairstyle is
   inside the frame.
