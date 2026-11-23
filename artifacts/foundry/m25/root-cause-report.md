# M25 — root causes of LÉLU's visual defects

Every figure below comes from `topology/audit-v0004.json` (lelu_m25_audit.py),
`visual-defect-map/` (lelu_m25_classmap.py), landmark/colour measurements
(m25_landmarks.py, m25_color.py) or the build report. Cause codes: A geometry,
B normals, C material, D texture, E UV, F lighting, G sampling, H camera/post, I multiple.

## 1. The washed-out complexion was mostly the renderer (H + F), then albedo chroma (D)

The same v0004 file was measured three ways on landmark-located cheek/forehead/chin
patches (brightest 20 % dropped, CIELAB D65):

| source | L\* | a\* | b\* |
| --- | --- | --- | --- |
| photographs (median of 5 front references) | ≈ 45 | ≈ 34 | ≈ 33 |
| M24 render of v0004 (`m24/renders/face-close-up.png`) | 80.3 | 12.9 | 14.4 |
| v0004 under a grey-card-calibrated neutral studio | 51.0 | 18.0 | 23.1 |
| skin texels in the v0004 albedo (median) | 42.9 | 16.2 | 22.6 |

The M24 renderer exposed by `120 W × framing²`, tone-mapped with *AgX Medium High
Contrast*, and its material pass matched no object (`materials_applied: []`). That
alone lifted her skin by ~30 L\* and halved its chroma. Exposing every M25 shot
against a measured 18 % grey card at the subject removes that. What remains is in the
texture: the painted skin carries about half the photographs' chroma. M25 corrects
skin texels only (L\* × 0.88 — darker, never lighter — and a\*/b\* shifted +12/+8,
additively so the painted blush is not amplified into blotches).

## 2. The "metallic" hair and plastic skin are material maps (C), shown by the renderer (H)

The asset's own metallicRoughness maps put metallic up to p99 0.68 on hair texels and
p90 0.67 on head texels (jewellery is in the same atlas), and roughness down to p1 0.09
on the head. Under an over-bright key, near-black hair (albedo mean sRGB 0.07/0.03/0.03)
reflects grey: the "metallic ribbons". Repair is texel-local: skin and hair texels get
metallic 0 and a roughness floor; texels the map marks as metal (≥ 0.5) are untouched,
so the rose-gold jewellery stays metal.

## 3. The crystals on shoulders, back and chest are real geometry (A), drawn hard (B)

* No topology fault explains them: 0 zero-area, 0 collapsed, 0 duplicate faces, 0
  inverted normals on every object; 18 / 66 / 28 winding-inconsistent welded edges on
  char1 / lelu_hair / lelu_scalp — far too few for region-wide artefacts; no
  transparent material (all HASHED, alpha 1.0) so no sorting problem.
* The surface is folded: on char1's shoulders the median per-triangle dihedral is
  51.7° and 61 % of triangles bend more than 45° against their neighbours, on edges of
  12.7 mm (39,166 triangles cover the whole body and outfit).
* It is hair: 31 % of shoulder and 51 % of upper-back triangles carry hair albedo.
  Meshy fused the hair that falls over her shoulders into the body as a crumpled shell.
* The exported normals are essentially per-face (loop-vs-face deviation median 2.3°;
  88 % of shared positions split by more than 30°), so every fold is a hard facet.

`visual-defect-map/crumple-v0004-*.png` paints every triangle with ≥ 45° mean dihedral
red: shoulders, hair ends, hands and trouser folds.

Repair: normals rebuilt from area-weighted face normals at coincident positions with
class limits (hair 80°, skin 50°, fabric 40°, metal 30°, 45° for anything in front of
the face); localised Taubin smoothing of the hair cape (≤ 15 mm) and of folded
shoulder/upper-arm triangles (≤ 8 mm), every vertex that touches an unfolded
triangle pinned. **Not welded**, no UV changed. The crumple is reduced, not removed:
the folds are pinned by UV seams and a true fix is a retopology + re-projection,
which is a separate version.

## 4. The hair ribbons are folded strips (A + B + C)

`lelu_hair` is 161,673 triangles of unwelded soup; welded, its median dihedral is
31.9° and 23.8 % of adjacent pairs bend more than 60°. No strand structure exists to
recover (M24: median shell = 3 vertices). M25 keeps it as the opaque **foundation**
(gently Taubin-smoothed outside the face zone, matte, normals rebuilt) and adds new
geometry for what the photographs show: rounded helical ringlets grown along the
existing hair surface, and fine flyaways and baby hairs.

## 5. The eyes are a texture-resolution limit (D) with no legitimate source to fix it

The eye patches carry 121 × 83 and 121 × 78 px. The head texture under them has no eye
(rendered with the patches hidden: the sockets are empty), and the reference
photographs carry 40–84 px per eye. No legitimate process can add detail that no
source contains, so the eye textures were not enlarged.

## 6. The IPD and mouth "discrepancies" were a registration error

M24 compared model millimetres (IPD 51.2 mm, mouth 31.1 mm) with 63 / 50.4 mm derived
from a sheet scaled by an assumed 142 mm face (confidence: low). Those two targets
disagree with each other (50.4 / 63 = 0.80) and with every photograph
(mouth/IPD 0.66–0.69). In scale-free landmark ratios the render already sits inside
the photographs' spread, so neither the eyes nor the mouth were moved — see
`anatomy/facial-landmarks.json`.
