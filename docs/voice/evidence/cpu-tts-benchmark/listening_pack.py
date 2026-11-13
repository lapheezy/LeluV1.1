#!/usr/bin/env python3
"""Build a BLIND A/B listening pack: the same sentences from two speech workers,
loudness-matched, randomly assigned to A/B per item (fixed seed). The answer key
is a separate file so the listener can rate first and unblind after.

  listening_pack.py OUT_DIR NAME_A=URL_A NAME_B=URL_B
"""
import io
import json
import random
import sys
import urllib.request
import wave
from pathlib import Path

import numpy as np

SENTENCES = [
    "Hi, I'm Lélu. How can I help you today?",
    "Lélu here. I found three new messages for you.",
    "Of course. I'll remind you tomorrow morning at nine.",
    "That's a good question. Let me think about it for a moment.",
    "Your meeting with the design team starts in fifteen minutes.",
    "I've saved the document and shared it with your project folder.",
    "I'm sorry, I didn't catch that. Could you say it again?",
    "Good night. Sleep well, and I'll be here when you wake up.",
]


def fetch(url: str, text: str) -> tuple[np.ndarray, int]:
    req = urllib.request.Request(url, data=json.dumps({"input": text, "response_format": "wav"}).encode(), headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=600) as r:
        data = r.read()
    w = wave.open(io.BytesIO(data))
    x = np.frombuffer(w.readframes(w.getnframes()), dtype="<i2").astype(np.float32) / 32768
    if w.getnchannels() > 1:
        x = x.reshape(-1, w.getnchannels()).mean(1)
    return x, w.getframerate()


def write(path: Path, x: np.ndarray, rate: int) -> None:
    w = wave.open(str(path), "wb")
    w.setnchannels(1)
    w.setsampwidth(2)
    w.setframerate(rate)
    w.writeframes((np.clip(x, -1, 1) * 32767).astype("<i2").tobytes())
    w.close()


def main() -> int:
    out = Path(sys.argv[1])
    out.mkdir(parents=True, exist_ok=True)
    systems = dict(arg.split("=", 1) for arg in sys.argv[2:4])
    rng = random.Random(20261113)
    key = {}
    for i, text in enumerate(SENTENCES, 1):
        clips = {}
        for name, url in systems.items():
            x, rate = fetch(url, text)
            rms = float(np.sqrt(np.mean(x ** 2))) or 1.0
            clips[name] = (x * (0.08 / rms), rate)  # same loudness for both
        names = list(systems)
        rng.shuffle(names)
        key[f"{i:02d}"] = {"A": names[0], "B": names[1], "text": text}
        for label, name in zip("AB", names):
            write(out / f"{i:02d}-{label}.wav", *clips[name])
        print(f"item {i:02d} done", flush=True)
    (out / "ANSWER-KEY.json").write_text(json.dumps(key, indent=1, ensure_ascii=False))
    lines = [
        "# Blind listening comparison: LÉLU's voice",
        "",
        "Each item has two clips of the same sentence, **A** and **B**, from two different speech models.",
        "Which model is A or B was chosen at random per item, and the clips are loudness-matched.",
        "**Do not open `ANSWER-KEY.json` until you have filled this in.**",
        "",
        "Her reference recording, for comparison: `public/audio/voice/lelu-voice-reference.m4a`.",
        "",
        "| Item | Sentence | Sounds more like her (A/B/same) | More natural (A/B/same) | Name said right? A / B | Notes |",
        "|---|---|---|---|---|---|",
    ]
    for i, text in enumerate(SENTENCES, 1):
        lines.append(f"| {i:02d} | {text} | | | / | |")
    lines += ["", "Also: how should her name sound? (e.g. \"LAY-loo\", \"leh-LOO\", French \"Lélou\"…): ______"]
    (out / "RATING-SHEET.md").write_text("\n".join(lines) + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
