"""ECAPA speaker similarity of MOSS-TTS-Nano output vs LÉLU's reference (same method as ../../voice-identity/speaker_similarity.py).
Usage: python speaker_similarity_moss.py WORKDIR REF16K.wav NEGATIVE16K.wav"""
import json, sys, numpy as np, soundfile as sf, torch
from speechbrain.inference.speaker import EncoderClassifier
enc = EncoderClassifier.from_hparams(source="speechbrain/spkrec-ecapa-voxceleb", savedir=sys.argv[1] + "/ecapa", run_opts={"device": "cpu"})
def load(path, start=None, end=None):
    x, sr = sf.read(path, dtype="float32")
    if x.ndim > 1: x = x.mean(1)
    if sr != 16000:
        t = np.arange(0, len(x) / sr, 1 / 16000); x = np.interp(t, np.arange(len(x)) / sr, x).astype(np.float32)
    if start is not None: x = x[int(start * 16000): int(end * 16000)]
    return x
def emb(x):
    with torch.no_grad(): e = enc.encode_batch(torch.from_numpy(x).unsqueeze(0)).squeeze()
    return (e / e.norm()).numpy()
ref = sys.argv[2]
anchors = {"cond": emb(load(ref, 0, 12)), "h1": emb(load(ref, 12, 30)), "h2": emb(load(ref, 30, 48.5))}
d = "docs/voice/evidence"
items = {
  "MOSS app 1": f"{d}/livekit-voice-moss/identity/moss-app-1.wav",
  "MOSS app 2": f"{d}/livekit-voice-moss/identity/moss-app-2.wav",
  "MOSS app 3": f"{d}/livekit-voice-moss/identity/moss-app-3.wav",
  "MOSS received over LiveKit (Opus)": f"{d}/livekit-voice-moss/identity/received-over-livekit.wav",
  "VoxCPM2 app-speech (prior)": f"{d}/livekit-voice/app-speech.wav",
  "VoxCPM2 app-stream (prior)": f"{d}/livekit-voice/app-stream.wav",
  "NEG ElevenLabs voice": sys.argv[3],
}
rows = [{"item": "REF 12-30s vs REF 30-48s (same real speaker)", "vs_heldout_mean": round(float(anchors["h1"] @ anchors["h2"]), 3)}]
for name, path in items.items():
    e = emb(load(path))
    rows.append({"item": name, "vs_heldout_mean": round((float(e @ anchors["h1"]) + float(e @ anchors["h2"])) / 2, 3), "vs_conditioning": round(float(e @ anchors["cond"]), 3)})
print(json.dumps({"model": "speechbrain/spkrec-ecapa-voxceleb (cosine)", "rows": rows}, indent=1))
