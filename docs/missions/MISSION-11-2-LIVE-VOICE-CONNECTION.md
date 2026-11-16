# Mission 11.2 — LÉLU Live Voice Connection & Conversational Runtime

**Branch:** `integration/lelu-four-workforce-consolidation`
**Date:** 2026-11-10
**Commit:** `21cb55ea8dd35e996168841b44ae6a8025df81d0`

## Verdict first

Voice **input** is genuinely operational end to end in a real browser, and was proven
so with real speech. Voice **output** is not: her voice provider refuses every real
reply because the ElevenLabs account is on the free tier with **1 of 10,000
characters remaining**, and this runtime's browser has no speech engine of its own.
Nothing is spoken, and this report does not claim otherwise.

| Direction | Status | Evidence |
|---|---|---|
| Microphone → VAD → transcription → chat | **PASSED** (live) | 5/5 utterances heard; transcripts in §6 |
| Cognition (same AIService as text) | **PARTIAL** (live) | 3/5 turns answered; 2 hit provider-chain exhaustion |
| Reply → her voice → audible playback | **BLOCKED** | ElevenLabs `401 quota_exceeded`; browser has 0 voices |
| Barge-in over real audio | **NOT EXECUTED** (unit-tested only) | nothing audible to interrupt |
| Mobile hardware | **NOT EXECUTED** | no device, no `android/` or `ios/` project in-repo |

**Definition of completion (speak → contextual reply → hear her) was NOT met**, for the
provider-quota reason above, not for a code reason.

---

## 1. Voice architecture map

```
┌─ entry points ────────────────────────────────────────────────────────┐
│ SpatialNavigator mic button · ChatUniverse "Talk to LÉLU"             │
│ CoreHoldGesture (hold the planet) · GenesisSettingsPanel voice studio  │
└───────────────┬───────────────────────────────────────────────────────┘
                ▼
        VoiceEngine (singleton, src/core/voice/VoiceEngine.ts)
        ├─ mic: navigator.mediaDevices.getUserMedia
        ├─ ears: Web Speech (continuous, interim)  ─┐
        │        ElevenLabs Scribe  /api/voice/stt  ├─ pick one per session
        │        Groq Whisper       (broker)       ─┘
        ├─ segmentation: energy VAD on the live stream (vadWorklet.ts first,
        │   AnalyserNode fallback), one turn per utterance, 20 s cap
        ├─ barge-in: isBargeIn / isEchoUtterance, cancelSpeech()
        ├─ cognition: AIService.chat() — the SAME call text chat makes
        ├─ voice: ElevenLabs via /api/voice/tts (chunked, serialised)
        │         fallback: browser speechSynthesis
        └─ state: idle → listening → processing → speaking (+ diagnostics)
                ▼
        VoiceBridge.tsx — persists the user utterance through addMessage(),
        mirrors phase into GenesisCore, surfaces errors as notifications
                ▼
        MultiChatStore — one conversation for text and voice; the assistant
        reply is stored by AIService, so it appears in the transcript
                ▼
        GenesisChat.tsx — typed turns; feeds streamed replies to
        begin/feed/finishStreamingSpeech so she speaks while streaming
```

Server side (key never in the browser):

```
plugins/voiceApi.ts   GET  /api/voice/status → {configured, stt, voiceId, modelId}
                      POST /api/voice/tts    → audio/mpeg  (xi-api-key attached server-side)
                      POST /api/voice/stt    → {text}      (Scribe)
                      rate-limited per client, X-Lelu-Usage reports provider cost
plugins/modelApi.ts   /api/model/<provider>/… — the broker every chat/STT call uses
```

## 2. Existing component audit

| Component | Verdict | Note |
|---|---|---|
| `src/core/voice/VoiceEngine.ts` | **functional** | One engine; mic, VAD, three STT routes, chunked TTS, barge-in, diagnostics |
| `src/app/scene/genesis/VoiceBridge.tsx` | **functional** | Single app-level subscriber; no second chat pipeline |
| `src/app/scene/genesis/GenesisChat.tsx` | **functional** | Streams text into TTS; typed and voice share one conversation |
| `plugins/voiceApi.ts` | **functional** | Live on this server; `configured:true, stt:true`, voice Jessica, `eleven_v3`, `scribe_v1` |
| `src/core/voice/elevenLabsTts.ts` | **functional, was faulty** | Serialised chain; hung after any stop (§4 fix 4) |
| `src/core/voice/elevenLabsStt.ts` | **functional** | Metered, name normalisation |
| `src/core/voice/transcriptionTransport.ts` | **functional** | Groq Whisper through the same broker |
| `src/core/voice/vadWorklet.ts` | **functional** | Audio-thread turn detection |
| `src/core/voice/speechToText.ts` | **duplicated** | `buildTranscriptionForm` duplicates the inline Whisper form in `VoiceEngine`; only used by a verification script |
| `src/core/voice/audioRecorder.ts` | **orphan** | Imported only by `scripts/verify-voice.ts` |
| `src/core/voice/adapters/VoiceAdapters.ts` | **not wired** | Kokoro / whisper.cpp / Silero adapters; imported only by `tests/voice-adapters.test.ts`. Its own header says the services are absent |
| `src/og/lib/voice-engine.ts` + `og/.../VoicePanel.tsx` | **separate variant** | OG workspace's own engine; not on the Genesis path |
| `src/app/scene/genesis/integration/VoiceStudioPanel.tsx` | **test-only reference** | Imported by `tests/integration-studios.test.ts` only |
| `src/core/native/capabilities/{mic,speech,tts}.ts` | **native wrappers** | `tts.ts` delegates to `VoiceEngine`; not exercised in this environment |

## 3. Connection and provider audit

| Path | Configured | Live result |
|---|---|---|
| `/api/voice/status` | yes | `{configured:true, stt:true, voiceId:"cgSgspJ2msm6clMCkdW9", modelId:"eleven_v3", sttModelId:"scribe_v1"}` |
| ElevenLabs TTS | yes | **refused** — `401 quota_exceeded` (tier `free`, 9,994/10,000 characters used, 1 remaining) |
| ElevenLabs Scribe (STT) | yes | **refused** on real speech (same quota); 200 on a 1 s tone |
| Groq Whisper (STT) | yes | **works** — 5/5 transcriptions, 456–537 ms |
| Chat providers | anthropic `POLICY_DISABLED`; groq, openrouter, githubModels `CONFIGURED` | Groq 5 ok / 6 fail; OpenRouter 0/3; GitHub Models 0/1 across the run |

No provider was added, replaced or reconfigured by this mission.

## 4. Files changed

| File | Change |
|---|---|
| `src/core/voice/VoiceEngine.ts` | Streamed segments are now **counted** (`streamSegmentsPending`) so a streamed reply registers as *speaking* (barge-in can fire) and the phase **settles** when the last segment ends; a streamed reply with no browser engine waits for the one-time provider answer instead of silently dropping its first sentences; the playback-failure notice no longer promises a browser voice that does not exist |
| `src/core/voice/elevenLabsTts.ts` | `stopSpeaking()` now **releases the serialised chain** — a paused element fires no `ended`, so every reply after a barge-in used to queue behind a promise that never settled |
| `tests/voice-streaming-tts-state.test.ts` | **new** — 3 regression tests for exactly those behaviours |
| `scripts/verify-voice-conversation.cjs`, `scripts/verify-voice-e2e.cjs` | Chromium path may be supplied via `PW_CHROMIUM` (this VM's browser is not at `/opt/pw-browsers/chromium`); behaviour otherwise unchanged |
| `docs/acceptance/mission-11-2/` | Live evidence: `voice-conversation.json`, `voice-conversation.partial.json`, `conversation-final.png`, `typed-turn-blocked.png` |

## 5. Commit SHAs

- `21cb55ea8dd35e996168841b44ae6a8025df81d0` — fixes above, regression test, evidence, this report.

## 6. Voice input test evidence (live)

Harness: `scripts/verify-voice-conversation.cjs` against the running dev server
(`vite`, port 5173), Chromium 151 headless with a **virtual microphone**: real
decoded speech played into a real `MediaStream` at the moment a person would speak.
Everything after the microphone is LÉLU's own code.

```
heard 5/5   turns 5   repeated 0
elevenlabs-stt:stt   ok=0 fail=5   (935 / 1006 / 948 / 888 / 986 ms — quota)
groq-whisper:stt     ok=5 fail=0   (456 / 537 / 521 / 496 / 497 ms)
```

Transcripts the engine produced from audio, in order:

1. "Lélu, in one short sentence, what are you?"
2. "What is 2 plus 2? Just the number."
3. "Remember this. My favorite color is teal."
4. "What is my favorite color? One word."
5. "Hold on, stop, just say the word paused."

Phases observed: `idle → listening → processing → speaking`. The Scribe failure was
absorbed by the existing fallback (no user-visible error), which is the designed
behaviour and is visible in the ledger above.

## 7. Voice output test evidence

| Check | Result |
|---|---|
| Provider round trip | **FAILED** — 490 ms, `401 quota_exceeded` |
| Browser fallback | **unavailable** — 0 `speechSynthesis` voices in this Chromium |
| Audio elements that played | **0** (`her-audio` events: 0) |
| Playback transport (serialised chain, cancellation, phase settle, no double-play) | **PASSED** — `tests/voice-streaming-tts-state.test.ts`, 3/3, with a stub audio element |

So: the transport around her voice is now verified by test; the voice itself is not
audible in this environment, and no audio claim is made.

## 8. Two-way conversation demonstration

Voice and text share one conversation (`MultiChatStore` active id) and one cognition
call. In the live run the same conversation produced:

```
user:      Lélu, in one short sentence, what are you?
assistant: I'm Lélu, your personal AI companion and creative partner.

user:      What is 2 plus 2? Just the number.
assistant: 4

user:      Remember this. My favorite color is teal.
assistant: Got it — I've saved that your favorite color is teal.

user:      What is my favorite color? One word.
assistant: I'm in offline mode right now — all AI providers are unreachable …
```

An earlier run of the same harness answered turn 4 with **"teal"** after an offline
notice on turn 3, which shows memory survives a failed reply. The reply itself is
absent only because the provider chain failed on that turn (Groq/OpenRouter/GitHub
Models), not because of voice.

The typed half of the mixed-mode check could **not** be executed: the harness could
not find the composer in that scene state (`user-typed-blocked`, "no composer";
`screenshots/typed-turn-blocked.png`). Voice→text interleaving in the same
conversation is therefore **not verified live**.

## 9. Mobile test results

**NOT EXECUTED.** No physical device or emulator was available, and this repository
contains no `android/` or `ios/` project to build (`capacitor.config.ts` is present;
platform folders are not). Microphone permission, audio routing, background/foreground
transitions and device audio behaviour are therefore **unverified on mobile**, and no
mobile voice support is claimed.

## 10. Remaining limitations

1. **Her voice cannot speak (blocker).** ElevenLabs free tier: 9,994/10,000 characters
   used. Every reply is refused with `401 quota_exceeded`. Remediation: top up the
   account or supply a key with characters as `ELEVENLABS_API_KEY` (the server reads
   `ELEVENLABS_API_KEY` or the bare `Elevenlabs`), then re-run:
   `LELU_BASE=http://127.0.0.1:5173/ node scripts/verify-voice-conversation.cjs <utteranceDir> <outDir>`.
2. **Browser voice is absent here**, so the fallback is silent in this VM. On a normal
   desktop the fallback speaks in an OS voice — not hers.
3. **Provider chain instability**: 2/5 turns ended in the offline notice. Voice is
   only as reliable as cognition underneath it.
4. **Barge-in over real audio is unit-tested only** — it needs audible speech to
   interrupt, which (1) prevents.
5. **Echo suppression is a text heuristic** (`isEchoUtterance`), not acoustic echo
   cancellation; a speakerphone conversation remains unproven.
6. **Typed/voice interleaving not verified live** (composer absent in the harness's
   scene state).
7. **Duplicate/orphan voice modules left in place** (§2): `audioRecorder.ts`,
   `VoiceAdapters.ts`, `speechToText.ts`'s duplicated form builder, the OG engine and
   `VoiceStudioPanel`. They are not on the live path; removing or re-wiring them is a
   separate decision and was deliberately not taken here.
