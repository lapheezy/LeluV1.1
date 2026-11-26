"""ECAPA speaker similarity (cosine) against HELD-OUT parts of her reference (the model is conditioned on 0-12 s)."""
import json, sys, subprocess
from pathlib import Path
import torchaudio
if not hasattr(torchaudio, "list_audio_backends"):
    torchaudio.list_audio_backends = lambda: ["soundfile"]  # speechbrain 1.0.3 vs torchaudio 2.11
import huggingface_hub, functools
_orig = huggingface_hub.hf_hub_download
@functools.wraps(_orig)
def _compat(*a, use_auth_token=None, **k):  # speechbrain 1.0.3 vs huggingface_hub 1.x
    return _orig(*a, **k)
huggingface_hub.hf_hub_download = _compat
import numpy as np, soundfile as sf, torch
from speechbrain.inference.speaker import EncoderClassifier
d = Path(sys.argv[1]); src = sys.argv[2]
def load16k(path, start=None, dur=None):
    tmp = d / ("_tmp_" + Path(path).stem + f"_{start}_{dur}.wav")
    cmd = ["ffmpeg", "-v", "error", "-y"] + (["-ss", str(start)] if start is not None else []) + (["-t", str(dur)] if dur else []) + ["-i", str(path), "-ac", "1", "-ar", "16000", str(tmp)]
    subprocess.run(cmd, check=True)
    x, _ = sf.read(tmp, dtype="float32"); return torch.tensor(x).unsqueeze(0)
enc = EncoderClassifier.from_hparams(source=str(d / "ecapa-src"), savedir=str(d / "ecapa"), run_opts={"device": "cpu"})
emb = lambda w: torch.nn.functional.normalize(enc.encode_batch(w).squeeze(), dim=0)
held = [emb(load16k(src, 12, 18)), emb(load16k(src, 30, 18))]
cond = emb(load16k(src, 0, 12))
rows = [{"item": "REAL her: ref 12-30 s vs ref 30-48 s", "vs_heldout": round(float(held[0] @ held[1]), 3)}]
def score(label, path):
    e = emb(load16k(path))
    rows.append({"item": label, "vs_heldout_mean": round(float(np.mean([float(e @ h) for h in held])), 3), "vs_conditioning": round(float(e @ cond), 3)})
for f in sorted(d.glob("ref-*.wav")): score(f"VoxCPM2 WITH her reference ({f.name})", f)
for f in sorted(d.glob("noref-*.wav")): score(f"VoxCPM2 WITHOUT reference — generic ({f.name})", f)
for f in sys.argv[3:]: score(f"app output {Path(f).name}", f)
score("NEG test speaker espeak-ng (raw_q1.wav)", "/tmp/claude-0/mic/raw_q1.wav")
print(json.dumps({"model": "speechbrain/spkrec-ecapa-voxceleb (cosine)", "rows": rows}, indent=1))
