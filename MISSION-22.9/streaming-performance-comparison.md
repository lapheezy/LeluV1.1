# STREAMING PERFORMANCE COMPARISON

**WP02 · Gate G4 (optimization) and G5 (measured improvement)**

Run: `MISSION-22.9/logs/m22.9-warm-paced.json` (30 turns, 7 min 23 s,
Chromium + `--use-file-for-fake-audio-capture`, warm Piper runtime on
`http://127.0.0.1:4180`). Script: `MISSION-22.9/scripts/voice-latency-acceptance.mjs`.

**The microphone is simulated.** This measures the software pipeline end to
end in a real browser; it is not hardware acceptance and not human speech.

## Headline

| Metric | M22.8 (`latency-acceptance.json`) | M22.9 (this run) | Change |
| --- | --- | --- | --- |
| Transcript → first TTS, median | 1 626 ms | **1 435 ms** | −12 % |
| Transcript → first TTS, P90 | 4 311 ms | **2 628 ms** | −39 % |
| Transcript → first TTS, max | 13 400 ms | **6 400 ms** | −52 % |
| Transcript → first audio, median | 3 518 ms | **2 480 ms** | **−29 %** |
| Transcript → first audio, P90 | 5 721 ms | **3 664 ms** | **−36 %** |
| Transcript → first audio, max | — | 7 786 ms | — |
| ASR, median | 457 ms | 468 ms | unchanged (not optimised) |
| Stale responses played | 0 | **0** | held |
| Barge-ins in the run | 11 | **9** | comparable |

Against the mission's original targets:

| Target | Measured | Verdict |
| --- | --- | --- |
| First audio under 2 000 ms | median **2 480 ms**, P90 3 664 ms | **MISSED** — and reported as missed |
| Warm first audio (speech stage) under 1 500 ms | **114 ms** benchmark, 804 ms median live synthesis | MET for the speech stage; the miss is upstream |

## Where the remaining 2.5 s goes

Measured within this run:

| Stage | Median |
| --- | --- |
| ASR (transcript available) | 468 ms |
| Transcript → first text (model) | `firstTextLatencyMs` 1 395 ms |
| First text → TTS request | ≈ 40 ms (1 435 − 1 395) |
| TTS synthesis (server, live sentences) | 804 ms (n = 20, min 73, max 1 535) |
| Synthesis → playback onset | `firstAudibleLatencyMs − firstAudioLatencyMs` = **+25 ms** |

The model's own first-token time (≈1.4 s) plus its full first sentence and the
speaker are what remain. **The TTS stage is no longer the bottleneck**, which
is the concrete change this mission delivered: in M22.8, `firstAudio −
firstTts` was 1 794–1 935 ms — largely the per-sentence model load — and here
the speech stage is 0.8 s for a full conversational sentence and 0.114 s for a
short one.

## Per-turn distribution (n = 26 measured turns)

- `transcriptToFirstTts`: min 27, median 1 435, P90 2 628, max 6 400 ms.
- `transcriptToFirstAudio`: min 0, median 2 480, P90 3 664, max 7 786 ms.
- Sentence synthesis (n = 20 turns with a completed response): median **804.5**,
  min 73, max 1 535 ms.
- 40 sentences were handed to the speaker across 30 turns.

## Turns that do not fit the medians, named

- **Four turns produced no speech at all** (#18 "Recommend one fruit for
  breakfast", #19 "That is all for now", #28 "Does HTTP stand for?", #29 "Who
  wrote Pride and Prejudice"): a transcript arrived, `sentencesSpoken = 0`,
  no TTS request. They are counted in the 30 turns and excluded from the
  latency medians (which are computed over the 26 turns that had a first-TTS
  timestamp). This is a real gap, not an outlier to bury.
- **Six turns were interrupted mid-reply** (1–2 pause events): their audio
  began but their response never completed, so no `X-Lelu-Synthesis-Ms`
  header was read (`provider: null`). Their first-audio times are included,
  their synthesis times are not.
- **One turn reports `transcriptToFirstAudioMs = 0`** (#14, the joke turn,
  which was interrupted twice). Zero milliseconds is physically impossible
  for this pipeline; it is a measurement artefact of an interrupted turn that
  the harness attributed to the next one. It is the `min` of the distribution
  and does not move the median, but it is disclosed rather than deleted.

## What was optimized, and what was not

| Stage | Change | Effect |
| --- | --- | --- |
| TTS model load | **persistent warm worker** | 426 → 114 ms first audio (benchmark); 20 → 1 model load |
| TTS delivery | complete WAV per sentence instead of PCM stream | −? (see note) |
| Browser playback | onset now measured on the player's own `playing` event | +25 ms of *honesty*, not of latency |
| Sentence detection, normalization | unchanged (M22.8) | — |
| ASR | unchanged | 468 ms |
| Model first token | unchanged | ~1.4 s, now the dominant cost |

Note on the streaming trade: the warm path cannot emit raw PCM (measured:
`--json-input` + `--output_raw` = 10 bytes), so audio arrives per sentence.
The M22.8 measurement showed PCM streaming saved only ~0.1 s of
`firstAudio − firstTts` (1 935 → 1 794/1 892 ms) — the model load was the real
cost, and removing it is worth ~7× more than the streaming granularity lost.
The PCM path still exists and is tested; `LELU_PIPER_PERSISTENT=0` restores
M22.8 behaviour exactly for a like-for-like comparison in the same build.
