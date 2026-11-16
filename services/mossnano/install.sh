#!/usr/bin/env bash
# ==========================================================
# LÉLU — MOSS-TTS-Nano CPU worker: reproducible, anonymous install
#
#   bash services/mossnano/install.sh
#
# · runtime code: github.com/OpenMOSS/MOSS-TTS-Nano pinned at 8b7bcc9 (Apache-2.0)
# · weights: OpenMOSS-Team/MOSS-TTS-Nano-100M-ONNX + MOSS-Audio-Tokenizer-Nano-ONNX
#   (Apache-2.0, ungated) downloaded WITHOUT any token (HF_TOKEN emptied,
#   implicit tokens disabled): no account, no secret
# · CPU-only wheels; ~729 MB weights + ~0.9 GB environment
# Everything lands in .mossnano/ and .venv-mossnano/ (gitignored).
# ==========================================================
set -euo pipefail
cd "$(dirname "$0")/../.."
COMMIT=8b7bcc9
DIR=.mossnano
VENV=.venv-mossnano
mkdir -p "$DIR/state"
if [ ! -d "$DIR/src/.git" ]; then
  git clone -q https://github.com/OpenMOSS/MOSS-TTS-Nano "$DIR/src"
fi
git -C "$DIR/src" fetch -q --depth 50 origin || true
git -C "$DIR/src" checkout -q "$COMMIT"
command -v uv >/dev/null 2>&1 || { python3 -m pip install --user --quiet uv; export PATH="$HOME/.local/bin:$PATH"; }
[ -x "$VENV/bin/python" ] || uv venv -q "$VENV" --python 3.12
# torch/torchaudio only because the upstream module imports them; the worker
# itself loads audio with soundfile.
uv pip install -q --python "$VENV/bin/python" onnxruntime==1.32.0 numpy sentencepiece soundfile imageio-ffmpeg \
  huggingface-hub torch==2.7.0 torchaudio==2.7.0 --extra-index-url https://download.pytorch.org/whl/cpu
HF_TOKEN= HF_HUB_DISABLE_IMPLICIT_TOKEN=1 "$VENV/bin/python" -I - "$DIR/models" <<'PY'
import json, sys, time
from pathlib import Path
from huggingface_hub import snapshot_download
root = Path(sys.argv[1])
for repo in ("OpenMOSS-Team/MOSS-TTS-Nano-100M-ONNX", "OpenMOSS-Team/MOSS-Audio-Tokenizer-Nano-ONNX"):
    snapshot_download(repo, local_dir=str(root / repo.split("/")[1]), token=False)
Path(".mossnano/state/model-ready.json").write_text(json.dumps({"ready": True, "at": time.time(), "models": str(root)}))
print("weights ready (anonymous download)")
PY
"$VENV/bin/python" -c "import onnxruntime;print('onnxruntime', onnxruntime.__version__)"
