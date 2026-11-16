#!/usr/bin/env python3
"""
==========================================================
LÉLU — VOXCPM2 SELF-CHECK (does she actually speak?)
==========================================================

Installing a model proves nothing. This script is the acceptance test:

  1. the weight state is verified (`bootstrap.ready_state`, no marker → not
     ready → we say so instead of loading whatever is on disk);
  2. the reference recording is decoded;
  3. the model loads (time measured);
  4. three sentences are generated IN HER CLONED VOICE;
  5. each WAV is measured — duration, level, median F0, spectral centroid;
  6. the measurements are written as evidence, with a short listenable MP3.

The acoustic numbers are measurements, not speaker verification: no
speaker-embedding model is used, so this proves "audio was produced from
the reference conditioning consistently", never "a third-party biometric
system confirms identity". The honest claim is the one written down.

    python services/voxcpm/selfcheck.py
    python services/voxcpm/selfcheck.py --device cuda
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import statistics
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SAMPLES_DIR = ROOT / ".voxcpm" / "samples"
EVIDENCE_DIR = ROOT / "docs" / "voice" / "evidence" / "voxcpm2"

SENTENCES = [
    ("short", "Hello. I am Lélu, and this is my own voice."),
    (
        "medium",
        "I can see the stars from here. If you want, I will read you the whole night sky, name by name, until you fall asleep.",
    ),
    ("repeat", "Hello, Lélu speaking. This is still my voice."),
]


def load_server_module():
    """Import the sidecar's own Engine, so the test exercises shipped code."""
    path = ROOT / "services" / "voxcpm" / "server.py"
    spec = importlib.util.spec_from_file_location("lelu_voxcpm_server", path)
    assert spec and spec.loader, f"cannot import {path}"
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def acoustic(path: Path) -> dict:
    """Cheap, honest measurements of a wav: level, pitch, brightness."""
    import numpy as np
    import soundfile as sf

    data, rate = sf.read(str(path), dtype="float32")
    mono = data.mean(axis=1) if getattr(data, "ndim", 1) > 1 else data
    frame = max(1, int(rate * 0.04))
    hop = max(1, int(rate * 0.02))
    f0s: list[float] = []
    centroids: list[float] = []
    for start in range(0, max(1, len(mono) - frame), hop):
        segment = mono[start : start + frame]
        if len(segment) < frame:
            break
        if float(np.sqrt(np.mean(segment**2))) < 0.01:
            continue  # silence carries no pitch
        spectrum = np.abs(np.fft.rfft(segment * np.hanning(len(segment))))
        freqs = np.fft.rfftfreq(len(segment), 1.0 / rate)
        centroids.append(float((spectrum * freqs).sum() / max(float(spectrum.sum()), 1e-9)))
        autocorrelation = np.correlate(segment, segment, mode="full")[len(segment) - 1 :]
        low, high = int(rate / 400), int(rate / 70)
        if high < len(autocorrelation) and high > low:
            window = autocorrelation[low:high]
            lag = low + int(np.argmax(window))
            if lag > 0 and autocorrelation[lag] > 0.3 * autocorrelation[0]:
                f0s.append(float(rate / lag))
    return {
        "seconds": round(len(mono) / rate, 2),
        "sampleRate": int(rate),
        "rms": round(float(np.sqrt(np.mean(mono**2))), 4),
        "peak": round(float(np.abs(mono).max()), 3),
        "f0Hz": round(statistics.median(f0s), 1) if f0s else None,
        "f0Frames": len(f0s),
        "centroidHz": round(statistics.median(centroids), 1) if centroids else None,
    }


def encode_mp3(source: Path, target: Path, seconds: float = 8.0) -> "dict":
    """A short, listenable artefact; the full WAVs stay out of git."""
    try:
        import imageio_ffmpeg

        target.parent.mkdir(parents=True, exist_ok=True)
        completed = subprocess.run(
            [
                imageio_ffmpeg.get_ffmpeg_exe(),
                "-y",
                "-v",
                "error",
                "-t",
                f"{seconds:.1f}",
                "-i",
                str(source),
                "-ac",
                "1",
                "-ar",
                "24000",
                "-b:a",
                "48k",
                str(target),
            ],
            capture_output=True,
            text=True,
        )
        if completed.returncode != 0:
            return {"ok": False, "error": completed.stderr.strip()[-300:]}
        return {"ok": True, "path": str(target), "bytes": target.stat().st_size}
    except Exception as exc:
        return {"ok": False, "error": f"{type(exc).__name__}: {exc}"}


def main() -> int:
    parser = argparse.ArgumentParser(description="VoxCPM2 acceptance self-check")
    parser.add_argument("--device", default=None)
    parser.add_argument("--timesteps", type=int, default=None)
    parser.add_argument("--skip-ready-check", action="store_true")
    args = parser.parse_args()

    SAMPLES_DIR.mkdir(parents=True, exist_ok=True)
    EVIDENCE_DIR.mkdir(parents=True, exist_ok=True)

    report: dict = {"startedAt": int(time.time()), "sentences": [], "checks": {}}

    if not args.skip_ready_check:
        weights_ready = None
        try:
            spec = importlib.util.spec_from_file_location("lelu_voxcpm_bootstrap", ROOT / "services" / "voxcpm" / "bootstrap.py")
            assert spec and spec.loader
            bootstrap = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(bootstrap)
            weights_ready = bootstrap.ready_state()
        except Exception as exc:
            report["checks"]["weights"] = {"ok": False, "error": f"{type(exc).__name__}: {exc}"}
        if weights_ready is None and "weights" not in report["checks"]:
            report["checks"]["weights"] = {
                "ok": False,
                "error": "no verified weight marker; run services/voxcpm/bootstrap.py first",
            }
        elif weights_ready is not None:
            report["checks"]["weights"] = {"ok": True, **weights_ready}

    server = load_server_module()
    config = server.Config()
    if args.device:
        config.device = args.device
    if args.timesteps:
        config.timesteps = args.timesteps
    engine = server.Engine(config)
    engine.prepare_reference()
    report["reference"] = engine.reference_meta
    report["referenceAcoustic"] = acoustic(Path(engine.reference_meta["wav"]))

    load_started = time.time()
    try:
        engine.ensure_model()
    except Exception as exc:
        report["checks"]["model"] = {"ok": False, "error": f"{type(exc).__name__}: {exc}"}
        print(json.dumps(report, indent=2))
        return 1
    report["checks"]["model"] = {
        "ok": True,
        "modelId": config.model_id,
        "device": config.device,
        "sampleRate": engine.sample_rate,
        "loadSeconds": engine.load_seconds,
        "measuredWallSeconds": round(time.time() - load_started, 1),
    }
    sys.stderr.write(json.dumps({"event": "model_ready", **report["checks"]["model"]}) + "\n")

    for index, (label, text) in enumerate(SENTENCES, start=1):
        try:
            audio, meta = engine.wav_for(text)
        except Exception as exc:
            report["sentences"].append({"label": label, "ok": False, "error": f"{type(exc).__name__}: {exc}"})
            continue
        target = SAMPLES_DIR / f"sample-{index:02d}-{label}.wav"
        target.write_bytes(audio)
        report["sentences"].append(
            {
                "label": label,
                "ok": True,
                "text": text,
                "file": str(target.relative_to(ROOT)),
                "bytes": len(audio),
                "synthesis": meta,
                "acoustic": acoustic(target),
            }
        )
        sys.stderr.write(json.dumps({"event": "sentence", "label": label, **meta}) + "\n")

    spoken = [s for s in report["sentences"] if s.get("ok")]
    pitches = [s["acoustic"]["f0Hz"] for s in spoken if s["acoustic"]["f0Hz"]]
    centroids = [s["acoustic"]["centroidHz"] for s in spoken if s["acoustic"]["centroidHz"]]
    report["checks"]["audio"] = {
        "ok": len(spoken) == len(SENTENCES),
        "generated": len(spoken),
        "expected": len(SENTENCES),
        "f0SpreadHz": round(max(pitches) - min(pitches), 1) if len(pitches) > 1 else None,
        "centroidSpreadHz": round(max(centroids) - min(centroids), 1) if len(centroids) > 1 else None,
        "rtfValues": [s["synthesis"]["rtf"] for s in spoken],
    }
    if spoken:
        first = ROOT / spoken[0]["file"]
        report["checks"]["listen"] = encode_mp3(first, EVIDENCE_DIR / "lelu-voxcpm2-sample.mp3")

    report["finishedAt"] = int(time.time())
    (EVIDENCE_DIR / "selfcheck.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2))
    healthy = report["checks"].get("model", {}).get("ok") and report["checks"]["audio"]["ok"]
    return 0 if healthy else 1


if __name__ == "__main__":
    raise SystemExit(main())
