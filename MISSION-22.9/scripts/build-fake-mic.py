#!/usr/bin/env python3
"""
M22.8 — build a multi-turn SIMULATED microphone file.

The container has no physical microphone. Chromium's
--use-file-for-fake-audio-capture reads a WAV as if it were the device, so
this script speaks twenty short questions with the same local Piper voice
used for output, plus a silence gap long enough for the energy VAD to end
a turn (900 ms) between each, and resamples everything to 48 kHz mono
16-bit — the format the device path expects.

Every phrase is separated by 1.4 s of silence, and the file starts with
1.0 s of silence so the noise floor can be learned before the first word.

Usage:
  python3 MISSION-22.8/scripts/build-fake-mic.py \
      --piper .piper/piper/piper --model .piper/voices/amy-low.onnx \
      --out .piper/fake-mic-20.wav
"""

import argparse
import audioop
import os
import subprocess
import sys
import tempfile
import wave

PHRASES = [
    "Hello Lélu, are you listening?",
    "What is the capital of Peru?",
    "Tell me one fact about the ocean.",
    "What time complexity does binary search have?",
    "Can you explain what an API is in one sentence?",
    "Name a planet with rings.",
    "What is two plus two?",
    "Give me a short tip for better sleep.",
    "What does H T T P stand for?",
    "Who wrote Pride and Prejudice?",
    "How many sides does a hexagon have?",
    "What is the boiling point of water in Celsius?",
    "Suggest a name for a pet cat.",
    "What is machine learning in simple terms?",
    "Tell me a very short joke.",
    "What is the largest desert on Earth?",
    "How do you say hello in Japanese?",
    "What is the speed of light roughly?",
    "Recommend one fruit for breakfast.",
    "Thank you, that is all for now.",
]

TARGET_RATE = 48_000
LEAD_SILENCE = 1.0
GAP_SILENCE = 1.4


def synthesize(piper: str, model: str, text: str, out_path: str) -> None:
    result = subprocess.run(
        [piper, "--model", model, "--output_file", out_path],
        input=text.encode("utf-8"),
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        timeout=60,
    )
    if result.returncode != 0:
        raise SystemExit(f"piper failed for {text!r}: {result.stderr.decode('utf-8', 'replace')[:400]}")


def read_wav(path: str):
    with wave.open(path, "rb") as handle:
        if handle.getnchannels() != 1 or handle.getsampwidth() != 2:
            raise SystemExit(f"{path}: expected mono 16-bit PCM")
        rate = handle.getframerate()
        frames = handle.readframes(handle.getnframes())
    return rate, frames


def resample(rate: int, frames: bytes) -> bytes:
    if rate == TARGET_RATE:
        return frames
    converted, _ = audioop.ratecv(frames, 2, 1, rate, TARGET_RATE, None)
    return converted


def silence(seconds: float) -> bytes:
    return b"\x00\x00" * int(TARGET_RATE * seconds)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--piper", required=True)
    parser.add_argument("--model", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument(
        "--gap",
        type=float,
        default=GAP_SILENCE,
        help="silence between phrases, in seconds (1.4 is enough for the VAD to end a turn; 11 leaves her time to answer)",
    )
    parser.add_argument("--limit", type=int, default=len(PHRASES), help="use only the first N phrases")
    args = parser.parse_args()

    if not os.path.exists(args.piper):
        raise SystemExit(f"piper binary not found: {args.piper}")
    if not os.path.exists(args.model):
        raise SystemExit(f"voice model not found: {args.model}")

    phrases = PHRASES[: args.limit]
    pieces = [silence(LEAD_SILENCE)]
    with tempfile.TemporaryDirectory(prefix="lelu-mic-") as work:
        for index, phrase in enumerate(phrases, start=1):
            wav_path = os.path.join(work, f"{index:02d}.wav")
            synthesize(args.piper, args.model, phrase, wav_path)
            rate, frames = read_wav(wav_path)
            pieces.append(resample(rate, frames))
            pieces.append(silence(args.gap))
            print(f"{index:02d} {len(frames) / rate:5.2f}s @ {rate} Hz  {phrase}", flush=True)

    audio = b"".join(pieces)
    with wave.open(args.out, "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(TARGET_RATE)
        handle.writeframes(audio)

    seconds = len(audio) / (TARGET_RATE * 2)
    print(f"\nwrote {args.out}: {seconds:.1f}s, {len(phrases)} phrases, {args.gap}s gaps, {TARGET_RATE} Hz mono 16-bit")
    return 0


if __name__ == "__main__":
    sys.exit(main())
