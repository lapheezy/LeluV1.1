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
ref = f"{sys.argv[1]}/spk-in/lelu-voice-reference.wav"
anchors = {"ref_cond_0-12s": emb(load(ref, 0, 12)), "ref_heldout_12-30s": emb(load(ref, 12, 30)), "ref_heldout_30-48s": emb(load(ref, 30, 48.5))}
ev = "docs/voice/evidence"
items = {
  "GEN probe-run1": f"{ev}/worker-recovery/probe-run1.wav",
  "GEN worker-speech-1": f"{ev}/worker-recovery/worker-speech-1.wav",
  "GEN post-boundary": f"{ev}/worker-recovery/post-boundary.wav",
  "GEN finalization-speech": f"{ev}/worker-recovery/finalization-speech.wav",
  "GEN app-speech": f"{ev}/livekit-voice/app-speech.wav",
  "GEN app-stream": f"{ev}/livekit-voice/app-stream.wav",
  "GEN received-over-livekit": f"{ev}/livekit-voice/probe-reply/agent-heard.wav",
  "GEN e2e-q1": f"{ev}/livekit-voice/e2e/q1.wav",
  "GEN e2e-q2": f"{ev}/livekit-voice/e2e/q2.wav",
  "NEG elevenlabs-jessica-0": f"{sys.argv[1]}/spk-in/tts-sample-0.wav",
  "NEG elevenlabs-jessica-1": f"{sys.argv[1]}/spk-in/tts-sample-1.wav",
  "NEG elevenlabs-jessica-58": f"{sys.argv[1]}/spk-in/tts-sample-58.wav",
}
rows = []
same = float(anchors["ref_heldout_12-30s"] @ anchors["ref_heldout_30-48s"])
rows.append({"item": "REF 12-30s vs REF 30-48s (same speaker, real)", "vs_heldout_mean": round(same, 3)})
for name, path in items.items():
    e = emb(load(path))
    held = [float(e @ anchors[k]) for k in ("ref_heldout_12-30s", "ref_heldout_30-48s")]
    rows.append({"item": name, "vs_heldout_mean": round(sum(held) / 2, 3), "vs_conditioning": round(float(e @ anchors["ref_cond_0-12s"]), 3)})
print(json.dumps({"model": "speechbrain/spkrec-ecapa-voxceleb (cosine)", "rows": rows}, indent=1))
