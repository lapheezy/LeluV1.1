# M22.7 — PROVIDER READINESS

**Measured 2026-11-19/20.** Every "available" below was exercised; nothing is assumed from a package being installed.

---

## 1. Matrix

| Capability | Provider | Status | Evidence |
|---|---|---|---|
| Speech recognition | **Groq Whisper** `whisper-large-v3-turbo` via `/api/model/groq/audio/transcriptions` | **Available, used** | 7/7 live transcripts; 16/16 earlier pack requests; 265–356 ms |
| Speech recognition | ElevenLabs Scribe `/api/voice/stt` | Unavailable | no key; route 503 |
| Speech recognition | Browser Web Speech API | Present, unusable here | "heard speech but returned nothing" in headless Chromium; engine fell back |
| Speech synthesis | **Piper** `en_US-amy-low` (local, CPU) | **Available, used** | 6 WAVs, 1.14–2.46 s synthesis, intelligible on round-trip |
| Speech synthesis | ElevenLabs `/api/voice/tts` | Unavailable | no key; 503 |
| Speech synthesis | VoxCPM2 (LÉLU voice) | Unavailable | worker `ECONNREFUSED 127.0.0.1:8788`; no model |
| Speech synthesis | Browser `speechSynthesis` | Unavailable | 0 voices on this image |
| Text model | OpenRouter | Available, used | 200s during the conversation |
| Text model | Groq chat | Available | used by some background paths |
| LiveKit full-duplex | livekit-server + Python agent | Unavailable | binary/package absent, no credentials |
| Audio output device | ALSA/Pulse | **Absent** | no playback hardware |

## 2. Local TTS evaluation (WP02)

| Engine | Verdict | Notes |
|---|---|---|
| **Piper** (`piper` 2023.11.14-2 binary, `en_US-amy-low`) | **Chosen** | MIT models; fully offline; 61 MB model; CPU-only; 1.1–2.5 s per reply segment; 16 kHz mono WAV; no Python dependency at runtime |
| Piper medium models | Rejected on this binary | `Phonemes must be one codepoint` — the 2023 binary is older than current medium voice maps. Low-quality model works. |
| Kokoro | Not pursued | needs espeak/phonemizer + PyTorch; far heavier than the available runtime justifies once Piper worked |
| eSpeak NG (bundled with Piper) | Fallback only | works, but clearly robotic; not used when Piper is present |
| ElevenLabs | Unavailable | paid key absent; also not a clone of LÉLU |
| VoxCPM2 | Preferred but blocked | needs the model + ≥16 GiB/GPU and a running worker |

**Honest label:** Piper is a **generic neural voice**, not LÉLU's trained voice. Nothing in the reports or UI calls it her cloned voice.

## 3. Cost and licensing

- Piper: MIT (engine) / CC-BY or public-domain voice datasets; model card for `amy` is CC-BY. No account, no key, no per-character cost.
- Groq: existing project key, already in use for STT before this mission.
- No new subscription, account, credit card or paid API was added.

## 4. Configuration

```
LELU_LOCAL_TTS_BIN=/abs/path/.piper/piper/piper
LELU_LOCAL_TTS_MODEL=/abs/path/.piper/voices/amy-low.onnx
```

Both must exist for the route to activate. Without them, `/api/voice/tts` answers exactly as it did in M22.6 (503 when ElevenLabs is absent). `audio/` contains the WAVs produced during acceptance.
