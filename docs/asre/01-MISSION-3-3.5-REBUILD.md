# Missions 3 and 3.5 — rebuilt and re-measured

Everything below was produced in this session from the code in `src/core/asre`, `scripts/asre` and `services/asre-reconstruct`. Historical figures come from the lost session's handoff and are compared, not assumed.

## Mission 3 — Numerical Reconstruction Engine

| Historical target | Rebuilt result | Status | Evidence |
| --- | --- | --- | --- |
| Sparse round-trip 590/590, IoU 1.0000 | 590/590 cells, IoU 1, byte-identical re-encode | VERIFIED | `tests/asre-nre.test.ts` (fixture: seeded 590-cell scatter — the original fixture's shape is unknown; no sphere/torus/shell gives 590) |
| Dense block 1,728 cells, 728 boundary-reconstructed | 12³ block: 1,728 cells, 728 boundary; boundary + fill rebuilds the 1,000 interior cells (IoU 1, INFERRED) | VERIFIED | `tests/asre-volumetric.test.ts` |
| Noisy-OR 0.55 ⊕ 0.80 = 0.91 | 0.91 (derived from evidence) | VERIFIED | `tests/asre-nre.test.ts` |
| Originals unchanged during accumulation | Observations frozen; mutation throws | VERIFIED | `tests/asre-nre.test.ts` |
| Temporal expansion and rigid movement classification | `compareGrids` classifies unchanged / rigid-translation (recovers exact delta) / expansion / contraction / deformation | VERIFIED | `tests/asre-temporal.test.ts` |
| Snapshots, parents, diffs, restore, historical reconstruction | Diff-only snapshots, replay from root checked against SHA-256, restore as new head, tamper detection | VERIFIED | `tests/asre-temporal.test.ts` |
| Versioned schema, checksums, corruption detection, migration | `.lnre` container: canonical JSON header, CRC-32 per section, SHA-256 trailer, located corruption errors, v1→v2 migration | VERIFIED | `tests/asre-nre.test.ts` |
| O-Voxel adapter / `.vxz` compatibility | Not implemented: the O-Voxel / `.vxz` specification was not available to verify against, and the directive allows it only "where verified". | NOT IMPLEMENTED | — |

## Mission 3.5 — Volumetric intelligence

| Historical target | Rebuilt result | Status |
| --- | --- | --- |
| 2,872 cells, 744 boundary, 2,128 interior, 74.09% | Sphere of radius 8.77 cells centred on a lattice corner: exactly 2,872 / 744 / 2,128 / 74.09% | VERIFIED |
| Boundary-only information loss vs all-cell preservation | Sphere with sealed cavity + interior probe: boundary + fill falsely fills every cavity cell and loses interior evidence; all-cell storage exact | VERIFIED |
| Adaptive representation selection | `selectRepresentation` chooses surface mesh / boundary voxels / volumetric voxels from measured loss and intended use | VERIFIED |
| Temporal interpolation | Exact-EDT SDF blending; found that plain blending shrinks a moving object (2,176 → 1,008 cells), so interpolation is motion-compensated (volume preserved) | VERIFIED |
| Confidence & uncertainty propagation | INTERPOLATED cells with time-damped confidence; per-class uncertainty report | VERIFIED |
| Actual GLB generation | `writeGlb`, validated by LÉLU's `inspectGlb`; watertight / outward / volume checks | VERIFIED |
| Blender integration and real rendering | Blender 4.2.23 LTS Cycles CPU via `plugins/blenderStage` `findBlender/run` | VERIFIED |

### TripoSR CPU reconstruction (`artifacts/asre/triposr/police_woman`)

Input: TripoSR's own example `police_woman.png` (RGBA). Hardware: 4 vCPU, no GPU, torch 2.15 CPU, numpy 2.5.

| Quantity | Historical | This session | Note |
| --- | --- | --- | --- |
| CPU inference | ~38.4 s | 6.40 s (+6.6 s model load, 10.7 s mesh) | different hardware/torch; historical input unknown |
| Vertices / triangles | 15,950 / 31,848 | 76,785 / 153,582 (MC 256, threshold 25) | different object; same upstream defaults |
| GLB size | ~660 KB | 4.9 MB (positions, normals, linear colours, uint32 indices) | no decimation applied |
| NRE cells @ 6.25 mm | 45,475 | 706,026 (53,757 boundary; 16,632 OBSERVED front-visible) | a full bust at 6.25 mm |
| IoU vs re-voxelized exported geometry | 0.9744 | **0.9918** (GLB read back, axes undone, ray-cast voxelized) | |
| Container bytes / ratio vs 24 B/cell | 110,884 / 9.84:1 | 3,128,892 deflated / **5.42:1** (2.18:1 raw) | this container stores a float64 density-derived probability per cell; the historical one evidently did not |
| Validation vs upstream on identical preprocessed input | — | **IoU 0.9997** (same scene codes; scikit-image vs upstream torchmcubes); bounds equal to 3×10⁻⁸; ours watertight, upstream has 660 open edges | VERIFIED |

Defects prevented, each with a concrete check: RGBA/RGB normalisation; upstream foreground crop; float 0.5-grey compositing; numpy-2 clean (also caught: Fortran-ordered `.npy`, now refused by the reader and fixed in the worker); no `[2,1,0]` swap with scikit-image (swap belongs to torchmcubes); explicit Z-up → Y-up proper rotation; plus two found this session: sRGB colours written as linear (washed out) and TripoSR's +X front (renders showed the side) — both fixed and visible in `contact_sheet.png`.
