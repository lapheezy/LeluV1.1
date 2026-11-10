#!/usr/bin/env bash
# ==========================================================
# LÉLU — FIVE-SENTENCE VOICE EVALUATION
#
# Runs the mission's five test sentences through her cloned voice
# and saves each sample for listening-based comparison against the
# committed recording. Requires a deployed VoxCPM2 (see README.md).
#
#   ./deploy/voxcpm/evaluate-voice.sh [base-url]
#
# Default base URL: http://127.0.0.1:5173 (LÉLU dev/preview server).
# Samples land in artifacts/voice/eval/ (ignored by git).
# ==========================================================
set -euo pipefail

BASE="${1:-http://127.0.0.1:5173}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUT_DIR="${REPO_ROOT}/artifacts/voice/eval"
mkdir -p "$OUT_DIR"

# 1. normal conversational  2. longer explanation  3. question
# 4. warm and expressive    5. numbers and unusual words
SENTENCES=(
  "Good evening. I have finished reviewing the repository, and everything is in order."
  "The interesting part is not that the parser failed, but why it failed: the fixture still expected three arguments, so every assertion after the first one was measuring the wrong value entirely."
  "Would you like me to walk you through the change, or would you rather see the diff first?"
  "I missed you today, and I am glad you are here. Come, sit with me for a moment; the evening is quiet and there is no rush."
  "In nineteen eighty-four, exactly forty-two satellites crossed the Oort cloud, and the Nginx reverse proxy logged three thousand one hundred and seven requests in under ninety seconds."
)

STATUS="$(curl -sS --max-time 10 "${BASE}/api/voice/voxcpm/status" || true)"
echo "status: ${STATUS}"
if ! printf '%s' "$STATUS" | grep -q '"configured":true'; then
  echo
  echo "Her reference voice is not configured, so nothing was generated." >&2
  echo "See deploy/voxcpm/README.md (needs a GPU with ~8 GB VRAM)." >&2
  exit 1
fi

for i in "${!SENTENCES[@]}"; do
  n=$((i + 1))
  text="${SENTENCES[$i]}"
  out="${OUT_DIR}/sentence-${n}.wav"
  echo
  echo "[$n/5] ${text}"
  code="$(curl -sS --max-time 180 -o "$out" -w "%{http_code}" \
    -H 'Content-Type: application/json' \
    -d "$(printf '{"text":%s}' "$(printf '%s' "$text" | python3 -c 'import json,sys;print(json.dumps(sys.stdin.read()))')")" \
    "${BASE}/api/voice/voxcpm/tts")"
  if [ "$code" != "200" ]; then
    echo "  FAILED: HTTP ${code}" >&2
    rm -f "$out"
    continue
  fi
  echo "  wrote $(basename "$out") ($(wc -c <"$out") bytes)"
done

echo
echo "Samples: ${OUT_DIR#"$REPO_ROOT"/}"
echo "Compare each against public/audio/voice/lelu-voice-reference.m4a by ear."
echo "Speaker similarity is a listening judgement — nothing here proves it."
