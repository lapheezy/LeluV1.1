#!/usr/bin/env bash
# Restore the LÉLU foundry toolchain after a workspace restore.
# The venv lives in .foundry/ and is git-ignored, so it is NOT checkpointed:
# re-run this after any restart. Costs nothing, downloads from PyPI only.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
VENV="$ROOT/.foundry/venv"
SYSROOT_LIB="$ROOT/.foundry/sysroot/usr/lib/x86_64-linux-gnu"

command -v uv >/dev/null || { echo "uv is required (https://docs.astral.sh/uv/)"; exit 1; }

if [ ! -x "$VENV/bin/python" ]; then
  echo "[bootstrap] creating venv (python 3.11, required by the bpy 4.5 wheels)"
  uv venv --python 3.11 "$VENV"
fi

echo "[bootstrap] installing pinned dependencies"
uv pip install --python "$VENV/bin/python" \
  "bpy==4.5.9" numpy pillow gradio_client nbformat

echo "[bootstrap] checking Blender import"
LD_LIBRARY_PATH="$SYSROOT_LIB${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}" \
  "$VENV/bin/python" - <<'PY'
import bpy, numpy, PIL
print("bpy", bpy.app.version_string, "| numpy", numpy.__version__, "| pillow ok")
PY

echo "[bootstrap] ready. Use:"
echo "  export LD_LIBRARY_PATH=$SYSROOT_LIB"
echo "  $VENV/bin/python scripts/foundry/import_cloud_mesh.py '{...}'"
