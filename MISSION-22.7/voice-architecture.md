# M22.7 — VOICE ARCHITECTURE (AS BUILT)

**Status:** one engine, three input paths, three output paths — plus one new **local** speaker behind the existing route. No second voice subsystem was created.

---

## 1. Diagram

```
 composer mic / navigator / planet-hold
                │
                ▼
        VoiceEngine (singleton)  ──► useVoice() ──► VoiceBridge (Genesis)
        idle → listening → processing → speaking
                │
   ┌────────────┼──────────────────────────────┐
   ▼            ▼                              ▼
LiveKit      Web Speech API               Whisper fallback
(if status   (webkitSpeechRecognition)    MediaRecorder + VAD
 configured)  final results                per utterance
   │            │                              │
   │            └────── transcript ────────────┘
   │                        │  (TranscriptProvenance: source/final/at/confidence)
   └────────────────────────┤
                            ▼
              handleUserSpeech(text, provenance)
              echo filter → duplicate guard → turnId → conversationId
                            ▼
              AIService.chat({ conversationId, transcript })
                            ▼
         AIRuntime → ProviderResolver → providers (OpenRouter/Groq/…)
              cognition · memory · tools · execution ledger
                            ▼
                     response.text
                            ▼
              speakResponse / speakThroughLivekit
        ┌───────────────────┼───────────────────────┐
        ▼                   ▼                       ▼
  LiveKit agent TTS   server /api/voice/tts    browser speechSynthesis
  (VoxCPM2 worker)    ├─ ElevenLabs (key)      (no voices in this container)
                      └─ local Piper  ← M22.7 addition
                            ▼
                    HTMLAudioElement → speakers
```

## 2. Component state in this environment (measured)

| Component | State |
|---|---|
| `VoiceEngine` singleton, state machine, barge-in/cancel, diagnostics | implemented; **exercised live** (9 VAD turns, 7 transcripts) |
| `getUserMedia` + `MediaRecorder` | **exercised live** against Chromium's simulated device |
| Web Speech API | present but returned nothing in headless Chromium → engine fell back to Whisper (observed) |
| Groq Whisper via `/api/model/groq/audio/transcriptions` | **working** (7/7 HTTP 200 in the live run) |
| `AIService.chat` | **working** (OpenRouter, 200) |
| ElevenLabs TTS | **not configured** (no key) |
| Local Piper TTS via `/api/voice/tts` | **working** (6 WAVs, 1.1–2.5 s synthesis) |
| Browser `speechSynthesis` | 0 voices on this Linux image |
| VoxCPM2 worker | **unreachable** (`ECONNREFUSED 127.0.0.1:8788`) |
| LiveKit server / agent | not installed, not configured |
| Playback | `<audio>` `play`/`pause`/`ended` observed; **no audio device** |

## 3. The M22.7 addition, precisely

`plugins/voiceApi.ts` gained a local-engine branch:

- **Opt-in only**: `LELU_LOCAL_TTS_BIN` and `LELU_LOCAL_TTS_MODEL` must both exist as files; otherwise the route behaves exactly as before (honest 503).
- **Same contract**: `POST /api/voice/tts { text }` → `audio/wav` (ElevenLabs returns `audio/mpeg`; `HTMLAudioElement` plays both). Existing client code is untouched.
- **Same status surface**: `GET /api/voice/status` now returns `configured: true, provider: "local-piper", voiceId: "local-piper:amy-low"` when ElevenLabs is absent but Piper is present. `stt` stays `false` — local TTS is not a recogniser.
- **No spend**: local synthesis never consults the ElevenLabs budget; the paid path is unchanged when a key exists.
- **Concurrency**: Piper is spawned per request with a 30 s timeout; output goes to a per-request temp dir that is always removed.

Not added: no new registry, no new session controller, no second memory or chat path, no npm dependency, no client bundle change.

## 4. Data that crosses each boundary

| Boundary | Payload |
|---|---|
| mic → recogniser | audio only |
| recogniser → engine | text + `{source, final, at, confidence?}` |
| engine → AIService | text, `conversationId`, transcript provenance |
| AIService → memory | the same provenance, merged by `MemoryBridge.learn` |
| engine → TTS | reply text only (chunked into speech segments) |
| TTS → page | audio bytes + provider/synthesis-time headers |
| execution ledger | tool calls, with optional mission scope (M22.6) |

## 5. Why half-duplex

In the Whisper fallback the engine records one utterance, transcribes, answers, speaks, then resumes listening. While it speaks, the mic loop is paused, so speech during her reply is not captured. This is the documented behaviour of the fallback path, not a bug discovered here; barge-in works in the Web Speech path (where recognition continues during speech) and over LiveKit. Full-duplex was **not** demonstrated.
