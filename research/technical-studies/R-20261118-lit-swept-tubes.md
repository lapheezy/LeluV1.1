# R-20261118-lit-swept-tubes

WP03 · technical-studies · experiment · confidence 0.36

_2026-11-18T20:45:04.566Z_ · commit `4512e946`

**1–3 Mission.** LÉLU 2.1 — geometry fidelity and mathematical validation (WP03)

**4 Observed.** Tube hair needed frames that do not spin along the curve, or the cross-section twists visibly.

**5 Studied.** Discrete elastic rods (Bergou et al. 2008) for the framing language: a material frame described by its angular deviation from the natural Bishop frame, with parallel transport along the centreline and holonomy at closed loops.

**6 Question.** How should a tube's cross-section be oriented along a curl so it does not twist?

**7 Hypothesis.** Parallel transport of the previous frame (minimal rotation) prevents twist without a global up-vector.

**8 Method.** Sweep each strand with parallel transport, elliptical cross-sections and a taper; verify by rendering and by diameter statistics.

**9 Results.** Shipped in src/core/asre/hair/tubes.ts: 1219 strands, diameter CV 0.427, no visible twist artefacts in the front and three-quarter renders.

**10 Evidence.**
- `source` https://doi.org/10.1145/1360612.1360662 — Bergou et al. 2008, ACM TOG 27(3):63
- `code` src/core/asre/hair/tubes.ts — sweepTube / bundleTubes
- `render` artifacts/lelu2/hair/tubes-high/lelu2-tubes-high-head-three-quarter.png — ringlets frame the face

**11 Learned.** Parallel transport solves orientation, not penetration: frames that do not twist still produce roots that sit above the scalp. The framing literature is not a placement solution.

**12 Confidence.** 0.36

**12b Limitations.**
- The full rod dynamics (bending, collision) were not implemented; only the framing was used.

**13 Applications.** Reuse the framing for any swept geometry: baby hairs, laces, cables.

**14 Next questions.**
- Would a collision-aware rod solve the floating roots that framing does not?

**Settles.**
- (nothing declared)

**Assumptions.**
- (none recorded)

**Refutations.**
- (none)

**Tags.**
`hair` `tubes` `parallel-transport` `literature`
