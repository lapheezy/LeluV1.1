# M22.6 — VOICE ARCHITECTURE AUDIT

**Date:** 2026-11-19
**Base candidate:** `8aa24ce1` (M22.5)
**Method:** read the actual implementation and probe the running server. Nothing here is inferred from older reports.

---

## 1. One voice engine, three transports, three outputs

There is **no second voice subsystem**. Every entry point (composer mic, navigator mic, hold-the-planet) calls the singleton `VoiceEngine` (`src/core/voice/VoiceEngine.ts`), mirrored into React by `useVoice()` and adapted to the Genesis scene by `src/app/scene/genesis/VoiceBridge.tsx`.

```
                       ┌──────────────────────────────┐
 mic / navigator /      │        VoiceEngine           │
 planet hold ──────────►│  state: idle→listening→      │
                        │  processing→speaking         │
                        └───┬───────────┬──────────┬───┘
                            │           │          │
              ┌─────────────▼──┐  ┌─────▼──────┐  ┌▼─────────────────┐
              │ LiveKit (full  │  │ Browser    │  │ Whisper fallback │
              │ duplex path)   │  │ SpeechRec. │  │ MediaRecorder +  │
              │ livekitTransport│ │ (WebKit/   │  │ VAD chunks       │
              │ + Python agent │  │  Chrome)   │  │                  │
              └─────┬──────────┘  └─────┬──────┘  └┬─────────────────┘
                    │                   │          │
                    │  transcript       │ final    │ POST audio
                    ▼                   ▼          ▼
                 ┌──────────────────────────────────────────┐
                 │ handleUserSpeech(text, TranscriptProvenance)│
                 │  echo filter → duplicate guard → turnId   │
                 └───────────────────┬──────────────────────┘
                                     ▼
                        AIService.chat(text, …, {conversationId, transcript})
                                     │
                     normal cognition, providers, memory, tools
                                     ▼
                    ┌────────────────────────────────────┐
                    │ speakResponse / speakThroughLivekit │
                    └───┬───────────────┬─────────────┬──┘
                        │               │             │
              LiveKit agent TTS     ElevenLabs      browser
              (VoxCPM2 worker)      /api/voice/tts  speechSynthesis
```

### Component status (measured, not assumed)

| Component | File | State in this repository | Available here? |
|---|---|---|---|
| Voice session orchestrator | `src/core/voice/VoiceEngine.ts` | Implemented; phases, barge-in, echo filter, duplicate guard, diagnostics | Code present, **no browser** |
| React mirror | `src/core/voice/useVoice.ts` | Implemented | — |
| Scene adapter | `src/app/scene/genesis/VoiceBridge.tsx` | Implemented; subscribes to turns/utterances, persists them | — |
| Mic permission + capture | `VoiceEngine.start()` / `recordUtterance()` (`:844`, `:851`, `:1415`) | Implemented: `getUserMedia({audio:true})`, `MediaRecorder` per utterance | **BLOCKED** (no browser/device) |
| Error mapping | `speechToText.mapMediaError`, `VoiceEngine.mapRecognitionError` | Implemented; distinguishes permission / no-device / busy / blocked-embed | Unit-tested |
| Browser speech recognition | `startWebSpeechRecognition()` (`:969`) | Implemented behind feature detection; fallback if absent | Code present, **no browser** |
| VAD recording fallback | `startWhisperFallback()` → `recordUtterance()` | Implemented; records one utterance per detected speech region | Code present |
| Groq Whisper STT | `transcribeViaWhisper` → `/api/model/groq/audio/transcriptions` | **Operational** — verified with real audio and the server's brokered key | **YES** |
| ElevenLabs Scribe STT | `elevenLabsStt.ts` → `POST /api/voice/stt` | Implemented; requires `ELEVENLABS_*` | **Not configured** (503) |
| LiveKit transport | `src/core/voice/livekitTransport.ts` + `plugins/livekitApi.ts` | Implemented: token, room, data channel, reconnect notices | **No server binary, no credentials** |
| LiveKit agent | `services/livekit-agent/agent.py` | Present; Python `livekit` package absent | **Not runnable** |
| VoxCPM2 TTS | `services/voxcpm/` + `plugins/voxApi.ts` + `gpuWorkers.ts` | Client + route + worker scripts present; probe shows worker `ECONNREFUSED` on `127.0.0.1:8788` | **No model, no worker** |
| ElevenLabs TTS | `elevenLabsTts.ts` → `POST /api/voice/tts` | Implemented | **Not configured** |
| Browser speech synthesis | `speakResponse()` (`:1926`) | Implemented; chunked, cancellable, waits for voices | Code present, **no audio device** |
| Interruption / barge-in | `isBargeIn`, `cancelSpeech`, `cancelInFlightTurn` | Implemented for both recognition paths | Unit-tested, not live |
| Session cleanup | `stop()` (`:2075`) | Stops recognition, recorder, timers, speech, LiveKit; releases tracks | Code present |
| Conversation association | `handleUserSpeech` reads active conversation; `ai.chat` gets `conversationId` | Implemented | Pinned by `voice-core-integration` |
| ASR provenance | **M22.6 addition** — `TranscriptProvenance` on each turn, forwarded into memory | Implemented | Unit-tested |

---

## 2. Canonical dependencies (and no duplicates)

- **AI/cognition:** `AIService` → `AIRuntime` → `ProviderResolver`/`AIProviderRegistry`. Voice does not instantiate a second provider chain; it calls `ai.chat`.
- **Memory:** `MemoryBridge.learn` → `Brain.learn` → `MemoryEngine`. Voice passes provenance, it does not write memory itself.
- **Server broker:** `plugins/modelApi.ts` exposes `/api/model/<provider>/…` and resolves numbered Groq slots (`GROQ_API_KEY_1..3`). The browser never holds the key.
- **Execution evidence:** `ExecutionEvidence` + `AgentEventBus`; voice turns are ordinary chat turns once transcribed.

No LiveKit/Vox/Whisper alternative was added, and no new registry or session controller was created.

---

## 3. Configuration the pipeline reads

| Variable / route | Purpose | Present here? |
|---|---|---|
| `GROQ_API_KEY`, `GROQ_API_KEY_1..3` | Whisper transcription (server-side broker) | **Yes** (numbered slots; broker resolved them) |
| `ELEVENLABS_API_KEY*` | Scribe STT / ElevenLabs TTS | No |
| `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `LELU_VOICE_AGENT_TOKEN` | LiveKit room + agent | No |
| `VOXCPM_*` / worker at `127.0.0.1:8788` | LÉLU's cloned voice | No (worker unreachable) |
| `OPENROUTER_API_KEY*` | Text model responses | Yes (used by the normal provider chain) |

`/api/voice/status` is served by `plugins/voiceApi.ts:723`; `/api/livekit/status` by `plugins/livekitApi.ts:226`; `/api/voice/vox/health` by `plugins/voxApi.ts`.

---

## 4. What is genuinely missing

1. A **launchable browser**: Playwright's Chromium cannot start (`libnspr4.so` missing) and there is no root to install system packages.
2. **Audio hardware**: no microphone or speaker, and no virtual audio device in the container.
3. A **speech-output engine that is both configured and local**: ElevenLabs has no key, the VoxCPM2 worker is not running and its model is not installed, and no local TTS binary (`espeak`, `festival`, `pico2wave`) exists.
4. **LiveKit server and Python agent dependencies**: `livekit-server` is absent; `livekit` Python package is absent.

These are environment facts, not code conclusions. The code paths exist and are unit-tested; they cannot be exercised end to end here.
