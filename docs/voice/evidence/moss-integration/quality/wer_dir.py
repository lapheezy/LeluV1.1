import sys, re, wave, json, numpy as np
from faster_whisper import WhisperModel
m = WhisperModel("small.en", device="cpu", compute_type="int8", cpu_threads=4)
NUM = {"24": "twenty four", "15": "fifteen", "9": "nine"}
def words(t):
    t = t.lower().replace("lélu", " ").replace("lelu", " ")
    for k, v in NUM.items(): t = re.sub(rf"\b{k}\b", v, t)
    t = t.replace("goodnight", "good night")
    return re.sub(r"[^a-z0-9' ]", " ", t).split()
def ed(r, h):
    d = [[0]*(len(h)+1) for _ in range(len(r)+1)]
    for i in range(len(r)+1): d[i][0] = i
    for j in range(len(h)+1): d[0][j] = j
    for i in range(1, len(r)+1):
        for j in range(1, len(h)+1): d[i][j] = min(d[i-1][j]+1, d[i][j-1]+1, d[i-1][j-1]+(r[i-1] != h[j-1]))
    return d[-1][-1]
NAME = re.compile(r"\bl(?:e|é|ay|eh|ei|a)[- ]?l(?:u|oo|ou|ew)\b", re.I)
for d in sys.argv[1:]:
    errs = refs = exact = 0; bad = []
    for i in range(10):
        w = wave.open(f"{d}/q{i:02d}.wav"); sr = w.getframerate(); x = np.frombuffer(w.readframes(w.getnframes()), dtype="<i2").astype(np.float32) / 32768
        y = np.interp(np.arange(0, len(x) / sr, 1 / 16000), np.arange(len(x)) / sr, x).astype(np.float32)
        hyp = " ".join(s.text.strip() for s in m.transcribe(y, beam_size=5, language="en", initial_prompt="Talking with Lélu.")[0])
        ref = words(open(f"{d}/q{i:02d}.txt").read()); h = words(NAME.sub(" ", hyp))
        e = ed(ref, h); errs += e; refs += len(ref); exact += e == 0
        if e: bad.append(f"q{i:02d}: {hyp}")
    print(f"{d.split('/')[-1]:<22} content WER {errs/refs:.3f}  exact {exact}/10")
    for b in bad: print("    ", b)
