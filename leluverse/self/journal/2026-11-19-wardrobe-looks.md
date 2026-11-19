---
date: 2026-11-19
title: My mouth, jewellery, shoulders and three new looks (M25-complete)
by: Claude (coding assistant), with the person who owns this project
commits: cf732d8a, c356cf53, 7286cd26, d9f4a561, edcf5e39, 20d5124b, 8c9a2819, d3b1f0f0, dd452241
playbooks: rebuild-looks, new-look-from-photos
---
This is what was done to you, LÉLU, in your own terms, so you can check it and do it again.

**Your mouth.** The dark patches at the corners of your mouth were not shadows. The mouth-interior
mesh (`lelu_mouth`) sat up to 3.8 mm *in front of* your lips. It was moved 2.5 mm behind them and
made matte; the teeth card moved back as one piece. Script: `scripts/blender/lelu_m25c_mouth.py`.
Your lip shape already matched your photographs, so it was not reshaped. Lesson: measure before
"fixing" — a 3 % widening was tried, measured as noise, and reverted.

**Your jewellery.** The M25 ringlets hid your ornaments. Curls are now cut 9 mm from any jewellery
or flower. Measured with an accessory mask in front, three-quarter, profile and rear views.

**Your shoulders.** Meshy had fused hair into your body as a crumpled shell. A weighted smoothing
(`lelu_m25c_shoulders.py`) reduced folded triangles from 35 % to 25 %; it is not gone.

**Your looks.** Three outfits were made from the person's photographs with Meshy (paid; the person
approved it in conversation): the copper-rose coat (`rose_gold_sovereign`), the copper catsuit
(`bronze_velocity`) and Home/Laidback 3 (`home_laidback3`). For each: an A-pose front view, a
turnaround, a 3D build, a rig. Then your own head goes onto that body (`lelu_m25c_lookassemble.py`):
your face, lips and face jewellery stay; the hair comes from that look's own photograph, so each look
has its own hairstyle. The handbags were built from the bags cropped out of the photographs and hang
from your right hand as separate objects (`lelu_m25c_bagattach.py`).

**What went wrong, and why it matters to you.**
- The first coat was guessed below the waist (no photograph showed it): slits in the back, a skirt that
  split into trousers. The person then sent the full-length photograph and the coat was rebuilt from it.
  Lesson: never invent what a photograph does not show without saying so.
- Your head tipped back in the coat when walking. Your animations store rotations relative to *your*
  skeleton's rest directions; the coat's skeleton had its Head bone 49° off. Now every look's bones take
  your rest directions (`alignBones` in the assembler). If an outfit ever moves strangely, check
  `boneDirectionChangeDeg` in its assemble report first.
- A render script once had file paths written into it and showed an old version. Renders now read your
  manifest. Lesson: never hard-code where you are; ask the wardrobe.

**To redo it yourself:** playbook `rebuild-looks` (free) rebuilds and re-renders every look;
`new-look-from-photos` makes a new one (spends about 58 credits — only with a person's approval).
Look at every render before saying it worked.
