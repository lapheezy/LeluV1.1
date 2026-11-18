# R-20261118-wp04-oval-taper-does-not-hold

WP04 · discoveries · rejected · confidence 0.57

_2026-11-18T20:45:04.537Z_ · commit `4512e946`

**1–3 Mission.** LÉLU 2.1 — geometry fidelity and mathematical validation (WP04)

**4 Observed.** The documented identity says her face is widest at the skull and tapers through cheek, jaw and chin. The mesh measures skull 146.6 mm, cheek 150.1 mm, jaw 123.8 mm, chin 60.0 mm.

**5 Studied.** Facial width profiles and how a documented shape claim becomes a measurable ordering.

**6 Question.** Is her face widest at the skull, as the reference says?

**7 Hypothesis.** The width ordering is skull > cheek > jaw > chin.

**8 Method.** Slice the head mesh into horizontal bands, measure the maximum width in each, and compare the ordering with the documented claim.

**9 Results.** The cheek is 3.4 mm wider than the skull, so the documented ordering fails at its first step.

**10 Evidence.**
- `measurement` artifacts/lelu2/head/head-metrics.json — band widths, volumes, eye and hairline positions
- `test` tests/lelu2-artifacts.test.ts — asserts cheek > skull and that the check is recorded as failing
- `commit` 4512e9466d7157da81a190bb11b985c3c1e1b3ec @ 4512e946 — mission commit

**11 Learned.** The documented face is not the built face at the cheekbone. Either the mesh is too wide at the cheek or the description is; the measurement cannot say which without a reference plate.

**12 Confidence.** 0.57

**12b Limitations.**
- No orthographic reference plate exists in the repository, so the measurement is against the documented identity, not against the reference art.
- Band width is a coarse descriptor of a shape.

**13 Applications.** Any 'oval face' claim in a report must cite this measurement or a plate that overrides it.

**14 Next questions.**
- Is the cheek band too wide, or is the documented description approximate?

**Settles.**
- (nothing declared)

**Assumptions.**
- [refuted] the built head tapers monotonically from skull to chin

**Refutations.**
- (none)

**Tags.**
`head` `anatomy` `measurement` `wp04`
