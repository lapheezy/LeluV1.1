# TTS PERFORMANCE REPORT

**WP01 acceptance evidence** · raw data: `MISSION-22.9/logs/warm-runtime.json` ·
script: `MISSION-22.9/scripts/warm-runtime-benchmark.ts`

Hardware: 8 vCPU, 16 GB RAM, no GPU. Voice: `amy-low.onnx` (63 MB), 16 kHz
mono. Sentence set: 20 fixed sentences (10 distinct, cycled), identical for
both paths.

## Method

- **Cold** — the M22.8 path: `execFile(piper, --model … --output_raw)`, one
  process per sentence, timed from spawn to (a) the first PCM byte and (b)
  process close.
- **Warm** — the M22.9 path: `PersistentPiper.synthesize(text)`, timed from
  submission to holding the complete WAV.
- The comparison is **deliberately unfair to the warm path**: cold is
  credited at its *first byte*, warm only at its *complete sentence*.

## Results (20 sentences)

| Metric | Cold (M22.8) | Warm (M22.9) | Change |
| --- | --- | --- | --- |
| First audio, median | 426 ms | **114 ms** | **−73 %** |
| First audio, P90 | 466 ms | **138 ms** | −70 % |
| First audio, max | 514 ms | **139 ms** | −73 % |
| Full sentence, median | 453 ms | **114 ms** | −75 % |
| Full sentence, P90 | 528 ms | **138 ms** | −74 % |
| Total wall, 20 sentences | 9 193 ms | **2 530 ms** (incl. 351 ms prewarm) | −72 % |
| Model loads in the session | **20** | **1** | −95 % |
| Processes spawned | 20 | **1** | −95 % |
| Resident memory | — (one process at a time) | **111.5 MiB** per worker (95 MiB in-server) | bounded, one per profile |

Per-sentence warm times (ms): 73, 64, 99, 105, 106, 114, 115, 121, 122, 130,
130, 130, 138, 139 … (min 64, mean 109, n = 20). One PID answered all twenty
(`pid=416508`), and every answer reported `loads=1`.

Real-time factor (warm): synthesis 2.18 s for 114 s of audio ≈ **0.019**,
i.e. ~52× faster than playback — which is why the synthesis-ahead queue can
always keep ahead of the speaker.

## Against the mission's targets

| Target | Measured | Verdict |
| --- | --- | --- |
| Warm first audio under 1 500 ms | **114 ms median** (TTS stage) | **MET** for the speech stage. End-to-end first audio also contains ASR + model time, reported separately in `streaming-performance-comparison.md` |
| Subsequent short utterances under 700 ms | **114 ms median, 139 ms max** | **MET** |
| Model reloads per session: 0 after initialisation | **1 load for 20 sentences** (0 reloads) | **MET** |
| Stale audio: 0 | warm path is per-sentence and abortable; measured in the browser run | see `full-duplex-acceptance.md` |
| Failed worker recovery: successful | crash test: `worker-crashed` → next sentence answered by a new PID | **MET** |
| Memory growth: bounded | 95–112 MiB per worker, one per profile, idle workers never respawn | **MET** (no growth observed across 21 requests) |

## What is *not* claimed

- These numbers are the **speech stage only**. They do not prove end-to-end
  conversation latency, which is dominated by transcription and the model.
- The first sentence after a **server restart** pays the prewarm (351 ms); a
  visitor who arrives before `prewarm()` completes would see that cost once.
- A **cold OS page cache** makes the very first load much slower (one probe
  measured 4 995 ms for the first-ever process). The benchmark warms the page
  cache by construction; the server's boot prewarm absorbs the same cost.
- A **second delivery profile** costs one model load the first time it is
  used (measured: 2 profiles → 2 loads). That is a deliberate trade for
  keeping delivery per-profile after finding that per-request flags are
  ignored.
