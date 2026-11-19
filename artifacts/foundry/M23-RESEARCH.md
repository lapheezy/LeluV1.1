# M23 — Photorealistic Character Foundry: research, licences and hardware

Baseline: `experiment/lelu-2-golden-geometry` (this worktree). Licence claims
verified **2026-11-19**. The machine these decisions were made on is described
below; a decision that depends on hardware says so in its reason.

> A repository being installed does not mean it works, and a permissive code
> licence does not grant rights to the weights. Every row separates the two, and
> every row says how it was checked.

## 1. Hardware audit (measured, not assumed)

`npx tsx scripts/foundry/run.ts status` → `artifacts/foundry/hardware.json`

| fact | value | how |
| --- | --- | --- |
| CPU | 8 vCPU, model string `19/01` | `node:os.cpus()` |
| RAM | 16.8 GB (15 GiB usable) | `os.totalmem()` |
| GPU | **none** | no `/proc/driver/nvidia`, `/dev/kfd`, `/opt/rocm`, `/dev/dri/renderD128` |
| CUDA | absent | no `/usr/local/cuda` |
| ROCm | absent | — |
| Disk | 34 GB free | `statfs` |
| OS | Ubuntu 24.04.5, kernel 6.1 | `/etc/os-release` |
| Python | 3.12.3 | `python3 --version` |
| Node | v26.13 | `process.version` |
| Blender | **4.2.23 LTS**, headless | `$LELU_TOOLS/blender-4.2.23-linux-x64/blender` |
| Blender runtime deps | needs `LD_LIBRARY_PATH=$HOME/libs/usr/lib/x86_64-linux-gnu` | the binary fails to load `libXrender.so.1` without it |
| Cycles backend | CPU only | `--factory-startup`, 8 threads, OpenImageDenoise |
| Measured render cost | 6.1–10.7 s per shot at 768²–1024², 32 samples, 1.29 M triangles | `artifacts/foundry/benchmark/*.json` |

**Consequence.** Every GPU-only reconstruction candidate is unusable here. That
is a hardware fact, not a preference, and the execution planner refuses those
jobs with that sentence instead of attempting them.

## 2. Decision matrix

Full machine-readable form: `artifacts/foundry/licenses.json`. Fields follow the
mission's table exactly; "Install" is one of `reproduced / installed / untested /
not-attempted`, and only `reproduced` means this machine ran it.

| candidate | code licence | weights licence | commercial | account | internet | GPU | CPU fallback | install | decision |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **Blender 4.2 + Cycles** | GPL-2.0-or-later (application) | n/a | yes | no | download-only | optional | **tested here** | reproduced | **adopt** |
| **PCI-FR 2.3.1** (this repo) | project licence | n/a (procedural) | yes | no | none | none | is the CPU path | reproduced | **adopt** |
| TripoSR | MIT | MIT | yes | no | download-only | recommended | CPU worker in repo | untested | optional (props only) |
| COLMAP | BSD-3 | n/a | yes | no | none | optional | documented | untested | optional (needs a capture set) |
| HumanNOVA | **none — no LICENSE file** (`license: null`) | unstated | unknown | no | download-only | CUDA 12.1 | nominal `cpu` flag, untested | not-attempted | **reject** |
| IDOL | MIT | checkpoint + SMPL-X/FLAME templates | **no** (SMPL-X academic-only) | **yes** (SMPL-X + FLAME registration) | download-only | CUDA 11.8, 24 GB | none | not-attempted | **reject** |
| PSHuman | MIT | CC BY 4.0 (reported) + SMPL-X for the conditioned variant | restricted | no | download-only | **> 40 GB VRAM** | none | not-attempted | **reject** |
| SAM 3D Body | MIT | SAM License (custom, not OSI) | restricted | **yes** (gated HF access) | download-only | **CUDA unconditionally** | none | not-attempted | **reject** |
| Sapiens2 | custom Meta Sapiens licence | same | restricted (needs review) | no | download-only | ViT 0.4–5 B | impractical | not-attempted | **reject** (not a generator) |
| Meshroom / AliceVision | MPL-2.0 | n/a | yes | no | download-only | **CUDA for MVS** | partial | not-attempted | **reject** (no GPU, no capture) |
| Nerfstudio | Apache-2.0 | n/a | yes | no | download-only | **CUDA for training** | none | not-attempted | **reject** (appearance ≠ mesh) |
| OpenMVS | **AGPL-3.0** | n/a | restricted | no | none | optional | documented | not-attempted | **reject** (copyleft) |
| SuGaR | **Inria/MPII research-only** | same | **no** | no | download-only | CUDA, 24 GB | none | not-attempted | **reject** |
| Stable Fast 3D | Stability AI Community License | same (gated) | restricted | **yes** | download-only | CUDA ~7 GB | none | not-attempted | **reject** |

`auditLicences()` asserts the invariant the mission set: **no adopted or optional
engine is restricted, gated or copyleft**. It currently reports 0 violations and
the test suite fails if that changes.

### The one finding that decides a whole branch of the search

HumanNOVA has **no licence file at all** — `GET /repos/HumanNOVA/HumanNOVA`
returns `"license": null`, and the repository root contains no `LICENSE`. Under
default copyright that grants nothing: not use, not modification, not
redistribution. Its quality claims are therefore irrelevant to a shippable
pipeline, and the matrix records `commercial: unknown` with decision `reject`
rather than the usual "open source, probably fine".

IDOL is the opposite trap: MIT code, but it *cannot run* without registering for
SMPL-X and FLAME, whose licences are academic-research-only. The MIT on the
repository does not travel through to an avatar built on those templates.

## 3. What was independently checked, and what was not

| claim | evidence | status |
| --- | --- | --- |
| Blender is GPL-2.0-or-later; output is not covered | blender.org licence page | documented |
| Cycles CPU renders this character | 13 benchmark renders from this machine | **tested** |
| TripoSR code and weights are MIT | repository + HF model card ("License: MIT") | documented |
| TripoSR CPU worker exists | `services/asre-reconstruct/triposr_worker.py` in this repo | present, not timed |
| HumanNOVA has no licence | GitHub API `license: null`; root listing has no LICENSE | **verified 2026-11-19** |
| IDOL requires SMPL-X/FLAME registration | IDOL `env/README.md`; SMPL-X licence text | documented |
| PSHuman needs > 40 GB VRAM | authors' FAQ, quoted in README | documented |
| SAM 3D Body needs a CUDA device unconditionally | INSTALL.md gating + an independent wrapper's report that a CPU-only machine raises | documented (independent) |
| Sapiens2 is not a character generator | its own task list: pose/seg/normal/pointmap/matting | documented |
| SuGaR is research-only | `LICENSE.md`: "non-commercially, i.e., for research and/or evaluation" | documented |
| OpenMVS is AGPL-3.0 | repository licence | documented |
| COLMAP/Meshroom/Nerfstudio licences | BSD-3 / MPL-2.0 / Apache-2.0 | documented |

Not done, and therefore not claimed: no candidate was installed and benchmarked
end-to-end except Blender (used for every render) and the repository's own PCI-FR
engine. TripoSR's CPU worker was not run in this pass; COLMAP was not installed
because there is no multi-view capture set to feed it.

## 4. Why the adopted architecture is the one adopted

1. **Blender + Cycles for output.** It is the only candidate that is free, local,
   account-free, CPU-capable, and whose output is unencumbered. It provides the
   physically based skin, subsurface scattering, metallic jewelry and studio
   lighting the mission asks for, and the renders prove it ran.
2. **PCI-FR for the human.** It is the only engine that preserves *her* measured
   identity (jaw 98.7 mm against the sheet's 96 mm, 149 baby strands, 100 %
   hairline coverage) without a GPU, an account, or a research-only dependency.
   Every GPU avatar model that might beat it on fidelity is either unlicensed,
   gated, or needs 24–40 GB of VRAM this machine does not have.
3. **TripoSR optional, for props.** MIT code and weights, a CPU worker already in
   the repository, and the mission explicitly forbids it as the human engine.
4. **COLMAP optional.** Legally clean and CPU-capable, but photogrammetry needs
   many views of one static subject; the 39 references are different hairstyles,
   expressions and skeletons, not a capture set. Claiming a reconstruction from
   them would be the exact mistake the mission warns about.

## 5. Reproduce this report

```
npx tsx scripts/foundry/run.ts status        # hardware.json + engine choices
npx tsx scripts/foundry/run.ts technologies  # licenses.json (matrix + audit)
npx tsx scripts/foundry/run.ts references    # references.json + 39/39 hash check
npx tsx scripts/foundry/run.ts plan          # shots.json
```

Licence sources, in the order the matrix used them: the repository `LICENSE`
file, the model card on Hugging Face, the project's own INSTALL/README, and — for
HumanNOVA — GitHub's licence API, because the absence of a file is the finding.
