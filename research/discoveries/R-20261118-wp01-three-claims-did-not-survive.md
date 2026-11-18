# R-20261118-wp01-three-claims-did-not-survive

WP01 · discoveries · verified · confidence 0.57

_2026-11-18T20:45:04.490Z_ · commit `4512e946`

**1–3 Mission.** LÉLU 2.1 — geometry fidelity and mathematical validation (WP01)

**4 Observed.** The 2.0 report claimed a more uniform hair root layout. The same comparison re-read from the published files reports CV 1.3446 at n=928 against 0.6434 at n=1350 — 11 verdicts, 3 warnings.

**5 Studied.** Sampling-uniformity statistics and how the coefficient of variation depends on sample count.

**6 Question.** Do the 2.0 uniformity claims survive an independent re-measurement?

**7 Hypothesis.** The golden layout is more uniform than the baseline on every published metric.

**8 Method.** Re-read every published value from its own artefact path (no transcription), recompute the winner, and refuse a claim when the two sides were measured at different sample counts or when the metric does not describe both layouts.

**9 Results.** Audit ok=true with 3 warnings. The hair CV comparison is confounded (928 vs 1350). Divergence and radial exponent are not applicable to concentric rings, so they cannot be wins. The 2.0 ringlet was mis-parameterised: growth was 1.09×/turn, not φ.

**10 Evidence.**
- `measurement` artifacts/lelu2/audit.json — every verdict, with its source path and sample count
- `test` tests/claims.test.ts — eight guard tests, one per way a claim can lie
- `commit` 4512e9466d7157da81a190bb11b985c3c1e1b3ec @ 4512e946 — mission commit

**11 Learned.** Three of the 2.0 claims were artefacts of unequal sample counts or of applying a disc metric to a ring layout. The comparison that survives is the equal-n one: 0.3925 → 0.0968 at n=800, a 75.3% reduction.

**12 Confidence.** 0.57

**12b Limitations.**
- The audit re-reads files; it cannot repair an experiment that was never run at equal n.
- Blueprint: the original 2.0 renders were not regenerated, only their measurements re-checked.

**13 Applications.** Any future uniformity claim must name the sample count on both sides.; The audit is re-runnable and gates the report.

**14 Next questions.**
- How many other published numbers were computed at unequal sample counts?
- Does the equal-n result hold on the garment and disc surfaces too?

**Settles.**
- Do the 2.0 uniformity claims survive an independent re-measurement?

**Assumptions.**
- [refuted] published metrics were comparable across variants
- [refuted] the golden ringlet used φ per turn

**Refutations.**
- (none)

**Tags.**
`audit` `uniformity` `confound` `wp01`
