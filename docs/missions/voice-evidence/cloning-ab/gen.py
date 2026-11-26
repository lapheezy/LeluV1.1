"""Same sentences, same model, with and without her reference (A/B control for cloning)."""
import json, sys, time
from pathlib import Path
import numpy as np, soundfile as sf
from voxcpm import VoxCPM
out = Path(sys.argv[1]); ref = sys.argv[2]
model = VoxCPM.from_pretrained("openbmb/VoxCPM2", load_denoiser=False, device="cpu", optimize=False, local_files_only=True)
sr = int(model.tts_model.sample_rate)
sentences = [
    "Got it. Your favourite colour is green, and I will remember it.",
    "The ocean stretched beyond the horizon, calm and silver in the morning light.",
    "I am here with you. Tell me what you would like to do next.",
]
meta = []
for i, text in enumerate(sentences, 1):
    for cond in ("ref", "noref"):
        np.random.seed(i); __import__("torch").manual_seed(i)
        t = time.time()
        kw = dict(text=text, cfg_value=2.0, inference_timesteps=10)
        if cond == "ref": kw["reference_wav_path"] = ref
        wav = model.generate(**kw)
        f = out / f"{cond}-{i}.wav"; sf.write(f, np.asarray(wav, dtype="float32"), sr)
        meta.append({"file": f.name, "cond": cond, "text": text, "seconds": round(len(wav)/sr, 2), "ms": int((time.time()-t)*1000)})
        print(meta[-1], flush=True)
(out / "gen.json").write_text(json.dumps(meta, indent=2))
