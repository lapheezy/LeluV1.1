#!/usr/bin/env bash
# LÉLU ASRE — offline toolchain (no account, no API key, no paid service).
# Installs into ${LELU_TOOLS:-/opt/lelu-tools}. Nothing here is committed to git.
set -euo pipefail
T=${LELU_TOOLS:-/opt/lelu-tools}
mkdir -p "$T" && cd "$T"

# Blender 4.2 LTS (GPL), headless Cycles CPU rendering
if [ ! -x blender-4.2.23-linux-x64/blender ]; then
  curl -sSL -o blender.tar.xz https://download.blender.org/release/Blender4.2/blender-4.2.23-linux-x64.tar.xz
  tar xf blender.tar.xz && rm blender.tar.xz
fi

# Python worker venv (CPU torch)
if [ ! -x asre-venv/bin/python ]; then
  python3 -m venv asre-venv
  asre-venv/bin/pip install -q --upgrade pip
  asre-venv/bin/pip install -q torch torchvision --index-url https://download.pytorch.org/whl/cpu
  asre-venv/bin/pip install -q "numpy>=2" omegaconf einops "transformers>=4.40,<5" trimesh scikit-image scipy pillow huggingface-hub rembg onnxruntime pybind11 cmake ninja scikit-build-core
fi

# TripoSR code (MIT), pinned
if [ ! -d TripoSR ]; then
  git clone -q https://github.com/VAST-AI-Research/TripoSR.git
  git -C TripoSR checkout -q 107cefdc244c39106fa830359024f6a2f1c78871
fi

# Upstream marching cubes (tsr imports it; also used to validate against upstream TripoSR).
# -I and a real symbol: run from $T, a bare "import torchmcubes" finds the cloned
# source folder as an empty namespace package and would skip a failed build.
asre-venv/bin/pip install -q scikit-build-core
if ! asre-venv/bin/python -I -c "from torchmcubes import marching_cubes" 2>/dev/null; then
  [ -d torchmcubes ] || git clone -q https://github.com/tatsy/torchmcubes.git
  git -C torchmcubes checkout -q a9ac95aa329957ba646e7bb057f825f5dfa77f38
  (cd torchmcubes && PATH="$T/asre-venv/bin:$PATH" CMAKE_PREFIX_PATH="$("$T/asre-venv/bin/python" -c "import torch,pybind11;print(torch.utils.cmake_prefix_path+';'+pybind11.get_cmake_dir())")" "$T/asre-venv/bin/pip" install -q --no-build-isolation .)
fi

# Weights (MIT): stabilityai/TripoSR @ 5b521936 and the DINO config it loads
HF_HOME="$T/hf-home" asre-venv/bin/python - <<'PY'
from huggingface_hub import hf_hub_download
for f in ("config.yaml", "model.ckpt"):
    hf_hub_download("stabilityai/TripoSR", f, revision="5b521936b01fbe1890f6f9baed0254ab6351c04a")
for f in ("config.json", "preprocessor_config.json"):
    hf_hub_download("facebook/dino-vitb16", f)
PY
echo "expected model.ckpt sha256: 429e2c6b22a0923967459de24d67f05962b235f79cde6b032aa7ed2ffcd970ee"
sha256sum "$T"/hf-home/hub/models--stabilityai--TripoSR/snapshots/*/model.ckpt
