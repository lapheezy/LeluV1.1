# M22.7 — LATENCY BENCHMARKS

**Single-session measurements**, 2026-11-20 02:47–02:48 UTC, loopback server, real providers. These are observations, not a benchmark suite; no target is asserted.

---

## 1. Measured stages

| Stage | Measurement | Notes |
|---|---|---|
| VAD utterance capture | 1.93–6.58 s per turn | includes 940 ms silence close |
| Silence close | 940 ms (418 ms on the final short turn) | engine default |
| Utterance end → ASR request | ≈ 0.4–0.9 s | derived from VAD log vs request timestamps |
| ASR (Groq Whisper) | 265–356 ms in the 16-file pack; ~300 ms typical live | server round trip |
| **Transcript → first TTS request** | **0.51, 1.80, 2.31, 3.68, 5.69, 9.82 s** | median **3.0 s**; first turn includes provider/model warm-up |
| TTS synthesis (Piper) | **1.14–2.46 s** per segment | for 8.2–18.2 s of audio |
| Audio duration | 8.23–18.17 s per reply | conversational replies are long |
| Playback start | immediately after synthesis response | `play` on `blob:` URL |

## 2. Turn table (from `logs/turn-summary.json`)

| Turn | ASR timestamp | Next TTS | Gap |
|---|---|---|---|
| 1 | 02:47:46.261 | 02:47:56.081 | 9.82 s |
| 2 | 02:47:52.405 | 02:47:56.081 | 3.68 s (queued behind turn 1) |
| 3 | 02:47:58.961 | 02:48:04.649 | 5.69 s |
| 4 | 02:48:06.220 | 02:48:08.527 | 2.31 s |
| 5 | 02:48:13.282 | 02:48:13.793 | 0.51 s |
| 6 | 02:48:20.414 | 02:48:22.216 | 1.80 s |

The 3.68 s row is the visible queueing effect: audio arrives faster than she can answer, so replies are serialised and the gap overlaps the previous reply.

## 3. What is not measured

- Physical microphone activation time (no device).
- Time to **first audible** sample through hardware (no device).
- Live reconnection time (no LiveKit).
- CPU/memory of a live session (only one 88 s headless run; not instrumented).

## 4. Interpretation, plainly

Recognition is fast (≈0.3 s) and synthesis is fast relative to speech length (≈7–8× real time). The dominant wait a user would feel is **model response time (0.5–10 s)** plus **reply length**: a 16 s spoken answer takes 16 s to hear. The backlog defect compounds this when input keeps arriving.

No latency claim beyond these observed numbers is made.
