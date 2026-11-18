# R-20261118-wp07-silhouette-of-the-hair-swap

WP07 · experiments · verified · confidence 0.90

_2026-11-18T20:45:20.295Z_

**1–3 Mission.** LÉLU 2.1 — geometry fidelity and mathematical validation (WP07)

**4 Observed.** Front renders of voxel and tubes-high hair, same camera: silhouette IoU 0.8931, coverage 61.35% → 59.34%.

**5 Studied.** What changes in the silhouette when the hair surface is replaced, and which changes are visible rather than measured.

**6 Question.** Does the tube hair change the silhouette, and where?

**7 Hypothesis.** The change is confined to detail and the outline stays the same.

**8 Method.** Decode both PNGs, take the background from the corners, build a foreground mask, and compare coverage, third profile, bounds and IoU.

**9 Results.** crown / upper third coverage fell 7.0 percentage points silhouette bounds moved by (0, 54) → (0, 0) px

**10 Evidence.**
- `measurement` artifacts/lelu2/research/visual-voxel-vs-tubes.json — full comparison
- `render` artifacts/lelu2/hair/voxel/lelu2-voxel-head-front.png — voxel front
- `render` artifacts/lelu2/hair/tubes-high/lelu2-tubes-high-head-front.png — tube front
- `test` tests/lelu2-artifacts.test.ts — the same comparison is asserted in the test suite

**11 Learned.** The outline moves at the top of the frame: the tube version loses upper-third coverage. That is consistent with the sparse crown seen in the render and with the 54 roots beyond 4 mm — three independent observations of the same defect.

**12 Confidence.** 0.90

**12b Limitations.**
- A 2D silhouette cannot show geometry intersections or scalp penetration; those need the mesh and the clearance measure.
- One camera angle only.

**13 Applications.** Any hair change now has a measured before/after silhouette, not an opinion.

**14 Next questions.**
- Does the upper-third loss disappear if the front roots keep their full length?

**Settles.**
- (nothing declared)

**Assumptions.**
- (none recorded)

**Refutations.**
- (none)

**Tags.**
`visual` `silhouette` `hair` `wp07`
