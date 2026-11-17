# PRIMARY SOURCE — canonical reference photographs

These are copies of the photograph set supplied in chat. They are the design
authority for the LÉLU character. Everything in `scripts/foundry/lelu_design.py`
is supposed to be traceable to these pixels, via
`scripts/foundry/reference_sheet.py` -> `foundry/references/reference_sheet.json`.

| file | what it locks |
|---|---|
| `01_front_full_body.png` | silhouette, bodysuit, camo-rose print, harness, balloon pants, platform boots |
| `02_face_closeup.png` | skull, brows, eyes + wing, nose, lips, hairline, hair jewelry, choker |
| `03_back_upper_body.png` | hair mass and braids, hair chains, back harness, sashes, pockets |
| `04_front_apose.png` | proportions, arm/leg lengths, stance |

Rules:
- Never overwrite these with renders, screenshots, or the older jpeg studies in
  `scripts/avatar/references/` (those show a different, superseded look).
- `manifest.json` records sha256, byte size and provenance for each file; check
  a file against it before trusting it.
- If a file is ever lost, restore it from git history of this directory rather
  than re-generating anything.
