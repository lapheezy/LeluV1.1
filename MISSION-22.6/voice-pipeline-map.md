# M22.6 — VOICE PIPELINE MAP

Every stage of the spoken loop, the code that owns it, and what was actually observed. No stage is marked working because a file exists.

Legend: **VERIFIED** (observed working in this mission) · **PARTIAL** (real components exercised, but not the full stage) · **BLOCKED** (environment prevented it) · **NOT IMPLEMENTED**.

---

## A. Input path

| # | Stage | Owner | Observed status | Evidence |
|---|---|---|---|---|
| A1 | Entry point (mic button / navigator / planet hold) | `VoiceBridge.tsx` → `VoiceEngine.toggle` | **BLOCKED** | No browser |
| A2 | Secure-context / capability check | `VoiceEngine.start()` | PARTIAL | Code distinguishes `insecure`, `blocked-embed`, `no-device`; unit-tested mappings |
| A3 | Microphone permission request | `navigator.mediaDevices.getUserMedia({audio:true})` (`:851`) | **BLOCKED** | No browser or device |
| A4 | Permission grant / denial / recovery | `mapMediaError` | PARTIAL | Pure mapping tested; live denial not exercised |
| A5 | Device enumeration / selection | browser default device only | **BLOCKED** | No `enumerateDevices` run |
| A6 | Stream acquisition | `getUserMedia` → `this.mediaStream` | **BLOCKED** | No device |
| A7 | Sample rate / channel config | browser default; `MediaRecorder` MIME selection | PARTIAL | Code only |
| A8 | Encoding / buffering | `MediaRecorder` per utterance (`:1444`) | **BLOCKED** | No browser |
| A9 | Audio reaches a real STT service | `transcribeViaWhisper` → `/api/model/groq/audio/transcriptions` | **VERIFIED (file audio, not mic)** | 16/16 real WAV requests returned transcripts; see [speech-recognition-acceptance.md](speech-recognition-acceptance.md) |
| A10 | Conversation association | `MultiChatStore.getActiveId()` → `ai.chat({conversationId})` | **VERIFIED (code + tests)** | `VoiceEngine.ts:1674–1684`; `tests/voice-core-integration.test.ts` |
| A11 | Mic release after session | `stop()` stops tracks, recorder, timers | PARTIAL | Code + unit tests; no live stream |
| A12 | Repeated activation without duplicate streams | `start()` guards `_state.active`; `recordUtterance` reuses stream | PARTIAL | Code inspection |

---

## B. Recognition and understanding

| # | Stage | Owner | Observed status | Evidence |
|---|---|---|---|---|
| B1 | Browser recognition (Web Speech API) | `startWebSpeechRecognition` | **BLOCKED** | Not launchable here |
| B2 | VAD-chunk fallback | `recordUtterance` + silence detection | **BLOCKED** | No mic |
| B3 | Transcript finalisation | `onresult` / fallback loop | PARTIAL | Final-only submission; duplicate guard tested |
| B4 | Silence / no-speech handling | `mapRecognitionError` returns null for `no-speech`/`aborted`; empty transcript loops | PARTIAL | Unit-tested |
| B5 | Duplicate suppression | `lastUtterance` 4 s guard; echo filter `isEchoUtterance` | **VERIFIED (unit)** | `tests/voice-continuity` |
| B6 | Error classification | `mapRecognitionError`, `TurnFailure` | **VERIFIED (unit)** | voice suites |
| B7 | Transcript provenance | **M22.6** `TranscriptProvenance` on `VoiceTurn`, forwarded to memory | **VERIFIED (unit)** | `tests/asr-provenance.test.ts` |
| B8 | Multiple spoken turns | `handleUserSpeech` per final transcript | **BLOCKED** | No live audio |

---

## C. Cognition and reply

| # | Stage | Owner | Observed status | Evidence |
|---|---|---|---|---|
| C1 | Canonical routing | `ai.chat` → `AIRuntime` → providers | PARTIAL | Text path builds; no browser turn run |
| C2 | LÉLU identity/personality | system prompt + `LeluIdentity` via the same path as text | PARTIAL | Unchanged, not exercised live |
| C3 | Conversation continuity | `MultiChatStore` + `MemoryBridge.threadContext` | **VERIFIED (unit/integration)** | existing cognition/memory suites |
| C4 | Memory of the spoken turn | `MemoryBridge.learn(..., provenance)` | **VERIFIED (unit)** | `tests/asr-provenance.test.ts` |
| C5 | Turn failure surfaced, not spoken | `failureFromResponse`, `noteFailure` | **VERIFIED (unit)** | `voice-stream-*`, `voice-continuity` |

---

## D. Output path

| # | Stage | Owner | Observed status | Evidence |
|---|---|---|---|---|
| D1 | Reply text produced | `ai.chat` response | PARTIAL | Not run in a browser; provider keys exist server-side |
| D2 | LiveKit agent speech (VoxCPM2) | `speakThroughLivekit` | **BLOCKED** | Worker `ECONNREFUSED` at `127.0.0.1:8788` |
| D3 | ElevenLabs speech | `/api/voice/tts` | **BLOCKED** | 503 — no `ELEVENLABS_*` |
| D4 | Browser speech synthesis | `speakResponse` chunk chain | **BLOCKED** | No browser/audio device |
| D5 | Audible playback | `<audio>` / `speechSynthesis` | **BLOCKED** | No speaker; no way to confirm audibility |
| D6 | Text↔speech correspondence | same `response.text` passed to TTS | PARTIAL | Code; no playback to compare |
| D7 | STOP silences immediately | `stopSpeakingNow` → `cancelSpeech` | **VERIFIED (unit)** | voice suites |
| D8 | Barge-in | `isBargeIn` + cancellation | PARTIAL | Logic tested; no live microphone |

---

## E. Lifecycle

| # | Stage | Owner | Observed status |
|---|---|---|---|
| E1 | Session start/stop | `toggle`, `stop` | PARTIAL (code/tests) |
| E2 | Reconnection | `livekitTransport` notices; recognition restart | **BLOCKED** (no LiveKit server) |
| E3 | Cleanup (timers, streams, speech) | `stop()` | PARTIAL (code/unit) |
| E4 | Repeated sessions | state guard + teardown | PARTIAL (code) |
| E5 | Refresh/navigation during session | page unload stops audio | **NOT VERIFIED** |
| E6 | Provider fallback (ElevenLabs → Whisper) | `transcribeUtterance` catch | **VERIFIED (unit)** |

---

## F. Bottom line

```
mic → encode → recognise → converse → synthesise → speak → recover
 │       │         │           │           │          │        │
BLOCKED BLOCKED  PARTIAL     PARTIAL     BLOCKED    BLOCKED  BLOCKED
                    ▲
        real audio → real transcript VERIFIED through the server broker
        (file input, not a microphone)
```

The pipeline is **architecturally complete and singular**; the central live gate is blocked by absent hardware, a non-launchable browser and unconfigured output engines. That is reported as BLOCKED, not converted into a pass by testing pieces in isolation.
