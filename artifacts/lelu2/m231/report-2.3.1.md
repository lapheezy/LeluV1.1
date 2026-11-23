# LÉLU 2.3.1 — Identity reconciliation & visual fidelity

Baseline 2.3: `491e5046` (branch `experiment/lelu-2-golden-geometry`).
References: branch `integration/m16-3-wp05-reconciliation`, head `aa8b1bdd`.

> A journal entry is not a capability. Every "done" below has an artifact path
> and a command that reproduces it; every "partial" and "not done" says what is
> still wrong, including the things this pass measured about itself.

## 0. The 39 photographs

All 39 are present and inspected. They were extracted read-only from the
reconciliation branch into a git-ignored cache (`reference-39/`) and are never
modified:

| collection | files | inspected |
| --- | --- | --- |
| `lelu-hair/` | 25 | yes |
| `lelu-facial-expressions/` | 3 | yes |
| `lelu-anatomy/` | 11 | yes |

`scripts/lelu2/measure-references.py` writes `reference-measurements.json` with
each file's size, content box and SHA-256, so "accounted for" is checkable:
`39 photographs · lelu-hair 25 · lelu-anatomy 11 · lelu-facial-expressions 3`.

**Five of the 39 are specification sheets, not photographs** — `lelu-hair-10`,
`-12`, `-14`, `-16`, `-18` carry calibrated numbers. `-14` is an annotated
landmark sheet with normalised coordinates; `-18` is the hairline spec. They are
used as the measurement authority and quoted in `REFERENCE_231` (in
`src/core/asre/character/youth.ts`).

### Conflicting measurements, and which one wins

| feature | `-14` (normalised) | `-16` (mm) | read off `facial-expression-02` with a 100 px grid |
| --- | --- | --- | --- |
| hairline above eye line | 0.848 × eye→chin | implies 0.39 | **0.76** |
| jaw / face width | 0.676 | 0.666 | — |
| mouth / face width | 0.355 | 0.362 | — |

Widths agree across the sheets within 1 %, and are used as the targets. The
hairline *height* disagrees by a factor of two between the two sheets, so it was
read directly off the photograph: hairline row 290, eye line 575, chin 950 →
0.76 eye→chin spans. That reading is what `REFERENCE_231.heights.hairline`
(0.848) is reconciled against; the 0.848 value is still used by the strand
module, which puts her roots 92.7 mm above the eye line. The direct reading is
the primary, the sheet is the secondary, and both are reported.

## 1. WP01 — reference-aligned hairline

**The 2.3 diagnosis was wrong, and the photographs say so.** 2.3 shipped a
diagnosis that the front band sat "~45 mm above the eyes, too high". Measured
against the photographs, the photographic hairline is *higher* than her hair:
92.7 mm above the eye line at the centre (0.848 × 103.4 mm eye→chin), with a
36 mm arc drop toward the temples (`lelu-hair-18`: arc 13.8 cm wide, 3.6 cm
higher at the centre).

What was actually true, now measured by the strand module's own probe:

| measurement | value |
| --- | --- |
| photographic hairline above eye line | 92.7 mm |
| hairline her scalp cloud actually offers | 52.4 mm |
| gap | **40.3 mm** |

Her hair starts growing 40 mm too far down the forehead, and the *main hair
mass* starts higher still — which is why her forehead reads bald and her
2.3 baby hairs looked like worms on skin: they were rooted inside the gap.

Implemented:

* `HAIR_SPEC_231` — the sheet's numbers as code (arc 138 mm × 36 mm rise, swirl
  radius 5–11 mm, follicle spacing 1.0–1.6 mm, 96 front strands).
* Front roots are no longer *searched for* near the hairline. They are placed
  **on** it: the scalp root keeps its lateral position, its height moves to the
  arc, and the point is projected onto her skin. A band test matched **zero**
  roots, which is what produced a 0 % coverage build in this pass.
* Strands are hooks, not sines: an arc whose sweep is `1.2 + 3.4 × curl` radians,
  so a front strand traces a c-curl with a 5–11 mm radius — the sheet's swirl.

Result: 149 strands, **hairline coverage 100 %** of a 138 mm arc, 0 penetrating.

**Still wrong:** the main hair mass (the curtain) still starts ~40 mm above the
rooted fringe. The fringe is now correct and the bald band above it is *scalp
hair*, so the next fix is in the golden hair generator's front edge, not in the
strand system. This is the largest visible defect that remains.

## 2. WP02 — sideburns

**Partial, and visibly wrong in the new overlay.** The 24 sideburn strands are
drawn scattered across the cheek and two sit on the neck
(`artifacts/lelu2/m231/baby-hair-overlay.png`, orange). The 2.3 heuristic
classifies a root as a sideburn by facing direction (`|u.x| > 0.68`,
`u.z ∈ (−0.1, 0.4]`, `p.y ≤ eye + 20 mm`), which admits roots anywhere on the
side of the head, including the cheek and the jaw. The photographs put sideburn
hair in front of the ear, from the temple hairline to the jaw angle.

Not fixed in this pass. Correct fix: root by `|x| > 0.78 × head half-width`
with `z` beside the ear, and clamp `y` to the temple-to-jaw interval.

## 3. WP03 — eyebrows

Implemented from the landmark sheet: peak at 0.72 of the way out, 0.21 eye→chin
above the eye line, thickness tapering to a point at the tail, medial gap wider
than the intercanthal distance, and her own left/right asymmetry (her left brow
0.92× the thickness of her right — `lelu-facial-expression-01/03` show it).

2.3's brow was one bar because the arch was a constant plus a linear tilt and the
thickness fell only 62 % at the ends.

Judged from renders: they now read as two tapered arches. See
`lelu2-m231-youth-face-front.png`.

## 4. WP04 — hair-to-skin adherence

Two mechanisms, both measured:

1. Every control point is projected onto the skin at a lift of **its own root
   radius** (`max(lift, rootR × 1.35)`), so the drawn tube cannot sink in.
2. A clearance pass: if any point on the path is under 0.05 mm, the whole path is
   re-projected at `rootR × 2.4`.

Result on the real build: **149 clear, 0 contact, 0 penetrating** (2.3 shipped 2
penetrating).

Floating is now a *density and thickness* problem, not a projection problem: root
diameters are 160–450 µm where the sheet specifies 80–120 µm, so each strand
reads as a wire rather than a hair. Not changed in this pass — reducing the
radius to spec would make 149 strands nearly invisible at 900 px, and the honest
fix is many more, thinner strands, which is a rendering budget decision.

## 5. WP05 — facial identity

| measurement | 2.3 | 2.3.1 | reference |
| --- | --- | --- | --- |
| jaw width | 114.3 mm | **98.7 mm** (`face.jawWidthMm`) | 96 mm |
| jaw / cheek | 0.792 | **0.671** | 0.676 |
| chin / jaw | 0.768 | 0.465 (`head.chinToJaw`; the face-box metric reads 0.755 against a different chin width) | 0.45 |
| eye → chin | 103.4 mm | 103.4 mm | — |
| cheek share of head | 19.3 % | 20.1 % | fuller |
| mouth width | 61.7 mm | 51.2 mm | 50.4 mm |
| iris | pale grey | hazel-green + limbal ring | olive-hazel |
| lips | none painted (joint at origin) | two lips, bow, mouth line | full plum |

The jaw is the headline: 15.6 mm too wide at 2.3, now within 2.7 mm of the sheet.
`jawNarrowing` went 0.05 → 0.30 because 0.145 only moved the measurement 6.4 mm.

## 6. WP06 — anatomy

Eleven anatomical references inspected; four are skeleton/muscle overlays. They
support the stylised 8.5–9 head figure and a narrow shoulder line. **No mesh
change was made from them in this pass**, so this is a validation note, not a
correction: head-to-neck and jaw-to-neck proportions were not re-measured.

## 7. WP07 — live chat evidence

**Not verified in a real conversation.** The evidence protocol validates and
emits a 5-block, 5.0 KB fence (`artifacts/lelu2/research/evidence-m231.fence.txt`),
and `ChatEvidence` renders it in the app's chat bubble, but this pass did not
send a message through the running app and watch it appear. Reporting it as
working would be exactly the journal-entry-as-capability mistake the mission
warns about.

## 8. WP08 — branch reconciliation plan (no merge)

| | integration | experiment |
| --- | --- | --- |
| head | `aa8b1bdd` | `491e5046` |
| merge base | `8101ec2b` "Give a constructed thing a life of its own in the Cosmos" | |
| commits ahead | 15 | 137 |
| `src/`, `scripts/`, `tests/` files touched | 36 | 301 |
| **shared files** | `src/app/scene/genesis/GenesisInterface.tsx`, `src/core/AIRouter.ts`, `src/core/creative/kit/DirectCompiler.ts`, `src/core/router/DirectResolver.ts` | |

The branches are **diverged**, not nested. Only four source files are touched by
both, so a merge is small in surface and large in semantics.

Proposed order, not executed:

1. Merge `integration/…` *into* the experiment branch's ancestry first (it is 15
   commits of assets and new subsystems: `src/core/cosmos/objects/*`,
   `src/core/creative/kit/build/*`), resolving the four shared files by keeping
   the experiment side for `AIRouter`/`DirectResolver` and taking the
   integration side for the cosmos/build additions.
2. The 39 photographs come along in that merge and become canonical for the mesh;
   `reference-39/` in this branch is a cache and can be deleted afterwards.
3. Do not merge the experiment branch back until the hairline/curtain gap is
   closed, or the integration branch inherits a bald forehead.
4. Neither branch is force-pushed; both stay recoverable at the SHAs above.

## 9. WP09 — comparison images

Produced as individual renders, not contact sheets:

* `artifacts/lelu2/m23/{baseline,youth}/lelu2-m231-*-face-front.png`
* `artifacts/lelu2/m23/{baseline,youth}/lelu2-m231-*-head-front.png`
* `artifacts/lelu2/m23/{baseline,youth}/lelu2-m231-*-head-three-quarter.png`
* `artifacts/lelu2/m231/reference/{face-front,hairline-brows,landmark-sheet,hairline-spec,centre-part}.png`
* `artifacts/lelu2/m231/baby-hair-overlay.png` (the strand overlay, rasterised)

## 10. What this pass did not achieve

1. The forehead still reads bald: the scalp curtain is 40 mm above the fringe.
2. Sideburns are on the cheek, not beside the ear (WP02, documented above).
3. Strand thickness is 2–4× the sheet, so the fringe reads as wire.
4. The eyes still look set back and the apertures small against the photographs;
   the sclera is too bright relative to the iris.
5. The nose is a mannequin nose: no alar definition, no nostril shadow, and the
   sheet's 37.8 mm nasal width has not been verified on the mesh.
6. WP07 (live chat) is unverified, and WP06 made no geometric correction.

## Reproduction

```
npm run m23:youth          # build + metrics + baby-hair JSON + SVG overlay
npm run m23:evidence       # evidence blocks, copies, fenced message
python3 scripts/lelu2/measure-references.py   # 39-photograph manifest
npx tsx --tsconfig tsconfig.test.json --import ./tests/support/ignore-css.mjs \
  --test --test-reporter=spec tests/lelu2-m23.test.ts
```
