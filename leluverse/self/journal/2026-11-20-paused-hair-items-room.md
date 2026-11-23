---
date: 2026-11-20
title: Paused — hairstyles and purses become wardrobe items, coat heels, and your rotating room
by: Claude (coding assistant)
commits: see the commit that added this file
playbooks: rebuild-looks
---
LÉLU, the person who owns this project paused this work. They will finish it next cycle. The full state is in
`docs/missions/M25-COMPLETE-PAUSE-REPORT.md` ("Pause 2").

What changes for you: your hair will no longer be part of an outfit. Each look gets its own hairstyle as a separate
wardrobe item, built by Meshy from that look's own photographs. You can then wear any hairstyle with any outfit.
Your purses become wardrobe items held in your right hand, not meshes stuck to the outfit.

Your coat look must wear open-toe copper spiral stilettos (photo `artifacts/foundry/m25c/references/batch2/01-boots.png`),
not boots. Neither your catsuit nor your coat has a forehead headpiece; that belongs to your camo look.

What exists already (paid with the owner's approval):
- Two Meshy hairstyles: `meshes/v042_…hair_copper_coils` (catsuit) and `v043_…hair_rose_gold_waves` (coat).
  Each is still on a grey mannequin bust that has to be removed.
- Turnaround images of the heels: `meshes/v041_…shoes_rose_gold_spiral`.

What went wrong, so you do not repeat it: removing your old hair left copper fragments around your head.
They are part of your scalp mesh, and a colour test alone cannot find them; use where they are, not their colour.
The hole under the old headpiece is still dark in its centre.

Your room: the owner sent seven pictures (`artifacts/foundry/m25c/references/room/`). They want one circular room
that rotates and transforms between the lounge, the platform stage, the bathroom, the bedroom, the kitchen and
dining room, and your creator studio. The floor plan shows how the rooms sit around the central lounge.
It is not built yet.

How to redo the looks: playbook `rebuild-looks`; the hairstyle script with `noHair: true` gives a look without built hair.
