# M25 Complete — LÉLU asset inventory

Baseline: branch `experiment/m25-visual-fidelity-reconstruction` @ `d88dd00f` (M25, v0005), which builds on
`experiment/lelu-2-golden-geometry` @ `d4667d78` (M24). The working tree was clean. Mission branch:
`experiment/m25-complete-character-fidelity`, created from `d88dd00f`. Nothing on either earlier branch was rewritten.

Searched: the working tree; every remote branch (`git ls-tree -r` over all refs); history
(`git log --all -- leluverse/assets/characters/lelu_character/meshes`); `.gitignore` rules; the Meshy job log
(`leluverse/assets/characters/lelu_character/generation_logs/jobs.json`); the wardrobe inventory
(`leluverse/assets/wardrobe/inventory.json`); and the user's computers (`list_computer_folders`: none attached).
Git LFS is not used by this repository.

## 1. Recovered 3D assets: present and loadable

| asset | path | sha256 (16) | bytes | what it is |
| --- | --- | --- | --- | --- |
| Meshy LÉLU v0003 (canonical) | `leluverse/assets/characters/lelu_character/rig/v005_faceshapes_mvwaqbim/lelu.glb` | 80089844d989c413 | 49,511,140 | rigged body + current outfit fused in `char1`, head, eyes, mouth, 12 face shapes |
| head-swap v004 (predecessor) | `leluverse/assets/characters/lelu_character/rig/v004_headswap_mvvnvqa1/lelu.glb` | 540c4c32a6d9ad83 | 48,585,500 | same rig, before the face shapes |
| v0004 (M24 hair split) | `artifacts/foundry/m24/assets/lelu-m24-hair-split.glb` | 6b9bccbe3591a3ee | 102,886,260 | v0003 with hair/scalp separated |
| v0005 (M25) | `artifacts/foundry/m25/assets/lelu-m25-visual-fidelity.glb` | 1170e1ff52414be0 | 53,137,492 | calibrated skin, ringlet hair, repaired normals |
| 31 Meshy motion clips | `leluverse/assets/characters/lelu_character/animations/v0NN_*/motion.glb` | per file | — | joint-node clips for the same rig (idle, walk `v021`, sit_idle `v024`, …) |
| CC0/PCI-FR canon (not identity) | `artifacts/lelu/canon/lelu-canon.glb` | 9ae0b3a3c9248f0b | 43,685,096 | scaffold only |

**Current outfit:** the corset/camo top, cargo trousers, harness, straps and platform boots are not separate
assets. They are fused into the `char1` mesh and share one 2048² material with her skin (M24 modularity report).
Jewellery on the head (forehead ornament, septum, hoops, roses, hair chains) is inside `lelu_hair`/`lelu_scalp`;
body jewellery (pendant, chains, straps) is inside `char1`.

## 2. Meshy wardrobe exports: generated, recorded, files NOT on this machine

These jobs succeeded and the job log records every output file with its size and sha256. The files were never
committed (they lived on the machine that ran the jobs), and none is on any branch.

| job | Meshy task | what | primary file (sha256 12) | bytes |
| --- | --- | --- | --- | --- |
| fj_mvxffilj_de83ff | 01a195b7 (text-to-3d) | modular hooded shoulder-cape garment | `meshes/v005_text-to-3d_01a195b7/model.glb` (f0731c9d8ea8) | 1,492,588 |
| fj_mvxfi9ta_4d9cbf | Blender export of the cape | runtime GLB, blend, fbx, obj | `meshes/v006_export_mvxffilj/runtime.glb` (16b91487131e) | 1,349,548 |
| fj_mvxfr7cu_76c6c7 | 01a195bf (image-to-3d) | Outfit B shoulder pauldron (from ref16) | `meshes/v007_image-to-3d_01a195bf/model.glb` (59d888e18872) | 15,209,780 |
| fj_mvxfyfnm_c048dc | Blender export of the pauldron | runtime GLB, blend | `meshes/v008_export_mvxfr7cu/runtime.glb` (7958f8a5e556) | 15,107,856 |
| fj_mvxg0q5l_10c652 | 01a195c6 (multi-image-to-3d) | Outfit B wire-cage hooded look (full body) | `meshes/v009_multi-image-to-3d_01a195c6/model.glb` (6009c706c94a) | 16,350,752 |
| fj_mvxg5592_36c413 | Blender export of the hooded look | runtime GLB, blend | `meshes/v010_export_mvxg0q5l/runtime.glb` (73300543b4c2) | 16,330,272 |
| fj_mvxfbqf8 / fj_mvxfem6f | Blender exports of fj_mvx5ruga | full-character export (blend, glb 26.7 MB) | `meshes/v003_export_mvx5ruga/runtime.glb` (7d12a378a573) | 26,720,528 |

Status: **missing, recoverable**. To restore them, copy the `meshes/v003…v010` folders from the machine that ran
the Forge (paths relative to `leluverse/assets/`) into this repository. The checksums above verify them. None
was regenerated: the mission forbids paid generation, and regenerating would replace an original with an
approximation.

Jobs that produced nothing: `fj_mvxfz5sk` (hooded look, FAILED); the hood-only image job (awaiting approval);
four early base-character attempts (rejected).

## 3. Planned but never generated: the two new outfits

`leluverse/assets/wardrobe/inventory.json` (read by `plugins/wardrobeInventory.ts`) already plans both new looks
from the photographs supplied with this mission:

* **`bronze_velocity`** (Outfit A, copper exosculpt catsuit): catsuit (look), arm rings, high collar, ankh belt,
  handbag, boots, earrings, neck jewellery, hair coils.
* **`rose_gold_sovereign`** (Outfit B, copper-rose tailored coat): coat (look), inner garment, jewelled belt, oval
  gem buckle, handbag, boots, layered necklace, choker, pendant, hoops, rings, hair ornament.

Each entry carries a Meshy request plan. Nothing was generated, because generation requires paid credits.
The reference photographs these plans name (`rose_gold_photo_primary`, `bronze_velocity_photo_primary`, …) were
not on disk. The 15 images supplied with this mission are now stored under `artifacts/foundry/m25c/references/`.

## 4. Screenshots and references only (no geometry)

* `leluverse/assets/characters/lelu_character/references/*.png`: the original identity photographs (outfit B
  hooded/unhooded, corset, cargo, boots, shoulder armour, pendant, hands).
* `meshes/v001…v002/*.png`: preview views of the first Meshy bases (their GLBs are gitignored and absent).
* `artifacts/asre/character/variations/outfits/*.png`: renders of a CC0 scaffold in generic outfits. These are
  not LÉLU garments.
* `artifacts/foundry/m25c/references/01…15`: this mission's photographs (catsuit, coat, boots, belt, hand
  jewellery, ear cuff, hoops, handbag, choker, hair ornaments).

## 5. Other garment geometry in the repository (not LÉLU wardrobe)

* `origin/freebuff/m22-2-…`: `artifacts/pci-fr-1.0/meshes/lelu_garment_reconstructed.glb`, a PCI-FR 1.0
  reconstruction experiment on the parametric body, not on the Meshy rig.
* `origin/freebuff/4007…`: `artifacts/creative/garment.glb`, a generic garment-engine test.
* `origin/temporal-studio/asre-core`: `lelu_character/foundry/v001…v002/lelu_foundry.*`, the CC0 foundry body.

None of these is a Meshy outfit for the canonical rig. They are listed so nobody mistakes them for one.

## 6. Existing systems to reuse (no duplicate wardrobe)

* `plugins/forgeStore.ts`: wardrobe items (`manifests/wardrobe.json`), slots and bone-following placements.
* `plugins/wardrobeInventory.ts` + `leluverse/assets/wardrobe/inventory.json`: looks and their parts.
* `tests/forge-wardrobe.test.ts`, `tests/forge-wardrobe-inventory.test.ts`.
