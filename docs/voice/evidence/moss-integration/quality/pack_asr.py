import sys, json, re, wave, numpy as np
from faster_whisper import WhisperModel
P = sys.argv[1]; key = json.load(open(f"{P}/ANSWER-KEY.json"))
m = WhisperModel("small.en", device="cpu", compute_type="int8", cpu_threads=4)
NAME = re.compile(r"\bl(?:e|é|ay|eh|ei|a)[- ]?l(?:u|oo|ou|ew)\b", re.I)
def load(p):
    w = wave.open(p); sr = w.getframerate(); x = np.frombuffer(w.readframes(w.getnframes()), dtype="<i2").astype(np.float32) / 32768
    t = np.arange(0, len(x) / sr, 1 / 16000); return np.interp(t, np.arange(len(x)) / sr, x).astype(np.float32), len(x) / sr
def words(t): return re.sub(r"[^a-z0-9' ]", " ", t.lower()).split()
def ed(r, h):
    d = [[0]*(len(h)+1) for _ in range(len(r)+1)]
    for i in range(len(r)+1): d[i][0] = i
    for j in range(len(h)+1): d[0][j] = j
    for i in range(1, len(r)+1):
        for j in range(1, len(h)+1): d[i][j] = min(d[i-1][j]+1, d[i][j-1]+1, d[i-1][j-1]+(r[i-1] != h[j-1]))
    return d[-1][-1]
rows = []
for item, k in key.items():
    for label in "AB":
        x, secs = load(f"{P}/{item}-{label}.wav")
        hyp = " ".join(s.text.strip() for s in m.transcribe(x, beam_size=5, language="en", initial_prompt="Talking with Lélu.")[0])
        ref = words(k["text"].replace("Lélu", " ")); h = words(NAME.sub(" ", hyp))
        has_name = "Lélu" in k["text"]
        rows.append({"item": item, "system": k[label], "seconds": round(secs, 2), "heard": hyp, "wordErrors": ed(ref, h), "refWords": len(ref), "nameOk": (bool(NAME.search(hyp)) if has_name else None)})
json.dump(rows, open(sys.argv[2], "w"), indent=1, ensure_ascii=False)
for sysname in sorted({r["system"] for r in rows}):
    rs = [r for r in rows if r["system"] == sysname]
    wer = sum(r["wordErrors"] for r in rs) / sum(r["refWords"] for r in rs)
    names = [r["nameOk"] for r in rs if r["nameOk"] is not None]
    print(f"{sysname:<14} WER {wer:.3f}  exact {sum(r['wordErrors']==0 for r in rs)}/{len(rs)}  name recognised {sum(names)}/{len(names)}  mean length {sum(r['seconds'] for r in rs)/len(rs):.2f}s")
