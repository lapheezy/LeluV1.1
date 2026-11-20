#!/usr/bin/env bash
# M22.9 / WP01 — second probe: streaming shape of a persistent Piper.
#
# Probe 1 established: `--json-input` makes one process serve many sentences
# (5 sentences in 1.2 s vs 7.2 s cold) but `--output_raw` yields ~0 bytes on
# stdout in that mode. This probe answers:
#   1. Does `output_file: "-"` (WAV) work at all in json-input mode?
#   2. Does Piper write PCM into a real output file *while* synthesising, or
#      only when the sentence is finished? (decides incremental delivery)
#   3. Is the WAV data-size field patched only at the end? (completion signal)
set -u

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PIPER="$ROOT/.piper/piper/piper"
MODEL="${LELU_LOCAL_TTS_MODEL:-$ROOT/.piper/voices/amy-low.onnx}"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

echo "## 1. json-input, output_file \"-\" (no --output_raw)"
printf '{"text":"Hello from stdout.","output_file":"-"}\n' |
  "$PIPER" --model "$MODEL" --json-input >"$WORK/stdout.wav" 2>"$WORK/stdout.err"
echo "stdout_bytes=$(stat -c%s "$WORK/stdout.wav")"
head -c 200 "$WORK/stdout.err" | tr '\n' ' '; echo

echo
echo "## 2. growth of a real output file during synthesis of a long text"
LONG="This is a deliberately long sentence, written so that the speech engine takes a measurable amount of time to synthesise it, long enough that we can watch the output file grow while the work is still in progress, and long enough that a single poll interval cannot cover the whole synthesis."
( printf '{"text":"%s","output_file":"%s/long.wav"}\n' "$LONG" "$WORK"; sleep 3 ) |
  "$PIPER" --model "$MODEL" --json-input >/dev/null 2>"$WORK/long.err" &
BG=$!
for i in $(seq 1 40); do
  if [ -f "$WORK/long.wav" ]; then
    SIZE=$(stat -c%s "$WORK/long.wav")
    DATA=$(od -An -tu4 -j40 -N4 "$WORK/long.wav" 2>/dev/null | tr -d ' ')
    echo "t=$((i*25))ms size=$SIZE data_field=${DATA:-na}"
    if [ -n "${DATA:-}" ] && [ "$DATA" != "0" ] && [ $((DATA + 44)) -eq "$SIZE" ] && [ "$SIZE" -gt 1000 ]; then
      echo "COMPLETE_AT $((i*25))ms size=$SIZE data=$DATA"
      break
    fi
  else
    echo "t=$((i*25))ms no_file"
  fi
  sleep 0.025
done
wait $BG 2>/dev/null

echo
echo "## 3. does the placeholder header start at zero?"
printf '{"text":"Short sentence.","output_file":"%s/short.wav"}\n' "$WORK" |
  "$PIPER" --model "$MODEL" --json-input >/dev/null 2>&1
echo "short_size=$(stat -c%s "$WORK/short.wav") short_data=$(od -An -tu4 -j40 -N4 "$WORK/short.wav" | tr -d ' ')"
