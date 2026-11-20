#!/usr/bin/env python3
"""
M23.0 — build a 100-turn SIMULATED microphone file.

M22.9's seven-minute conversation used a 30-turn WAV. WP04 requires at least
100 consecutive synthetic turns, so this speaks the same twenty questions
five times with the same local Piper fallback voice, with the same 11 s of
silence between phrases that M22.9 used (enough for her to answer before the
next question starts).

This is a SIMULATED microphone. It proves the software pipeline handles 100
turns; it says nothing about a physical device.

Usage:
  python3 MISSION-23.0/scripts/build-fake-mic-100.py \
      --piper .piper/piper/piper --model .piper/voices/amy-low.onnx \
      --out .piper/fake-mic-100.wav
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
GAP_SILENCE = 11.0


def synth(piper: str, model: str, text: str, out_path: str) -> None:
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
        return handle.getframerate(), handle.readframes(handle.getnframes())


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
    parser.add_argument("--turns", type=int, default=100)
    parser.add_argument("--gap", type=float, default=GAP_SILENCE)
    args = parser.parse_args()

    for path in (args.piper, args.model):
        if not os.path.exists(path):
            raise SystemExit(f"not found: {path}")

    # Every phrase is synthesised once and reused: 100 turns of audio from
    # twenty recordings, so the file is built in a minute instead of an hour.
    with tempfile.TemporaryDirectory(prefix="lelu-mic100-") as work:
        rendered = {}
        for index, phrase in enumerate(PHRASES):
            path = os.path.join(work, f"p{index:02d}.wav")
            synth(args.piper, args.model, phrase, path)
            rate, frames = read_wav(path)
            rendered[phrase] = resample(rate, frames)
            print(f"voice {index + 1:02d}/{len(PHRASES)} {len(frames) / rate:5.2f}s  {phrase}", flush=True)

    pieces = [silence(LEAD_SILENCE)]
    for turn in range(args.turns):
        phrase = PHRASES[turn % len(PHRASES)]
        pieces.append(rendered[phrase])
        pieces.append(silence(args.gap))

    audio = b"".join(pieces)
    with wave.open(args.out, "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(TARGET_RATE)
        handle.writeframes(audio)

    seconds = len(audio) / (TARGET_RATE * 2)
    print(f"\nwrote {args.out}: {seconds:.1f}s ({seconds / 60:.1f} min), {args.turns} turns, {args.gap}s gaps")
    return 0


if __name__ == "__main__":
    sys.exit(main())
