#!/usr/bin/env bash
# M22.9 / WP01 — empirical probe of the installed Piper binary.
#
# Answers three questions with measurements, not assumptions:
#   1. How long does a cold process take per sentence (model load included)?
#   2. Does one `--json-input` process serve many sentences, and how much of
#      the cold cost disappears?
#   3. Does `--output_raw` on a persistent process concatenate cleanly, and do
#      per-request WAV files carry a patched header (usable as a completion
#      signal)?
#
# Usage: bash MISSION-22.9/scripts/piper-persistence-probe.sh
set -u

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PIPER="$ROOT/.piper/piper/piper"
MODEL="${LELU_LOCAL_TTS_MODEL:-$ROOT/.piper/voices/amy-low.onnx}"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

if [ ! -x "$PIPER" ] || [ ! -f "$MODEL" ]; then
  echo "SKIP: piper binary or model not present"
  exit 0
fi

S1="The mission runtime is warm."
S2="Second sentence, same model."
S3="Third sentence, same model."
S4="Fourth sentence, same model."
S5="Fifth sentence, same model."

ms() { echo $(( ($(date +%s%N) - $1) / 1000000 )); }

echo "## A. cold process per sentence (5 separate processes)"
TOTAL_START=$(date +%s%N)
for i in 1 2 3 4 5; do
  TEXT="Sentence number $i speaking from a cold process."
  START=$(date +%s%N)
  printf '%s' "$TEXT" | "$PIPER" --model "$MODEL" --output_file "$WORK/cold-$i.wav" 2>/dev/null
  echo "cold[$i] $(ms $START) ms  bytes=$(stat -c%s "$WORK/cold-$i.wav" 2>/dev/null || echo 0)"
done
echo "cold_total $(ms $TOTAL_START) ms"

echo
echo "## B. one persistent --json-input process (5 sentences, WAV files)"
TOTAL_START=$(date +%s%N)
{
  for i in 1 2 3 4 5; do
    printf '{"text":"Sentence number %s speaking from a warm process.","output_file":"%s/warm-%s.wav"}\n' "$i" "$WORK" "$i"
  done
} | "$PIPER" --model "$MODEL" --json-input 2>/dev/null
echo "warm_total_batch $(ms $TOTAL_START) ms (includes process start + one model load)"
for i in 1 2 3 4 5; do
  echo "  warm[$i] bytes=$(stat -c%s "$WORK/warm-$i.wav" 2>/dev/null || echo 0)"
done

echo
echo "## C. one persistent --json-input process, raw PCM to stdout"
{
  printf '{"text":"%s","output_file":"-"}\n' "$S1"
  printf '{"text":"%s","output_file":"-"}\n' "$S2"
  printf '{"text":"%s","output_file":"-"}\n' "$S3"
  printf '{"text":"%s","output_file":"-"}\n' "$S4"
  printf '{"text":"%s","output_file":"-"}\n' "$S5"
} | "$PIPER" --model "$MODEL" --json-input --output_raw >"$WORK/all.raw" 2>/dev/null
echo "raw_concat_bytes=$(stat -c%s "$WORK/all.raw")"

echo
echo "## D. per-sentence WAV (same model, separate cold processes) for comparison"
SUM_PCM=0
for i in 1 2 3 4 5; do
  case $i in
    1) TEXT="$S1";; 2) TEXT="$S2";; 3) TEXT="$S3";; 4) TEXT="$S4";; 5) TEXT="$S5";;
  esac
  printf '%s' "$TEXT" | "$PIPER" --model "$MODEL" --output_file "$WORK/single-$i.wav" 2>/dev/null
  BYTES=$(stat -c%s "$WORK/single-$i.wav")
  PCM=$(( BYTES - 44 ))
  if [ $PCM -lt 0 ]; then PCM=0; fi
  SUM_PCM=$(( SUM_PCM + PCM ))
  echo "single[$i] pcm_bytes=$PCM"
done
echo "sum_pcm_bytes=$SUM_PCM"

echo
echo "## E. WAV header of a warm request (is the data size patched at the end?)"
od -An -tu4 -j4 -N4 "$WORK/warm-1.wav" 2>/dev/null | awk '{print "riff_size_field="$1}'
od -An -tu4 -j40 -N4 "$WORK/warm-1.wav" 2>/dev/null | awk '{print "data_size_field="$1}'
echo "file_size=$(stat -c%s "$WORK/warm-1.wav")"

echo
echo "## F. model load cost alone (first request in a warm process vs the rest)"
START=$(date +%s%N)
printf '{"text":"Warm up.","output_file":"%s/first.wav"}\n{"text":"Second.","output_file":"%s/second.wav"}\n{"text":"Third.","output_file":"%s/third.wav"}\n' "$WORK" "$WORK" "$WORK" |
  "$PIPER" --model "$MODEL" --json-input 2>/dev/null
echo "three_in_one_process_total $(ms $START) ms"
