import sys, json, re, wave, glob, numpy as np
from collections import defaultdict
from faster_whisper import WhisperModel
m = WhisperModel("small.en", device="cpu", compute_type="int8", cpu_threads=4)
NAME = re.compile(r"\bl(?:e|é|ay|eh|ei|a)[- ]?l(?:u|oo|ou|ew)\b", re.I)
def load16(p):
    w = wave.open(p); sr = w.getframerate()
    x = np.frombuffer(w.readframes(w.getnframes()), dtype="<i2").astype(np.float32) / 32768
    t = np.arange(0, len(x) / sr, 1 / 16000); return np.interp(t, np.arange(len(x)) / sr, x).astype(np.float32)
def words(t): return re.sub(r"[^a-z0-9' ]", " ", t.lower()).split()
def rest_errors(ref, hyp):
    r = [w for w in words(ref) if not NAME.fullmatch(w) and w not in ("lélu", "lelu")]
    h = words(NAME.sub(" ", hyp))
    d = [[0]*(len(h)+1) for _ in range(len(r)+1)]
    for i in range(len(r)+1): d[i][0] = i
    for j in range(len(h)+1): d[0][j] = j
    for i in range(1, len(r)+1):
        for j in range(1, len(h)+1): d[i][j] = min(d[i-1][j]+1, d[i][j-1]+1, d[i-1][j-1]+(r[i-1] != h[j-1]))
    return d[-1][-1]
def repeated(hyp):
    w = words(hyp)
    return any(w[i:i+n] == w[i+n:i+2*n] for n in (1, 2, 3) for i in range(len(w) - 2*n + 1))
rows = []
for p in sorted(glob.glob(sys.argv[1] + "/*.wav")):
    meta = json.load(open(p[:-4] + ".json")); x = load16(p)
    hint = " ".join(s.text.strip() for s in m.transcribe(x, beam_size=5, language="en", initial_prompt="Talking with Lélu.")[0])
    plain = " ".join(s.text.strip() for s in m.transcribe(x, beam_size=5, language="en")[0])
    rows.append({**meta, "hint": hint, "plain": plain, "nameOk": bool(NAME.search(hint)), "restErrors": rest_errors(meta["text"], hint), "repeat": repeated(hint)})
json.dump(rows, open(sys.argv[2], "w"), indent=1, ensure_ascii=False)
agg = defaultdict(lambda: [0, 0, 0, 0])
for r in rows:
    a = agg[r["variant"]]; a[0] += 1; a[1] += r["nameOk"]; a[2] += r["restErrors"] == 0; a[3] += r["repeat"]
print(f"{'spelling':<10} clips  name-recognised  rest-exact  repetition")
for v, (n, ok, rest, rep) in agg.items(): print(f"{v:<10} {n:>5}  {ok:>8}/{n}        {rest:>3}/{n}      {rep}/{n}")
