# M23.0 — Raw Evidence Index

Everything in this directory was produced by a script in `../scripts/` or by a
server the mission started. Nothing here is hand-written except this index.

## Browser run (SIMULATED microphone)

| File | What it is |
|---|---|
| `m23.0-100-turn.json` | The 100-turn run: per-turn ledger outcome, TTS requests, playback events, timeline, console lines, latency percentiles |
| `100-turn-stdout.log` | The harness's own summary and acceptance check for that run |
| `server-boot.log` | Server log during the 100-turn run — includes every model-provider 429 that explains the refused turns |
| `../screenshots/turn-025.png`, `turn-050.png`, `turn-075.png`, `run-final.png` | The page during and after the run |

The microphone for this run is a WAV file fed to Chromium's fake capture
device (`.piper/fake-mic-100.wav`, 100 questions, 22.8 min, built by
`../scripts/build-fake-mic-100.py`). **It is not a physical microphone**, and
nothing in this run is hardware acceptance.

## Echo guard (software, no audio)

| File | What it is |
|---|---|
| `echo-guard-before-after.json` | 48 echo cases + 228 interruption interactions, scored by the pre-fix rule (copied verbatim from `b46b0aa3`) and the current rule |

## Delivery / personality (software, no audio)

| File | What it is |
|---|---|
| `personality-expression-matrix.json` | 30 replies across 10 registers: register, spoken text, chosen profile under three identities, reason |

## Warm runtime soak

| File | What it is |
|---|---|
| `warm-soak-30min.json` | 30-minute soak: RSS samples, worker states, synthesis latency, queue depth, recovery event |
| `soak-stdout.log` | Progress lines and the final summary |
| `server-soak.log` | Server log for the soak (fresh process, warm worker at boot) |

## Audio samples

`../audio/profile-warm.wav`, `profile-calm.wav`, `profile-bright.wav` — the same
sentence in the three delivery profiles. Generated with the real Piper binary.
**Nobody listened to these**: no speaker exists in this container, so they are
reproducible artifacts, not an evaluation.

## Reproducing

```bash
# 1. build the simulated microphone
python3 MISSION-23.0/scripts/build-fake-mic-100.py \
  --piper .piper/piper/piper --model .piper/voices/amy-low.onnx \
  --out .piper/fake-mic-100.wav

# 2. serve
bun run build
PORT=4180 LELU_LOCAL_TTS_BIN=$PWD/.piper/piper/piper \
  LELU_LOCAL_TTS_MODEL=$PWD/.piper/voices/amy-low.onnx bun run server.ts

# 3. the 100-turn regression (~23 min)
LELU_MIC_WAV=$PWD/.piper/fake-mic-100.wav \
  node MISSION-23.0/scripts/silent-turn-regression.mjs 1800 100

# 4. the software measurements (seconds)
npx tsx MISSION-23.0/scripts/echo-guard-before-after.ts
npx tsx MISSION-23.0/scripts/personality-expression-matrix.ts

# 5. the 30-minute soak
npx tsx MISSION-23.0/scripts/warm-runtime-soak.ts 30
```
