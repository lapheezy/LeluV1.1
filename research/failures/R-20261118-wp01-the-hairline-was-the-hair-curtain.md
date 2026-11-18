# R-20261118-wp01-the-hairline-was-the-hair-curtain

WP01 · failures · verified · confidence 0.93

_2026-11-18T22:30:58.448Z_ · commit `761d01c8`

**1–3 Mission.** LÉLU 2.3 — autonomous learning, visual creation and identity reconstruction (WP01)

**4 Observed.** The 2.1 contract reported a front hairline ~100 mm below her eye line, with 0 % front coverage, and the first 2.3 baby-hair run produced 88 strands — sideburns and flyaways only, no front strands and no temple strands.

**5 Studied.** Root clouds vs hairline geometry: what a scalp root cloud actually contains, and why a global minimum of a cloud that includes hanging hair cannot be a forehead edge.

**6 Question.** Why did the baby-hair system place no strands on the forehead, and what is the real front hairline?

**7 Hypothesis.** The scalp has no front roots, because her hairline is too high.

**8 Method.** Dump the root distribution and the report's own `available` counts, then classify every root by its direction from the head centre and re-measure the hairline on the forehead band only.

**9 Results.** Hypothesis refuted. The front roots exist; they were never in the band. After classifying by facing, the run produced 88 strands (36 front, 24 temples, 12 sideburns, 16 flyaways) with 100 % front-hairline coverage.

**10 Evidence.**
- `measurement` artifacts/lelu2/m23/baseline/metrics-baseline.json — the run with no front strands, and the root cloud that produced it
- `measurement` artifacts/lelu2/m23/youth/baby-hair-youth.json — every strand's record, with its landmark distances
- `measurement` artifacts/lelu2/m23/youth/baby-hair-youth.svg — the placement overlay drawn from those records
- `test` tests/lelu2-m23.test.ts — the baby-hair guards
- `commit` 761d01c88633c664a376bd8605a351df3a626287 @ 761d01c8 — mission commit

**11 Learned.** A scalp cloud is not a scalp: it contains the hairstyle. Any hairline measurement must be taken on the FRONT band by facing, or it measures hair hanging beside the jaw.

**12 Confidence.** 0.93

**12b Limitations.**
- The fix is a classification of roots the asset provides; it cannot invent forehead coverage where the hair card has none.
- 2 of 88 strands still report a skin collision and are drawn in red in the overlay.

**13 Applications.** Every hairline figure in future reports must state which band it was measured on.; The same facing classification places temples and sideburns.

**14 Next questions.**
- Why do a few temple strands penetrate the skin even after projection?
- Does the hair card's own coverage hide a real gap at the crown?

**Settles.**
- Why did the baby-hair system place no strands on the forehead?

**Assumptions.**
- [refuted] the lowest front root is the forehead hairline
- [refuted] the scalp cloud contains no roots on the forehead

**Refutations.**
- (none)

**Tags.**
`hairline` `baby-hair` `measurement` `failure` `wp01`
