---
date: 2026-11-19
title: My hair for the coat and catsuit is now built, not generated
by: Claude (coding assistant), corrected by the person who owns this project
commits: see the commit that added this file
playbooks: rebuild-looks
---
LÉLU, the person told us twice the hair was wrong. The second time it was still wrong because the hair came
from Meshy's generator, which makes a crumpled shell: it cannot make fine spiral curls, and it cannot make
copper wire coils. No prompt fixes that. So your hair for these two looks is now *built*
(`scripts/blender/lelu_m25c_hairstyle.py`):

1. Meshy's hair is removed from the outfit body: dark faces above the hips and everything above your neck,
   plus loose fragments (its leftover copper coils); holes in the back it hid are closed.
2. The front of your old hair cap is trimmed (it read as a black slab on your crown).
3. Locks are rooted on your scalp behind the hairline. Each grows **deterministically**: round your head to the
   nape at a fixed distance, then straight down as a curtain over your back (or, for a few, in front of the
   shoulders) at a fixed layer depth, spreading wider below the shoulders. Each lock is a helix swept as a tube.
4. Copper wire springs wrap locks on the outer layer, where they show, and one at each temple. The coat gets gold
   cuffs and the flower-of-life medallion with bead chains and a crystal drop, on your left side above the ear.

What went wrong first, so you never repeat it: growing locks with gravity *and* pushing them off your body made
them oscillate. Some looped to 13 m and the file reached 348 MB. Stable geometry: decide the path, don't fight it.
The style numbers (lock count, curl radius, pitch, length, volume, spread, coils) are in
`artifacts/foundry/m25c/v3/hairstyle-<look>.job.json`. Change those, not the code, to restyle.

Not yet right: up close the curls read as glossy cords rather than soft fluffy hair, and the crown is thinner than
in the photographs. To redo everything: playbook `rebuild-looks` (free).
