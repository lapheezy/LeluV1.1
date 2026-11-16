# Voice architecture

## Position in the system

`VoiceEngine` (existing) owns conversation identity, listening, speaking,
barge-in and the transcript transport. The new adapters sit **behind** it and can
only add capability; they cannot change who LÉLU is.

```
VoiceEngine
   ├── when has the user finished?   VadDetector        (adaptive energy VAD)
   ├── what did the user say?        WhisperAdapter     (whisper.cpp HTTP)
   └── how do I say this back?       KokoroAdapter      (HTTP, chunked, interruptible)
```

## What was measured, and what was not

| Claim | Status |
|---|---|
| Chunked speech never duplicates or drops a word | **tested** — the join of all chunks equals the input, normalised |
| A chunk never ends mid-word | **tested** |
| Steady room tone does not open the detector | **tested** (300 frames) |
| A 300 ms thinking pause does not end the utterance | **tested** |
| 500 ms of silence ends it | **tested** |
| Barge-in closes the turn immediately | **tested** (`flush`) |
| Overlapping recognition windows de-duplicate | **tested** (`mergeTranscripts`) |
| Interruption stops synthesis at the next chunk | **tested** (fake HTTP, generation counter) |
| Unconfigured STT/TTS refuses honestly | **tested** |
| Median / p95 latency from real samples | **implemented** (`summariseBenchmark`); **no samples**, because there is no microphone |
| Real streaming audio, WebRTC, mobile transport | **not implemented** — Pipecat adapter is a health probe only |
| Silero's neural model | **not used** — ONNX weights absent; an energy detector with an adaptive noise floor stands in and says so |
| Kokoro voice quality, expressiveness | **not evaluated** — no server |

## Thresholds and why

| Parameter | Default | Rationale |
|---|---|---|
| `openRatio` | 3.2 × noise floor | speech must be clearly above learned room tone |
| `closeRatio` | 1.6 × noise floor | hysteresis: a quiet tail is still speech |
| `minSpeechFrames` | 3 (~90 ms) | a click is not an utterance |
| `minSilenceFrames` | 17 (~500 ms) | measured against natural thinking pauses; 300 ms is too eager |
| speech chunk | 180 chars | long enough for prosody, short enough to interrupt |

The noise floor only adapts **while not speaking**, so a loud utterance cannot
raise the floor and deafen the detector for the rest of the call.

## Benchmark contract

`summariseBenchmark(samples)` reports `median` and `p95` for
`transcriptionMs`, `synthesisMs`, `responseMs`, `interruptionMs`, and returns
`null` with "Nothing is claimed about latency" when there are no samples. Medical
of the acceptance spec ("record median and p95") is met **structurally**; the
numbers themselves require a device.

## Mobile

Capacitor shell exists and is unchanged. Microphone permission is handled by the
platform; **no device was available**, so no mobile voice check was performed and
none is claimed.

## Next steps (in order)

1. Run whisper.cpp `base.en` and Kokoro on the same machine; measure p50/p95.
2. Record 20 utterances with pauses and background noise; tune the four
   thresholds against the recordings, not intuition.
3. Only then consider Pipecat for a streaming transport, since it replaces the
   transport rather than the pipeline.
