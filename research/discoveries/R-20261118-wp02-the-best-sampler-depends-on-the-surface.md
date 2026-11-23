# R-20261118-wp02-the-best-sampler-depends-on-the-surface

WP02 · discoveries · verified · confidence 0.57

_2026-11-18T20:45:04.503Z_ · commit `4512e946`

**1–3 Mission.** LÉLU 2.1 — geometry fidelity and mathematical validation (WP02)

**4 Observed.** Five samplers at n=800 on four surfaces: hair roots: A 0.3925 → E-hybrid 0.0968 (coverage 100.0%); surface detail placement: A 0.3943 → E-hybrid 0.0885 (coverage 100.0%); jewelry (diadem): A 0.4092 → C-vogel 0.0382 (coverage 100.0%); procedural surface sampling: A 0.0519 → B-fibonacci 0.0277 (coverage 100.0%). The one-arm logarithmic spiral was rejected on every surface for coverage (7–23%).

**5 Studied.** Equal-area point distributions: ordered stride, Fibonacci sphere, Vogel disc, one-arm logarithmic spiral, and an area-even hybrid. The relevant principle is that equal spacing and equal area are different objectives (Vogel 1979; Bridson 2007).

**6 Question.** Which sampling law produces the most uniform distribution for her actual surfaces?

**7 Hypothesis.** One golden-ratio law is best everywhere.

**8 Method.** Identical point cloud, n=800, same seed and same coverage radius per surface; measure spacing CV, min/max spacing and coverage; reject any method whose coverage falls below the surface it is supposed to cover.

**9 Results.** hair roots: A 0.3925 → E-hybrid 0.0968 (coverage 100.0%); surface detail placement: A 0.3943 → E-hybrid 0.0885 (coverage 100.0%); jewelry (diadem): A 0.4092 → C-vogel 0.0382 (coverage 100.0%); procedural surface sampling: A 0.0519 → B-fibonacci 0.0277 (coverage 100.0%). Curls: the log law is the regular one (R² 1.000, growth 0.618/turn), while the hybrid has diameter CV 0.153 but R² 0.934.

**10 Evidence.**
- `measurement` artifacts/lelu2/matrix/summary.json — per-surface methods with spacing, coverage and decisions
- `test` tests/lelu2-artifacts.test.ts — guards equal n, coverage and the rejected spiral
- `commit` 4512e9466d7157da81a190bb11b985c3c1e1b3ec @ 4512e946 — mission commit

**11 Learned.** There is no single winner. A surface thin enough to be one strip (the disc) favours Vogel; a closed sphere favours Fibonacci; an irregular anatomical cloud favours the area-even hybrid. The constant is not the answer — the surface is.

**12 Confidence.** 0.57

**12b Limitations.**
- Four surfaces only; the accessory and jewellery surfaces were not sampled.
- CV is a spacing statistic, not a perceptual one.

**13 Applications.** Hair roots and surface detail keep the hybrid; the ornament disc keeps Vogel.; The matrix is the harness any new sampler must beat at equal n.

**14 Next questions.**
- Does the hybrid stay ahead on the accessory and jewellery surfaces?
- Can the hybrid be made deterministic across resolutions without losing its coverage guarantee?

**Settles.**
- Which sampling law produces the most uniform distribution for her actual surfaces?

**Assumptions.**
- [refuted] a golden-ratio law is best on every surface
- [refuted] the one-arm spiral is usable if its CV is low

**Refutations.**
- (none)

**Tags.**
`sampling` `vogel` `fibonacci` `poisson` `wp02`
