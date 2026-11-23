# R-20261118-wp05-the-youth-warp-was-inert-then-wrong

WP05 · failures · verified · confidence 0.93

_2026-11-18T22:30:58.462Z_ · commit `761d01c8`

**1–3 Mission.** LÉLU 2.3 — autonomous learning, visual creation and identity reconstruction (WP05)

**4 Observed.** The first youth build reported identical geometry to the baseline (264.6 mm tall, jaw/cheek 0.825) while its own diagnostics claimed a chin lift of 134 mm. The second build moved geometry and produced a head 172.1 mm wide instead of 172.1 mm.

**5 Studied.** Implicit-surface deformation: what a coordinate warp does to an SDF, and what happens when it samples outside its own grid.

**6 Question.** Does the youth pass actually change her head, and is it a valid deformation of her field?

**7 Hypothesis.** A smooth coordinate warp is a safe way to shorten a lower face.

**8 Method.** Compare the two builds' head metrics and bounds, probe the extreme vertices, and test the warp directly on an analytic SDF whose surface is known.

**9 Results.** Both failures identified. (1) The CC0 rig has no chin joint, so it resolved to the origin and the "lower face" was 1.579 m long: a warp with nothing to compress. (2) A scale warp sampled below the head field's grid, where the field reads zero, and a false solid slab appeared across the bottom of the box — the 303 mm width. Replaced with a translation lift that fades out 20 mm under the jaw: chin 9.2 mm higher, eye→chin 112.6 → 103.4 mm, head width back to 172.1 mm.

**10 Evidence.**
- `measurement` artifacts/lelu2/m23/baseline/metrics-baseline.json — the inert build's measurements
- `measurement` artifacts/lelu2/m23/youth/metrics-youth.json — the corrected build's measurements
- `measurement` artifacts/lelu2/m23/youth/lelu2-m23-youth-face-front.png — the face the corrected build renders
- `test` tests/lelu2-m23.test.ts — the warp guards: chin lift, fixed eye line, front-only volume
- `commit` 761d01c88633c664a376bd8605a351df3a626287 @ 761d01c8 — mission commit

**11 Learned.** A deformation of an implicit surface must never sample outside that surface's grid, and a landmark that silently resolves to the origin makes a change that looks applied and measures as nothing. Both are now guarded by tests.

**12 Confidence.** 0.93

**12b Limitations.**
- The lift is a translation, not anatomy: it shortens the lower face without changing the teeth, jaw or neck joints.
- Fixed-fraction width metrics re-sample a different slice when the face is lifted, which is why widths are now measured at fractions of the face.

**13 Applications.** Any future head/face morph must be measured on the face's own landmarks, not the component's bounding box.; The same guard rejects any warp that reads outside its field.

**14 Next questions.**
- Does the youth pass read as younger in a blind comparison against ref10?
- Should the chin/jaw ratio target be 0.45, given the measured 0.768?

**Settles.**
- Does the youth pass actually change her head?

**Assumptions.**
- [refuted] the rig has a usable chin joint
- [refuted] scaling the lower face is safe on this field

**Refutations.**
- (none)

**Tags.**
`youth` `identity` `sdf` `failure` `wp05`
