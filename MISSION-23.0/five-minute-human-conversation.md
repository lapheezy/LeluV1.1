# WP05 — Five-Minute Live Human Conversation

**Status: BLOCKED.** No microphone and no speaker exist in this container.
The protocol is complete and executable; the conversation did not happen.

## Why it is blocked, precisely

A five-minute conversation requires a person to speak into a microphone and to
hear a speaker. `hardware-discovery.md` shows there is neither: no `/dev/snd`,
no ALSA, no sound server, no audio device nodes. Using a recorded WAV instead
is not a substitute — M22.9 already did that, and it is exactly the substitute
this gate exists to replace.

**No simulated run is reported as a human conversation in this mission.** The
100-turn simulated run (`silent-turn-investigation.md`) is labelled SIMULATED
everywhere it is mentioned.

## Protocol

### Environment

* One person, one microphone, one speaker (a headset is best: it separates
  echo cancellation from room coupling).
* `bun run server.ts` as in `physical-audio-acceptance.md`; page open at
  `http://127.0.0.1:4180/`, voice session started from "Talk to LÉLU".
* External recording of both sides (screen + system audio), so the transcript
  can be checked against what was actually said.

### Script — the eleven required moments

The conversation is unscripted in wording but must contain each of these:

| # | Moment | Example prompt | What it tests |
|---|---|---|---|
| 1 | Natural opening | "Hey Lélu, can you hear me?" | capture, ASR, first audio |
| 2 | Follow-up question | "And why is that?" | context within a topic |
| 3 | Topic change | "Different thing — what's a good way to learn guitar?" | topic-switch recovery |
| 4 | Human interruption | speak over her mid-sentence | barge-in, stop latency |
| 5 | Her interruption handling | after the barge-in, does she stop and listen? | stale speech, ownership |
| 6 | Correction | "No, that's wrong, it was 1893." | accepting correction without re-arguing |
| 7 | Technical discussion | "Explain what a race condition is." | `calm` delivery, term pronunciation |
| 8 | Contextual reference | "Like the thing you said about the guitar." | memory of an earlier turn |
| 9 | Silence | say nothing for ~15 s | no false turn, no babbling |
| 10 | Return to an earlier topic | "Back to the race condition — what was the second cause?" | retention across a topic change |
| 11 | Natural closing | "Thanks, that's all for now." | graceful end, no phantom answer |

### Measurements to record

Duration · turns · recognitions correct · responses appropriate · first-audio
latency (median and worst) · interruptions made · **false barge-ins** · **missed
interruptions** · silent turns (and the ledger reason for each) · audio
failures · context retained at moment 8 and 10 · topic-switch recovery at 3.

The page publishes all of it: `window.__leluVoice.diagnostics.speechOutcome`
gives spoken/silent/unexplained, and `window.__leluVoice.turns` gives the
per-turn reason, so "silent turn with no explanation" is now a counted number
rather than a memory of the session.

### Pass conditions

* Five uninterrupted minutes of session continuity.
* No unrecovered runtime failure; no stale speech.
* **No unexplained silent turn** — every silent turn carries a ledger reason.
* Response ownership correct: the answer matches the latest thing said.
* Context maintained across the topic change (moments 8 and 10).
* Audio was heard by the human, not merely decoded by the browser.

## Closest available evidence, and what it does not cover

The 100-turn simulated run covers the *pipeline* under real load: turns,
latency, silences and their causes, cancellation. It cannot cover anything that
depends on a human or a room — natural opening, genuine interruption timing,
context retention judged by a person, audibility, echo, and whether she *feels*
conversational.

That judgement is the actual point of this gate, and it is not available here.
