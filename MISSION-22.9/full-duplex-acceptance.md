# WP04 — FULL-DUPLEX CONVERSATIONAL BEHAVIOR

**Priority:** P0 · **Gate G8:** PARTIALLY VERIFIED · **Gate G9:** VERIFIED (software)

## 1. What is in place

Unchanged from M22.8 and re-measured here: the microphone stays open while she
speaks, barge-in is driven by the audio-thread VAD plus transcript ownership,
and `stopSpeaking()` cuts scheduled playback, aborts the response (which now
aborts the warm worker's job rather than waiting for it), and drops every
queued segment.

New in M22.9, and specific to full duplex with a warm runtime:

- **A barge-in no longer costs a model load.** The abort marks the job
  cancelled, sweeps its output file when it appears, and leaves the process
  warm (`cancelled` increments, `modelLoads` does not).
- **Cancellation reaches the synthesiser.** The route aborts on
  `res.on("close")`, so a closed response stops the server waiting for a
  sentence nobody will hear.
- **Onset is now a player fact.** `onAudible` fires from the browser's
  `playing` event (blob) or when the first scheduled buffer is due (PCM). The
  diagnostic keeps both numbers.

## 2. Measured in the live run

From `MISSION-22.9/logs/m22.9-warm-paced.json` (30 turns, simulated mic):

| Fact | Value |
| --- | --- |
| Barge-ins (`diagnostics.bargeIns`) | **9** |
| Turns where playback was paused by an interruption | 17 |
| Stale streamed text spoken (`staleStreamsDropped`) | **0** |
| Turns with a complete spoken response | 26 of 30 |
| Turns whose response was cut short | 6 |
| Conversation corruption observed | none — no reply was spoken against the wrong turn |
| `firstAudibleLatencyMs − firstAudioLatencyMs` | **25 ms** (the honest gap between "handed to a player" and "playing") |

Nine barge-ins and zero stale responses is the behaviour the mission asks
for: she stops, the superseded turn does not speak over the new one, and the
conversation keeps its ownership.

## 3. The mission's interaction script — measured coverage

| Step | Covered? | Evidence |
| --- | --- | --- |
| 1. LÉLU begins speaking | ✅ | 40 sentences spoken |
| 2. User begins talking | ✅ (simulated audio) | 9 barge-ins, 17 turns paused |
| 3. LÉLU detects the interruption | ✅ | engine `bargeIns` counter, `pause` events |
| 4. Playback stops | ✅ | 23 pause events; `stopSpeaking()` path |
| 5. Response generation is cancelled | ✅ | `cancelInFlightTurn` + stream ownership |
| 6. The new utterance is captured | ✅ | next transcript arrived with no restart |
| 7. The new utterance is understood | ✅ | ASR median 468 ms across 30 turns |
| 8. LÉLU responds to the latest input | ✅ | 26 turns produced a response |
| 9. Context remains intact | ⚠️ **not proven** | the run's questions are independent; a scripted contextual reference was not part of this scenario |

## 4. The matrix the mission requested

| Scenario | Required | Status |
| --- | --- | --- |
| Interruptions during short responses | 10 | **9 recorded in one run** (short and long mixed) — not a dedicated 10-run series |
| Interruptions during long responses | 10 | not run as a dedicated series |
| Interruptions during TTS generation | 5 | covered implicitly: 6 turns were interrupted before their synthesis header arrived |
| Interruptions during AI response generation | 5 | not isolated (would need a slow provider and timed speech) |
| Ordinary turns without interruption | 10 | ✅ 30 turns, 13 uninterrupted |
| Zero stale responses played | — | ✅ 0 |
| Zero conversation corruption | — | ✅ none observed |

So the matrix is **partly** executed: the mixed live run demonstrates the
mechanism and the outcome, but the mission's exact 10/10/5/5 series was not
performed, and the acoustic half of it cannot be performed here at all.

## 5. What is reserved for hardware

- **Acoustic echo cancellation.** The browser is asked for AEC/NS/AGC
  (`getUserMedia` constraints in `VoiceEngine.start()`), and the software echo
  guard (`isEchoUtterance`, 0.7 token overlap) is unit-tested. Whether a real
  speaker's output is actually removed by the OS/browser was not observed.
- **False-barge-in rate in a real room.** Background noise, a cough, or a door
  can trip an energy VAD. No measurement of that exists, and none is claimed.
- **Double-talk** (both speaking at once) with real acoustics.

## 6. Verdict

The **software** full-duplex path — listening while speaking, detecting an
interruption, stopping playback, cancelling the turn, answering the latest
input, never speaking a superseded response — is verified in a real browser
across 30 turns with 9 interruptions and 0 stale responses. **Acoustic**
full-duplex remains unverified and G8 stays PARTIALLY VERIFIED for that reason.
