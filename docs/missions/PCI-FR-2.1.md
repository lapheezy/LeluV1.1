# PCI-FR 2.1 — Hair reconstruction status

Baseline: PCI-FR 1.0 (`a8c8fe70`), references `aa8b1bdd`.
Outputs: `artifacts/pci-fr-2.1/`.

## Verdict

**The hairstyle does not yet pass visual acceptance.** The reconstruction is
waist-length, spec-driven, asymmetric and has real spiral baby hairs and a real
chain headpiece, but it reads as a smooth ribboned curtain, not as her mass of
dark curls. Section 5 lists exactly what fails and why. Nothing beyond hair was
started, per the mission's stop rule.

## 1. What is measured, and from where

The 25 hair references are design sheets: a letterboxed artwork plus an
annotation panel carrying the hair's physical specification. The specification
was transcribed with its source file:

| Parameter | Value | Source |
|---|---|---|
| Ringlet curl radius / diameter | 4.2 mm / 8.4 mm | `lelu-hair-17.png` |
| Ringlet pitch, turns per cm | 11.8 mm, 0.85 | `lelu-hair-17.png` |
| Strand diameter | 0.07 mm (0.06–0.09) | `lelu-hair-17.png` |
| Loose ringlet radius / D / pitch | 6.5 mm / 13 mm / 15 mm | `lelu-hair-24.png` |
| Hairline arc length / height | 13.8 cm / 3.6 cm | `lelu-hair-18.png` |
| Baby swirls A/B/C radius, length | 0.8/1.1/0.5 cm, 4.2/5.6/3.1 cm | `lelu-hair-18.png` |
| Follicle spacing, density | 1.0–1.6 mm, 62–100 /cm² | `lelu-hair-18.png` |

Scale: the sheets carry no px→mm ruler, so **head width = 150 mm** is the single
assumed dimension, stated in `lelu_hair.py::HEAD_WIDTH_MM`. Every millimetre in
every output traces to it.

## 2. Perception (`lelu_hair.py`)

Across 25 sheets: 12 faces detected, 33 spiral filaments found on 8 sheets,
per-image hair masks, orientation fields (mean coherence 0.56–0.75), curl
spacing by autocorrelation (median 16 px, spread 12–118 px — the spread is real:
close-up texture panels versus portraits), and palettes.

Two bugs found and fixed here: face detection failed on band-cropped images
(now measured on the full sheet), and the curl search floor of 8 px locked onto
pixel-level texture (now scales with the region and requires prominence ≥ 2σ).

## 3. Geometry

`lelu_hair3d.py` — 1 855 clump roots on a head ellipsoid (half-extents 0.62,
0.84, 0.55 face widths), grouped into locks, each grown as a 3D ringlet at the
loose-curl spec and falling 3.2 face widths below the chin. Baby hairs are
Archimedean spirals at the measured radii and forehead coordinates. The chain
headpiece is geometry on the head surface (centre chain to a brow gem, two
temple strands).

`lelu_hair_shell.py` — the mass rendered as a displaced shell (14 784 quads,
exported as `lelu_hair_shell.glb`) whose waves come from the lock paths, plus
front / three-quarter / profile / rear renders.

## 4. Validation (`hair-metrics.json`)

| Check | Measured | Target / reference | Pass |
|---|---|---|---|
| Length below chin | 330 mm visible | 480 mm (waist) | **no** — clipped by the base render's frame |
| Curl spacing | 8.2 mm | 13 mm loose ringlet | **no** — 37 % under |
| Silhouette IoU vs reference | 0.167 | — | **no** (recall 0.53, precision 0.20) |
| Colour hue / saturation | 18.5° / 0.54 | 19.4° / 0.37 | partly — right hue, over-saturated |
| Baby hairs re-detected | 4 filaments, 3 spirals | 3 swirls | **yes** (geometry is detectable) |
| Chain position error | 11.7 mm | — | acceptable |
| Hairline RMS | not measurable | — | detector finds no hairline on the render |

Silhouette IoU is computed face-relative with both masks rescaled to a common
frame; it is low because the reference's hair is far wider and rounder than the
reconstruction.

## 5. What fails visual acceptance, specifically

1. **Curl character.** Her hair is a mass of dark voluminous curls with copper
   and pink strands through them. The reconstruction's shell waves read as
   parallel ribbons — regular, and too coarse in wavelength.
2. **Volume.** Her hair stands well clear of the skull and frames the face with
   roundness; the reconstruction is a fitted helmet with a straight edge.
3. **Colour.** Mean hue matches, but saturation is 45 % too high and the mass
   reads brown rather than near-black with highlighted strands.
4. **Ornament.** Roses and the side chains of the reference are absent (the
   mission scoped only the gold chain headpiece).
5. **Hairline.** The render's hairline detector finds nothing, so hairline
   accuracy is unverified at this render.
6. **Length.** The hair is cut by the base frame at 330 mm of the 480 mm target.

## 6. Reproduction

```
bash scripts/perception/setup.sh
export LD_LIBRARY_PATH="$PWD/.libs/root/usr/lib/x86_64-linux-gnu:$LD_LIBRARY_PATH"
.venv-perception/bin/python scripts/perception/lelu_reference_inventory.py
.venv-perception/bin/python scripts/perception/lelu_hair.py
.venv-perception/bin/python scripts/perception/lelu_hair3d.py --out artifacts/pci-fr-2.1
.venv-perception/bin/python scripts/perception/lelu_hair_shell.py --out artifacts/pci-fr-2.1
.venv-perception/bin/python scripts/perception/lelu_hair_validate.py --out artifacts/pci-fr-2.1
.venv-perception/bin/python scripts/perception/lelu_hair_techdraw.py --out artifacts/pci-fr-2.1
```

Licences unchanged from PCI-FR 1.0 (MediaPipe Apache-2.0, OpenCV Apache-2.0,
SciPy BSD, NumPy BSD). No paid services, no new dependencies.
