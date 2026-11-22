# WP07 — Performance and resource validation

All numbers from `persistent-runtime/logs/resource-probe.json`,
`resource-probe-idle.json`, `e2e-*.json`. Simulated microphone; a container
with no audio device; Chromium headless on a shared CPU.

## Repeated session start/stop (30 cycles through the real mic button, forced GC before each sample)

| After cycle | Heap (MB) | window listeners | document listeners | AudioContexts created / closed | mic streams open / acquired / released | lifecycle listeners | TTS queue |
| --- | --- | --- | --- | --- | --- | --- | --- |
| before | 38.39 | 72 | 6 | 1 / 1 | – | – | – |
| 1 | 38.98 | 87 | 7 | 3 / 3 | 0 / 1 / 1 | 4 | 0 |
| 10 | 40.36 | 87 | 7 | 21 / 21 | 0 / 10 / 10 | 4 | 0 |
| 20 | 40.96 | 87 | 7 | 41 / 41 | 0 / 20 / 20 | 4 | 0 |
| 30 | 41.59 | 87 | 7 | 61 / 61 | 0 / 30 / 30 | 4 | 0 |

**Idle control** (same wall time, same page, no voice): 38.29 → 40.28 MB (+1.99 MB).
With 30 voice cycles: 38.39 → 41.59 MB (+3.20 MB) — at most ≈ 1.2 MB, ≈ 40 KB per
session, attributable to voice. Growth is linear and small; no structure was
found that grows with sessions (stream, listener, AudioContext, queue counters
all flat). Not called a leak, not called leak-free: it is reported.

* **Duplicate audio streams:** none — open streams return to 0 after every stop;
  one `getUserMedia` per session in every E2E run.
* **Event listener accumulation:** none — window/document listener counts are
  identical after cycle 1 and cycle 30. (+15 window / +1 document on the first
  session: one-time bindings, including the engine's 4 lifecycle listeners.)
* **Unreleased AudioContexts:** none — every context created (VAD + recorder
  per utterance) was closed.
* **Playback queue growth:** queue depth 0 after every stop.
* **Unbounded transcript buffering:** `lastSpokenText` is capped at 800 chars;
  transcripts are not accumulated by the engine.
* **Rerenders:** the mic button's attributes change exactly 10 times per
  start/stop cycle (300 over 30): one per real phase/state transition, not
  per animation frame.
* **Unnecessary model requests:** one `AIService.chat` per transcript; the
  duplicate-utterance guard and single-flight recorder are unchanged and were
  not triggered in any run (4 transcripts → 4 turns → 4 replies).

## Startup

Tap → microphone live (state `active` + `micStreamActive`): min 611 ms, median **1 224 ms**,
p90 1 661 ms, max 1 725 ms over 30 cycles. That includes the LiveKit and
voice-status probes and the fake device opening; it is the user-visible delay
before "listening".

## Voice-to-chat latency (final desktop run, `e2e-desktop.json`)

| Turn | STT request (ms) | transcript → first text | → first audio handed to player | → first audible (`playing`) |
| --- | --- | --- | --- | --- |
| 1 (question) | 462 | 2 188 | 4 492 | 4 832 |
| 2 (barge-in) | 991 | 1 042 | 2 031 | 2 366 |
| 3 (barge-in) | 359 | 3 697 | 4 084 | 4 373 |
| 4 (context) | 556 | 2 068 | 2 430 | 2 747 |
| mobile run, turn 1 | 633 | 601 | 702 | 735 |

Three desktop runs, 12 turns: transcript → first text 712–5 056 ms (median
≈ 2.5 s), first text → audible 529–2 685 ms (median ≈ 800 ms), transcript →
audible 1 241–6 273 ms (median ≈ 3.9 s). Model time dominates (one superseded
run: 9.3 s when the model chose to call two tools for a simple question). Local Piper warm
synthesis: 86 ms reported for the last sentence (`warmSynthesis`).

## Regressions

None measured against the earlier M22.9 numbers (transcript → first audio
median 2.48 s there; 2.4–4.5 s here on a busier CPU with a remote model). The
streaming change (split on line breaks) **adds** speech requests for markdown
replies (18–21 per run instead of ~8) — each is short, warm and in order — and
removes the 413 that silenced a whole block before. No optimisation was made
without a measurement.

## Not measured

Real speaker output, acoustic echo, battery, iOS memory, long (>10 min) sessions.
