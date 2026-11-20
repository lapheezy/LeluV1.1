# MISSION 22.8 — LÉLU REAL-TIME CONVERSATIONAL INTELLIGENCE

**Streaming speech · full-duplex interaction · voice identity · conversational synchronization**

| | |
|---|---|
| Mission class | P0/P1 runtime & experience advancement |
| Parent | M22.7 Live Voice Qualification (CONDITIONALLY APPROVED) |
| Candidate baseline | `8fe502382fb9911629860bda08d90dcff0be7fdc` (M22.7 remote-verified) |
| Implementation reference | `e4ce1764` (M22.7 local TTS + live qualification) |
| Canonical baseline | `543da7c8` — **not touched** |
| Working branch | `m22.8/real-time-conversational-intelligence` |
| Date | 2026-11-20 |
| Environment | Linux container, 8 vCPU, 16 GiB RAM, no GPU, **no physical microphone or speaker** |

## The sentence this mission had to make true

M22.7 proved a pipeline: mic → ASR → model → TTS → speaker. It did not prove a
conversation. The defects it reported were structural, not cosmetic:

1. a queued reply could belong to an earlier transcript;
2. speech generation waited for the whole answer;
3. the microphone was paused while fallback TTS played;
4. interruption could not cancel what had already been generated;
5. markdown, emoji and formatting artefacts were read aloud;
6. Piper is not LÉLU's voice;
7. physical mic/speaker acceptance stayed open;
8. latency grew across consecutive turns.

M22.8 closes 1, 2, 5 and the software half of 3 and 4; it audits 6 with evidence
and keeps 7 explicitly blocked. It does **not** upgrade a simulated microphone
into hardware acceptance, and it does not promote the candidate.

## What changed, in one paragraph

A spoken turn now subscribes to the same response stream a typed turn already
used, so her first sentence is spoken while the rest is still being written.
Every streamed reply carries the identity of the turn that owns it, and a
reply whose turn has been superseded is dropped and counted instead of spoken.
The TTS pipeline synthesises the next sentence while the current one plays, and
a stop drops everything synthesising behind it. Everything she says now goes
through one pure normalization layer, so `**Mission 22.8** completed. 🚀`
reaches the speaker as "Mission twenty-two point eight completed." The
microphone asks for echo cancellation and stays open while she speaks, which is
what makes barge-in possible with a real device. A server route and a page-level
diagnostic now name every component of the pipeline, and say plainly which facts
the server cannot know.

## Deliverables in this directory

| File | Work package | Contents |
|---|---|---|
| `mission-overview.md` | — | this document |
| `source-integrity.md` | Phase 0 | baseline verification, branch isolation, canonical untouched |
| `conversation-synchronization.md` | WP01 | turn ownership, cancellation, stale-drop evidence |
| `streaming-latency-report.md` | WP02 | 20-turn measurements before/after, method, limits |
| `full-duplex-interruption.md` | WP03 | capture, barge-in, echo, what is simulated |
| `voice-identity-investigation.md` | WP04 | why VoxCPM2 returns ECONNREFUSED, with the real traceback |
| `tts-provider-comparison.md` | WP04 | open-source providers, licences, hardware, verdict |
| `spoken-language-normalization.md` | WP05 | the rules, the acceptance populations, the fixtures |
| `hardware-acceptance.md` | WP06 | the procedure that must be run on real devices |
| `runtime-recovery.md` | WP06 | failure matrix and the diagnostics that locate each one |
| `M22.8-verification-report.md` | WP07 | typecheck, build, lint, full suite, new tests |
| `release-qualification.md` | — | gate-by-gate status, promotion decision |
| `known-limitations.md` | — | everything still not true |
| `scripts/` | — | fake-mic builder, browser harness, diagnostics probe |
| `logs/`, `screenshots/`, `audio/` | — | raw evidence from the runs below |

## How to reproduce the live run

```bash
# 1. browser libraries and Piper (see M22.7/scripts and .gitignore)
#    .browser-libs/extract/usr/lib/x86_64-linux-gnu, .piper/piper/piper,
#    .piper/voices/amy-low.onnx

# 2. a simulated microphone of twenty questions
python3 MISSION-22.8/scripts/build-fake-mic.py \
  --piper .piper/piper/piper --model .piper/voices/amy-low.onnx \
  --out .piper/fake-mic-20.wav            # dense (interruption run)
python3 MISSION-22.8/scripts/build-fake-mic.py \
  --piper .piper/piper/piper --model .piper/voices/amy-low.onnx \
  --out .piper/fake-mic-paced.wav --gap 11  # paced (latency run)

# 3. the server, with the local speaker
PORT=4180 \
LELU_LOCAL_TTS_BIN="$PWD/.piper/piper/piper" \
LELU_LOCAL_TTS_MODEL="$PWD/.piper/voices/amy-low.onnx" \
bun run server.ts

# 4. the acceptance runs (Playwright + Chromium, simulated mic)
node MISSION-22.8/scripts/voice-latency-acceptance.mjs 300 20
LELU_MIC_WAV="$PWD/.piper/fake-mic-paced.wav" \
  node MISSION-22.8/scripts/voice-latency-acceptance.mjs 280 20
```

The harness labels the microphone as simulated in every log it writes. Nothing
in this directory claims a physical device was used.

## Reading the evidence honestly

* **VERIFIED** — reproduced here, with a command, an exit status and a log.
* **PARTIALLY VERIFIED** — the software path ran, but one half of the claim
  needs hardware or a provider this container does not have.
* **BLOCKED** — cannot be executed here; the procedure to execute it is written.
* **NOT TESTED** — no claim is made.

`release-qualification.md` assigns one of these to each of gates G1–G18.
