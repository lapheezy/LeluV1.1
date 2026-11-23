# M25 Complete — LÉLU character fidelity, accessories and wardrobe

Branch `experiment/m25-complete-character-fidelity`, created from `experiment/m25-visual-fidelity-reconstruction`
@ `d88dd00f` (M25), which builds on `d4667d78` (M24). Nothing was merged. v0003, v0004 and v0005 are
byte-identical (tests/foundry-m25c.test.ts). Inventory: `docs/missions/M25-COMPLETE-ASSET-INVENTORY.md`.
Evidence: `artifacts/foundry/m25c/`. Every visual step was rendered, inspected and sent at the time it was made.

## Paid generation

The mission brief forbade paid services. Mid-mission, the user authorised Meshy for the two new looks (and
nothing else). Spent, per the Forge price table: Outfit A 35 (multi-image-to-3d) + 5 (rigging); Outfit B 9 + 9
(image-to-image, to obtain the full-length and turnaround views no photograph showed) + 35 + 5. **98 credits.**
Balance before: 2,867. Each request, task id and file sha256 is in the folder's `provenance.json`.

## What was done, with its measured result

| phase | result | evidence |
| --- | --- | --- |
| 0 inventory | all branches, history, job log and wardrobe plans searched. The Meshy cape, Outfit-B pauldron and hooded Outfit-B look (and the `hooded` look the manifest still points at) are recorded with checksums but **missing from this machine** | inventory doc |
| 1 black mouth patches | **cause: the `lelu_mouth` cavity sat up to 3.8 mm in front of the lips**; seated 2.5 mm behind, with a matte interior. Teeth card moved back rigidly. | `mouth/before-*.png`, `after-*.png`, `mouth-seat.json` |
| 1 lip shape | every lip ratio (width/IPD, upper/lower, height/width, Cupid's bow, colour) already inside the photographs' spread. A 3 % widening was tried, measured below detector noise, and **reverted**. Local lip smoothing plus 70° normals applied. | `lips-before.json`, `lips-photo-vs-render.png`, `s2-*.png` |
| 2 jewellery visibility | accessory mask, identical for every version: visible share front/3q/profile/rear 61/64/57/55 % (v0004) → 53/56/42/44 % (v0005) → **56/59/50/49 %** (ringlets cut 9 mm from ornaments). Hair silhouette still larger than v0004 everywhere. | `jewelry/visibility*.png`, `visibility.json` |
| 3 shoulder/chest crumple | weighted, unpinned Taubin unfolding: triangles folded > 45° — shoulders 35 → 25 %, upper back 32 → 24 %, chest 27 → 21 %, arms 33 → 24 % | `outfit-current/*-compare.png`, `shoulder-repair.json` |
| 4 wardrobe recovery | nothing recoverable on this machine (see inventory) | inventory doc |
| 5 Outfit A catsuit | Meshy body from front/side/back photos, rigged; LÉLU's head (face, ringlets, eyes, mouth, 12 face shapes, hair jewellery) moved on at the Head bone; metallic ×0.55, roughness ≥ 0.32; handbag split into `bronze_bag` on RightHand, holes behind it filled | `outfit-a/`, `final/bronze_velocity/` |
| 6 Outfit B coat | full-length + turnaround views generated from the coat photos (lower half inferred), Meshy body rigged, head placed by measured face position (rigger's Head bone was 11 cm off), skirt unfolded 20 → 8 % | `outfit-b/`, `final/rose_gold_sovereign/` |
| 7 wardrobe | three looks registered in the **existing** Forge (job records, GlbInspector, `look:` slots): `camo_repaired`, `bronze_velocity`, `rose_gold_sovereign`. `dressOutfit` switches between them and refuses unknown looks. | `wardrobe-switch-test.json` |
| 8 animation | her own clips by joint name on every look: walk (22 bones), sit_idle (21), idle_look_around (21); smile and jaw open with each outfit | `final/<look>/walk, sit, arms, face-*` |
| 9 renders | 30 individual final renders + every step's before/after | `final/`, step folders |

## Still wrong (not hidden)

* **Outfit A:** jagged copper shards from the generated collar under the chin; the bag overlaps the fingers;
  small scrap behind the right knee mid-stride.
* **Outfit B:** the skirt is skinned to the legs (no cloth simulation), so it splits into two tubes when she
  walks or sits; dark slits between the back panels (real gaps in the generated mesh); the generated back hair
  below her head is a blocky dark mass. The coat's lower half is an inferred design.
* **Current outfit:** shoulder crumple reduced, not removed; thin hair-lock strips fused into the body beside the
  arms remain.
* **Face:** facet and painted seam lines on cheeks; teeth are a flat card now seated out of view; eye textures
  121 px (no legitimate higher source); no lip/septum bead jewellery yet (it is in the photographs).
* **Wardrobe:** the bag is a separate object inside the look, not yet an independent Forge wardrobe item; the
  manifest's existing `hooded` look points at a missing file; the original Meshy garment exports are not here.
* **Browser:** the looks were validated in Blender and through the Forge API, not loaded in the web client.

## Tests

`npx tsc -b --force`: 0 errors. `tests/forge-wardrobe*.test.ts`, `foundry.test.ts`, `foundry-m25.test.ts`,
`foundry-m25c.test.ts`: 43 / 44 pass. The one failure, *"the three sources are ordered per component"*, also
fails on the untouched M24 commit: it expects the repository to sit in a `lelu2/` workspace folder.

## Reproduce

```
B=~/lelu-tools/blender-4.5.9-linux-x64/blender
$B -b --factory-startup --python scripts/blender/lelu_m25_build.py -- artifacts/foundry/m25c/hair/build-job.json        # s0 (9 mm accessory clearance)
$B -b --factory-startup --python scripts/blender/lelu_m25c_mouth.py -- artifacts/foundry/m25c/mouth/mouth-seat.job.json # s1
$B -b --factory-startup --python scripts/blender/lelu_m25c_lipsurface.py -- artifacts/foundry/m25c/mouth/lip-surface.job.json # s2
$B -b --factory-startup --python scripts/blender/lelu_m25c_shoulders.py -- artifacts/foundry/m25c/outfit-current/shoulder-repair.job.json # s3
$B -b --factory-startup --python scripts/blender/lelu_m25c_lookassemble.py -- artifacts/foundry/m25c/outfit-a/assemble.job.json
$B -b --factory-startup --python scripts/blender/lelu_m25c_bagsplit.py -- artifacts/foundry/m25c/outfit-a/bag-split.job.json
$B -b --factory-startup --python scripts/blender/lelu_m25c_lookassemble.py -- artifacts/foundry/m25c/outfit-b/assemble.job.json
$B -b --factory-startup --python scripts/blender/lelu_m25c_shoulders.py -- artifacts/foundry/m25c/outfit-b/coat-unfold.job.json
npx tsx scripts/foundry/m25c-wardrobe.ts
python3 scripts/foundry/m25c_final_renders.py --samples 48
```
Meshy jobs: `scripts/foundry/m25c_meshy.py` (submit / i2i / rig / wait), key from `MESHY_API_KEY`.

## Round 2 (after the user's second reference batch)

Authorised by the user: rebuild the coat and catsuit from the full-length photographs, build Home/Laidback 3,
match each look's hair to its reference. Spent: 27 (A-pose fronts) + 27 (turnarounds) + 105 (three 3D builds) +
15 (three rigs) + 70 (two handbags, multi-image 35 each) = 244 by the price table; the account balance actually fell 2,779 → 2,560, so **219 credits** were charged.

| look | file | what changed |
| --- | --- | --- |
| `look:rose_gold_sovereign` | `meshes/v026_look_rose_gold_sovereign/lelu.glb` | rebuilt from the real full-length coat photograph: pointed side panels, front slit, closed back; linework handbag on RightHand |
| `look:bronze_velocity` | `meshes/v025_look_bronze_velocity/lelu.glb` | rebuilt from the full-length catsuit photograph: ankh belt, pointed boots; lotus handbag on RightHand |
| `look:home_laidback3` | `meshes/v027_look_home_laidback3/lelu.glb` | new: open hoodie, crop top, printed sweats, slippers |

Hair: `lelu_m25c_lookassemble.py` `"hair": "outfit"` keeps her face, lips and face jewellery (hoops, forehead jewel,
septum) and the hair Meshy generated from that look's reference; the camo roses and the chains that hung inside
her old hair are removed; generated face fragments within 6 mm (any) / 20–40 mm (light-coloured) of her skin are cut.

Open: on the coat, her head tips back in walk/sit (that rig's neck bone orientation differs from the rig her clips
were authored for); small copper flecks at the neckline; the v1 coat/catsuit builds stay in the job ledger, the
look slots now point at v2. Room: waiting for the user's room photographs.
