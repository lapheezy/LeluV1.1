# M22.7 — INTERRUPTION AND RECOVERY

**Status:** **PARTIALLY VERIFIED.** Session stop, playback cancellation and an automatic ASR fallback were observed live. Natural barge-in (talking over her) and injected network failures were not.

---

## 1. What was observed

| Test | Result | Evidence |
|---|---|---|
| Stop the session while active | **PASS** — the voice control ended the session; capture stopped; a later click started a fresh one | harness events at 02:48:47 and 02:48:55 in `logs/voice-acceptance.json` |
| Playback cancellation | **PARTIAL** — a `pause` event was recorded on one playing element when a newer reply took over; STOP path is unit-tested (`cancelSpeech`) | `logs/turn-summary.json` playback events |
| Reply cannot overwrite a newer turn | **unit-verified** — `turnId` guard discards late replies | `tests/voice-continuity` |
| Second session after stop | **PASS** — new utterances captured and transcribed (turn 7 at 02:48:41) | same log |
| No duplicate response generation | **PASS in this run** — one reply per captured transcript, no repeated answer for the same audio | turn ledger |
| ASR provider failure → fallback | **PASS, live** — "Browser recognizer heard speech but returned nothing — switching to Whisper", then Whisper transcribed successfully | `logs/harness-console.log` at 02:47:46 |
| Silence handling | **PASS, live** — a 1.9 s silent region produced `spoke:false` and no transcription request | VAD turn 7 |
| Session end cleanup | **PARTIAL** — session stopped cleanly and restarted; track-level release not observable | harness |

## 2. What was not tested live

| Failure | Status |
|---|---|
| Network drop during recognition | **BLOCKED** — would require cutting the loopback/API mid-request; unit-tested only |
| Provider timeout / 429 | **BLOCKED** live; classified by `mapSttHttpError` and unit tests |
| Playback device failure | **BLOCKED** — no device to fail |
| Browser refresh mid-session | **NOT RUN** |
| Navigation away mid-session | **NOT RUN** |
| Microphone permission denial | **NOT RUN** (auto-granted in this harness) |

## 3. Natural interruption — why it is not claimed

In the Whisper fallback the engine records one utterance, transcribes, answers, speaks, then resumes listening. While she speaks the microphone loop is paused, so speech aimed at interrupting her is not captured. That is half-duplex by construction. Barge-in exists in the Web Speech path and over LiveKit, but neither ran here.

**Therefore: "a person can interrupt her naturally" is PARTIALLY VERIFIED (stop control works; barge-in not demonstrated).**

## 4. One real recovery success worth naming

The browser's own recogniser silently returned no result. Instead of failing the turn, the engine logged the condition once, switched to Whisper mid-session, and continued — with no user-visible error and no lost session. That is the failure-recovery behaviour the mission asked for, observed in the wild rather than simulated.
