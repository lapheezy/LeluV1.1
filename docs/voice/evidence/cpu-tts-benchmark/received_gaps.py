import sys, wave, re, numpy as np, json
w = wave.open(sys.argv[1]); x = np.frombuffer(w.readframes(w.getnframes()), dtype="<i2").astype(np.float32)
f = x[: len(x)//480*480].reshape(-1, 480); r = np.sqrt((f**2).mean(1))   # 10 ms blocks
s = "".join("#" if v > 300 else "." for v in r).strip(".")
runs = [len(m) * 10 for m in re.findall(r"\.+", s)]
print(json.dumps({"spokenSpanMs": len(s) * 10, "longestQuietMs": max(runs, default=0), "quietRunsOver400Ms": sum(1 for v in runs if v > 400)}))
