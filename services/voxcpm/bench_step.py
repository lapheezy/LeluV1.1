"""
VoxCPM2 on CPU — where a sentence's time goes, and what a change buys.

Loads the same model, weights and reference as server.py (one process; stop the
worker first: two copies do not fit in 15 GiB). For each variant it generates
the same sentences, times every component of every generation step, saves the
audio, and writes JSON:

  .venv-voxcpm/bin/python services/voxcpm/bench_step.py --out <dir> --threads 4 \
      --variant baseline [--steps 10] [--compile estimator|lm|all]

Components timed: the diffusion estimator (called `inference_timesteps` times
per step, batch 2 for guidance), base_lm / residual_lm forward_step, the
feature encoder, and the audio VAE decode at the end of the sentence.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

TEXTS = [
    ("clause", "Sure, I can help with that."),
    ("sentence", "The Eiffel Tower is the most famous tower in France."),
    ("long", "The ocean covers about seventy percent of the planet, and most of it is still unexplored."),
]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--threads", type=int, default=4)
    ap.add_argument("--steps", type=int, default=10)
    ap.add_argument("--variant", default="baseline")
    ap.add_argument("--compile", default="none", choices=["none", "estimator", "lm", "all"])
    ap.add_argument("--repeat", type=int, default=1)
    ap.add_argument("--stream", action="store_true", help="streaming generation: time to first chunk, chunk pacing")
    args = ap.parse_args()

    import numpy as np
    import soundfile as sf
    import torch

    torch.set_num_threads(args.threads)
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    from voxcpm import VoxCPM

    t0 = time.time()
    model = VoxCPM.from_pretrained("openbmb/VoxCPM2", load_denoiser=False, device="cpu", optimize=False, local_files_only=True)
    load_s = time.time() - t0
    tts = model.tts_model
    ref = next((ROOT / ".voxcpm").glob("reference-*-12s.wav"))
    t1 = time.time()
    cache = tts.build_prompt_cache(reference_wav_path=str(ref))
    encode_ms = int((time.time() - t1) * 1000)

    timings: dict[str, float] = defaultdict(float)
    counts: dict[str, int] = defaultdict(int)

    def timed(name, fn):
        def wrapper(*a, **k):
            s = time.perf_counter()
            try:
                return fn(*a, **k)
            finally:
                timings[name] += time.perf_counter() - s
                counts[name] += 1
        return wrapper

    if args.compile in ("estimator", "all"):
        tts.feat_decoder.estimator = torch.compile(tts.feat_decoder.estimator, dynamic=False)
    if args.compile in ("lm", "all"):
        tts.base_lm.forward_step = torch.compile(tts.base_lm.forward_step, dynamic=False)
        tts.residual_lm.forward_step = torch.compile(tts.residual_lm.forward_step, dynamic=False)

    class Timed(torch.nn.Module):
        def __init__(self, inner, name):
            super().__init__()
            self.inner = inner
            self.call = timed(name, inner)

        def forward(self, *a, **k):
            return self.call(*a, **k)

    tts.feat_decoder.estimator = Timed(tts.feat_decoder.estimator, "estimator")
    tts.base_lm.forward_step = timed("base_lm", tts.base_lm.forward_step)
    tts.residual_lm.forward_step = timed("residual_lm", tts.residual_lm.forward_step)
    tts.feat_encoder.forward = timed("feat_encoder", tts.feat_encoder.forward)
    tts.audio_vae.decode = timed("vae_decode", tts.audio_vae.decode)

    chunk_times: list[float] = []

    def generate(text: str):
        clean = re.sub(r"\s+", " ", text)
        if args.stream:
            chunk_times.clear()
            start = time.perf_counter()
            parts = []
            gen = tts._generate_with_prompt_cache(
                target_text=clean, prompt_cache=cache, min_len=2, max_len=4096,
                inference_timesteps=args.steps, cfg_value=2.0, retry_badcase=False, streaming=True,
            )
            try:
                for wav, _, _ in gen:
                    a = wav.squeeze(0).float().cpu().numpy()
                    parts.append(a)
                    chunk_times.append((time.perf_counter() - start, len(a)))
            finally:
                gen.close()
            return np.concatenate(parts) if parts else np.zeros(0, dtype="float32")
        gen = tts._generate_with_prompt_cache(
            target_text=clean, prompt_cache=cache, min_len=2, max_len=4096,
            inference_timesteps=args.steps, cfg_value=2.0, retry_badcase=True,
            retry_badcase_max_times=3, retry_badcase_ratio_threshold=6.0, streaming=False,
        )
        try:
            wav, _, _ = next(gen)
        finally:
            gen.close()
        return wav.squeeze(0).float().cpu().numpy()

    # Warm-up: the first generation pays one-off costs (allocation, compile).
    w0 = time.time()
    generate("Hello, I am ready.")
    warm_s = time.time() - w0

    rows = []
    for rep in range(args.repeat):
        for tid, text in TEXTS:
            timings.clear()
            counts.clear()
            s = time.perf_counter()
            wav = generate(text)
            ms = int((time.perf_counter() - s) * 1000)
            sr = int(tts.sample_rate)
            secs = len(wav) / sr
            f = out / f"{args.variant}-{tid}-{rep}.wav"
            sf.write(f, np.clip(wav, -1, 1), sr, subtype="PCM_16")
            row = {
                "variant": args.variant, "text": tid, "rep": rep, "ms": ms, "audioSeconds": round(secs, 2),
                "rtf": round(ms / 1000 / secs, 2) if secs else None,
                "steps": counts.get("base_lm", 0),
                "components_ms": {k: int(v * 1000) for k, v in timings.items()},
                "calls": dict(counts), "file": f.name,
            }
            if args.stream and chunk_times:
                produced = 0
                pace = []
                for t, n in chunk_times:
                    produced += n
                    pace.append([round(t, 2), round(produced / sr, 2)])

                row["firstChunkMs"] = int(chunk_times[0][0] * 1000)
                row["chunks"] = len(chunk_times)
                row["pace"] = pace
                # Earliest playback start that never runs dry: each chunk must
                # arrive before its own audio is due (start + audio before it).
                before = 0.0
                safe = 0.0
                for t, n in chunk_times:
                    safe = max(safe, t - before)
                    before += n / sr
                row["safeStartMs"] = int(safe * 1000)
            rows.append(row)
            print(json.dumps(row), flush=True)
    result = {"variant": args.variant, "threads": args.threads, "inferenceTimesteps": args.steps, "compile": args.compile,
              "loadSeconds": round(load_s, 1), "referenceEncodeMs": encode_ms, "warmupSeconds": round(warm_s, 1),
              "torch": torch.__version__, "rows": rows}
    (out / f"{args.variant}.json").write_text(json.dumps(result, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
