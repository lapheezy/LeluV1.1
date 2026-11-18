# R-20261118-wp03-tube-hair-cannot-move-occupancy

WP03 · discoveries · verified · confidence 0.93

_2026-11-18T20:45:04.513Z_ · commit `4512e946`

**1–3 Mission.** LÉLU 2.1 — geometry fidelity and mathematical validation (WP03)

**4 Observed.** voxel/tubes-high/tubes-medium/tubes-low hair builds all report 375460 occupancy cells (digest 15999). Tubes replace the hair mesh only: high spends 426650 triangles where the voxel shell spends 540508.

**5 Studied.** Swept-tube surfaces with parallel-transport frames (Bergou et al. 2008), elliptical cross-sections, taper and closed ends; why a surface representation is not the same thing as an occupancy decision.

**6 Question.** Can her hair look like distinct curls without changing what ASRE/NRE believe she occupies?

**7 Hypothesis.** A mesh swap changes appearance but not occupancy, if occupancy is decided before the surface is built.

**8 Method.** Build voxel, tubes-high, tubes-medium and tubes-low from the same roots; hash the SparseVoxelGrid cell set in each build; compare the hashes, then compare triangle counts and file sizes.

**9 Results.** Identical occupancy in all four variants (375460 cells, digest 15999); hair triangles 540508 → 426650 → 52920; strands 1219, baby hairs 120, diameter CV 0.427.

**10 Evidence.**
- `measurement` artifacts/lelu2/hair/voxel/metrics-voxel.json — voxel occupancy baseline
- `measurement` artifacts/lelu2/hair/tubes-high/metrics-tubes-high.json — high LOD occupancy and hair
- `measurement` artifacts/lelu2/hair/tubes-low/metrics-tubes-low.json — low LOD occupancy and hair
- `test` tests/lelu2-artifacts.test.ts — asserts the cell counts and digests are equal
- `commit` 4512e9466d7157da81a190bb11b985c3c1e1b3ec @ 4512e946 — mission commit

**11 Learned.** Occupancy is an authority decision taken before the surface exists, so presentation can improve without re-opening ASRE/NRE. That is the property that makes visual work safe.

**12 Confidence.** 0.93

**12b Limitations.**
- Invariance is asserted for these four builds; a new root set needs its own comparison.
- Root placement was carried over from the voxel roots — see the floating-root entry for what that did not guarantee.

**13 Applications.** Hair can gain LODs, breaks and baby hairs without invalidating spatial authority.; The same pattern applies to any component whose surface is presentation-only.

**14 Next questions.**
- Do the 54 roots beyond 4 mm come from the face cut, the normal lift, or the root set?
- Does the crown stay covered at the medium LOD?

**Settles.**
- Can her hair look like distinct curls without changing what ASRE/NRE believe she occupies?

**Assumptions.**
- [supported] occupancy is independent of the surface representation
- [supported] root placement is carried over unchanged from the voxel roots

**Refutations.**
- (none)

**Tags.**
`hair` `tubes` `occupancy` `lod` `wp03`
