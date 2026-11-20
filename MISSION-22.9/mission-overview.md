# MISSION 22.9 — PERSISTENT VOICE RUNTIME & HUMAN CONVERSATION

**Classification:** P0/P1 runtime advancement
**Parent:** M22.8 Real-Time Conversational Intelligence
**Branch:** `m22.9/persistent-voice-runtime`
**Baseline candidate:** `43db0a06c3c9c587aab9606e4cb328671548c805` (`m22.8/real-time-conversational-intelligence`)
**Canonical:** `543da7c8` — untouched
**M22.7 baseline (recoverable):** `8fe50238`

## What this mission set out to do

M22.8 made her speech belong to the turn that asked for it, streamed it
sentence by sentence, and proved interruption with simulated browser audio.
It also left seven known limits, and M22.9 was instructed to attack them
without rebuilding anything:

1. Piper reloads its ONNX model on every synthesis request.
2. First-audio latency stays above target.
3. Physical microphone and speaker acceptance is incomplete.
4. Acoustic interruption and echo cancellation are only partly verified.
5. Her intended voice identity is not established.
6. Delivery is not yet driven by her personality.
7. No five-minute conversation has been accepted.

## What was actually done

| WP | Subject | Result |
| --- | --- | --- |
| WP01 | Persistent Piper runtime | **Implemented and verified.** One warm `--json-input` worker per delivery profile; 20 sentences, 1 model load, median 114 ms |
| WP02 | Streaming audio optimization | **Measured** in a real browser against the warm server; compared with M22.8 |
| WP03 | Physical microphone/speaker | **BLOCKED** — this container has no audio device at all (`/dev/snd` absent). Procedure and evidence recorded |
| WP04 | Full-duplex conversation | Warm path integrated; barge-in unchanged and re-measured; physical acoustics remain blocked |
| WP05 | Personality-driven speech | **Implemented and verified** — three delivery profiles resolved from her developed identity, 30 representative replies tested |
| WP06 | Voice identity research | **Investigated with hard results** — the only loadable voice in this runtime is `amy-low`; `amy-medium` and `voice.onnx` abort on a phoneme-map error |
| WP07 | Five-minute conversation | **Simulated only** — labelled as such, never as human acceptance |
| WP08 | Runtime diagnostics | **Extended** — worker state, PID, uptime, model loads, queue depth, cancellations, restarts, RSS, AudioContext state, speaker count |
| WP09 | Regression | Typecheck, build, lint, full suite, voice suites |

## The one architectural decision that mattered

Before writing any code, three probe scripts measured what the installed
Piper binary can and cannot do. They are in `MISSION-22.9/scripts/` and their
raw output is in `MISSION-22.9/logs/`. The results decided the design:

- `--json-input` makes one process serve many sentences: **5 sentences in
  1 225 ms instead of 7 237 ms**.
- `--output_raw` (the M22.8 PCM stream) **does not work** in `--json-input`
  mode: it emitted 10 bytes. `output_file: "-"` emitted 2 bytes.
- A per-request output file is **0 bytes until the sentence is finished**,
  and its WAV header is patched with the real length **as the last write** —
  which is a reliable completion signal.
- Per-request `length_scale` over the JSON protocol is **ignored**
  (5.368 / 5.224 / 5.224 s against the command line's 5.000 / 5.400 /
  5.816 s), so delivery cannot be a request parameter.

Therefore: **one warm worker per delivery profile**, complete WAV per
sentence, with the M22.8 cold streaming path kept as the fallback
(`LELU_PIPER_PERSISTENT=0` restores it exactly, and it is also used when a
warm worker fails).

## What this mission did not do

- It did not use a physical microphone or speaker. None exists here.
- It did not clone her voice, and does not describe `amy-low` as hers.
- It did not merge, promote or touch canonical.
- It did not claim a five-minute human conversation. The long run is
  simulated and labelled so everywhere.

Evidence lives beside this file: 16 documents, five raw probe runs, the
benchmark JSON, browser logs, audio samples and the test suite result.
