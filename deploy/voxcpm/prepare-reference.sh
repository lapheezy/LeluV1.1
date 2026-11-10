#!/usr/bin/env bash
# ==========================================================
# LÉLU — PREPARE THE REFERENCE CLIP FOR VOXCPM2
#
# Derives the model's reference audio from the COMMITTED recording.
# Nothing here replaces, renames or overwrites the original — it is
# only ever read.
#
#   public/audio/voice/lelu-voice-reference.m4a   (committed, untouched)
#        -> deploy/voxcpm/reference/lelu-voice-reference-44k-mono.wav
#
# The WAV is generated, not committed (see .gitignore).
#
# Optional single-speaker window. The committed clip is an acted
# dialogue with more than one voice in it; a clone driven by the whole
# file inherits the scene rather than one speaker. Set START/DURATION
# to the stretch that is one person speaking before running.
#
#   START=39 DURATION=8 ./deploy/voxcpm/prepare-reference.sh
# ==========================================================
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SOURCE="${REPO_ROOT}/public/audio/voice/lelu-voice-reference.m4a"
OUT_DIR="${REPO_ROOT}/deploy/voxcpm/reference"
OUT="${OUT_DIR}/lelu-voice-reference-44k-mono.wav"

START="${START:-}"
DURATION="${DURATION:-}"
SAMPLE_RATE="${SAMPLE_RATE:-44100}"

FFMPEG="${FFMPEG:-ffmpeg}"
if ! command -v "$FFMPEG" >/dev/null 2>&1; then
  echo "ffmpeg not found. Install it (apt install ffmpeg) or set FFMPEG=/path/to/ffmpeg." >&2
  exit 1
fi

if [ ! -f "$SOURCE" ]; then
  echo "Reference recording is missing at ${SOURCE#"$REPO_ROOT"/}." >&2
  echo "Refusing to substitute another recording." >&2
  exit 1
fi

mkdir -p "$OUT_DIR"

TRIM=()
if [ -n "$START" ] && [ -n "$DURATION" ]; then
  TRIM=(-ss "$START" -t "$DURATION")
  echo "Using window: start=${START}s duration=${DURATION}s"
fi

"$FFMPEG" -y -v error "${TRIM[@]}" -i "$SOURCE" \
  -ac 1 -ar "$SAMPLE_RATE" -c:a pcm_s16le "$OUT"

echo "Wrote ${OUT#"$REPO_ROOT"/} ($(wc -c <"$OUT") bytes)"
echo "SHA-256: $(sha256sum "$OUT" | cut -d' ' -f1)"
echo
echo "Source (unmodified) SHA-256: $(sha256sum "$SOURCE" | cut -d' ' -f1)"
echo
echo "Next: get the spoken transcript of THIS clip and give it to the"
echo "route as VOXCPM_REFERENCE_TEXT. VoxCPM2 pairs the prompt audio with"
echo "its exact transcript; a wrong transcript degrades the clone."
