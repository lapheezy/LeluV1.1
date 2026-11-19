# M22.6 — VOICE PERFORMANCE AND RELIABILITY

**Date:** 2026-11-19
**Status:** **PARTIAL** — one stage was measured for real; every live-session metric is **BLOCKED**.
No latency target, buffer count or error rate below is invented.

---

## 1. Measured (real)

### Speech recognition round-trip

Method: 16 real WAV files (3.7–4.1 s each) posted to the app's own broker endpoint; wall-clock around the HTTP request.

| Metric | Value |
|---|---|
| Requests | 16 |
| Success | 16/16 HTTP 200 |
| Min / median / max | **265 ms / 292 ms / 356 ms** |
| Audio duration | 3.68–4.08 s |
| Realtime factor | ≈ 11–15× faster than real time |

This includes network and provider time; it is **not** the time from a user's end of speech (that requires VAD and a microphone).

### Build and test cost

| Metric | Value |
|---|---|
| Typecheck (`tsc -b --force`) | passes |
| Production build | 22.22 s |
| Deterministic voice suites | 77 tests, ~? (run in the same process batch) |
| Full suite | see [regression-and-release-qualification.md](regression-and-release-qualification.md) |

## 2. Blocked metrics

| Metric | Status |
|---|---|
| Microphone activation time | **BLOCKED** — no browser/device |
| Time to first transcript (live) | **BLOCKED** |
| End of utterance → first assistant text | **BLOCKED** |
| Time to first audible response | **BLOCKED** — no TTS engine |
| Total response duration | **BLOCKED** |
| Reconnection time | **BLOCKED** — no LiveKit server |
| Audio interruptions / dropped buffers | **BLOCKED** |
| Errors per session | **BLOCKED** |
| CPU / memory during a live session | **BLOCKED** (server RSS was 54 MB idle; not a voice measurement) |

## 3. Reliability properties, and how each was checked

| Concern | Implementation | Check | Status |
|---|---|---|---|
| Duplicate microphone streams | `start()` guarded by `_state.active`; one recorder at a time | code inspection | PARTIAL |
| Duplicate transcript events | 4 s same-utterance guard; echo filter (`isEchoUtterance`) | unit tests | VERIFIED (unit) |
| Orphaned audio contexts | `stop()` cancels speech, closes/stops recorder, stops tracks | code inspection | PARTIAL |
| Leaked session controllers | LiveKit transport detached on stop; listeners removed | code inspection | PARTIAL |
| Unbounded buffers | per-utterance `MediaRecorder`; recognition text only | code inspection | PARTIAL |
| Stale audio after barge-in | `cancelSpeech` + turnId check before speaking a late reply | unit tests | VERIFIED (unit) |
| Incorrect conversation association | active conversation captured **before** `ai.chat`; reply bound to it | unit test `voice-core-integration` | VERIFIED (unit) |
| Race between overlapping turns | `turnId` comparison; stale response discarded | unit tests | VERIFIED (unit) |
| Unhandled exceptions | recognition/transcription/playback each caught and classified into `TurnFailure` | unit tests | VERIFIED (unit) |

## 4. What a real measurement would require

1. Launchable browser + `--use-file-for-fake-audio-capture` (simulated mic) **or** a real microphone.
2. A running speech-output engine and a sink that records what was played.
3. A text provider (available).
4. Timing instrumentation already present in `VoiceEngine` diagnostics and `LatencyProbe`.

Until those exist, the honest performance statement is: **recognition is fast and reliable at the service boundary; the live interaction has no measured latency.**
