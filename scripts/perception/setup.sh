#!/usr/bin/env bash
# ==========================================================
# LÉLU — perception + replication environment (PCI-FR 1.0)
#
# Reproduces the exact environment the WP02–WP06 pipeline ran in:
#   • a project-local virtualenv (nothing is installed system-wide)
#   • Python deps: numpy, opencv-python-headless, Pillow, mediapipe, scipy
#   • libEGL/libGLESv2 unpacked from their .deb into .libs/ — MediaPipe's
#     Python bindings dlopen them, and this machine has no root, so the
#     libraries are extracted locally and exposed through LD_LIBRARY_PATH.
#
#   scripts/perception/setup.sh
#   source scripts/perception/env.sh
#   python scripts/perception/lelu_replicate.py --out artifacts/pci-fr-1.0
# ==========================================================
set -euo pipefail

root="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$root"

echo "── virtualenv"
python3 -m venv .venv-perception
.venv-perception/bin/pip install --quiet --upgrade pip
.venv-perception/bin/pip install --quiet numpy opencv-python-headless Pillow mediapipe scipy

echo "── libEGL / libGLESv2 (workspace-local, no root)"
libdir=".libs/root/usr/lib/x86_64-linux-gnu"
if [ ! -f "$libdir/libEGL.so.1" ]; then
  mkdir -p .libs/deb
  version="1.7.0-1build1"
  base="http://archive.ubuntu.com/ubuntu/pool/main/libg/libglvnd"
  for pkg in libglvnd0 libegl1 libgles2; do
    curl -sfL "$base/${pkg}_${version}_amd64.deb" -o ".libs/deb/${pkg}.deb"
    dpkg-deb -x ".libs/deb/${pkg}.deb" .libs/root
  done
fi

cat > scripts/perception/env.sh <<'ENV'
# source this before running the perception pipeline
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
export LD_LIBRARY_PATH="$root/.libs/root/usr/lib/x86_64-linux-gnu:${LD_LIBRARY_PATH:-}"
export GLOG_minloglevel=2
export PY="$root/.venv-perception/bin/python"
ENV

echo "── verify"
LD_LIBRARY_PATH="$root/$libdir:${LD_LIBRARY_PATH:-}" GLOG_minloglevel=2 \
  .venv-perception/bin/python - <<'PY'
import cv2, mediapipe, numpy, scipy
from PIL import Image
print("mediapipe", mediapipe.__version__, "| opencv", cv2.__version__, "| numpy", numpy.__version__)
PY
echo "ready: source scripts/perception/env.sh"
