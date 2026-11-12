#!/usr/bin/env bash
# ==========================================================
# LÉLU — VoxCPM2 sidecar: reproducible environment
# ==========================================================
#
# Safe to run again at any time. It does not reinstall a working
# torch/torchaudio pair, because the expensive way to break this
# environment is exactly that: a CPU torch with a CUDA torchaudio
# raises `libcudart.so.13: cannot open shared object file` at import.
#
#   bash services/voxcpm/install.sh            # CPU or GPU, auto-detected
#   VOXCPM_FORCE_TORCH=1 bash .../install.sh   # repair a broken pair
#
set -euo pipefail
cd "$(dirname "$0")/../.."

VENV="${VOXCPM_VENV:-.venv-voxcpm}"
PY="$VENV/bin/python"

if ! command -v uv >/dev/null 2>&1; then
  echo "uv not found; installing it (pip --user)" >&2
  python3 -m pip install --user --quiet uv
  export PATH="$HOME/.local/bin:$PATH"
fi

if [ ! -x "$PY" ]; then
  echo "creating $VENV (python 3.12)" >&2
  uv venv "$VENV" --python 3.12
fi

GPU=""
if command -v nvidia-smi >/dev/null 2>&1 && nvidia-smi -L >/dev/null 2>&1; then
  GPU="$(nvidia-smi --query-gpu=name,memory.total --format=csv,noheader | head -1)"
fi

TORCH_OK=0
if [ "${VOXCPM_FORCE_TORCH:-0}" != "1" ] && "$PY" -c "import torch, torchaudio" >/dev/null 2>&1; then
  TORCH_OK=1
fi

if [ "$TORCH_OK" = "1" ]; then
  echo "torch + torchaudio already import cleanly — leaving them alone" >&2
elif [ -n "$GPU" ]; then
  echo "GPU detected ($GPU) — installing the CUDA build of torch" >&2
  uv pip install --python "$PY" --reinstall torch torchaudio
else
  echo "no GPU detected — installing the CPU build of torch" >&2
  uv pip install --python "$PY" --reinstall torch torchaudio \
    --index-url https://download.pytorch.org/whl/cpu
fi

uv pip install --python "$PY" -r services/voxcpm/requirements.txt
uv pip freeze --python "$PY" > services/voxcpm/requirements.lock

echo "--- what this machine now has ---" >&2
"$PY" - <<'PY'
import json
import torch, torchaudio, soundfile, numpy, imageio_ffmpeg
try:
    import voxcpm
    version = getattr(voxcpm, "__version__", "unknown")
except Exception as exc:  # reported, never hidden
    version = f"import failed: {exc}"
print(json.dumps({
    "torch": torch.__version__,
    "torchaudio": torchaudio.__version__,
    "cuda": torch.cuda.is_available(),
    "device": torch.cuda.get_device_name(0) if torch.cuda.is_available() else "cpu",
    "vramGb": round(torch.cuda.get_device_properties(0).total_memory / 1e9, 2) if torch.cuda.is_available() else None,
    "threads": torch.get_num_threads(),
    "numpy": numpy.__version__,
    "soundfile": soundfile.__version__,
    "ffmpeg": imageio_ffmpeg.get_ffmpeg_exe(),
    "voxcpm": version,
}, indent=2))
PY

echo "next: python services/voxcpm/bootstrap.py && python services/voxcpm/server.py --warmup" >&2
