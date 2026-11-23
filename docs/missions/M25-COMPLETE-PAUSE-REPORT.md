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


---

# Pause 2 (2026-11-20): hair and purse as wardrobe items, coat shoes, her room

Paused again at the owner's request ("Pause this for now here and commit… we will finish on the next cycle").

## What the owner asked for this cycle
- **Coat (rose_gold_sovereign) shoes are wrong.** They must be the open-toe copper spiral stilettos from `references/batch2/01-boots.png`.
  The catsuit shoes are correct, but her toes are hard to see.
- **Hair is a separate wardrobe item per look**, made by Meshy from that look's own shots, so she can change hairstyles. Meshy use was approved.
- **The purse is an attachment** (a wardrobe item on her hand), not part of the outfit mesh.
- **No forehead headpiece** on the catsuit or the coat.
- **Her room:** one circular room that rotates and transforms between seven versions
  (`references/room/01-lounge … 07-studio`: lounge, stage/platform, top-down floor plan, bathroom, bedroom, kitchen/dining, creator studio).
  Not started.

## Done (paid Meshy, approved), downloaded, not yet fitted
- `v039`/`v040`: image-to-image hair references (catsuit coils, coat waves).
- `v042_multi-image-to-3d_hair_copper_coils` and `v043_multi-image-to-3d_hair_rose_gold_waves`: 3D hair on a mannequin bust.
  The FBX copies were deleted; the GLB is kept and its checksum is in provenance.json.
- `v041`: turnaround views of the open-toe spiral heels (`view_01a1f5d7_0.png`). No 3D build yet.

## In progress: bald base looks (`artifacts/foundry/m25c/v5/`, `steps/look5-*.glb`). NOT registered.
- `noHair` in `scripts/blender/lelu_m25c_hairstyle.py` gives a look with no built hair. All old-hair faces are removed from `lelu_hair`; the face jewels and lips stay.
- **Open defect 1:** copper hair fragments are still around the head. They belong to the `lelu_scalp` mesh, not to `lelu_hair` and not to the outfit body. The colour filter (dark only) misses them; they need a geometric filter (an ellipsoid fitted to her head, or one connected component).
- **Open defect 2:** the forehead hole patch is now skin-coloured at its rim, but its centre is still dark. See `v5/*-bald-face.png`.

## Next cycle, in order
1. Clean the bald base (both defects above), then register the looks without hair and without the purse.
2. Hair items: align the v042/v043 mannequin head to her head, delete the mannequin faces, and export in the Head-bone frame.
   Register them in the Forge wardrobe (slot `hair`, bone `Head`).
3. Purses: export the v023 lotus bag and the v024 linework bag as `RightHand` items.
4. Coat shoes: build 3D from the v041 turnaround (multi-image-to-3d, approved), fit to the coat look's feet, and skin to the legs. Render with her toes visible. Improve toe visibility on the catsuit too.
5. Her rotating room from `references/room/`.
