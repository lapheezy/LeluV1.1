# Mission 3.5 — Volumetric Intelligence & Reconstruction Advancement

Branch `temporal-studio/asre-core`. Nothing merged, pushed or rewritten.

Mission 3 established the sparse numerical surface representation, temporal
expansion, rigid-movement detection, confidence accumulation and snapshot
preservation. Mission 3.5 asks a harder question: **can NRE keep both surface
and volumetric information without losing the temporal capability it already
has?**

Answer, as measured below: yes for preservation and representation selection,
yes for labelled interpolation, and the reconstruction path now runs
end-to-end on CPU — with the fidelity limits stated rather than hidden.

| Work package | Status | Evidence |
| --- | --- | --- |
| WP1 volumetric preservation | VERIFIED | 8 cases, container keeps every cell; boundary loss measured per case |
| WP2 adaptive representation | VERIFIED | 7/7 shapes classified from cell statistics, each with the representation it rejected |
| WP3 temporal interpolation | VERIFIED | 9 interpolants across 3 methods, all `state: "interpolated"`, uncertainty maximal at t=0.5 |
| WP4 real 3D visualisation | VERIFIED | Blender 4.5.9 Cycles renders of real GLB assets (see images below) |
| WP5 Experiment A recovery | VERIFIED | TripoSR runs on CPU, 31,848-triangle GLB, gate accepted, all five stages measured |
| WP6 tests | VERIFIED | 13 Mission 3.5 tests, 60 NRE tests, 48 regression tests |
| WP7 performance | VERIFIED | 9 measured operations, sparse-vs-dense memory factor 4.61× |

---

## 1. WP1 — Volumetric preservation

`src/temporal/nre/volume.ts` measures a voxel set rather than inferring it:
cells, boundary cells, interior cells, 6-connected components, isolated cells,
surface area in cells, surface-to-volume ratio.

The important finding is about where the information was actually being lost.
The container was never the problem — it already stored interior cells. The
loss was in **export**: a boundary mesh skips every face shared by two occupied
cells, which is by definition the interior.

Measured, per case (from `artifacts/mission35/wp1_volume.json`):

| case | cells | boundary | interior | interior share |
| --- | --- | --- | --- | --- |
| solid-box 12³ | 1728 | 728 | 1000 | 57.87% |
| solid-sphere r8 | 2176 | 632 | 1544 | 70.96% |
| hollow-box shell | 728 | 728 | 0 | 0% |
| thin-sphere shell | 488 | 488 | 0 | 0% |
| thick torus | 304 | 224 | 80 | 26.32% |
| irregular blob | 590 | 590 | 0 | 0% |
| sparse cloud | 400 | 400 | 0 | 0% |
| punched shell | 719 | 719 | 0 | 0% |

Mean interior share across the volumetric cases: **19.39%** — and mean recovery
when solidifying a closed boundary back to a solid: **84.86%**. The missing
15% is not error: it is the cells that were never interior in the first place
(shells, thin structures) and are correctly not invented.

`solidFromSurface` floods the *outside* of the lattice and inverts, so it can
only fill a closed boundary. `surfaceFromSolid` is the inverse. Inferred
interior cells carry `confidence: 0` plus an explicit `inferred = 1` channel:
they are recorded as an inference, never dressed up as an observation. A
punched shell is reported `open` and refused rather than filled.

**Formats evaluated.** The sparse voxel grid stays the interchange format. The
VXZ container is already a Morton-ordered sparse grid with per-cell channels, so
adopting O-Voxel's dual grid would duplicate it, and OpenVDB is a native C++
library (MPL-2.0) with no binding for this Node/TypeScript runtime — it would
add a build dependency for a capability already covered. Both were considered
and not adopted; this is a design decision, not a measured comparison.

## 2. WP2 — Adaptive representation

`analyseRepresentation` derives a kind from measured statistics and records
*why*, including the representation it rejected:

- **Motion decides the kind; density decides the storage.** A solid that
  articulates is still an articulated body; its interior only changes how it
  must be stored. Testing density first would label it `volumetric` and lose
  the fact that its parts move independently.
- Point clouds are detected by isolation fraction, not by point count.
- Hollow structures are detected by solidifying: if the boundary closes and
  encloses empty cells, the shape is a shell and the cavity is reported, not
  filled.

| shape | decision | storage | rejected |
| --- | --- | --- | --- |
| solid box | volumetric | sparse-volume | boundary mesh (would keep only 728 of 1728 cells) |
| closed shell | hollow | sparse-surface | volumetric (the cavity is empty) |
| point cloud | point-cloud | sparse-surface | surface mesh; interior (0%) |
| flat sheet | sparse-surface | sparse-surface | — |
| irregular shell | sparse-surface | sparse-surface | — |
| two blocks moving differently | articulated | sparse-volume | — |
| surface change, no rigid explanation | deforming | sparse-surface | — |

Two fixtures had to be rebuilt because the *measurement* was right and the
fixture was not: a "deforming" case built from two separately-moving blocks is
genuinely articulated (two distinct component shifts), and uniformly random
point sampling produces ~13% accidental face adjacency, which is a denser object
than a point cloud. The deforming case is now a single connected bar that bends,
and the point-cloud case samples a lattice two cells apart. Both changes made
the fixtures stricter, not the assertions looser.

## 3. WP3 — Temporal interpolation

Three methods — `occupancy-blend`, `rigid`, `correspondence` — all return
`state: "interpolated"`, never `observed`. Every result carries a per-cell
`uncertainty` channel, `4t(1−t)(1−2·mix)`, which is legitimately 0 where both
endpoints agree and maximal where nothing was measured.

| method | t | cells | mean uncertainty | mean confidence |
| --- | --- | --- | --- | --- |
| occupancy-blend | 0.0 | 360 | 0.000 | 0.600 |
| occupancy-blend | 0.5 | 692 | 0.960 | 0.700 |
| occupancy-blend | 1.0 | 360 | 0.000 | 0.800 |
| rigid | 0.0 | 360 | 0.000 | 0.600 |
| rigid | 0.5 | 360 | 0.000 | 0.700 |
| rigid | 1.0 | 360 | 0.000 | 0.800 |
| correspondence | 0.0 | 360 | 0.000 | 0.600 |
| correspondence | 0.5 | 423 | 0.834 | 0.698 |
| correspondence | 1.0 | 360 | 0.000 | 0.800 |

Rigid interpolation reports zero uncertainty at t=0.5 because a pure translation
between two observations *is* fully determined; occupancy-blend does not,
because it cannot know which of two disagreeing states a cell should take. That
difference is the point of tracking the channel at all.

Confidence propagates as a weighted mean of the contributing observations and
never rises above the best endpoint. Transform interpolation slerps rotation
and reproduces both endpoints exactly.

## 4. WP4 — Real 3D visualisation

The dependency-free isometric rasteriser stays for diagnostics. Production
rendering uses the Blender binary already in `.foundry`:

```
LD_LIBRARY_PATH="$PWD/.foundry/sysroot/usr/lib/x86_64-linux-gnu:$PWD/.foundry/sysroot/usr/lib" \
  .foundry/blender-4.5.9-linux-x64/blender --background \
  --python scripts/temporal/render_glb.py -- --glb <asset>.glb --out <png>
```

(`bpy` has no wheel for Python 3.12, so the binary plus the sysroot libraries is
the route that works.)

Assets in `artifacts/mission35/`:

| file | bytes | triangles | note |
| --- | --- | --- | --- |
| `lelu_apose_recon.glb` | 574,752 | 31,848 | TripoSR reconstruction of the A-pose reference |
| `nre_solid_boundary.glb` | 54,324 | 2,976 | dense sphere, boundary only |
| `nre_solid_all_cells.glb` | 690,020 | 34,464 | dense sphere, every occupied cell |
| `nre_solid_boundary_cut.glb` | — | 2,784 | same solid, cut by whole cells |
| `nre_solid_all_cells_cut.glb` | — | 17,232 | same solid, cut, every cell kept |
| `wp3_states_combined.glb` | — | 7,376 | t=0, t=0.5, t=1 in one frame |

The dense sphere is 2,872 cells: 744 boundary, 2,128 interior (74.09%). Exporting
it two ways and rendering the same cutaway gives the visual form of the WP1
finding — the boundary export is a hollow bowl, the all-cells export is a filled
dome. Cost of keeping the interior: **12.70× the bytes, 11.58× the triangles**.

Three renderer defects were found and fixed here, all of which had produced
silently wrong images: bounds read from `obj.bound_box` before the depsgraph
updated (zero-radius camera → blank frames), a boolean EXACT cut that collapsed a
34,464-triangle cube soup to 43 triangles (replaced by an exact face clip, and
the production cutaways are now cut in Node by whole cells so every cube stays
closed), and a cube soup wound inside-out (black cross-sections).

## 5. WP5 — Experiment A recovery

TripoSR (`stabilityai/TripoSR`, MIT for code *and* weights, verified before use)
now runs on CPU with no account, no API key and no GPU. Weights were already in
the local Hugging Face cache; the `torchmcubes` CUDA extension is replaced by a
scikit-image CPU shim.

Result (`artifacts/mission3/experiment_a.json`), **VERIFIED**:

| stage | status |
| --- | --- |
| image input | VERIFIED — `04_front_apose.png`, sha256 `1e01242a0a272961…`, 2,070,376 bytes |
| image analysis | VERIFIED — forward pass on CPU, 11.4 s inference, 4.8 s load |
| spatial reconstruction | VERIFIED — 15,950 vertices / 31,848 triangles, export gate accepted |
| numerical representation | VERIFIED — 45,475 cells on a 64×162×77 lattice at 6.25 mm, 1,165 interior |
| 3D geometry export | VERIFIED — 3,377,628-byte GLB (189,672 triangles), re-voxelised IoU **0.9744** |

Container: 110,884 bytes, sha256 `6551ca0fdaec5657…`, compression ratio **9.84:1**.
Total pipeline: 2,159 ms after inference.

Representation decision for the reconstruction: `hollow` (2.56% interior) —
correct. A single-image reconstruction is a shell, and the system says so
instead of pretending the interior was observed.

### Defects found on the way

Four bugs had to be fixed before any of the above was true, and each one had
been producing a plausible-looking but wrong output:

1. **RGBA fed to the model** — `rembg` returns 4 channels and the forward pass
   raises a tensor mismatch.
2. **No foreground crop** — upstream `run.py` crops to the alpha bounding box
   and composites onto mid-grey. Without it TripoSR models the dark studio
   backdrop as part of the object.
3. **`ndarray.ptp` removed in numpy 2** — trimesh 4.0.5 cannot export, and the
   method cannot be monkeypatched back (immutable C type). Replaced by
   `scripts/foundry/glb_writer.py`, a stdlib glTF 2.0 writer.
4. **Axis conventions** — PyMCubes/torchmcubes return vertices axis-reversed
   relative to scikit-image, and TripoSR swaps `[2,1,0]` to undo it; the shim
   was doing the swap twice. Separately, TripoSR geometry is z-up and glTF is
   y-up, so exporting it verbatim left the character lying on its back — which
   reads as a lumpy mass, not as a bug.

Verification of the whole chain: TripoSR's own `run.py` was run on the identical
preprocessed image (with `xatlas`/`moderngl` stubbed, since texture baking is not
needed for geometry). It produced **the same 15,950 vertices / 31,848 triangles**
and the same silhouette as our worker. The pipeline is not approximating
upstream, it reproduces it.

### Reproducing it from nothing

```bash
python3 -m venv /tmp/triposr-venv
/tmp/triposr-venv/bin/pip install torch==2.15.0 --index-url https://download.pytorch.org/whl/cpu
/tmp/triposr-venv/bin/pip install -r /tmp/TripoSR/requirements.txt   # trimesh, transformers, rembg, onnxruntime, scikit-image
git clone --depth 1 https://github.com/VAST-AI-Research/TripoSR /tmp/TripoSR
mkdir -p /tmp/shim && ln -s "$PWD/scripts/foundry/torchmcubes_cpu_shim.py" /tmp/shim/torchmcubes.py
PYTHONPATH=/tmp/shim:/tmp/TripoSR /tmp/triposr-venv/bin/python scripts/foundry/triposr_to_glb.py \
  --image leluverse/assets/characters/lelu_character/references/PRIMARY_SOURCE/04_front_apose.png \
  --out /tmp/lelu_apose.glb --mc-resolution 160
npx tsx scripts/temporal/experiment-a.ts /tmp/lelu_apose.glb
```

Not done: texture baking (`xatlas`, `moderngl` absent — geometry only), and any
claim about reconstruction *accuracy*. TripoSR publishes no calibrated figure,
so the recorded confidence is 0.5 with that reason attached.

## 6. WP6 — Tests

```
npx tsx --tsconfig tsconfig.test.json --import ./tests/support/ignore-css.mjs \
  --test --test-concurrency=1 tests/temporal-nre-mission35.test.ts
```

13/13 pass: interior fraction measurement, container preservation byte-for-byte,
boundary loss and solidification recovery, refusal of an open shell, the
seven-shape classification, per-component motion, interpolation labelling,
confidence and uncertainty, transform slerp, the volume/perf experiment
contracts, honest Experiment A reporting, real GLB export validated by the
production gate, and an existing 1.23 M-triangle production GLB still passing
that same gate.

Retained and re-run: 60/60 NRE tests (serialization, temporal, experiments,
model registry) and 48/48 in the 3D/forge/avatar regression subset.
`npx tsc --noEmit` exits 0.

Full repository suite (234 files, run to completion in the background):
**2,309 tests, 2,299 pass, 2 fail, 8 skipped**. Both failures are outside this
work and neither file imports anything from `src/temporal/` or `scripts/`:
`sandbox-security` (expects network to be denied; this VM's policy lets it
through) and `autonomy-end-to-end` ("the genuinely failing tool was not recorded
as failing" in the cognition harness). The skips are tools not installed here
(`opa`, `gitleaks`), each reported as a refusal rather than a pass.

## 7. WP7 — Performance

From `artifacts/mission35/wp7_performance.json` (32³ lattice, 2 cm cells):

| operation | cells | ms | bytes |
| --- | --- | --- | --- |
| measureVolume | 13,824 | 5.6 | — |
| solidFromSurface | 3,176 | 59.9 | — |
| boundaryOf | 13,824 | 11.6 | — |
| measureVolumeRoundTrip | 13,824 | 69.9 | — |
| connectedComponents | 13,824 | 9.4 | — |
| serialize (volume) | 13,824 | 12.7 | 30,300 |
| serialize (surface) | 3,176 | 2.7 | 6,577 |
| encodeGlb | 3,176 | 10.8 | 229,708 |
| interpolate (correspondence) | 13,824 | 111.2 | — |

Memory: 30,300 bytes dense vs 6,577 bytes sparse for the same shape's surface —
**4.61× overhead** for keeping the interior. Reconstruction: 11.4 s inference
plus 2.2 s of numerical work at 45,475 cells (CPU, no GPU).

Compression is where the volumetric representation pays for itself: 9.84:1 on
real reconstruction geometry, 9.98:1 on the earlier Experiment A run.

## 8. Limitations, stated plainly

- **Reconstruction fidelity is unverified.** The pipeline produces a recognisable
  A-pose figure, but nothing here measures its accuracy against the source. No
  ground-truth mesh exists for the reference.
- **No textures.** Geometry only; baking needs `xatlas` and `moderngl`.
- **The TripoSR environment is not checkpointed.** `/tmp/triposr-venv` and
  `/tmp/TripoSR` vanish on restore; the procedure above rebuilds them.
- **Two unrelated suite failures.** The full run reports 2/2,309 failures in
  the sandbox-policy and autonomy-harness tests (see WP6). They were not
  investigated beyond confirming they never touch this work.
- **OpenVDB/O-Voxel** were evaluated and not adopted (see WP1); no measured
  comparison between them and VXZ was performed.
- **Blender renders are CPU Cycles** at 24–40 samples. They are real renders of
  real geometry, not photoreal, and no PBR/pass pipeline was built.
