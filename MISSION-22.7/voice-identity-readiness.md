# M22.7 — VOICE IDENTITY READINESS

**Status:** **BLOCKED** for her actual voice; the working speaker is a labelled generic voice.

---

## 1. What the repository declares

| Item | Where | Value |
|---|---|---|
| Voice identity | `src/core/voice/voiceIdentity.ts` | `voiceId`, `modelId` from env (`ELEVENLABS_VOICE_ID`, `ELEVENLABS_MODEL_ID`), defaults in code |
| Reference recording | `lelu-voice-reference.m4a` (repo asset) | used only by the VoxCPM2 path |
| Server routes | `plugins/voiceApi.ts`, `plugins/voxApi.ts` | TTS/STT + Vox worker health/proxy |
| Worker | `services/voxcpm/` + `services/livekit-agent/agent.py` | present; needs model + Python deps + GPU/large RAM |
| Persisted settings | `voiceSettingsPayload(identity)` | stability/similarity style sent with each ElevenLabs request |

## 2. What is operational here

| Path | Operational? | Voice |
|---|---|---|
| VoxCPM2 (her voice) | **No** — `ECONNREFUSED 127.0.0.1:8788`, no model | would be hers |
| ElevenLabs | **No** — no key | generic commercial voice, *not* a clone |
| Browser `speechSynthesis` | **No** — 0 voices | OS voice |
| **Piper `en_US-amy-low`** | **Yes** | generic neural voice, **not hers** |

`/api/voice/status` reports `provider: "local-piper"` whenever the local engine is the active one, so a caller cannot mistake it for her trained voice.

## 3. Answers to the identity questions

| Question | Answer |
|---|---|
| Which voice model is configured? | ElevenLabs identity + VoxCPM2 reference; neither is runnable here |
| Is the intended voice available? | **No** |
| Is cloning implemented or planned? | The VoxCPM2 path (reference audio → worker) is implemented in code; it has **not** produced a single sample in this environment |
| Are settings persisted? | Voice style is computed from identity/env per request; no user-facing voice-settings store exists |
| Can providers preserve one identity? | No — swapping providers swaps the speaker; only the Vox worker would keep hers |
| Does output preserve pacing/personality? | Personality is preserved in **text** (her replies are unmistakably hers); the *voice* is generic |

## 4. What would make identity real

1. VoxCPM2 worker running with the model and `lelu-voice-reference.m4a` (GPU or ≥16 GiB host).
2. Or a licensed ElevenLabs voice clone of the reference, with the key configured (paid; requires authorization).
3. An audible A/B comparison against the reference.

Until then: **do not describe spoken output as LÉLU's cloned voice.** The reports and the status endpoint label it correctly.
