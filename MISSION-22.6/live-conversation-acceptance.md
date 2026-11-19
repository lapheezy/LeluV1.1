# M22.6 — LIVE CONVERSATION ACCEPTANCE

**Date:** 2026-11-19
**Gate status:** **BLOCKED — not run.**
There is no browser, no microphone, no speaker, no LiveKit server and no speech-output engine in this container. No step below is claimed as passed.

---

## 1. Required scenario, step by step

| # | Step | Status | Why |
|---|---|---|---|
| 1 | Open the real LÉLU application | **BLOCKED** | Chromium cannot launch (`libnspr4.so` missing; no root). A Vite server and a built `dist/` exist, but no browser can render them. |
| 2 | Activate voice | BLOCKED | Requires 1 |
| 3 | Confirm the session is ready | BLOCKED | Requires 1 |
| 4 | Speak a unique test phrase | BLOCKED | No microphone |
| 5 | Verify captured audio reaches the pipeline | **PARTIAL** | Real WAVs reached the transcription service with 200s; microphone capture itself unavailable |
| 6 | Verify the resulting transcript | **PARTIAL** | 16 real transcripts measured; see [speech-recognition-acceptance.md](speech-recognition-acceptance.md) |
| 7 | Verify the transcript enters the correct conversation | BLOCKED | Code passes `conversationId`; no session to observe |
| 8 | Verify LÉLU generates a response | BLOCKED | No browser turn run; provider keys exist server-side but were not exercised through voice |
| 9 | Verify actual audio playback | BLOCKED | No TTS engine configured; no audio device |
| 10 | Speak a follow-up | BLOCKED | No microphone |
| 11 | Verify contextual continuity | PARTIAL | Continuity is covered for text by `conversation-memory`/`cognition` suites, not by a voice session |
| 12 | Complete ≥5 consecutive turns | BLOCKED | Requires 1–9 |
| 13 | Interrupt her while speaking | PARTIAL | Barge-in logic is unit-tested; cannot be demonstrated without audio |
| 14 | Verify cancellation handling | PARTIAL | `cancelSpeech`/`cancelInFlightTurn` unit-tested |
| 15 | Speak a new request | BLOCKED | No microphone |
| 16 | Verify she processes it | BLOCKED | Requires 1–9 |
| 17 | End the session | BLOCKED | Requires 1 |
| 18 | Verify complete resource cleanup | PARTIAL | `stop()` inspection + unit tests; no live stream/track to release |
| 19 | Reopen and establish a new session | BLOCKED | Requires 1 |

**Steps passed end to end: 0 of 19.**

---

## 2. Failure recovery

| Failure | Code path | Verified how | Live? |
|---|---|---|---|
| Network interruption | LiveKit reconnect notices; recognition `network` error | unit tests | **BLOCKED** |
| Provider timeout | `failureFromResponse`, `TurnFailure` timeout kind | unit tests | **BLOCKED** |
| Provider rate limit | `mapSttHttpError` 429 → service diagnosis | unit tests | **BLOCKED** |
| Microphone permission denial | `mapMediaError` → `permission` | unit tests | **BLOCKED** |
| Playback failure | `noteFailure({kind:"playback-failure"})`; TTS stage `failed` | unit tests | **BLOCKED** |
| Recognition failure | `transcription-failure`; loop retries | unit tests | **BLOCKED** |
| Browser refresh | `pagehide` stops audio; store persists conversations | code inspection | **BLOCKED** |
| Navigation away | `stop()` on unmount cleanup | code inspection | **BLOCKED** |
| Repeated activation | `_state.active` guard; single whisper loop flag | code inspection | **BLOCKED** |
| Session reconnection | transition `failed` → cleared on successful join | unit tests | **BLOCKED** |

Deterministic voice suites: **77 tests, 76 pass, 1 intentional skip, 0 fail** (includes the new ASR-provenance tests). That is evidence that the failure *classifications* are implemented, not that recovery works with a real room.

---

## 3. Capability classification (no overstatement)

| Capability | Classification |
|---|---|
| Streaming speech recognition | Implemented, not demonstrated |
| Streaming speech synthesis | Implemented, not demonstrated |
| Half-duplex voice interaction | Implemented, not demonstrated |
| Full-duplex live conversation | Implemented only in the LiveKit path; **NOT DEMONSTRATED** |
| Request/response voice interaction | Not demonstrated end to end here |

What this mission can state:
- **Real speech → real transcript: VERIFIED** through the server broker with file audio.
- **Live microphone → conversation → audible reply: BLOCKED.**

A connected WebSocket, a generated audio file, a passing unit test, or a text response would each be insufficient proof. None is offered as proof.

---

## 4. Evidence that would satisfy the gate

A single unedited screen recording plus logs from a host with:
1. A browser that can start (Chromium with system libraries, or Firefox/WebKit).
2. A microphone and speaker (or loopback devices that can be recorded).
3. A configured speech-output engine (VoxCPM2 worker, or ElevenLabs as a generic voice — labelled as such).
4. Provider credentials for the reply.
5. Five consecutive spoken turns, one barge-in, one forced network failure, one session restart, with the conversation id visible and the cleanup observable.

Reproduction steps for the harness that would drive it are in [environment-and-provider-readiness.md](environment-and-provider-readiness.md) §5.
