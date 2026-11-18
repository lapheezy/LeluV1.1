# R-20261118-wp03-root-diagnostics-disagree

WP03 · hypotheses · hypothesis · confidence 0.47

_2026-11-18T20:45:04.521Z_ · commit `4512e946`

**1–3 Mission.** LÉLU 2.1 — geometry fidelity and mathematical validation (WP03)

**4 Observed.** The tube builder reports floatingRoots=0 and rootPenetrations=392. The vertex-clearance measure on the same build reports p50 1.11 mm, p95 2.06 mm, 54 roots beyond 4 mm, max 49.2 mm.

**5 Studied.** What each root diagnostic actually measures, and which one answers 'does a root float above the scalp'.

**6 Question.** Why do the two root diagnostics disagree about floating roots?

**7 Hypothesis.** They measure different things: 'floating' compares a root to the field box / normal offset, while clearance compares it to the nearest head-mesh vertex, so a root can be inside the box, above the scalp by tens of millimetres, and count as neither floating nor penetrating.

**8 Method.** Read both diagnostics from the same build and compare their definitions; the follow-up is to measure distance to the head *surface* (not vertices) for every root.

**9 Results.** 0 reported floating against 54 roots beyond 4 mm and 392 inside the mesh. The two numbers cannot both describe the same property.

**10 Evidence.**
- `measurement` artifacts/lelu2/hair/tubes-high/metrics-tubes-high.json — both diagnostics, same build
- `render` artifacts/lelu2/hair/tubes-high/lelu2-tubes-high-head-front.png — sparse crown and front hairline
- `commit` 4512e9466d7157da81a190bb11b985c3c1e1b3ec @ 4512e946 — mission commit

**11 Learned.** A diagnostic named after the defect it is supposed to catch is not evidence that it catches it. Zero floating roots was a definition, not a measurement.

**12 Confidence.** 0.47

**12b Limitations.**
- The nearest-vertex distance overestimates clearance on a coarse scalp mesh; a surface-distance measure is still needed.
- Whether the visible sparseness is the same 54 roots is not yet established.

**13 Applications.** Replace the counter with a surface-distance measurement before any 'floating roots fixed' claim.

**14 Next questions.**
- Does a surface-distance measure reproduce the 54 out-of-tolerance roots?
- Do those 54 roots correspond to the sparse region in the front render?

**Settles.**
- (nothing declared)

**Assumptions.**
- [refuted] floatingRoots=0 means no root floats

**Refutations.**
- refutes `R-20261118-wp03-tube-hair-cannot-move-occupancy`: "root placement is carried over unchanged from the voxel roots" — Placement was carried over as coordinates, but the face-plane cut and the normal lift move and shorten roots; the clearance measurement contradicts 'unchanged'.

**Tags.**
`hair` `roots` `diagnostics` `contradiction` `wp03`
