# WP02 — Streaming speech and latency

**Priority:** P0 · **Status:** streaming VERIFIED, median latency improvement
VERIFIED, one target MISSED and one measured with a negative result.

All numbers below were produced by the same harness
(`scripts/voice-latency-acceptance.mjs`), against the same server, with the same
simulated microphone content, on this container. Nothing is estimated.

## Method

* Chromium (Playwright build) with `--use-file-for-fake-audio-capture` reading a
  WAV of twenty questions. **The microphone is simulated**; there is no physical
  device. The harness records that fact in every log.
* The page's own `fetch` is instrumented: each `/api/voice/tts` request is
  timestamped with its text, each ASR response with its transcript.
* Playback is instrumented twice: `HTMLMediaElement.play` (whole-file path) and
  `AudioBufferSourceNode.start` (incremental PCM path).
* Engine state is read from `window.__leluVoice` (diagnostics + per-turn
  latency), not inferred from pixels.
* A turn's latency is measured **from the end of its ASR response**. This is the
  same origin M22.7 used, so the comparison is like-for-like.

Two microphone profiles:

| Profile | Gap between questions | Used for |
|---|---|---|
| dense (`fake-mic-20.wav`) | 1.4 s | interruption: she is talked over constantly |
| paced (`fake-mic-paced.wav`, `--gap 11`) | 11 s | latency: each answer has room to finish |

## Configurations compared

| # | Configuration | Log | Turns |
|---|---|---|---|
| A | **M22.7** — whole reply spoken after `chat()` returns, whole-WAV TTS | `MISSION-22.7/logs/voice-acceptance.json` | 7 |
| B | M22.8 before incremental audio — sentence streaming + turn ownership, TTS returns a complete WAV | `logs/latency-run-wav.json` | 19 |
| C | M22.8 with incremental PCM, run 1 | `logs/latency-run-pcm-first.json` | 19 |
| D | M22.8 with incremental PCM, run 2 (final) | `logs/latency-acceptance.json` | 19 |
| E | M22.8 with incremental PCM, dense mic | `logs/interruption-run.json` | 20 |

## Results

Medians in milliseconds; P90 / max in parentheses.

| Stage | A — M22.7 | B — WAV | C — PCM | D — PCM | E — dense |
|---|---|---|---|---|---|
| ASR round trip | ~300 | 499 (914 / 1381) | 450 (604 / 920) | **457** (593 / 1493) | 443 (852 / 946) |
| Transcript → first TTS request | **3000** (0.51–9.82 s) | **3034** (5238 / 6634) | **1371** (3205 / 5041) | **1626** (4036 / 13430) | **1339** (1868 / 3115) |
| Transcript → first audio | not measured | **4969** (7120 / 8208) | **3165** (5327 / 6701) | **3518** (5721 / 9077) | **2363** (2423 / 3366) |
| Sentences per turn | 1 (whole reply) | 1.6 | 1.8 | 2.1 | 1.3 |

Tool-measured engine latency for the last complete turn: `firstTextLatencyMs`
3454 → `firstAudioLatencyMs` **2136** (configuration D) and 2218 (E).

## Targets

| Target | Result | Verdict |
|---|---|---|
| ASR processing under 500 ms | median **443–499 ms** across all runs; P90 593–914 ms | **MET on median, MISSED on P90** |
| First response text under 1.5 s | 1371 ms (C) / **1626 ms (D)** / 1339 ms (E) | **MET in two of three runs, MISSED in D** |
| First synthesized audio under 2 s | 3165 / 3518 / 2363 ms | **MISSED** |
| Subsequent audio chunks continuous | see "discontinuities" below | **PARTIAL** |
| Stale response playback | `staleStreamsDropped` 0, and 0 obsolete buffers identified by ownership | **MET** (see caveat in `conversation-synchronization.md`) |
| Audio discontinuities measured | intra-sentence scheduling measured; inter-sentence gaps only partly | **PARTIAL** |

## What actually changed the numbers

### 1. A spoken turn now streams (the big one)

M22.7 awaited `ai.chat()` and only then asked for TTS. M22.8 subscribes to the
model's delta stream and speaks each complete sentence. The first TTS request
can therefore happen while the model is still writing sentence two.

Configuration B vs A: first TTS request medians are 3034 ms vs 3000 ms — **no
improvement**. That is the honest reading: with the first sentence being the
whole answer for most questions, streaming text alone does not move the first
request much. It shows up as multiple sentences per turn (1.6–2.1 instead of 1)
and as a much shorter *tail*: the second and third sentences no longer wait for
the entire reply.

The 1371–1626 ms medians in C/D/E are **not** attributable to PCM. They are the
same code path as B; the difference is model/provider variance between runs
(one D turn took 13.4 s to first text, which inflates its P90 and max). Reporting
the improvement as "streaming made first text 1.4 s" would be wrong.

### 2. Synthesis runs ahead of playback

`elevenLabsTts` now starts synthesis when a segment is enqueued, not when the
previous one ends. The unit test proves the ordering rule:

```
✔ the next sentence is synthesised while the current one is still playing
    both synthesises requested up front; only the first is playing
✔ order is preserved: the segments play in the order they arrived
✔ a stop drops what was already synthesising instead of playing it late
```

Before, every sentence after the first waited out a complete synthesis. On a
reply of three sentences that is two avoidable waits.

### 3. Incremental PCM — a small gain here, a bigger one elsewhere

`--output_raw` streams 16-bit PCM from Piper, and the page schedules each network
chunk as an `AudioBuffer` immediately.

Measured, within-run: `firstAudio − firstTts`

| Run | WAV | PCM run 1 | PCM run 2 |
|---|---|---|---|
| median | 1935 ms | 1794 ms | 1892 ms |

**So in this container PCM moved the first audible sample earlier by only about
0.1 s.** That is a negative result and it is reported as one. The reason is
visible in the synthesis timings: each `/api/voice/tts` call starts a **new
Piper process that loads the ONNX model** (0.7–1.5 s) before generating anything.
The first chunk cannot arrive before the model is in memory, and generation
itself (0.45–2.0 s) is the smaller half.

What PCM does buy is structural: playback no longer waits for the **last** chunk
of a sentence, which is exactly what matters for a provider whose synthesis is
seconds long (VoxCPM2 on any device, ElevenLabs on a slow link). It also makes
barge-in cheaper: cancelling aborts the response and kills the synthesiser
instead of letting it finish a WAV nobody will hear.

### Where the remaining 3.2 s goes

```
transcript ──1.4 s──► first streamed text   (model + routing + memory recall)
           ──1.8 s──► first audible sample  (Piper process start + model load
                                             + first chunk + scheduling)
```

To reach "first audio under 2 s" both halves must shrink. The model half is her
cognition and must not be shortcut (no bypassing `AIService`). The speaker half
has an obvious fix that was **not** implemented in this mission: keep **one
long-lived Piper process** and feed it sentences over stdin (`--json-input`
supports line-by-line synthesis), removing the per-sentence model load. That is
the single highest-value next step for latency.

## Discontinuities

**Intra-sentence:** none by construction — each PCM chunk is scheduled at
`max(currentTime + 20 ms, previousEnd)`, so buffers are contiguous and never
overlap. Measured in `logs/buffer-gaps.json`: 9/9 buffers reached their natural
end (`onended`), 0 underruns, 0 overlaps.

**Between sentences of one reply:** the synthesis-ahead queue is supposed to
have the next sentence ready before the current one ends. The live evidence is
indirect: in configuration D, 34 sentences were queued and 25 buffers played to
completion while the rest were dropped by interruption; the unit test proves the
next synthesis is requested before the current playback ends. A direct
measurement of buffer-to-buffer gaps *within one reply* was not obtained: the
short run used single-sentence answers (median gap between buffers 4.3 s, which
is the gap between **turns**, not within one), and the longer runs predate the
media-event logging. **This is the one metric WP02 asked for that is not
measured, and it is recorded as PARTIAL rather than claimed.**

## Reproduction

```bash
node MISSION-22.8/scripts/voice-latency-acceptance.mjs 280 20                              # paced
LELU_MIC_WAV=$PWD/.piper/fake-mic-20.wav \
  node MISSION-22.8/scripts/voice-latency-acceptance.mjs 200 20                            # dense
# logs land in MISSION-22.8/logs/<label>.json (LELU_RUN_LABEL selects the name)
```
