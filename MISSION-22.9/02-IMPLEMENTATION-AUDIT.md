# WP02 — Implementation inventory and gap audit

Audited on `m22.9/persistent-voice-runtime` @ `b46b0aa3` **before any edit**,
by reading the code paths end to end (not by trusting earlier reports).

## The real architecture (traced)

```
tap (composer mic [data-lelu-voice-toggle] / "Talk to LÉLU" / hold-the-planet / navigator mic)
  └─ VoiceEngine.toggle()                      src/core/voice/VoiceEngine.ts   (one singleton)
       ├─ unlockAudio()  (inside the tap — iOS)
       ├─ LiveKit transport if /api/livekit/status says configured (not configured here)
       └─ start(): getUserMedia({echoCancellation, noiseSuppression, autoGainControl})
            ├─ ears, in order: ElevenLabs Scribe (server) → Web Speech → Groq Whisper (server relay)
            │     Whisper/Scribe path: recordUtterance() — VAD on an AudioWorklet (vadWorklet.ts),
            │     main-thread fallback; one turn per utterance; loop keeps listening while she speaks
            ├─ barge-in: isBargeIn(heard, lastSpokenText) while isSpeaking() → cancelSpeech()
            └─ handleUserSpeech(text, provenance)
                 ├─ echo guard (isEchoUtterance), 4 s duplicate guard
                 ├─ emitUtterance → VoiceBridge → GenesisCore.addMessage (same channel as typed)
                 ├─ cancels the superseded in-flight turn (AIService.cancelActiveTurn)
                 ├─ AIService.chat(text, media, note, {conversationId, transcript})   ← SAME runtime as typed
                 ├─ AIService.subscribeStream → beginStreamingSpeech/feed/finish (turn-owned)
                 └─ failureFromResponse: failure notices shown, never spoken
  speech: elevenLabsTts.speakText → POST /api/voice/tts (server: ElevenLabs, else local Piper warm
          worker, plugins/voiceApi.ts + plugins/persistentPiper.ts) → PCM via AudioContext or a
          WAV/MP3 via HTMLAudioElement; synthesis-ahead queue, one pump, stopSpeaking() for barge-in.
          Browser speechSynthesis is the fallback.
  UI state: VoiceBridge → setVoice(phase); useVoice() mirrors state/turn/diagnostics;
            window.__leluVoice publishes the real diagnostics for acceptance runs.
```

There is one voice engine, one chat runtime, one memory path. No parallel
system exists or was added.

## 1. Already working (verified by reading + existing tests)

* Voice and typed input use the same `AIService.chat` and the same
  conversation id (MultiChatStore), so context is shared.
* Streaming speech per completed sentence, owned by the turn
  (`streamOwner`; stale deltas dropped and counted).
* Barge-in on both ears (Web Speech partials and Whisper turns), on speech
  and on thinking; echo guard; duplicate-utterance guard.
* Whisper loop is single-flight (`whisperLoopBusy`).
* Recognizer auto-restart in every phase; service failures fall back to Whisper.
* Warm local Piper runtime (earlier M22.9), PCM incremental playback,
  synthesis-ahead queue, `stopSpeaking()` resolves a paused segment.
* Turn failures classified (`turnFailure.ts`) and shown, not spoken.
* Typed `speakResponse` path: segment failure → browser voice fallback + notice.

## 2. Partially implemented

* **Speech-generation failure on the streamed path.** `speakStreamSegment`
  passed no `onFail`: a sentence the server could not synthesise disappeared
  with no notice, no fallback, no stage change. Every spoken reply streams,
  so this was the main path. (Text still reached the chat.)
* **TTS request with no timeout.** A server that accepted the request and
  never answered held the queue — and the "speaking" phase — indefinitely.
* **Remount.** `useVoice` started every mount with `turn = null` even when a
  turn was in progress.

## 3. Disconnected / missing

* **Microphone track lifecycle: none.** No `ended`/`mute` listener on the
  captured track. Device unplugged, permission revoked in site settings, or
  iOS taking the microphone left `active: true`, phase `"listening"` and a
  dead stream: **the UI said she was listening while nothing was captured**,
  and the Whisper loop failed once a second against the dead stream.
* **Page lifecycle: none.** No `visibilitychange`, `pagehide`, `online`, or
  permission-change handling anywhere in the voice code.
* **Diagnostics after stop** kept `micStreamActive: true` (never reset).

## 4. Fails on mobile (by code path; not observed on hardware)

* iOS Safari ends/mutes capture on backgrounding, screen lock, calls and
  Siri; with no `ended` handling the session became a silent false
  "listening" until the user toggled twice.
* Safari does not persist a "Don't Allow": the engine's catch-all retry with
  `{audio:true}` after **any** getUserMedia failure produced a **second
  permission prompt** after a denial.

## 5. Fails after interruptions / lifecycle changes

* **Concurrency:** `toggle()` awaited the LiveKit probe before deciding, so
  two quick taps both reached `start()`; a stop while the permission prompt
  was open adopted the late stream anyway (leaked live microphone).
* Ended stream → recorder errors each second, "transcription failed" notices
  for audio nobody spoke.

## 6. Simulated rather than real (in earlier evidence)

* Every earlier "conversation" run used Chromium's fake capture; there has
  never been a physical microphone or speaker in these containers
  (M22.7–M22.9 say so). That remains true for this mission.

## 7. Missing from the acceptance criteria

| Requirement | Before this mission |
| --- | --- |
| A — device interruption / stream end recovery | missing |
| A — backgrounding / visibility / screen lock | missing |
| A — no duplicate streams | race present |
| D — microphone stream failure | missing |
| D — remount | partial |
| E/F — failed synthesis on the streamed path | silent |
| F — revoked permission mid-session | missing |
| F — provider timeout (TTS) | missing |
| Resource counters to prove cleanup | missing |

Functioning components (echo guard, VAD, streaming, warm Piper, turn
ownership, budget gate) were **not** rewritten.
