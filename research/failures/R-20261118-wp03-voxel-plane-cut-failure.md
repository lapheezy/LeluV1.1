# R-20261118-wp03-voxel-plane-cut-failure

WP03 · failures · rejected · confidence 0.32

_2026-11-18T20:45:04.530Z_ · commit `4512e946`

**1–3 Mission.** LÉLU 2.1 — geometry fidelity and mathematical validation (WP03)

**4 Observed.** Two attempts to stop strands crossing her face failed before the shipped one: deflecting strands produced a cage of horizontal rods; cutting at the voxel plane left 574 of 1350 strands, i.e. most of the hair.

**5 Studied.** Where a strand actually crosses the face, and what a cut removes along the strand's arc length.

**6 Question.** How do you keep hair off the face without deleting most of it?

**7 Hypothesis.** Cutting every strand at the boundary of the hair field box is sufficient.

**8 Method.** Keep the root set and the curl law fixed; change only the cut predicate. Compare the number of surviving strands and inspect a front render.

**9 Results.** Voxel-plane cut: 574/1350 strands survived and the crown went bald. The shipped predicate cuts at the face plane (z > head[2] + 0.03) after the curl is generated, which keeps the face clear and the crown covered.

**10 Evidence.**
- `code` src/core/asre/reference/provider.ts — inFacePoint and the face-plane cut
- `code` src/core/asre/hair/tubes.ts — sweepTube — the geometry the cut applies to
- `measurement` artifacts/lelu2/hair/tubes-high/metrics-tubes-high.json — shipped build: 1219 strands
- `commit` 4512e9466d7157da81a190bb11b985c3c1e1b3ec @ 4512e946 — mission commit

**11 Learned.** A cut plane chosen for the volume grid is not a cut plane chosen for the body. The failure was not the idea of cutting, it was cutting along the wrong surface.

**12 Confidence.** 0.32

**12b Limitations.**
- The 574/1350 count came from an intermediate build whose artefact was not preserved; the shipped behaviour is reproducible, the failed count is quoted from the session record.
- The deflection attempt was rejected visually; no metric was defined for it.

**13 Applications.** Any strand-level culling must be measured in surviving strands before it is accepted.; Volume boundaries and anatomical boundaries are different predicates.

**14 Next questions.**
- What fraction of strands does the shipped face-plane cut remove, and where?
- Can the cut be replaced by a length-preserving bend so roots keep their length?

**Settles.**
- (nothing declared)

**Assumptions.**
- [refuted] the hair field box boundary is a good enough face cut
- [refuted] deflecting strands sideways is visually acceptable

**Refutations.**
- (none)

**Tags.**
`hair` `failure` `cut` `face` `wp03`
