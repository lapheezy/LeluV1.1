# ASRE offline reconstruction service

| File | What |
| --- | --- |
| `setup.sh` | Installs Blender 4.2.23 LTS, a CPU-torch venv, TripoSR @ `107cefd` (MIT), torchmcubes @ `a9ac95a` (validation only) and the TripoSR weights (MIT, `stabilityai/TripoSR` @ `5b521936`, `model.ckpt` sha256 `429e2c6b…70ee`) into `/opt/lelu-tools`. |
| `triposr_worker.py` | One image → TripoSR CPU inference → scikit-image mesh, density lattice, front-visibility, optional upstream (torchmcubes) extraction on the same scene codes. |
| `blender_render.py` | Headless Cycles CPU render of GLBs, framed from imported bounds. |

Run (from the repo root):

```bash
services/asre-reconstruct/setup.sh
HF_HOME=/opt/lelu-tools/hf-home HF_HUB_OFFLINE=1 LELU_TRIPOSR_SRC=/opt/lelu-tools/TripoSR \
  /opt/lelu-tools/asre-venv/bin/python -I services/asre-reconstruct/triposr_worker.py \
  '{"image":"/opt/lelu-tools/TripoSR/examples/police_woman.png","out_dir":"artifacts/asre/triposr/police_woman","upstream_check":true}'
npx tsx scripts/asre/triposr-ingest.ts artifacts/asre/triposr/police_woman
```

Licensing: TripoSR code and weights are MIT; DINO ViT-B/16 config (Apache-2.0); Blender GPL (used as a separate program); scikit-image BSD; torchmcubes MIT. No weights or binaries are committed.
