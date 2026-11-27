"""
Speaker similarity of generated clips to LÉLU's own recording.

Scores every WAV in --dir with microsoft/wavlm-base-plus-sv (x-vector, cosine)
against HELD-OUT parts of her reference (the model is conditioned on the first
12 s; the comparison uses 12-30 s and 30-48 s, which it never hears), and
reports her recording's similarity to itself as the ceiling.

  .venv-voxcpm/bin/python services/voxcpm/score_similarity.py --dir <clips> --out <json>
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
REFERENCE = ROOT / "services" / "voice-reference" / "lelu-voice-reference.m4a"


def load16k(path: Path, start: float | None = None, dur: float | None = None):
    import soundfile as sf

    with tempfile.NamedTemporaryFile(suffix=".wav") as tmp:
        cmd = ["ffmpeg", "-v", "error", "-y"]
        if start is not None:
            cmd += ["-ss", str(start)]
        if dur is not None:
            cmd += ["-t", str(dur)]
        cmd += ["-i", str(path), "-ac", "1", "-ar", "16000", tmp.name]
        subprocess.run(cmd, check=True)
        audio, _ = sf.read(tmp.name, dtype="float32")
    return audio


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dir", required=True)
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

    import torch
    from transformers import AutoFeatureExtractor, WavLMForXVector

    name = "microsoft/wavlm-base-plus-sv"
    extractor = AutoFeatureExtractor.from_pretrained(name)
    model = WavLMForXVector.from_pretrained(name).eval()

    def embed(audio):
        inputs = extractor(audio, sampling_rate=16000, return_tensors="pt", padding=True)
        with torch.inference_mode():
            vector = model(**inputs).embeddings[0]
        return torch.nn.functional.normalize(vector, dim=-1)

    held = [embed(load16k(REFERENCE, 12, 18)), embed(load16k(REFERENCE, 30, 18))]
    ceiling = float(held[0] @ held[1])
    rows = []
    for wav in sorted(Path(args.dir).glob("*.wav")):
        e = embed(load16k(wav))
        score = sum(float(e @ h) for h in held) / len(held)
        rows.append({"file": wav.name, "similarity": round(score, 4)})
        print(json.dumps(rows[-1]), flush=True)
    result = {"model": name, "reference": str(REFERENCE.relative_to(ROOT)), "heldOut": ["12-30 s", "30-48 s"],
              "ceilingHerOwnRecording": round(ceiling, 4), "rows": rows}
    Path(args.out).write_text(json.dumps(result, indent=1))
    print(json.dumps({"ceilingHerOwnRecording": round(ceiling, 4)}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
