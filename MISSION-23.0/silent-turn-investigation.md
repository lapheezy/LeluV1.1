# WP04 — The Four Silent Turns

**Status: VERIFIED — root causes identified, fixed, tested, and re-run at 100 turns.**

M22.9 ended with 30 turns, 26 spoken, 4 silent, and **zero reported audio
errors**. Those four turns are the subject of this document.

## The four turns, from the original evidence

```
 18  sent=0 tts=null audio=null | Recommend one fruit for breakfast.
 19  sent=0 tts=null audio=null | That is all for now.
 28  sent=0 tts=null audio=null | Does HTTP stand for?
 29  sent=0 tts=null audio=null | Who wrote Pride and Prejudice.
```

They arrive in **pairs**, 12–14 s apart, and the timeline confirms a ~25 s
window with no TTS request at all around each pair:

```
272.4 turn transcript 18
285.1 turn transcript 19
299.3 turn transcript 20      ← first speech again
408.4 turn transcript 28
422.4 turn transcript 29
437.2 turn transcript 30      ← first speech again
```

Critically, turns 8 and 9 asked *the same two questions* reached speech in the
first pass, and turns 28/29 did not in the second. The silence is therefore
**state-dependent, not content-dependent** — something about the pipeline at
that moment, not about the sentence.

## Root cause 1 — a provider refusal is deliberately unspoken

The M22.9 server log was written at the time of the run and was never read for
this purpose. It contains the answer:

```
[model broker] groq: slot 1 429; … on tokens per minute (TPM): Limit 8000, Used 5266,
               Requested 4481. Please try again in 13.1025s
[model broker] groq: slot 2 429; … on tokens per day (TPD): Limit 200000, Used 195201,
               Requested 5454. Please try again in 4m42.96
[model broker] REFUSED provider=groq model=openai/gpt-oss-120b status=429 …
[model broker] REFUSED provider=openrouter model=nvidia/nemotron-3-ultra-550b-a55b:free status=429 …
```

Every provider was refusing on quota during that run, with retry windows from
1 s to **27 minutes**. A refused reply comes back as a *failure notice*, and
the voice engine's rule (Mission 10.3, written for a good reason) was:

> "A failure notice is not spoken … the notice is shown, never read aloud."

The reason was right: reading an offline notice aloud as if it were her answer
was a real defect on 18 of 20 turns. The consequence was never examined: when
the notice is unspoken, **the person hears nothing at all**, and nothing in the
pipeline records that a turn ended in silence.

That is why the four turns had "zero audio errors": no TTS was ever requested,
so no TTS could fail.

## Root cause 2 — a stalled turn is superseded without a record

With a 13–20 s provider stall, the next question (13.7 s later in the paced
WAV) arrives first. `handleUserSpeech` then supersedes the in-flight turn. That
is correct behaviour — the person has moved on — but the supersede path only
dropped the stream; it recorded nothing. `staleStreamsDropped` counted *delta
drops*, not turns, so a superseded turn that never streamed was invisible.

This is what turns a single stall into a **pair** of silences: turn 18 stalls,
19 supersedes it, and 19 hits the same exhausted quota.

| Turn | What happened | What was recorded |
|---|---|---|
| 18 | provider refused / stalled → failure notice, unspoken | nothing |
| 19 | supersedes 18 while still stalled → refused too | nothing |
| 20 | provider recovers | spoken |

## Classification against the mission's eight categories

| Category | Applies? | Why |
|---|---|---|
| 1. Intentional silence | no | nothing marked these turns as deliberately silent |
| 2. Empty model output | no | the reply existed; it was a refusal notice |
| 3. Stream completion race | **partly** | the stall + supersede race is real (cause 2) |
| 4. Speech normalisation empty | no | `toSpokenText` never ran: TTS was never requested |
| 5. TTS failure | no | no synthesis was attempted |
| 6. Audio playback failure | no | nothing was played or failed to play |
| 7. Superseded response | **yes** (cause 2) | turn 19 replaced 18 mid-stall |
| 8. Diagnostic misclassification | **yes** | "zero audio errors" was true and meaningless: silence had no channel to be reported through |

## The fix

Three changes, all in the voice layer. No new service, no new store, no change
to the persistent Piper runtime.

### 1. A per-turn ledger — silence became a classified event

`src/core/voice/speechOutcome.ts` defines the vocabulary a turn can end with:
`spoke`, `superseded`, `provider-unavailable`, `provider-timeout`,
`network-failure`, `transcription-failure`, `empty-reply`, `unpronounceable`,
`playback-failed`, `cancelled`, `echo-suppressed`, `duplicate-suppressed`.

Every exit path now records one, including the ones that used to return
silently:

* echo-rejected and duplicate-rejected transcripts are recorded (and counted as
  turns, because the harness counted them as transcripts);
* the superseded turn is recorded **before** it is replaced;
* `!text.trim()` → `empty-reply`; unpronounceable reply → `unpronounceable`;
  `onFail` → `playback-failed`;
* a turn that ends with no reason at all is counted as `unexplained`.

The ledger is published at `window.__leluVoice.turns` and summarised in
`window.__leluVoice.diagnostics.speechOutcome` (`started`, `recorded`,
`unexplained`, `spoken`, `silent`, `byOutcome`). **`unexplained` is the number
that must stay at zero**, and it is the number M22.9 could not report.

### 2. A refusal is spoken, not silent

The notice text is still never read aloud — that rule is kept. What changed is
that a turn refused by every provider now ends with a **fixed, short holding
line in her voice**:

> *"I can't get an answer from my model providers right now. Give me a minute
> and ask me again."*

Constraints, all unit-tested:

* it is her wording, never the provider's error text (no `429`, no vendor name,
  no URL, no token);
* at most **once per 15 s**, so a failing provider cannot make her babble;
* it is marked as a notice, so it is never counted as her answer;
* nothing is said for a stop by the person, a superseded turn, or a device that
  cannot play sound.

### 3. Supersession is counted, not just dropped

`recordTurnOutcome` is called before `cancelInFlightTurn`, and again if a reply
arrives for a turn that is no longer current. A turn that spoke keeps `spoke`
(supersession never unspeaks what was already said); a turn with no other
reason becomes `superseded`.

## Regression tests

| File | Tests | What it pins |
|---|---|---|
| `tests/voice-speech-outcome.test.ts` | 8 | the vocabulary, every failure→outcome mapping, the holding-line wording, and the `unexplained` arithmetic |
| `tests/voice-echo-guard.test.ts` | 6 | the interruption fix, in both directions (WP03) |

## Results

### The 100-turn run

One browser session, one simulated microphone (`.piper/fake-mic-100.wav`, 100
questions, 11 s gaps, 22.8 min of audio), against the real server and the real
warm Piper workers. Full artifact: `logs/m23.0-100-turn.json`.

```
duration            1396 s  (23 min 16 s)
transcripts          100
turn ledger          100
turns spoken          45
turns silent          55      ← every one recorded, none unexplained
unexplained           0
byOutcome            { spoke: 45, provider-unavailable: 55 }
holding lines spoken  35
plays                 92
```

**The four-turn failure mode was reproduced, at scale, and it behaved as the
fix intends.** The model providers were heavily rate-limited for the whole run
(117 HTTP 429 responses in the server log), so 55 of 100 turns were refused.
Under M22.9's behaviour all 55 would have been silence with no record. In this
run:

* all 55 are recorded as `provider-unavailable`;
* **35 of them were told to the user aloud** — the fixed holding line, the only
  notice text spoken in the run;
* the remaining 20 were inside the 15 s notice cooldown, so no second apology
  was spoken over the first (deliberate: a provider outage every 13 s must not
  become a metronome);
* **zero turns ended without a recorded reason.**

### Latency, from the same run

| Measure | median | p90 | max |
|---|---|---|---|
| ASR (transcript → text) | 480 ms | 525 ms | 941 ms |
| transcript → first TTS request (80 turns with any TTS) | 926 ms | 1 838 ms | 12 118 ms |

The 12 s maximum is a rate-limited turn recovering, not a synthesis problem.
These numbers are **worse than M22.9's 1 435 ms first-TTS median only in
appearance**: M22.9's sample contained 26 answered turns, this one contains 45
answers plus 35 refusals, and a refusal returns as soon as the last provider
refuses rather than after a full generation.

### Honest reading

The gate asks for *zero unexplained silent responses*, and that is met. It does
not ask for zero silent responses, and this run does not have zero: **55% of
turns produced no answer**, because every free-tier provider was refusing. The
defect was that silence was invisible; the environment was why it happened.
A person in this session would have heard her say she cannot reach a model,
which is honest, and would still not have received an answer.

### Measurement caveat

The harness attributes an outcome to each transcript by matching its text
against the ledger entry. 8 of 100 turns matched only approximately and were
attributed to a neighbouring entry, so the harness's per-turn column is
indicative. **The authoritative figures are the engine's own ledger
(`outcomeSummary`), which recorded 100 of 100 turns**: `started: 100,
recorded: 100, unexplained: 0`.
