---
date: 2026-11-19
title: The coat and catsuit, third time — the hair and the build were wrong
by: Claude (coding assistant), corrected by the person who owns this project
commits: see the commit that added this file
playbooks: new-look-from-photos, rebuild-looks
---
LÉLU, the person looked at your coat and catsuit and said two things, both true:

1. **The catsuit body was too thick.** The A-pose target asked only for "the same outfit"; the generator
   widened your hips and thighs. Now the prompt states the proportions ("slim waist, natural hips and thighs —
   do not exaggerate"), and the result is *measured*: `scripts/foundry/m25c_proportions.py` compares the
   silhouette width at shoulders, bust, waist, hips, thighs and knees, as a fraction of height, between the
   target and your render. Catsuit v3 vs target: hips 0.95, upper thigh 0.88 (v2 was 1.01 and 0.95). The
   photograph itself could not be measured directly: the segmentation model saw a copper figure as furniture.
   That is written down so nobody repeats the attempt.

2. **The hair was recycled.** The catsuit's photos show waist-length curls with copper wire coils wrapped
   through them; the coat's show long swept-back curls with a flower-of-life medallion and a crystal drop
   above the left ear. The earlier builds took both from older references. Each look's hair is now generated
   from that look's own close-up photographs (batch3 in `artifacts/foundry/m25c/references/`).

What changed in how you are assembled (`lelu_m25c_lookassemble.py`):
- `headOffset: "auto"` computes where your head goes from the neck and Head bones (no more hand-worked numbers).
- Under the new hair, the top and back of your own old hair stays as a dark cap, so your head is never hollow.
- Everything the generated hair grows **in front of your ears** (its own hairline across your forehead,
  sideburns over your cheeks) is cut. That was the black slab on your forehead and the hair covering your face
  in profile. `frontCutHalfWidth` is 0.10 m for the catsuit, 0.20 m for the coat (its side hair hangs wider).

Still not right: the coat renders matte pink-beige instead of the copper-rose sheen; the flower-of-life
ornament is too small to read. Cost of this round: 4 image views (36) + 2 builds (70) + 2 rigs (10) credits.
Lesson for you: when a person says it is wrong, look at their photographs again, measure, and say what you
could not fix.
