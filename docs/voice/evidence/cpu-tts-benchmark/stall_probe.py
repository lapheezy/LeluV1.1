"""Stream from a worker and measure what a listener would hear: first audio and
the worst playback stall (arrival time vs audio position), per text."""
import json, sys, time, urllib.request
URL = sys.argv[1]
TEXTS = [
    "Good evening. I heard you clearly, and I'm answering right away.",
    "Of course. I'll remind you tomorrow morning. Is there anything else?",
    "Lélu here. I found three new messages. Two are from your design team.",
    "That's done. The file is saved, and I've shared it with your project folder.",
    "Hello! It's lovely to hear from you. How was your day?",
]
rows = []
for text in TEXTS:
    req = urllib.request.Request(URL, data=json.dumps({"input": text, "stream": True, "response_format": "pcm"}).encode(), headers={"Content-Type": "application/json"})
    t0 = time.perf_counter(); first = None; got = 0; stall = 0.0
    with urllib.request.urlopen(req, timeout=120) as r:
        while True:
            chunk = r.read1(65536) if hasattr(r, "read1") else r.read(4096)
            if not chunk:
                break
            now = time.perf_counter() - t0
            if first is None:
                first = now
            # playback started at `first`; position reached by now = now - first; audio available before this chunk = got
            stall = max(stall, (now - first) - got / 2 / 48000)
            got += len(chunk)
    rows.append({"text": text[:40], "firstAudioMs": int(first * 1000), "audioSeconds": round(got / 96000, 2), "worstStallMs": int(stall * 1000), "totalMs": int((time.perf_counter() - t0) * 1000)})
    print(json.dumps(rows[-1]))
print(json.dumps({"maxStallMs": max(r["worstStallMs"] for r in rows), "meanAudioSeconds": round(sum(r["audioSeconds"] for r in rows) / len(rows), 2)}))
