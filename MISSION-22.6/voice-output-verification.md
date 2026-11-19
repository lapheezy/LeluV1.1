# M22.6 — VOICE OUTPUT VERIFICATION

**Date:** 2026-11-19
**Status:** **BLOCKED — no audible output could be produced or confirmed in this environment.**
No claim of working speech output, live playback, or a LÉLU voice clone is made.

---

## 1. The three existing output paths

`VoiceEngine` chooses the best available, in this order:

| Order | Engine | Route | What it is |
|---|---|---|---|
| 1 | LiveKit agent TTS | `speakThroughLivekit` → `services/livekit-agent/agent.py` → VoxCPM2 worker | LÉLU's reference-conditioned voice |
| 2 | ElevenLabs | `POST /api/voice/tts` (`plugins/voiceApi.ts:298`) | Commercial voice; **not** cloning of LÉLU's reference |
| 3 | Browser speech synthesis | `speakResponse` (`VoiceEngine.ts:1926`) | Generic OS/browser voice |

They are one engine's fallback chain, not three subsystems.

## 2. What each path actually reported

| Path | Probe | Result |
|---|---|---|
| VoxCPM2 worker | `GET /api/voice/vox/health` | `{"configured":true,"available":false,…"reason":"unreachable","detail":"cannot reach worker: ECONNREFUSED … 127.0.0.1:8788"}` |
| ElevenLabs TTS | `GET /api/voice/status` / `POST /api/voice/tts` | `503` — no `ELEVENLABS_*` configured |
| Browser synthesis | `speechSynthesis` in a browser | **No browser can launch**: Chromium fails with `libnspr4.so: cannot open shared object file`; no root to install it |
| Local TTS binary | `command -v espeak espeak-ng festival pico2wave aplay` | all absent |

There is **no audio output device** in the container either, so even a successful synthesis could not be confirmed as audible.

## 3. What *was* verified about output

| Behaviour | Status | Evidence |
|---|---|---|
| Reply text is handed to the speech layer exactly once | VERIFIED (unit) | `voice-streaming-tts-state`, `voice-continuity` |
| TTS stage advances requested → generated → playing → ended | VERIFIED (unit) | diagnostics tests |
| STOP cancels queued speech and in-flight generation | VERIFIED (unit) | `voice-continuity` |
| Text↔audio correspondence uses the same string | VERIFIED (code) | `speakResponse(response.text)` |
| ElevenLabs failure does not permanently disable TTS for the session | VERIFIED (unit) | reset-on-failure path |
| Audio is actually audible | **BLOCKED** | no engine + no device |

## 4. Classification, stated accurately

- **Streaming speech synthesis:** implemented (ElevenLabs streams; Vox worker supports streaming), **not demonstrated** here.
- **Half-duplex voice interaction:** implemented (one reply at a time, barge-in supported on the input side).
- **Full-duplex live conversation:** the LiveKit transport is architecturally full-duplex, but **nothing about it was demonstrated**; there is no server, no agent and no audio path in this container. Do not read the code's existence as proof.
- **LÉLU voice identity:** the VoxCPM2 worker is the only path that uses `lelu-voice-reference.m4a`. It is not running. Browser `speechSynthesis` and ElevenLabs are **generic voices** and must never be presented as her cloned voice.

## 5. What would change this verdict

1. A host with an audio device (or a loopback sink that can be recorded).
2. Either `ELEVENLABS_API_KEY` (generic voice, not a clone) **or** the VoxCPM2 worker running with its model and a GPU/≥16 GiB host.
3. A launchable browser with `libnspr4`/`libnss3` present.
4. A real reply from the model in that browser session.

Until then the output gate stays **BLOCKED**, and the mission's central acceptance gate cannot pass.
