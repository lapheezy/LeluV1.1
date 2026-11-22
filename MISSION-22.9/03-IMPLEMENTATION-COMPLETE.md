# WP03 — Persistent voice runtime: what was completed

All changes are inside the existing engine and UI. No new engine, runtime,
memory path, provider or dependency. No LangChain/LangGraph, no Anthropic.

## Files changed

| File | Change |
| --- | --- |
| `src/core/voice/VoiceEngine.ts` | session epoch + single-flight start; capture lifecycle (adopt/release stream, track `ended`/`mute`/`unmute`); `recoverCapture()` with bounded retry for a busy device; `endSessionWithError()`; page lifecycle bound once (`visibilitychange`, `pagehide`, `online`, `permissions` change); `captureSuspended` state + one rule in `updateState` that never shows "listening" without a captured microphone; denial no longer re-prompts; streamed-segment `onFail` (notice + browser-voice fallback); new diagnostics (stream counters, losses, recoveries, interruption, visibility, listener count); `getTurn()`, `end()`, `disposeLifecycle()` |
| `src/core/voice/elevenLabsTts.ts` | 15 s response-header timeout on `/api/voice/tts` (cleared when headers arrive, so a long PCM body is never cut) |
| `src/core/voice/useVoice.ts` | a component mounting mid-session starts from the engine's real turn and state |
| `src/app/scene/genesis/GenesisChat.tsx` | mic button can always turn voice **off** (was disabled during a typed reply); status reads "microphone paused" when capture is suspended; machine-readable `data-lelu-voice-toggle/phase/capture` |
| `src/app/scene/genesis/chat/universe/ChatUniverse.tsx`, `chatUniverse.css` | the **primary** chat surface's mic button now shows the real state (`aria-pressed`, label, live/suspended highlight, `data-lelu-voice-*`), targets the composer's conversation, 44 px on touch |
| `tests/voice-persistent-session.test.ts` | **new**, 20 tests |

### Found by the live runs and fixed (WP06)

* **Streamed markdown block → one oversized speech request → HTTP 413 →
  that part of the answer silent.** `feedStreamingSpeech` now also breaks on
  line breaks and splits any block longer than a speech chunk.
* **A late `playing` event from a superseded turn was credited to the new
  turn** (a 29 ms "latency"). First-audio/audible are now attributed only to
  the turn that queued the audio.
* **`bargeIns` diagnostic lagged up to 5 s** (only refreshed by the poll);
  now published when it changes.
* **Chat Universe mic had no state at all** (see WP04).

## Behaviour, requirement by requirement

### A. Persistent listening lifecycle
* Starts only from a tap (`toggle()`); never resumes by itself after
  `pagehide` or reload.
* One session spans any number of turns; the microphone stays open through
  thinking and speaking (unchanged, already worked).
* Permission denied → `errorKind: "permission"`, `permission: "denied"`,
  **one** prompt only. No device → `"no-device"`.
* Track ends while visible → re-acquired at once (same session, ears
  restarted). Busy (a call) → retried at 0 / 1 / 3 s, then ended honestly
  (`"audio"`). Denied on re-acquire → session ends as a permission error.
* Page hidden → no re-acquire attempts from the background; if capture was
  lost the state is `captureSuspended`, phase `idle`; on return the
  microphone is re-acquired, or a recognizer the browser aborted is restarted.
* Duplicate streams: second tap during opening = stop; a stream arriving after
  stop is released; `micStreamsOpen` is provably 0 or 1.
* Lifecycle listeners are bound once per page (singleton), so start/stop
  cycles never add listeners.
* Explicit end stops every track and resets the diagnostic.

**iOS limit (stated, not worked around):** a backgrounded or locked iPhone
does not give a web page the microphone. The session keeps the user's intent
and resumes capture when the page is visible again; it does not claim to
listen in the background.

### B. Real-time conversational voice — unchanged, already correct
Same `AIService.chat`, same conversation id, streaming per sentence, turn
ownership, duplicate guard.

### C. Barge-in — unchanged logic, now tested repeatedly
Three consecutive interruptions in one session (unit), two in the live run
(see WP06).

### D. Persistent state and recovery
Provider failures (existing `turnFailure`), microphone failures (new),
playback failures (new on the streamed path), remount (new `getTurn`). Page
reload: conversation persists through the existing MultiChatStore; the voice
session deliberately does not auto-restart (requires a tap; iOS requires a
gesture for audio). No audio is ever persisted.

### E. Speech generation
Streamed-sentence failure → `turnFailure: playback-failure`, `ttsStage:
failed`, sentence spoken by the browser voice if one exists, text always in
chat; server voice re-probed on the next reply. Hung synthesis → failed after
15 s instead of hanging. No overlap (one pump, unchanged).

### F. Failure handling matrix

| Failure | Handling | Evidence |
| --- | --- | --- |
| Permission denied | error + denied, single prompt | unit |
| No microphone | `no-device` | unit |
| Permission revoked mid-session | session ends, permission error | unit (permissions change + track end) |
| Empty transcription | silence, back to listening (existing) | existing tests |
| Provider timeout / rate limit / network (chat) | `failureFromError/Response`, shown not spoken (existing) | existing tests |
| STT network disconnection | notice, loop continues | live (WP06 recovery run) |
| Interrupted model stream | superseded turn cancelled; stale deltas dropped (existing) | existing tests |
| Audio playback failure | notice + fallback, session keeps listening | unit + live |
| TTS provider hang | 15 s header timeout → failure path | code; not exercised live |
| Device audio interruption | `mute` → `micInterrupted`; `ended` → recover | unit + live (synthetic `ended`) |
| Reconnection | re-acquire with retry | unit + live |
