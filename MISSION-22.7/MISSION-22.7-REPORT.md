# M22.7 — LIVE VOICE QUALIFICATION & RUNTIME CLOSURE

**Date:** 2026-11-19/20
**Branch:** `m22.7/live-voice-qualification`
**Base:** `afcfd8c7f4c970c2ebfe3c9ce6de14578f1a2262` (M22.6 candidate)
**Canonical:** `543da7c8d7876258869d928648cffa913cd10649` (untouched)
**Decision:** **CONDITIONALLY APPROVED** — see §6.

---

## 1. Executive summary

M22.6 ended BLOCKED because no browser could start, no microphone existed and no speech-output engine was configured. M22.7 removed two of those three blockers **without root, without paid services and without a new voice subsystem**:

1. **A real Chromium now runs.** The missing Noble libraries were downloaded as `.deb` packages, extracted into a local prefix and supplied through `LD_LIBRARY_PATH`. LÉLU boots, renders and runs her real runtime in it (screenshots 01–04, logs).
2. **A real, offline speech engine now speaks.** Piper (MIT-licensed neural TTS, CPU-only) is installed locally, and the existing `/api/voice/tts` route now serves it when no ElevenLabs key is configured. The browser plays the returned WAV through the existing ElevenLabs playback path, unchanged.

With those in place, the complete loop ran end to end in the browser, repeatedly:

**fake microphone WAV → Chromium `getUserMedia`/`MediaRecorder` → VAD utterance → `POST /api/model/groq/audio/transcriptions` (200) → transcript → `AIService.chat` (200) → reply → `POST /api/voice/tts` (200, `local-piper:amy-low`) → HTMLAudioElement playback → next turn.**

- **7 real speech recognitions** of 5 distinct spoken phrases, all HTTP 200.
- **6 synthesized replies**, saved as WAV (8.2–18.2 s each), **6 playbacks started** in the page.
- **Contextual continuity across turns**: after hearing the meeting phrase, her replies refer to "15 minutes until the design team meeting" and offer to pull up project notes; when the looping test audio repeats her own greeting, she answers *"That's my line!"*.
- Round-tripping two synthesized replies back through Whisper returns their spoken text, proving the audio is intelligible speech, not silence.

## 2. What is still not real

| Limit | Consequence |
|---|---|
| **No physical microphone** | Input is Chromium's `--use-file-for-fake-audio-capture` with a real WAV. Every input gate is **simulated-input**, explicitly not physical-device. |
| **No speaker / audio device** | Playback is proven to start (`play` events on `blob:` URLs, `ended` observed) and the audio itself is real and intelligible, but **audibility through hardware is BLOCKED**. |
| **Piper is not LÉLU's cloned voice** | It is a generic 16 kHz neural voice (`en_US-amy-low`). VoxCPM2 — her trained voice — still has no worker, model or GPU here. Voice identity remains **BLOCKED**. |
| **Half-duplex only** | While she speaks, the microphone loop is paused, so a person cannot naturally interrupt her mid-sentence in this configuration. Barge-in logic exists and is unit-tested; live barge-in was **not** observed. |
| **Full-duplex / LiveKit** | No `livekit-server`, no agent runtime. Not claimed. |

## 3. The 12 required answers

**1. Can LÉLU hear a person through a microphone? — PARTIALLY VERIFIED.**
A real browser captured a real audio stream (`getUserMedia` → `Fake Default Audio Input`, 9 VAD turns of 3.7–6.5 s, peak 0.15–0.38) and sent it to recognition. No physical microphone exists in this container, so "a person speaking into hardware" is **BLOCKED**; the capture path itself is verified with Chromium's simulated device.
Evidence: [microphone-acceptance.md](microphone-acceptance.md), `logs/voice-acceptance.json`, `logs/harness-console.log`.

**2. Can she accurately recognize what is said? — VERIFIED (for the tested phrases).**
7/7 recognitions returned 200. All five injected phrases were recovered, including "I've saved the document and shared it with your project folder." and "I'm sorry, I didn't catch that. Could you say it again?". Number formatting varies ("15" vs "fifteen").
Evidence: [five-turn-conversation.md](five-turn-conversation.md), `logs/turn-summary.json`.

**3. Can she generate a response? — VERIFIED.**
Every transcript produced a real model response through the canonical `AIService.chat` path (OpenRouter, 200). Replies reference prior turns.
Evidence: `logs/voice-acceptance.json` (spoken segments), `logs/acceptance-run.out`.

**4. Can she speak that response audibly? — PARTIALLY VERIFIED.**
Real WAV speech was synthesized for every reply (Piper, 1.1–2.5 s per segment), saved in `audio/`, independently re-transcribed to matching text, and playback started in the browser (`play` on `blob:` URLs, `pause`/`ended` observed). **Audibility through a speaker is BLOCKED** — no audio device exists here.
Evidence: [speech-output-acceptance.md](speech-output-acceptance.md), `audio/reply-*.wav`.

**5. Can she maintain five consecutive turns? — VERIFIED (7 turns).**
Seven consecutive spoken turns in one session, with context carried across them.
Evidence: [five-turn-conversation.md](five-turn-conversation.md).

**6. Can a person interrupt her naturally? — PARTIALLY VERIFIED.**
Stopping the session during speech cancels playback and speech state; the STOP path is unit-tested. Natural barge-in (speaking over her) was **not** demonstrated because this half-duplex fallback pauses the mic while she speaks. No claim of full-duplex interruption is made.
Evidence: [interruption-and-recovery.md](interruption-and-recovery.md).

**7. Can she recover from errors? — PARTIALLY VERIFIED.**
Browser recognition failed and the engine **automatically switched to Whisper mid-session** ("Browser recognizer heard speech but returned nothing — switching to Whisper") and then transcribed successfully — a real, observed fallback. Session restart after stop produced a fresh working session. Network/provider-failure injection was not performed live; those paths remain unit-verified only.
Evidence: `logs/harness-console.log`, [interruption-and-recovery.md](interruption-and-recovery.md).

**8. Does she retain conversation continuity? — VERIFIED.**
Her third and fourth replies explicitly continue the meeting topic introduced in turn 1, and she reacts to hearing her own greeting in turn 5 ("That's my line!").
Evidence: [five-turn-conversation.md](five-turn-conversation.md).

**9. Is her intended voice actually operational? — BLOCKED.**
Her voice identity is VoxCPM2 (`lelu-voice-reference.m4a`); the worker is not running and no model is installed (`ECONNREFUSED 127.0.0.1:8788`). The working speaker is Piper `en_US-amy-low` — a generic voice, labelled as such everywhere. No cloning claim is made.
Evidence: [voice-identity-readiness.md](voice-identity-readiness.md).

**10. What remains blocked by hardware or infrastructure?**
Physical microphone, physical speaker/audible confirmation, true barge-in, LiveKit full-duplex, VoxCPM2 identity, GPU. Full list in [release-qualification.md](release-qualification.md) §4.

**11. Measured end-to-end latency?**
Speech end → transcript: not directly instrumented (VAD turn end to ASR request ≈ 0.4–0.9 s in the logs). Transcript → first TTS request: **0.5, 1.8, 2.3, 3.7, 5.7, 9.8 s** (median 3.0 s; first turn slowest). TTS synthesis: **1.14–2.46 s** for 8–18 s of audio. Details and method in [latency-benchmarks.md](latency-benchmarks.md). These are single-run numbers, not a benchmark.

**12. Is the candidate safe to promote? — CONDITIONALLY.**
Code is green (typecheck, build, lint 0 errors, voice 86/87 with 1 intentional skip, full suite pending), the candidate contains one small additive server change, and the live loop works with simulated input. Promotion still requires at least one run on a machine with a real microphone and speaker, because no hardware audition has happened. See [release-qualification.md](release-qualification.md).

## 4. What changed in the product

| File | Change |
|---|---|
| `plugins/voiceApi.ts` | Local, opt-in Piper speaker on the **existing** `/api/voice/tts` route when no ElevenLabs key exists; `/api/voice/status` reports `provider: "local-piper"`. No client change, no new subsystem, no new dependency in `package.json`. |

Everything else is evidence, harnesses and reports. The M22.6 implementation (`2bcc3c66`) and its evidence are preserved unchanged.

## 5. Reproduce

```bash
bash MISSION-22.7/scripts/prepare-voice-runtime.sh     # browser libs + Piper
bun install --frozen-lockfile && bun run build
PORT=4180 LELU_LOCAL_TTS_BIN=$PWD/.piper/piper/piper \
  LELU_LOCAL_TTS_MODEL=$PWD/.piper/voices/amy-low.onnx bun run server.ts &
node MISSION-22.7/scripts/voice-acceptance.mjs 45
```

## 6. Decision

**CONDITIONALLY APPROVED.** The loop is real and reproducible in a real browser with simulated audio input; output audio is real and intelligible but was not heard through hardware, and the voice is not yet hers. Canonical stays untouched until a hardware run signs off G2/G5/G7.
