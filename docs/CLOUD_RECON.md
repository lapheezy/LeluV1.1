# LÉLU zero-cost cloud reconstruction — runbook

No paid compute, no GPU purchase, no credits, no paid API. Everything below
uses free hosted GPU time or free notebook GPUs.

## What was actually tested (2026-11-17)

| route | endpoint | result |
|---|---|---|
| PSHuman | `fffiloni/PSHuman` `/process_image` | **blocked**: `The requested GPU duration (140s) is larger than the maximum allowed` — the Space hard-codes a 140 s ZeroGPU request, above the free allowance |
| TRELLIS.2 | `microsoft/TRELLIS.2` `/image_to_3d` | **blocked**: `You have exceeded your ZeroGPU quota (120s requested vs. 0s left) … Authenticate with a Hugging Face token for more quota` |
| TripoSR | `stabilityai/TripoSR` | Space sleeping (HTTP 503) |
| import + validate | `scripts/foundry/import_cloud_mesh.py` on `base.obj` | **works**: normalises to 1.72 m, reports 19,158 verts / 36,972 tris / 154 components, renders front, three-quarter, profile, back, writes `compare.png` |

Raw evidence for every attempt is appended to
`foundry/cloud/runs.jsonl` (space, endpoint, input sha256, timestamps, wall
clock, error text verbatim, output hashes).

## The one missing piece: a free Hugging Face token

Anonymous ZeroGPU quota is 0 s, so every GPU Space refuses the job. A free HF
account raises it; this costs nothing and needs no payment method.

1. Create a free account at huggingface.co (iPhone is fine).
2. Settings → Access Tokens → New token, **read** scope.
3. In Freebuff: Settings → Project settings → Secrets → add `HF_TOKEN`.
   Never paste it into chat; the runner reads it from the environment and never
   writes it to disk.

Then:

```bash
export LD_LIBRARY_PATH=$PWD/.foundry/sysroot/usr/lib/x86_64-linux-gnu
PY=.foundry/venv/bin/python
IMG=leluverse/assets/characters/lelu_character/references/PRIMARY_SOURCE/04_front_apose.png

# body reconstruction (PSHuman-120 variant fits the free 120 s cap)
$PY scripts/foundry/cloud_recon.py pshuman "$IMG"

# individual assets: hair ornaments, jewellery, boots, buckles (TRELLIS.2, MIT)
$PY scripts/foundry/cloud_recon.py trellis \
    leluverse/assets/characters/lelu_character/references/PH_ornament.png
```

Outputs land in `foundry/cloud/<route>_<timestamp>/` and are copied out of the
Space immediately, with sha256 per file, so nothing lives only in a Space.

## Horizontal flip handling (requested item 5)

`fffiloni/PSHuman` mirrors every input at `app.py:56`:

```python
# Flip the image horizontally
image = image.transpose(Image.FLIP_LEFT_RIGHT)
```

Our runner therefore sends a pre-mirrored copy (`input_preflipped.png`), so the
Space's flip restores the photograph's true orientation and asymmetric details
(thigh tattoo, hair sweep, single-shoulder straps) stay on the correct side.
The flag is recorded per run as `input_preflipped_for_space_flip: true`.

## PSHuman duration problem

The Space requests 140 s of ZeroGPU in one call. Free accounts are capped below
that, so that Space cannot serve a free run at all. Options, all zero-cost:

- use `jonasgk/PSHuman-120` (120 s request) with the token,
- or run PSHuman in a free Kaggle P100 notebook (weights from the repo, MIT/
  research licences — audit before commercial distribution),
- TripoSR (~6 GB VRAM) on Kaggle as the lighter fallback for single assets.

## Import, refine, validate

```bash
$PY scripts/foundry/import_cloud_mesh.py '{"mesh":"foundry/cloud/<run>/output.glb",
  "outDir":"foundry/cloud/<run>/blender","height":1.72}'
```

This is the gate: proportions are checked against the calibrated landmarks
(hairline 0.0305, eye 0.0662, chin 0.1492, shoulder 0.1754, bust 0.2216,
waist 0.2805, belt 0.3277, crotch 0.4580, knee 0.7350, ankle 0.9000 of figure
height), and four views are rendered against PRIMARY_SOURCE. A mesh that fails
the gate is not "reconstructed".

## Environment restore (after a workspace restart)

`.foundry/venv` is git-ignored, so it is not checkpointed and disappears when the
runner restarts. Blender's sysroot and the downloaded Blender build survive.
Restore in one command (free, PyPI only):

```bash
bash scripts/foundry/bootstrap_env.sh
```

It recreates the venv on Python 3.11, pins `bpy==4.5.9`, numpy, pillow,
gradio_client and nbformat, and prints the `LD_LIBRARY_PATH` line to export.
Verified 2026-11-17 after a restart: `bpy 4.5.9 LTS`, numpy 1.26.4, and the
import gate re-ran on `base.obj` producing four renders plus `compare.png`.
