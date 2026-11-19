# M25 Complete — paused (hair and headpiece work in progress)

Paused at the owner's request. Branch `experiment/m25-complete-character-fidelity`.

## What is live in her wardrobe (unchanged by the paused work)
`look:camo_repaired`, `look:bronze_velocity` (v037), `look:rose_gold_sovereign` (v038), `look:home_laidback3` (v030).
v037/v038 carry the first built (tube) hairstyle: waist-length curls, copper coils (catsuit), medallion (coat).
They still have the camo look's forehead headpiece, which neither the catsuit nor the coat photographs show.

## Work in progress, NOT registered (files in artifacts/foundry/m25c/steps/, renders in artifacts/foundry/m25c/v4/)
- **Headpiece removal** (`dropJewelBoxes`, `inpaintBoxes` in `scripts/blender/lelu_m25c_hairstyle.py`):
  the jewel faces are pressed flat onto the forehead and given skin; the painted chain line and markings are
  inpainted from surrounding skin (OpenCV, a new packed texture; the original is untouched).
  **Open defect:** her original face mesh has a real hole under the jewel. The patch that closes it
  (`lelu_forehead_patch`) still renders as a dark disc. Last change (patch depth from the skin rim around the
  hole) was interrupted before it was rendered.
- **Catsuit hair to the new profile photo** (`references/batch3/05-catsuit-hair-profile-2.png`): longer (past
  the hips), crown coils, longer hanging springs. Tried: finer curls (read as braids, reverted), a straight
  filler layer (reads as strings, off). Current renders: right length, but a lump at the crown, curls fanning
  at the shoulder, face/cap fragments beside the cheek.

## The decision waiting for the owner
Tube-built curls have reached their limit; photo-like soft curls need real strand hair (Blender hair curves),
which renders well but cannot go into the GLB the app loads. Options offered: real strands + baked hair cards
for the app; real strands for renders only; or keep tubes and fix the listed faults.

## Credits
This session's Meshy balance: 2,454 at last check. Nothing was spent in the paused work.
