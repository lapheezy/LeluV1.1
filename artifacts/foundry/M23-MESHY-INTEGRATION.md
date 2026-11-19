# M23 addendum — the Meshy LÉLU we already owned

Branch: `experiment/lelu-2-golden-geometry` (worktree `lelu2/`), on top of the
Foundry commit `e6c5679c`.

> **Correction to the previous report.** `M23-FOUNDRY-REPORT.md` treated the CC0
> parametric mesh as LÉLU's starting point. That was wrong: the project already
> owns a finished Meshy character, and the Foundry never looked for it. This
> document records where it is, what is inside it, why the hierarchy changes, and
> what was actually done in this pass. It also records what was **not** done, so
> nothing below can be read as an improvement that was never applied.

## 1. WP01 — where the character is

| | |
| --- | --- |
| Path | `leluverse/assets/characters/lelu_character/rig/v005_faceshapes_mvwaqbim/lelu.glb` |
| Size | 49,511,140 bytes |
| SHA-256 | `80089844d989c413dd1ce66bf8c70bf11441831e1256ad6854ab28e5db67e2ce` |
| Format | GLB, glTF 2.0 binary, generator `Khronos glTF Blender I/O v4.5.37` |
| Renders of it | `…/v004_headswap_mvvnvqa1/preview_*.png`, `…/v005_faceshapes_mvwaqbim/faceshapes_*.png` |
| Previous version | `v004_headswap_mvvnvqa1/lelu.glb`, 48,585,500 bytes, sha256 `540c4c32a6d9ad830e4c53ccd2e4c380c96524cc16658e6f0149b326ca4df282` |
| Ledger | `leluverse/assets/characters/lelu_character/rig/v001_rigging_01a18f4e/provenance.json` + `AVATAR_3D_REPORT.md` |

Provenance (already spent, **no credits were spent in this pass**):

| Job | Tool | What | Credits |
| --- | --- | --- | --- |
| `fj_mvvfg2o3_ebd9c0` | Meshy | multi-image-to-3D body (ref11 + ref09), 60k tris | 30 |
| `fj_mvvnf4v9_1ded97` | Meshy | auto-rig, 24 joints, walk/run clips | 5 |
| `fj_mvvnvqa1_b5672e` | Meshy | head-and-shoulders bust (ref10 + ref18 + ref19), 8k texture | 40 |
| `fj_mvwaqbim_55226d` | Blender | head swap, eye-only face projection, walk check | 0 |

The first full-body model was withdrawn (its face collapsed in the 60k remesh);
its GLB/FBX are deliberately out of git. 75 credits total, all before this pass.

**Why it was missed.** The Foundry was scoped to `lelu2/` and looked for
reconstruction engines, so it found PCI-FR and the CC0 base. The owned character
lives in the *sibling* `leluverse/` asset tree and is documented in
`AVATAR_3D_REPORT.md`, not in any Foundry manifest. A search for `*.glb` across
the workspace finds it immediately; the Foundry had no such search. That is a
design fault, and `sources.ts` now makes the three sources explicit so it cannot
happen silently again.

## 2. WP02 — what is actually inside it

Measured twice, by two independent readers: `meshy.ts` parses the GLB containers
(`artifacts/foundry/meshy/inspection.json`), and Blender imports the file and
walks the mesh (`artifacts/foundry/meshy/blender.json`,
`scripts/blender/lelu_meshy_verify.py`).

| | value |
| --- | --- |
| Triangles | 224,313 (Blender loop triangles) / 224,155 (glTF indices ÷ 3) |
| Vertices | 443,528 summed over primitives (a shared vertex counts twice, which is what the GPU draws) |
| Meshes / primitives | 7 objects, 6 glTF primitives |
| Materials | 6 — `Material_0`, `Material_0.001`, `eye_patch_l_mat`, `eye_patch_r_mat`, `lelu_mouth`, `lelu_teeth` |
| Textures | 8 embedded JPEG/PNG: 3 × 2048², 3 × 4096², 2 small eye PNGs (121×83, 121×78) |
| UVs | one set (`TEXCOORD_0`) across every primitive |
| Skeleton | `Armature`, **24 bones**: Hips, Left/RightUpLeg, Leg, Foot, ToeBase, Spine/01/02, shoulders, arms, forearms, hands, neck, Head, head_end, headfront |
| Shape keys | **12** ARKit keys, on the head and on both eye patches (36 morph-target entries): blink L/R, wide L/R, jawOpen, smile L/R, frown L/R, browInnerUp, browDown L/R |
| Animation | 1 clip inside the GLB (`Armature\|clip0\|baselayer`); **31** further clip slots on disk under `leluverse/…/animations/` |
| Height | 1.7185 m (Y-up in the GLB, Z-up after import) |
| Head + hair object | 0.7347 m tall |
| Body object | `char1`, 39,166 triangles |

Component breakdown:

| object | triangles | material | shape keys | loose parts |
| --- | --- | --- | --- | --- |
| `char1` (body: skin + outfit + boots) | 39,166 | `Material_0` | — | 22,149 |
| `lelu_head` (head + hair) | 182,555 | `Material_0.001` | 12 | 86,228 |
| `eye_patch_l` | 1,026 | `eye_patch_l_mat` | 12 | 513 |
| `eye_patch_r` | 1,026 | `eye_patch_r_mat` | 12 | 513 |
| `lelu_mouth` | 368 | `lelu_mouth` | — | 158 |
| `lelu_teeth` | 92 | `lelu_teeth` | — | 35 |
| `Icosphere` | 80 | *none* | — | 1 |

Two findings that matter more than the counts:

1. **The hair is thousands of separate shells.** 86,228 loose parts in
   `lelu_head` and 22,149 in the body are not a defect: that is how Meshy builds
   curls and fabric folds. It also answers the separation question — hair *can*
   be split from the head by connectivity, but **not** by material, because hair
   and face share `Material_0.001`. Clothing is fused into the body primitive in
   the same way (one material, no garment objects).
2. **There is a stray `Icosphere`** (80 triangles, no material, 2 m across at the
   origin) inside the asset. It is not visible in renders of the character, but it
   *did* silently break the Foundry's measured-bounds framing on the first
   attempt — the camera framed the sphere instead of the body, and the character
   came out small. The renderer now deletes named stray objects before framing
   (`exclude: ["Icosphere"]`) and the defect is recorded here rather than hidden.

Head-to-body ratio: the honest answer is that it cannot be computed from this
asset as-is. `lelu_head` is 0.735 m because it includes the hair mass; dividing
that by 1.719 m gives 0.43, which is a head-plus-hair ratio and not an anatomical
one. The sheet's canonical ratio is the measurement, not this number.

## 3. WP03 — the three-source hierarchy

`sources.ts` (code) and `artifacts/foundry/sources.json` (data) define it:

| source | file | sha256 | decides | may never decide |
| --- | --- | --- | --- | --- |
| **A — Meshy LÉLU** | `leluverse/…/v005_faceshapes_mvwaqbim/lelu.glb` | `80089844…67e2ce` | body proportions, silhouette, rig, shape keys, animation, topology | face shape, hairline |
| **B — photographs** | `lelu2/reference-39` (39 files) | per-file, 39/39 verified | face shape, skin, brows, lips, eyes, markings, hairline, hair style/strands, head/neck proportions, clothing, jewellery | topology, rig |
| **C — CC0 anatomy** | `lelu2/artifacts/lelu2/m23/youth/lelu2-m23-youth.glb` | `d1483ce9…f4aa2bd` | anatomy scaffold, anatomy reference | face, skin, eyes, hairline, hair style, jewellery, clothing, body proportions |

Precedence is per component (`authorityFor(component)`), not per source. Conflicts
are enumerated in `sources.json`; the hairline one is the clearest: the CC0 build
measures 52.38 mm above the eye line against the photographs' 87.68 mm (−35.3 mm),
so the CC0 mesh's hairline is not used to correct anything.

## 4. WP04 — reconciliation, component by component

`artifacts/foundry/meshy/reconciliation.json` — 10 components, each with the
decision, the evidence files, and `applied`.

| # | component | authority | decision | the short reason |
| --- | --- | --- | --- | --- |
| 1 | face.shape | photographs | **preserve** | only geometry that carries her features; the CC0 face is painted blobs |
| 2 | hairline | photographs | **preserve** | Meshy hair starts on the measured hairline; CC0 is 35.3 mm low |
| 3 | face.eyes | photographs | **preserve** | separate eye patches, 12 blink/wide keys, painted iris/liner/lashes |
| 4 | head.proportions | photographs | **deform** | Meshy identity + CC0 measured interpupillary/jaw: a scale fit, not a rebuild |
| 5 | body.proportions | meshy | **preserve** | the body all 31 clips were authored against |
| 6 | clothing | photographs | **preserve** | coherent, textured, attached; fusing is a separation task, not a rebuild |
| 7 | jewelry | photographs | **preserve** | septum, hoops, rose headpiece, chain are all present; CC0's wire is not |
| 8 | rig | meshy | **preserve** | 24 bones + 12 keys + 31 clips; one rig, one identity |
| 9 | topology | meshy | **deform** | head and eyes already separate; hair/clothing need a connectivity split |
| 10 | anatomy.scaffold | cc0 | **supplement** | measurement scaffold and comparison model only |

**7 preserve, 2 deform, 0 rebuild, 1 supplement. Every verdict says
`applied: false`.** Nothing in this pass changed the asset's geometry, so nothing
in this pass can be called an improvement. A test enforces the `applied: false`
invariant so a future pass cannot quietly flip a decision into a claim.

## 5. WP05/WP06 — one canonical character, registered and versioned

* The canonical LÉLU is **the Meshy asset**, unchanged, registered in the Foundry
  store as project `lelu` version **v0003**: 224,155 triangles, the exact sha256
  above, an immutable copy, and a spec block recording authority, height, joints,
  shape keys, texture sizes and the job chain. `v0001`/`v0002` remain the CC0
  2.3.1 builds; they are not deleted and not overwritten.
* `npx tsx scripts/foundry/run.ts meshy-ingest` is idempotent: it finds the
  version by hash and reports "already present" instead of copying again.
* The Foundry can now load it (`v0003` model path), inspect it (`meshy.ts`), compare
  it (`reconcile`), render it (below), export it (`foundry export`), and keep it
  versioned. What it cannot yet do is *correct* it — that is §8.
* API: `GET /api/foundry/sources`, `GET /api/foundry/meshy` (inspection, Blender
  report, reconciliation, renders), `GET /api/foundry/reconcile`.
* Blender project: `artifacts/foundry/meshy/lelu-canon.blend` is produced by
  `lelu_meshy_verify.py` from the imported GLB, with every armature at rest, the
  full rig, the 12 shape keys and the six materials. It is 125 MB, so it is
  gitignored and regenerated by the command in §7 rather than committed.

Rig and animation compatibility (measured, not assumed):

| check | result |
| --- | --- |
| armature imported | 1 (`Armature`), 24 bones, humanoid naming (Hips…Head, Left/Right limbs) |
| action bound | `Armature\|clip0\|baselayer_Armature` imports and evaluates |
| shape keys | 12 ARKit keys present on `lelu_head` and both eye patches; they survive the import |
| clips on disk | 31 slots; each is a `motion.glb` with bones + clip only (the app loads those, not the 24 MB download) |
| modifiers | armature modifier on every deforming mesh; meshes parented to the rig |
| what breaks | nothing in this pass — the asset is byte-identical to the one the app ships |

## 6. WP07 — the acceptance comparison

`artifacts/foundry/meshy/acceptance/AB-comparison.png` — 5 views × 3 columns.
Every cell was produced by the same Cycles scene, the same lens, resolution,
lights and **the same camera numbers**: the Meshy renders read the CC0
benchmark's own `camera_blender_zup` out of its render report and force it onto
the owned asset, so a framing difference cannot masquerade as a geometry
difference.

| view | photograph | Meshy LÉLU (owned) | CC0 foundry |
| --- | --- | --- | --- |
| front portrait | expression-01 | `meshy/renders/portrait-front.png` | `benchmark/portrait-front.png` |
| three-quarter | expression-03 | `meshy/renders/portrait-three-quarter.png` | `benchmark/portrait-three-quarter.png` |
| side profile | anatomy-01 | `meshy/renders/profile.png` | `benchmark/profile.png` |
| rear | hair-07 | `meshy/renders/rear.png` | `benchmark/rear.png` |
| face close-up | expression-02 | `meshy/renders/face-close-up.png` | `benchmark/face-close-up.png` |

What the sheet shows, plainly:

* **Skin, hair, jewellery, clothing, tattoos and the face all belong to the Meshy
  asset.** Deep warm skin, septum ring, gold hoops, rose headpiece with the quartz
  drop, chain and medallion, roses in the hair, her brows, liner and berry lips —
  the CC0 column has a pale plastic mannequin, a painted tube top and a wire where
  the headpiece should be.
* **The CC0 column's one advantage is resolution of the face mesh** (57k face
  triangles, measured jaw/chin/interpupillary within tolerance); it looks like a
  mannequin because its identity was never in the mesh.
* **The Meshy asset's own defects are visible at this size**: the body texture is
  smeared/stretched across the torso and upper arms, the forearms are thin, the
  hands are soft, the eye patches show their seam under strong key light, and the
  hair reads as a soft mass rather than individual curls at full-body distance.

**Columns C and D do not exist.** "Improved Meshy-based LÉLU" and "final
reconciled character" would require the correction pass in §8 to have been run;
it was not. Rendering the same asset under a new label would be exactly the kind
of fabrication this mission forbids.

## 7. Reproduce every number in this document

```
export LD_LIBRARY_PATH=$HOME/libs/usr/lib/x86_64-linux-gnu
export LELU_TOOLS=$HOME/lelu-tools

npx tsx scripts/foundry/run.ts sources          # three sources, hashes, precedence, conflicts
npx tsx scripts/foundry/run.ts meshy            # GLB inspection (geometry, textures, rig)
npx tsx scripts/foundry/run.ts meshy-ingest     # immutable v0003 baseline in the store
npx tsx scripts/foundry/run.ts reconcile        # 10 component verdicts
npx tsx scripts/foundry/run.ts meshy-render --shots face-close-up,portrait-front,portrait-three-quarter,profile,rear --samples 32
python3 scripts/foundry/acceptance_montage.py   # the 5×3 sheet

$LELU_TOOLS/blender-4.2.23-linux-x64/blender --background --factory-startup \
  --python scripts/blender/lelu_meshy_verify.py -- /tmp/meshy-verify.json
```

`/tmp/meshy-verify.json` is the job shown in `scripts/blender/lelu_meshy_verify.py`'s
docstring, with `output` → `artifacts/foundry/meshy/blender.json` and `blend` →
`artifacts/foundry/meshy/lelu-canon.blend`.

Checks run in this pass: `npx tsc -b --force` exit 0; `tests/foundry.test.ts`
**21/21 pass**, including a synthetic-GLB parse, the per-component authority
table, and the `applied: false` invariant; 5 Mesh renders, 0 failed (9.7–45.1 s
each at 1024²/32 samples, Cycles CPU).

## 8. What this pass did not do

1. **No correction was applied.** The `deform` verdicts (head scale fit, hair and
   clothing separation) are specified but unexecuted. The next pass has to fit the
   head to the measured interpupillary/jaw, split the head's 86,228 loose shells
   into hair vs. scalp by connectivity + position, and split the body primitive's
   garment shells — each as a **new version**, never an edit of v0003.
2. **No texture repair.** The smeared torso/arm albedo is the single most visible
   defect in the acceptance sheet; repairing it needs the UV islands re-projected
   from the photographs, not a filter.
3. **No animation was played.** The 31 clips are inventoried and their rig matches;
   a clip was not evaluated frame-by-frame in this pass. The Foundry renders the
   rest pose on purpose.
4. **No credit was spent, no Meshy API called, no account used.** The asset was
   read from disk.
5. **The app was not driven.** The Foundry's Meshy routes were typechecked and the
   CLI exercised; the chat surface for them was not opened in a live conversation.

## 9. Files, commits

Added: `src/core/asre/foundry/{meshy,sources,reconcile}.ts`,
`scripts/blender/lelu_meshy_verify.py`, `scripts/foundry/acceptance_montage.py`,
`artifacts/foundry/{sources.json,meshy/*}`, `artifacts/foundry/meshy/renders/*`,
`artifacts/foundry/meshy/acceptance/AB-comparison.png`, `meshy/lelu-canon.blend`.
Changed: `scripts/foundry/run.ts` (`meshy`, `meshy-ingest`, `sources`, `reconcile`,
`meshy-render`), `src/core/asre/foundry/render.ts` (`restPose`, `exclude`),
`scripts/blender/lelu_foundry_render.py` (rest pose, stray-object removal),
`plugins/foundryApi.ts` (3 routes), `tests/foundry.test.ts` (+3 tests),
`artifacts/foundry/store/projects/lelu/versions/v0003`.

Commit on `experiment/lelu-2-golden-geometry`; `claude/mission5-lelu-asre-integration-mm6xau`
stays at `55c89aae`.
