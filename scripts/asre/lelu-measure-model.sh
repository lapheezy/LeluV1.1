#!/usr/bin/env bash
# Measure the model's face exactly as her references were measured:
# orthographic front render of the bare head (no hair, no head jewelry),
# neutral light, then the same landmark detector and metric definitions.
#   scripts/asre/lelu-measure-model.sh <glb> <outDir>
# Needs: LELU_LANDMARK_PY (python with mediapipe), LELU_LANDMARK_MODEL (face_landmarker.task)
set -euo pipefail
GLB=$1; OUT=$2; mkdir -p "$OUT"
node -e '
import("./scripts/asre/render.mjs").then(m => m.renderViews({ glb: process.argv[1], outDir: process.argv[2], views: ["front"], prefix: "head-ortho-",
  resolution: [900, 900], samples: 32, camera: { center: [0, -0.1, 1.555], radius: 0.13 }, ortho: true, hide: ["hair", "accessories.head"],
  lighting: "neutral", materials: "classes", denoise: true, viewTransform: "AgX" }))' "$GLB" "$OUT" >/dev/null
"${LELU_LANDMARK_PY:-python3}" scripts/asre/lelu-landmarks.py --model "${LELU_LANDMARK_MODEL:-face_landmarker.task}" --out "$OUT" "$OUT/head-ortho-front.png" 2>&1 | grep -v "^[WIE]0000\|INFO\|WARNING" | grep -v "±" || true
"${LELU_LANDMARK_PY:-python3}" scripts/asre/lelu-compare-landmarks.py artifacts/lelu/wp04/reference-landmarks/landmarks.json "$OUT/landmarks.json" --out "$OUT/comparison.json"
