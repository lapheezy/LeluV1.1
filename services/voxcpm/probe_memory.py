#!/usr/bin/env python3
"""
LÉLU — VoxCPM2 load/inference memory probe (diagnostic, not a server).

Runs the *exact* sidecar code path (`server.Engine`) once and prints one
JSON line per phase with wall time, current RSS and peak RSS (VmHWM) read
from /proc/self/status. This is how the CPU load cost was measured instead
of guessed:

    .venv-voxcpm/bin/python services/voxcpm/probe_memory.py [--text "..."]

It loads the model once, generates once from the committed reference clip,
writes the WAV to .voxcpm/evidence/probe.wav and exits. It never downloads
(HF_HUB_OFFLINE=1 is forced) and never retries.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path

os.environ.setdefault("HF_HUB_OFFLINE", "1")
HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
sys.path.insert(0, str(HERE))


def mem() -> dict:
    out = {}
    with open("/proc/self/status", encoding="utf-8") as handle:
        for line in handle:
            if line.startswith(("VmRSS:", "VmHWM:")):
                key, value = line.split(":", 1)
                out[key] = round(int(value.split()[0]) / 1024 / 1024, 2)  # GiB
    return {"rssGiB": out.get("VmRSS"), "peakGiB": out.get("VmHWM")}


T0 = time.time()


def phase(name: str, **extra) -> None:
    print(json.dumps({"phase": name, "t": round(time.time() - T0, 1), **mem(), **extra}), flush=True)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--text", default="Hello. I am Lélu, and this is my own voice.")
    args = parser.parse_args()

    phase("start", pid=os.getpid())
    import torch  # noqa: F401

    phase("torch_imported", threads=torch.get_num_threads())
    import server  # the sidecar module; importing it starts nothing

    engine = server.Engine(server.Config())
    engine.prepare_reference()
    phase("reference_ready", reference=str(engine.reference_path))
    engine.ensure_model()
    phase("model_loaded", loadSeconds=engine.load_seconds, sampleRate=engine.sample_rate)
    audio, meta = engine.wav_for(args.text)
    out = ROOT / ".voxcpm" / "evidence" / "probe.wav"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes(audio)
    phase("generated", bytes=len(audio), out=str(out), **meta)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
