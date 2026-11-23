**Her face, same camera: without → with the youth pass**

| before | after |
| --- | --- |
| ![Her face before the youth pass](artifacts/lelu2/m23/baseline/lelu2-m23-baseline-face-front.png) | ![Her face after the youth pass](artifacts/lelu2/m23/youth/lelu2-m23-youth-face-front.png) |

*2.3 paint fixes, no youth pass → youth pass: lower face shorter, jaw narrower, cheeks fuller — Eye line → chin 112.6 mm → 103.4 mm; the chin is 1474.9 mm above the floor.*

| measurement | value | vs baseline |
| --- | --- | --- |
| eye → chin | 103.4 mm | -9.2 mm |
| jaw / cheek | 0.792 | -0.006 |
| cheek share of head | 19.3 % | 0.5 pts |

**Head, three-quarter view**

| before | after |
| --- | --- |
| ![Head before](artifacts/lelu2/m23/baseline/lelu2-m23-baseline-head-three-quarter.png) | ![Head after](artifacts/lelu2/m23/youth/lelu2-m23-youth-head-three-quarter.png) |

*without the youth pass → with the youth pass*

![Baby hair placement overlay, rasterised from the strand records](artifacts/lelu2/research/baby-hair-overlay.png)

*Placement of all 88 strands in the front view, with her eye line (1578 mm) and hairline band visible. Front strands sit ~45 mm above the eyes: the hairline is high and the strands are 7–35 mm long, which is the sparse-forehead defect this overlay exposes. —  `761d01c8`*

![Baby hair placement overlay](artifacts/lelu2/m23/youth/baby-hair-youth.svg)

*88 strands: 36 front, 24 temples, 12 sideburns, 16 flyaways · hairline coverage 100 % —  `761d01c8`*

| measurement | value | vs baseline |
| --- | --- | --- |
| strands | 88 |  |
| length | 7.2–35.2 mm |  |
| root Ø | 0.16–0.45 mm |  |
| skin collisions | 2 |  |

**What changed, measured on the mesh**

| measurement | value | vs baseline |
| --- | --- | --- |
| eye → chin | 103.4 mm | -9.2 mm |
| lower third share | 46.1 % | -2.1 pts |
| jaw width | 114.3 mm | -1.9 mm |
| chin width | 87.8 mm | -0.7 mm |
| chin / jaw | 0.768 | 0.007 |
| baby hair strands | 88 | 0 |
| hairline coverage | 10000.0 % | 0 pts |

Every value is read from the build's own metrics file, not typed in. Widths are measured at fixed fractions of the FACE (chin → eye line), so a lifted chin cannot silently re-sample a different part of the jaw.

- `761d01c8` LÉLU 2.3 — youth pass, baby-hair system, evidence in chat
