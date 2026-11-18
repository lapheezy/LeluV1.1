# R-20261118-wp05-frame-time-was-never-measured

WP05 · experiments · open · confidence 0.57

_2026-11-18T20:45:04.551Z_ · commit `4512e946`

**1–3 Mission.** LÉLU 2.1 — geometry fidelity and mathematical validation (WP05)

**4 Observed.** Projection cost was measured structurally for 4 variants: 15 draw calls each, GPU bytes 27.6/26.3/21.5/18.5 MB, parse 105.7/56.8/77.7/72.7 ms. No frame time was measured on any device.

**5 Studied.** What a static projection measurement can and cannot say about real-time performance.

**6 Question.** Does the tube hair hold a mobile frame budget?

**7 Hypothesis.** Lower triangle counts imply a proportionally lower frame time.

**8 Method.** Parse each GLB, count triangles and draw calls, estimate GPU bytes, and time the parse. Do not extrapolate to frames.

**9 Results.** Triangle and memory cost fall with LOD; frame time is unmeasured. The honest statement is structural: the binding cost is not known.

**10 Evidence.**
- `measurement` artifacts/lelu2/projection.json — draw calls, triangles, GPU bytes, parse time, no frame time
- `test` tests/lelu2-artifacts.test.ts — asserts the 'no frame time' note is still there
- `commit` 4512e9466d7157da81a190bb11b985c3c1e1b3ec @ 4512e946 — mission commit

**11 Learned.** Triangle count is a proxy for GPU work only when the bottleneck is vertex processing. Nothing in this data establishes that, so no iPhone or real-time claim can be made.

**12 Confidence.** 0.57

**12b Limitations.**
- No device or browser benchmark was run; p50/p95 frame times and LOD transition cost are unknown.
- GPU byte estimates are derived from buffer sizes, not from measured upload.

**13 Applications.** The LOD ladder is ready for a device benchmark that has not happened yet.

**14 Next questions.**
- What is p50/p95 frame time for tubes-high on a mid-range phone at 1080p?
- At what screen coverage does the high LOD stop being affordable?

**Settles.**
- (nothing declared)

**Assumptions.**
- (none recorded)

**Refutations.**
- (none)

**Tags.**
`mobile` `benchmark` `projection` `unmeasured` `wp05`
