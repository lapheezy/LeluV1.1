# R-20261118-lit-sampling-laws

WP02 · research-papers · open · confidence 0.21

_2026-11-18T20:45:04.559Z_ · commit `4512e946`

**1–3 Mission.** LÉLU 2.1 — geometry fidelity and mathematical validation (WP02)

**4 Observed.** The matrix needed a reason to expect a spiral disc law and a blue-noise law to behave differently.

**5 Studied.** Vogel's sunflower construction (1979): the golden angle 137.5° with radius ∝ √n produces equal-area packing on a disc. Bridson's fast Poisson-disk sampling (2007): dart throwing with a background grid gives blue-noise samples at every scale, in O(N).

**6 Question.** What do the sampling laws LÉLU uses actually promise?

**7 Hypothesis.** Equal-area packing and minimum-distance separation are different guarantees, so one law cannot be best everywhere.

**8 Method.** Read the two primary sources and state the guarantee each construction provides; no implementation was changed.

**9 Results.** Vogel guarantees equal area per point on a disc and is not a minimum-distance construction. Bridson guarantees a minimum separation with blue-noise spectrum. Neither makes a claim about an irregular anatomical surface, which is why the hybrid is empirical.

**10 Evidence.**
- `source` https://doi.org/10.1016/0025-5564(79)90080-4 — Vogel 1979, Math. Biosci. 44:179–189
- `source` https://doi.org/10.1145/1278780.1278807 — Bridson 2007, SIGGRAPH sketches

**11 Learned.** The matrix's result is not surprising once the guarantees are separated: the disc has a law, the skull does not.

**12 Confidence.** 0.21

**12b Limitations.**
- Studied from abstracts and the published construction, not from re-implementing both papers.

**13 Applications.** Choose a sampler by the guarantee the surface needs, not by the constant it contains.

**14 Next questions.**
- Would a Bridson variant on the head cloud beat the hybrid at equal n?

**Settles.**
- (nothing declared)

**Assumptions.**
- (none recorded)

**Refutations.**
- (none)

**Tags.**
`sampling` `literature` `vogel` `bridson`
