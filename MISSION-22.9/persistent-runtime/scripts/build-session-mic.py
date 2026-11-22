#!/usr/bin/env python3
"""
M22.9 persistent-runtime — build the SIMULATED microphone track for the
end-to-end session (MISSION-22.9/06-END-TO-END-ACCEPTANCE.md).

There is no physical microphone in this container. Chromium's
--use-file-for-fake-audio-capture reads a WAV as if it were the device. This
script speaks the user's lines with the local Piper voice and lays them out
on a timeline with silences chosen so that:

  * line 1 is a natural question (the first turn);
  * line 2 starts while LÉLU is expected to be answering line 1 (barge-in 1);
  * line 3 starts while she is expected to be answering line 2 (barge-in 2);
  * line 4 comes after a long silence (a normal successive turn, no restart);
  * a long trailing silence so the file does not loop during the run.

Pure standard library (Python 3.13 removed `audioop`, which the M22.8 builder
used). Output: 48 kHz mono 16-bit.

Usage:
  python3 MISSION-22.9/persistent-runtime/scripts/build-session-mic.py \
      --piper .piper/piper/piper --model .piper/voices/amy-low.onnx \
      --out .piper/session-mic.wav --plan-out MISSION-22.9/persistent-runtime/logs/mic-plan.json
"""

import argparse
import array
import json
import os
import subprocess
import tempfile
import wave

OUT_RATE = 48_000

# (text, silence AFTER the line in seconds)
LINES = [
    ("Hello Lélu. My name is Sam. Can you tell me about the city of Lima in Peru?", 7.0),
    ("Wait, stop. Tell me one interesting fact about the ocean instead.", 6.5),
    ("Sorry, hold on. What is seven times eight?", 16.0),
    ("Thank you. What did I say my name was?", 75.0),
]
LEAD_SILENCE = 1.5


def synth(piper: str, model: str, text: str) -> tuple[array.array, int]:
    with tempfile.TemporaryDirectory() as tmp:
        path = os.path.join(tmp, "line.wav")
        subprocess.run([piper, "--model", model, "--output_file", path], input=text.encode(), check=True,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        with wave.open(path) as src:
            assert src.getsampwidth() == 2 and src.getnchannels() == 1
            rate = src.getframerate()
            samples = array.array("h")
            samples.frombytes(src.readframes(src.getnframes()))
            return samples, rate


def resample(samples: array.array, rate: int) -> array.array:
    if rate == OUT_RATE:
        return samples
    out = array.array("h")
    ratio = rate / OUT_RATE
    n = int(len(samples) / ratio)
    last = len(samples) - 1
    for i in range(n):
        pos = i * ratio
        j = int(pos)
        frac = pos - j
        a = samples[j]
        b = samples[j + 1] if j < last else a
        out.append(int(a + (b - a) * frac))
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--piper", required=True)
    ap.add_argument("--model", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--plan-out", required=True)
    args = ap.parse_args()

    track = array.array("h", [0] * int(LEAD_SILENCE * OUT_RATE))
    plan = []
    for text, gap in LINES:
        samples, rate = synth(args.piper, args.model, text)
        samples = resample(samples, rate)
        start = len(track) / OUT_RATE
        track.extend(samples)
        end = len(track) / OUT_RATE
        plan.append({"text": text, "startS": round(start, 3), "endS": round(end, 3), "silenceAfterS": gap})
        track.extend([0] * int(gap * OUT_RATE))

    with wave.open(args.out, "wb") as dst:
        dst.setnchannels(1)
        dst.setsampwidth(2)
        dst.setframerate(OUT_RATE)
        dst.writeframes(track.tobytes())
    with open(args.plan_out, "w") as fh:
        json.dump({"rate": OUT_RATE, "durationS": round(len(track) / OUT_RATE, 3), "lines": plan}, fh, indent=2)
    print(json.dumps(plan, indent=2))


if __name__ == "__main__":
    main()
