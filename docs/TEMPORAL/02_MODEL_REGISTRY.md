# Mission 2 — Model capability registry

Code: [`src/temporal/registry/modelCapability.ts`](../../src/temporal/registry/modelCapability.ts)
Tests: [`tests/temporal-model-registry.test.ts`](../../tests/temporal-model-registry.test.ts) — **12/12 pass**, `tsc -b --force` exit 0.

Every entry records what a primary source actually says, with the source URLs
and a verification date. All entries were checked on 2026-11-17. Where a source
says nothing, the field says `null` or `"unstated"` rather than guessing.

---

## 1. Licensing matrix

| model | code licence | weights licence | commercial | gated | redistributable |
|---|---|---|---|---|---|
| **TripoSR** | MIT | MIT (stated for weights) | **yes** | no | **yes** |
| **TRELLIS.2 4B** | MIT | MIT (stated for weights) | **yes** | no | **yes** |
| **O-Voxel** (TRELLIS.2 `o-voxel/`) | MIT | MIT | **yes** | no | **yes** |
| **FLUX.2 [klein] 4B** | Apache-2.0 | Apache-2.0 | **yes** | no | **yes** |
| **SAM 2** | Apache-2.0 | Apache-2.0 | **yes** | no | **yes** |
| **Open3D** | MIT | no weights | **yes** | no | **yes** |
| **COLMAP** | BSD-3-Clause | no weights | **yes** | no | **yes** |
| Depth-Anything-3 BASE / SMALL / METRIC-LARGE / MONO-LARGE | Apache-2.0 | Apache-2.0 | **yes** | no | **yes** |
| Depth-Anything-3 GIANT / GIANT-1.1 / LARGE / LARGE-1.1 | Apache-2.0 | **CC BY-NC 4.0** | **no** | no | no |
| MoGe | MIT (DINOv2 vendored Apache-2.0) | Hub tag `mit` only | **unverified** | no | unverified |
| InstantMesh | Apache-2.0 | Hub metadata only | **unverified** | no | unverified |
| ComfyUI | **GPL-3.0** | ships no weights | restricted (copyleft) | no | **no** |
| SAM 3D Body | SAM License | SAM License | restricted (no sublicence) | **access request** | no |
| SAM 3D Objects | SAM License | SAM License | restricted (no sublicence) | **access request** | no |

**Rules the code enforces, not just documents:**

- `isCommercialEligible()` requires code **and** weights to be explicitly
  `permitted`, *and* `statedForWeights === true`. A Hub tag is not a licence
  statement, so MoGe and InstantMesh fail it while TripoSR passes.
- Depth-Anything-3's GIANT/LARGE family is registered **explicitly as
  prohibited** so the scheduler can refuse it, rather than being quietly absent.
- ComfyUI is usable but `isDistributable()` is false: GPL-3.0 permits commercial
  *use*, but conveying a derivative forces source disclosure, so it may only be
  driven as a separate process over HTTP.
- The SAM 3D licences omit a sublicence grant and gate checkpoints behind an
  access request, so they cannot enter a shipped commercial core.

## 2. Hardware matrix

| model | min VRAM (as stated) | CPU | published speed |
|---|---|---|---|
| TripoSR | 6 GB | **yes**, `run.py` falls back to cpu | <0.5 s / image on A100 |
| TRELLIS.2 4B | **24 GB** | no (generation); CPU only for mesh↔O-Voxel | ~3 s @512³, ~17 s @1024³, ~60 s @1536³ on H100 |
| FLUX.2 klein 4B | 8 GB (repo) / 13 GB (card) / 8.4 GB (site) — **conflict** | not stated | — |
| SAM 2 | not stated | **yes** (official CPU/MPS commit) | — |
| SAM 3D Objects | **32 GB** | no (NVIDIA-only: spconv, pytorch3d) | — |
| SAM 3D Body | not stated | no official claim | — |
| InstantMesh | not stated | no (`app.py` hard-codes cuda) | ~10 s per asset (GPU unnamed) |
| MoGe | not stated | yes (`--device cpu`) | 60 ms / image, A100/3090 FP16 ViT-L |
| Depth-Anything-3 | not stated per image; <12 GB for streaming video | unstated | — |
| Open3D / COLMAP | none (CPU) | **yes** | COLMAP dense needs CUDA |

Consequence for the free-first rule: **TripoSR is the only image-to-3D worker
that runs with no GPU, no account and no paid key.** That makes it the default
local worker for Mission 4, with TRELLIS.2 as the quality tier when a ≥24 GB GPU
is actually present.

## 3. Dependency matrix

| model | runtime | notable dependencies | notes |
|---|---|---|---|
| TripoSR | PyTorch | `torchmcubes` (needs a CPU build if no CUDA) | `--chunk-size` lowers VRAM |
| TRELLIS.2 | PyTorch + CUDA | nvdiffrast, nvdiffrec (**separate terms**) | verifies on A100/H100, Linux only |
| FLUX.2 klein | PyTorch + CUDA | diffusers stack | weights auto-download when env vars unset |
| ComfyUI | PyTorch | GPL-3.0 core | `--cpu` documented as slow |
| SAM 2 | PyTorch | optional CUDA extension (skippable) | checkpoint script fetches over plain HTTP |
| SAM 3D Body/Objects | PyTorch + CUDA | spconv, pytorch3d | access request + token |
| Open3D | Python wheel | CPU wheel available | TSDF fusion: Uniform, Scalable, Voxel Block Grid |
| COLMAP | C++ / PyCOLMAP | CUDA needed for dense | sparse CPU path via `--FeatureExtraction.use_gpu 0` |

## 4. Representation decision — reuse O-Voxel, do not reinvent

The directive says investigate O-Voxel before inventing NRE's sparse format, and
that investigation supports reuse:

- O-Voxel is a **Flexible Dual Grid**: a `(N,3)` coordinate tensor plus aligned
  per-voxel attributes, storing a dual vertex per occupied voxel with
  intersection flags. It represents open and non-manifold surfaces, which a
  plain occupancy grid cannot.
- It already ships a serializer: `.vxz` with `VXZ` magic, version byte,
  big-endian offset to the binary section, JSON metadata, chunked binary,
  Morton ordering, LZMA compression.
- CPU paths exist for mesh → O-Voxel (<10 s) and O-Voxel → mesh (<100 ms CUDA),
  so NRE can convert and round-trip on a machine without a 24 GB GPU.

**Decision:** NRE will adopt O-Voxel as its sparse-geometry adapter and add the
versioning, provenance, confidence and temporal layers around it, instead of
defining a competing sparse container. This keeps round-trip risk near zero and
satisfies "reuse existing representations".

## 5. What the registry deliberately does not contain

- **No paid provider.** Meshy is absent by design: the directive forbids a paid
  API in the core, and LÉLU's existing Meshy path stays as a consent-gated
  adapter outside the engine.
- **No unverified claims of CPU support or VRAM.** Unknown values are `null`,
  and `selectForTask()` treats a null VRAM figure with no CPU path as "not
  runnable here", so a missing number can never be read as "light enough".

## 6. Open questions carried forward

1. **MoGe weights licence** — the repo licences code only; Hub metadata says
   `mit`; upstream issue #98 is unanswered. Until the maintainers state it, MoGe
   stays `unverified`.
2. **InstantMesh weights licence** — Apache-2.0 appears only in Hub metadata.
3. **FLUX.2 klein VRAM** — three official figures disagree (8 / 8.4 / 13 GB);
   plan against 13 GB.
4. **SAM 3D partial release** — checkpoints exist but require approval; treat as
   an optional enhancement, never a required step.

## 7. Verification applied

```bash
npx tsc -b --force                                   # exit 0
npx tsx --tsconfig tsconfig.test.json --import ./tests/support/ignore-css.mjs \
  --test --test-concurrency=1 tests/temporal-model-registry.test.ts
# 12 tests, 12 pass, 0 fail
```

The tests assert the licensing rules themselves (non-commercial excluded,
code-licence-never-implies-weights, GPL not distributable, gated excluded), the
hardware routing (CPU-only still resolves to TripoSR; 8 GB rejects TRELLIS.2;
32 GB admits it), and that no ineligible entry leaks into a commercial
selection for any task.
