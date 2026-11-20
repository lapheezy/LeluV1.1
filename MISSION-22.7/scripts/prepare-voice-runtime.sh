#!/usr/bin/env bash
# Prepare everything M22.7 needs to speak and listen on a fresh Linux checkout:
#   1. the shared libraries Chromium needs (no root),
#   2. a local Piper speaker + one voice model,
#   3. the five-phrase simulated-microphone WAV used by the acceptance harness.
#
# Nothing is installed system-wide and no paid service is contacted.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

echo "== 1/3 Chromium libraries (user-space Noble packages)"
python3 MISSION-22.7/scripts/resolve-browser-libs.py

echo "== 2/3 Piper engine + voice"
mkdir -p .piper/voices
if [ ! -x .piper/piper/piper ]; then
  curl -fsSL -A Mozilla/5.0 -o /tmp/piper.tar.gz \
    https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_linux_x86_64.tar.gz
  tar -xzf /tmp/piper.tar.gz -C .piper
fi
if [ ! -f .piper/voices/amy-low.onnx ]; then
  curl -fsSL -A Mozilla/5.0 -o .piper/voices/amy-low.onnx \
    "https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/amy/low/en_US-amy-low.onnx?download=true"
  curl -fsSL -A Mozilla/5.0 -o .piper/voices/amy-low.onnx.json \
    "https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/amy/low/en_US-amy-low.onnx.json?download=true"
fi

echo "== 3/3 simulated microphone track (five phrases, 3 s gaps)"
python3 - <<'PY'
import wave
parts = ['01-A', '05-A', '03-B', '06-A', '07-A']
out = wave.open('.piper/fake-mic-5.wav', 'wb')
out.setnchannels(1); out.setsampwidth(2); out.setframerate(48000)
silence = b'\x00\x00' * 48000 * 3
for part in parts:
    source = wave.open(f'docs/voice/listening-pack/{part}.wav')
    assert (source.getframerate(), source.getnchannels(), source.getsampwidth()) == (48000, 1, 2)
    out.writeframes(source.readframes(source.getnframes()))
    out.writeframes(silence)
out.close()
print('wrote .piper/fake-mic-5.wav')
PY

cat <<'EOF'

Ready. Start the app with the local voice enabled:
  PORT=4180 LELU_LOCAL_TTS_BIN=$PWD/.piper/piper/piper \
    LELU_LOCAL_TTS_MODEL=$PWD/.piper/voices/amy-low.onnx bun run server.ts
Then run the acceptance harness:
  node MISSION-22.7/scripts/voice-acceptance.mjs 45
EOF
