# WP02 — Real Microphone and Speaker Acceptance

**Status: BLOCKED — no physical device in this container.**
Procedure prepared and executable; not executed.

## Why it is blocked

`hardware-discovery.md` records the evidence: no `/dev/snd`, no
`/proc/asound`, no `aplay`/`arecord`/`ffmpeg`, no PulseAudio, PipeWire or
ALSA, no USB or PCI audio. There is no microphone to speak into and no
speaker to hear.

This is stated plainly rather than worked around. A recorded WAV played into a
fake capture device is **not** microphone acceptance, and a decoded
`AudioBuffer` is **not** audible output. Any result produced that way is
labelled SIMULATED, here and in every artifact that quotes it.

## What was completed instead

| Item | State |
|---|---|
| Device inventory | done (`hardware-discovery.md`) |
| Reproducible procedure | done (below) |
| Software path acceptance, labelled | done (`silent-turn-investigation.md`) |
| Device-failure handling in code | verified by inspection and unit tests; **not** exercised on real hardware |
| Error surfacing for a missing device | VERIFIED — `mapMediaError` maps `NotFoundError` / `NotReadableError` / `NotAllowedError` to distinct diagnoses |

## Procedure (executable on any machine with audio)

Run on a Linux/macOS/Windows desktop with a microphone and speaker. No special
build is needed: the same server, the same page, the same permission prompt.

### Setup

```bash
bun install
bun run build
PORT=4180 LELU_LOCAL_TTS_BIN=$PWD/.piper/piper/piper \
  LELU_LOCAL_TTS_MODEL=$PWD/.piper/voices/amy-low.onnx \
  bun run server.ts
# open http://127.0.0.1:4180/ , open the chat panel, press "Talk to LÉLU"
```

Record the session from the OS mixer (or a second device) so the audio
evidence is independent of the browser.

### Scenarios and what each must establish

| # | Scenario | Method | Pass condition |
|---|---|---|---|
| A | Ordinary speech | 5 natural questions | transcript matches the spoken content; the reply answers *that* question |
| B | Quiet speech | same 5 questions at conversational-minus volume | recognition stable; no silent turns |
| C | Background noise | speech + music or a fan | recognition degrades gracefully; failures are reported, not silent |
| D | Speaker output | listen to 5 replies | audio is audible, unclipped, at a comfortable level |
| E | Device selection | switch input, then output, via the OS | `speakerDevices` changes; audio follows the selection |
| F | Device failure | disconnect the active device mid-turn, then reconnect | error is surfaced (not silence); the next turn works after reconnect |

### Measurements to record for each scenario

```
turn index · transcript · ASR latency · first TTS · first audible
barge-ins · false barge-ins · missed interruptions · silently dropped turns
```

The page already publishes all of it at `window.__leluVoice`
(`diagnostics`, `turnLatency`, and the M23.0 per-turn ledger `turns`), so the
run can be captured without instrumenting anything:

```js
// in the browser console after the session
copy(JSON.stringify(window.__leluVoice, null, 2))
```

### The specific things this container could not test

1. **Does browser AEC actually remove her voice from the mic?** Requires the
   speaker and microphone to be physically coupled. This is the single most
   important unknown for full duplex.
2. **Does "no" arriving through a real room still pass the echo guard?** The
   guard now lets short interruptions through by design
   (`acoustic-interruption-report.md`). A real room may return *her* audio as
   a short fragment; a physical run should count spurious turns that begin
   with an interruption word.
3. **How loud is she, and does the level clip?** `AudioContext` gain is set in
   software; the acoustic result is unknown.
4. **Does the session survive a real device unplug?** The code path exists;
   only a physical unplug exercises it.

## Acceptance criteria — status

| Criterion | Status |
|---|---|
| Actual human speech is captured | BLOCKED |
| Transcription corresponds to the spoken content | BLOCKED (simulated ASR only) |
| LÉLU responds to the correct input | PARTIALLY VERIFIED — software pipeline, simulated input |
| Actual speaker output is confirmed | BLOCKED |
| Device failures are recoverable | NOT TESTED on hardware; code paths verified |

## Honest summary

The software half of this gate is done and labelled. The physical half is not
blocked by a defect in LÉLU — it is blocked by a container with no sound card.
The procedure above is what turns this gate from BLOCKED into VERIFIED, and it
needs a person with a headset, not more code.
