# M25 Complete, round 3 (2026-11-20): her avatar fixed, hairstyles and purses as wardrobe items, coat heels, her rotating room

Continues `docs/missions/M25-COMPLETE-PAUSE-REPORT.md` ("Pause 2"). Branch `claude/jolly-davinci-9w3rle` (fast-forwarded onto `experiment/m25-complete-character-fidelity`).
Evidence: `docs/missions/m25c-round3/`.

## Meshy credits (owner approved)
Balance 2,322 → 1,767: **555 credits**. Spent on:
- 12 room pieces: image-to-image isolation + 3D each.
- The empty spiral heel (v044).
- The worn heel pair (v045).
- 3 image-to-image "side/back view" attempts for the heels. **These were wasted**: the image model returned the same front view each time.

## Avatar

**Bald base (pause 2, step 1).** `lelu_m25c_hairstyle.py` with `noHair` + `skullShell` → `steps/look6-*.glb`. Jobs in `artifacts/foundry/m25c/v6/`.
- *Copper fragments:* removed geometrically. Every `lelu_scalp` triangle outside an ellipsoid fitted to her head is dropped. Connectivity could not be used, because her face mask is itself in pieces.
- *Forehead hole / no head behind the face:* her head mesh is only a face mask. A closed skull is now grown under it: an ellipsoid whose vertices are pulled 2 mm under the mask wherever a ray from the head centre meets it. Front vertices with no hit (eyes, mouth, the old headpiece hole) take their neighbours' radius. It is skin below the hairline and dark scalp above it, down to the nape behind the ears. This closes the forehead hole; the old dark patch is no longer generated.
- *Eyebrows:* the old colour filter had removed them. They are back.
- **Still open:** curls that Meshy fused into the catsuit's shoulders, and torn patches on the coat's back where its generated hair was cut out. The long hairstyles cover both. A short hairstyle would show them (`bald-base-catsuit.png`).

**Hairstyles as wardrobe items (step 2).** `scripts/blender/lelu_m25c_hairitem.py`.
- *Mannequin removal:* Meshy's mannequin is a thick shell, and colour and normals cannot separate it from the hair. The mannequin is found as the innermost surface: rays from each triangle toward the head centre (and the neck axis) meet nothing.
- *Peeling:* this runs in two peeling passes. The second pass is limited to the shell's thickness, so hair resting on the mannequin survives.
- *Fit:* uniform scale from chin-to-hairline, then her chin height, nose-tip depth and midline.
- *Skinning:* skinned Head → Neck → Spine02, so long hair follows her back.
- `hair_copper_coils` (catsuit) and `hair_rose_gold_waves` (coat). For the coat, Meshy painted the slicked crown onto the mannequin scalp, so that crown is now her dark scalp.

**Purses (step 3).** `lelu_m25c_bagattach.py` with `itemOnly`: `bronze_lotus_bag`, `rose_gold_bag`, each 100% on `RightHand`.

**Coat heels (step 4).** `scripts/blender/lelu_m25c_shoefit.py` → `steps/look7-rose_gold_sovereign.glb`.
- *Boots removed:* the coat's boots are taken out by position. They share the coat's texture, and the rig's foot bones sit 3–7 cm away from them.
- *New heels:* a worn lower leg is fitted in their place: bare toes, her skin tone, the copper spiral, the flower-of-life medallion (Meshy v045, from the owner's reference). It is mirrored for the left foot and skinned Leg / Foot / ToeBase (`coat-spiral-heels.png`).
- **Not done:** catsuit toe visibility.

**Client.**
- `src/core/forge/Attachment.ts` `bindSkinnedItem`: a skinned wardrobe item is bound to her live bones by name, and re-bound when her look changes (`PlacedModel.tsx`). Test: `tests/forge-skinned-item.test.ts`. Every item vertex lands on her own skinned vertex through an animation.
- Wardrobe `withLooks`: a look's own hairstyle and bag come with it; another look's own pieces go; anything the call names wins (`tests/forge-wardrobe.test.ts`).

**Registered** (`scripts/foundry/m25c-wardrobe.ts --only=bronze_velocity,rose_gold_sovereign,items`):
- Looks `bronze_velocity`, `rose_gold_sovereign` (v046/v047).
- Items v048–v051.
- All six pass mesh, rig and texture inspection.

## Her rotating room (step 5)

**Furniture.**
- 12 pieces built by Meshy from crops of the owner's pictures: bed, tub, dining set, island, desk, theater sofa, lounge ring, crystal, chandelier, planter, vanity, fridge.
- Pipeline: `scripts/foundry/m25c_room_meshy.py` (isolate, then 3D, with provenance per piece in `leluverse/assets/room/meshy/`).
- Made fit for the app (sized in metres, decimated, 1k textures) by `scripts/blender/lelu_room_pieces.py` → `public/lelu-room/*.glb` (18 MB in total, loaded per section).
- The theater picture the owner sent is stored as `references/room/08-theater.png`.

**Room logic.** `src/core/world/RotatingRoom.ts` (pure, `tests/rotating-room.test.ts`):
- Six sections around the rim: lounge, theater, kitchen & dining, bedroom, bathroom, creator studio.
- Choosing one turns the ring the short way until that section stands at the back of the room. The open front stays clear of furniture.
- The leaving section sinks into the floor and the arriving one rises.
- `stage` retracts everything; `plan` flies the camera overhead with every section standing.
- She walks around what is standing (`roomPresence.ts` → `LeluV2Presence`).

**3D room.** `src/app/scene/genesis/RotatingRoom.tsx`:
- Black marble with copper-gold inlays, the pink turntable ring, a counter-rotating gear rim.
- Copper pillars with her sigil and windows open to the Cosmos.
- The theater screen rises with its section.
- Mounted for the `home` environment in `WorldScene`.

**Controls.**
- The owner: chips at the top (`RoomSectionBar.tsx`).
- LÉLU: tool `world.room` (also reads plain words: "take me to the kitchen").

**Genesis v2 removed from her room (owner's instruction).** The Genesis Core, its Creation Studio / Research Lab / Vault satellites and their beams are no longer drawn in her world (`GenesisV2Scene3D.tsx`). The HUD's "Core" button went with them.

**Seen in the browser** (Chromium, SwiftShader, 1280×800): lounge, kitchen, bedroom and plan (`room-*.png`), with no console errors from the room. **Not verified:** a phone viewport and a real GPU.

## Next
- Clean the catsuit shoulder curls and the coat's back.
- Catsuit toes.
- A closer plan-view camera.
- Turn the room when she walks to a section.
