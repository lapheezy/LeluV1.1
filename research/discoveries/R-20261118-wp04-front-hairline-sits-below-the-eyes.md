# R-20261118-wp04-front-hairline-sits-below-the-eyes

WP04 · discoveries · rejected · confidence 0.51

_2026-11-18T20:45:04.544Z_ · commit `4512e946`

**1–3 Mission.** LÉLU 2.1 — geometry fidelity and mathematical validation (WP04)

**4 Observed.** The documented identity describes a centre part with the hairline above the brow. The front hairline measures -49.7 mm relative to the eyes — i.e. 49.7 mm BELOW them.

**5 Studied.** Hairline placement as a landmark ratio, and how a root set's front extent is measured.

**6 Question.** Is the front hairline above the brow?

**7 Hypothesis.** The lowest front hair root is above the eye line.

**8 Method.** Measure the minimum Y of front-facing hair roots in the built asset and compare it with the eye centre Y.

**9 Results.** Front hairline at -49.7 mm above the eyes (negative = below); 928 strands.

**10 Evidence.**
- `measurement` artifacts/lelu2/head/head-metrics.json — hairline vs eye landmark
- `render` artifacts/lelu2/hair/tubes-high/lelu2-tubes-high-head-front.png — the front hairline is visibly low and sparse
- `commit` 4512e9466d7157da81a190bb11b985c3c1e1b3ec @ 4512e946 — mission commit

**11 Learned.** The low front hairline and the sparse front render are consistent with each other and with the root set, not with the description. The image and the measurement agree; the prose does not.

**12 Confidence.** 0.51

**12b Limitations.**
- 'Above the brow' has no numeric definition in the documentation, so the comparison uses the eye line.

**13 Applications.** Front-hairline placement is now a measured landmark, so it can be fixed and re-measured.

**14 Next questions.**
- Should the front root band be raised, or the forehead shortened?

**Settles.**
- (nothing declared)

**Assumptions.**
- [refuted] the built hairline sits above the brow

**Refutations.**
- (none)

**Tags.**
`head` `hairline` `landmark` `wp04`
