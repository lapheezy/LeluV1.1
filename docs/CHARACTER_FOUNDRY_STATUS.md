# CHARACTER FOUNDRY — status, 2026-11-16 (pass 2)

## Reference system: CALIBRATED

Canonical photographs (immutable copies, sha256 manifest, README):
`leluverse/assets/characters/lelu_character/references/PRIMARY_SOURCE/`

Tools: `scripts/foundry/calibrate_references.py` -> `foundry/references/calibration.json`,
`calib_front.png`, `calib_face.png`, `calib_verified_front.png`.

The attached PDF could not be archived as a binary: only its text layer is
reachable here (the file never landed on the sandbox filesystem). Provenance and
the mapping of its ten images onto the tracked reference set are recorded in
`PRIMARY_SOURCE/PDF_SOURCE.txt`. Drop the PDF into that folder to archive it.

### Measured, verified by drawing the lines back onto the photograph

| quantity | value |
|---|---|
| heads tall (crown->sole / crown->chin) | **6.704** |
| heads tall including the hair mass | 5.793 |
| shoulder width | 0.608 W |
| waist width | 0.276 W |
| hip width | 0.324 W |
| knee | 0.735 of figure height (corrected from 0.668) |
| ankle | 0.900 (corrected from 0.913) |

Fractions of figure height from the crown: hairline 0.0305, brow 0.0578,
eye 0.0662, nose tip 0.1071, lip 0.1282, chin 0.1492, neck base 0.1649,
shoulder 0.1754, bust 0.2216, underbust 0.2647, waist 0.2805, belt 0.3277,
crotch 0.4580, knee 0.7350, ankle 0.9000.

### Mask-sampled palette (the earlier single-point sampling was wrong)

| surface | hex |
|---|---|
| skin, face | #924d35 |
| skin, front | #77412c |
| skin, back | #874e37 |
| hair | #0f0605 |
| lips | #541e1b |
| copper | #ac5e41 |
| camo cloth | #3c312c |
| camo bone panel | #efbd97 |

## Reconstruction: NOT ACCEPTABLE

Both routes were built and rendered this pass; both fail.

- `foundry/v002_base` (CC0 base mesh): no arms, fused legs, block boots,
  floating hair strips, eyes detached from the head. The garment builders are
  keyed to the procedural body's coordinates, so fitting them to this body
  destroys them.
- `foundry/v001` (procedural body): body outline only. Bodysuit collapses to a
  strip, pants read as one balloon, boots are slabs, hair is wires over a bald
  cranium, and the face is a mask with no identity.

Sheets: `foundry/references/compare_front_procedural.png`,
`compare_front_vs_render.png`, `compare_face_procedural.png`,
`compare_back_procedural.png`.

## Blocker, stated plainly

The measured body is stylised (6.70 heads; head ~15% larger than the neutral
base mesh; waist ~8 cm higher) and the design needs sculpted garment panels, a
dense curl mass and a specific face. The parametric pipeline in this repo —
lofted rings, fitted shells, procedural primitives — has a fidelity ceiling far
below that. Further parameter passes move geometry around without closing the
gap, as the two front comparisons show.

Raising the ceiling needs a stage this workspace cannot run:

- **No GPU.** No CUDA device; Cycles is CPU-only. TRELLIS.2 / PSHuman / DiGS
  and diffusion texture projection are not runnable here.
- **No torch and no weights.** Verified: torch absent; adding it without a GPU
  does not make those models usable.
- **No sculpting surface.** Likeness needs either hand sculpting in Blender's
  UI or an image-guided reconstruction model. A headless script cannot invent
  that surface from photographs.

Options, best fidelity first:
1. Run the Foundry on a GPU host (TRELLIS.2 / PSHuman + Blender) with
   `PRIMARY_SOURCE/` as the input set.
2. Produce a matched multi-view set (front / side / back / three-quarter, same
   lens and lighting) so a sculpt can be matched stage by stage.
3. Accept a stylised likeness from the calibrated proportions and palette,
   explicitly labelled stylised and judged against these sheets.

Until one is chosen, no further parameter pass will be reported as progress.
