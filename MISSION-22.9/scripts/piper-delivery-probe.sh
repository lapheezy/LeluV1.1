#!/usr/bin/env bash
# M22.9 / WP01+WP05 probe — per-request delivery over one warm process.
#
# A persistent worker is only useful for personality-driven speech if the
# delivery of one sentence (pace, variation, trailing silence) can differ from
# the next WITHOUT restarting the process. This probe measures whether the
# json-input protocol honours per-request `length_scale` / `noise_scale`
# (judged by output duration), and what one warm worker costs in RSS.
set -u

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PIPER="$ROOT/.piper/piper/piper"
MODEL="${LELU_LOCAL_TTS_MODEL:-$ROOT/.piper/voices/amy-low.onnx}"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

DUR() { # WAV data bytes -> seconds at 16 kHz mono 16-bit
  local bytes=$1
  awk -v b="$bytes" 'BEGIN { printf "%.3f", (b/2)/16000 }'
}
PCM() { echo $(( $(stat -c%s "$1") - 44 )); }

TEXT="Delivery is the part of speech that carries meaning without changing a single word."

echo "## 1. baseline via CLI flags (cold processes)"
START=$(date +%s%N)
printf '%s' "$TEXT" | "$PIPER" --model "$MODEL" --output_file "$WORK/cli-1.0.wav" 2>/dev/null
BASE_PCM=$(PCM "$WORK/cli-1.0.wav")
echo "length_scale=1.0 duration=$(DUR $BASE_PCM)s bytes=$BASE_PCM"
for LS in 0.9 1.15; do
  printf '%s' "$TEXT" | "$PIPER" --model "$MODEL" --output_file "$WORK/cli-$LS.wav" --length_scale $LS 2>/dev/null
  P=$(PCM "$WORK/cli-$LS.wav")
  echo "length_scale=$LS duration=$(DUR $P)s bytes=$P"
done

echo
echo "## 2. per-request fields over ONE persistent json-input process"
{
  printf '{"text":"%s","output_file":"%s/warm-1.0.wav"}\n' "$TEXT" "$WORK"
  printf '{"text":"%s","output_file":"%s/warm-0.9.wav","length_scale":0.9}\n' "$TEXT" "$WORK"
  printf '{"text":"%s","output_file":"%s/warm-1.15.wav","length_scale":1.15}\n' "$TEXT" "$WORK"
  printf '{"text":"%s","output_file":"%s/warm-noise.wav","noise_scale":0.3}\n' "$TEXT" "$WORK"
} | "$PIPER" --model "$MODEL" --json-input >/dev/null 2>"$WORK/json.err"
for f in warm-1.0 warm-0.9 warm-1.15 warm-noise; do
  if [ -f "$WORK/$f.wav" ]; then
    P=$(PCM "$WORK/$f.wav")
    echo "$f duration=$(DUR $P)s bytes=$P"
  else
    echo "$f MISSING"
  fi
done
echo "stderr_tail: $(tail -c 300 "$WORK/json.err" | tr '\n' ' ')"

echo
echo "## 3. warm-process RSS and per-sentence cost (10 sentences, one process)"
{
  printf '{"text":"Warm up the model.","output_file":"%s/rss-0.wav"}\n' "$WORK"
  sleep 1
  for i in $(seq 1 10); do
    printf '{"text":"Sentence number %s, warm and short.","output_file":"%s/rss-%s.wav"}\n' "$i" "$WORK" "$i"
  done
  sleep 1
  echo "done"
} | "$PIPER" --model "$MODEL" --json-input >/dev/null 2>&1 &
BG=$!
sleep 1.2
PID=$(pgrep -P $$ -n piper 2>/dev/null || pgrep -n piper 2>/dev/null || true)
if [ -n "${PID:-}" ]; then
  RSS_KB=$(awk '/VmRSS/ {print $2}' "/proc/$PID/status" 2>/dev/null || echo 0)
  echo "warm_worker_pid=$PID rss_kb=$RSS_KB rss_mib=$(awk -v k="$RSS_KB" 'BEGIN {printf "%.1f", k/1024}')"
else
  echo "warm_worker_pid=unavailable"
fi
wait $BG 2>/dev/null

echo
echo "## 4. concurrency: two warm workers, two sentences at once"
START=$(date +%s%N)
( printf '{"text":"The first concurrent request.","output_file":"%s/c1.wav"}\n' "$WORK"; sleep 1 ) |
  "$PIPER" --model "$MODEL" --json-input >/dev/null 2>&1 &
( printf '{"text":"The second concurrent request.","output_file":"%s/c2.wav"}\n' "$WORK"; sleep 1 ) |
  "$PIPER" --model "$MODEL" --json-input >/dev/null 2>&1 &
wait
echo "two_processes_total=$(( ($(date +%s%N) - START) / 1000000 )) ms"
