# WP06 — Hardware acceptance procedure

**Status: BLOCKED.** No physical microphone or speaker exists in this container.
Nothing in this document has been executed. It exists so the remaining gate is a
procedure with a pass/fail line per item, not a vague intention.

Everything measurable *without* hardware is in `runtime-recovery.md` and
`streaming-latency-report.md`. This file is the part that needs a human in a
room.

## Equipment

- A machine with a microphone and a speaker (headphones are **not** valid for
  the echo tests; they hide the failure this gate exists to find).
- Chrome or Edge (the fake-device path and `AudioContext` behaviour were verified
  in Chromium 141; Safari and Firefox are **untested**).
- LÉLU running locally, with **one** of:
  - Piper configured (`LELU_LOCAL_TTS_BIN`, `LELU_LOCAL_TTS_MODEL`), or
  - a VoxCPM2 worker reachable (`VOXCPM_BASE_URL`), or
  - an ElevenLabs account the operator has explicitly authorized.
- Server logs visible (`/tmp/lelu-server.log` or the terminal).

## Before starting: read the diagnostic, do not assume it

```bash
curl -s http://127.0.0.1:4180/api/voice/diagnostic | jq
```

| Field | What it must say for the hardware pass |
|---|---|
| `asr.provider` | `groq-whisper-relay` or `elevenlabs-scribe` |
| `tts.provider` | `local-piper` / `elevenlabs` / `voxcpm` — **never** `none` |
| `tts.configured` | `true` |
| `voiceIdentity.status` | `fallback` (Piper) or `identity` (cloned voice) |
| `voiceIdentity.cloned` | `true` **only** if the provider is a real clone |
| `streaming.sentenceStreaming` | `true` |
| `interruption.fullDuplexCapture` | `true` |
| `hardware.verified` | `false` — this route cannot see devices; it stays false |

In the page, with the voice session active, the same state is on
`window.__leluVoice`:

```js
// DevTools console
__leluVoice.diagnostics
// { micPermission, micStreamActive, streaming, bargeIns, staleStreamsDropped,
//   firstTextLatencyMs, firstAudioLatencyMs, ttsQueueDepth, fullDuplex, … }
```

`micPermission: "granted"` is the browser's answer, not a claim that sound
arrived. `bargeIns` only increments when a transcript actually interrupted her.

## Test matrix

Each row must be executed once and recorded with the time, the observed
behaviour, and a screenshot or log line. **Any row not executed is not passed.**

### A. Capture

| # | Test | Procedure | Pass condition |
|---|---|---|---|
| A1 | Microphone permission, granted | Fresh profile, start the voice session, allow | `micPermission: "granted"`, `micStreamActive: true`, first transcript arrives |
| A2 | Microphone permission, denied | Fresh profile, deny | readable error naming permission (not "service unavailable"); no crash; re-prompt works after re-granting |
| A3 | Device selection | Change the OS default input mid-session, restart the session | new device is used; no stale stream; `micStreamActive` stays true |
| A4 | Microphone disconnection | Unplug the USB mic during a turn | one clear error, session returns to a usable state, conversation not stuck |
| A5 | Real speech recognition | Say 10 sentences (short, long, with proper nouns) | ≥ 9 transcribed correctly enough to answer; record which failed |

### B. Output

| # | Test | Procedure | Pass condition |
|---|---|---|---|
| B1 | Audible speech | Ask a question | sound leaves the speaker; the words match the on-screen reply (normalized, no markdown) |
| B2 | Speaker disconnection | Unplug headphones/speaker during playback | playback failure is reported, not silent success; next turn still attempts to speak |
| B3 | Volume and clarity | Listen to 10 replies | intelligible at normal volume; note any mispronunciation of names/numbers |
| B4 | Incremental playback | Ask for a long answer (≥ 4 sentences) | speech starts before the answer finishes appearing on screen; sentences run continuously with no long gap between them |

### C. Full duplex and interruption

| # | Test | Procedure | Pass condition |
|---|---|---|---|
| C1 | Barge-in during short speech | Interrupt after ~1 s | she stops within ~300 ms; `bargeIns` increments; the new question is answered |
| C2 | Barge-in during long speech | Interrupt mid-answer | same, and the remainder of the old answer is not spoken |
| C3 | Barge-in while TTS is generating | Interrupt in the pause before audio starts | no audio from the obsolete answer is heard afterwards |
| C4 | Barge-in while the model is generating | Interrupt before any audio | request is cancelled (server log shows the abort); next answer is for the new question |
| C5 | No false barge-in from her own voice | Let her speak 10 sentences uninterrupted | `bargeIns` stays 0; no fake user turns appear |
| C6 | Silence | Stay silent 30 s | no transcription, no turn, no fake reply |
| C7 | Background noise (fan, music) | Same, with noise | at most the noise floor rises; no fabricated transcripts |
| C8 | Two people talking near the mic | Side conversation during her answer | either a legitimate barge-in or no action — **never** a hallucinated answer to noise |

### D. Failure and recovery

| # | Test | Procedure | Pass condition |
|---|---|---|---|
| D1 | Network interruption | Disable the network mid-turn, restore after 10 s | a network failure is shown (not spoken as her answer); next turn works |
| D2 | ASR failure | Block the transcription host (`/etc/hosts`) | "I couldn't make out what you said" is shown; the loop recovers when unblocked |
| D3 | TTS failure | Stop Piper / revoke the voice key | playback failure reported; reply still visible in the conversation; no infinite retry loop |
| D4 | Rate limiting | 70 TTS requests in a minute | 429 with `Retry-After`; the page reports it; later requests succeed |
| D5 | Server restart | Restart the server mid-conversation | the page reconnects (refresh if required); conversation history is preserved; voice session restarts cleanly |
| D6 | Browser refresh | Refresh during playback | no orphaned audio; the session can be started again |
| D7 | Page hidden / backgrounded | Switch tabs for 60 s | no runaway loop; audio stops or continues as documented; returning restores listening |

### E. Continuity

| # | Test | Procedure | Pass condition |
|---|---|---|---|
| E1 | Ten-turn conversation | Ten related questions | topic and pronouns persist; no answer belongs to a previous question |
| E2 | Topic change | Change subject abruptly | she follows the new subject |
| E3 | Interrupt then resume | Interrupt, ask something else, then return | the earlier topic is still available in context |
| E4 | Long session | 20+ turns | latency does not grow monotonically; `ttsQueueDepth` returns to 0 between turns |

## Recording the result

For each row: `PASS` / `FAIL` / `NOT RUN`, with the timestamp, the observed
value of the relevant `__leluVoice.diagnostics` field, and an artefact (screen
recording or log excerpt). A row is only PASS if the observed behaviour matches
the pass condition **and** the diagnostic agrees — a diagnostic that says
"speaking" while the room is silent is a failure of the diagnostic too.

## What this procedure cannot prove

- That her voice is *hers*: that is a listening judgement about identity
  (`voice-identity-investigation.md`), not a checkbox.
- That the ASR understands every accent: the run records which sentences failed
  rather than scoring them.
- That the model's answers are correct: that is cognition, not voice.
