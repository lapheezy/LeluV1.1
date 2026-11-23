# WP03 — Acoustic Echo Cancellation and False Barge-In

**Status: PARTIALLY VERIFIED.**
Software echo defence: verified and improved. Browser acoustic echo
cancellation and acoustic false-barge-in: **BLOCKED** — no microphone and no
speaker exist in this container (`hardware-discovery.md`).

## What could and could not be measured

| Property | How it would be measured | M23.0 result |
|---|---|---|
| Browser AEC effectiveness | her speech played by a speaker, captured by a mic, measured as residual echo | **BLOCKED** (no devices) |
| Acoustic false barge-in rate | the same loop, with a human interrupting | **BLOCKED** |
| Double-talk behaviour | human speaks while she speaks | **BLOCKED** |
| Software echo guard: echo catch rate | scripted corpus of her sentences and their ASR-degraded returns | **VERIFIED** (measurable, below) |
| Software echo guard: false-reject rate | scripted corpus of genuine interruptions, including the short ones | **VERIFIED — defect found and fixed** |
| Playback cancellation on interrupt | player events during a barge-in | VERIFIED in M22.9 (0 stale), re-checked in the 100-turn run |
| Interruption detection latency | transcript → speech stops | measured for the software path in the 100-turn run |

`echoCancellation: true` is genuinely requested by the engine
(`getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true,
autoGainControl: true } })`), but requesting it is not evidence that it
works. This mission does not claim it does.

## The defect this mission found

The engine's second line of defence is `isEchoUtterance(candidate, spoken)`:
a pure string test that decides whether a transcript is her own voice coming
back through the open mic. It is what stops her talking to herself.

Its rule included:

```ts
// Tiny fragments ("the", "um") are near-useless as genuine barge-in
// and very commonly a recognizer's mis-hearing of trailing TTS audio.
if (a.length <= 3) return true;
```

The reasoning is sound for "the" and "um". It is wrong for **"no"**, which is
three characters and is the single most common way a person stops a talker.

### Measured, both directions

Corpus: 12 sentences she actually says, each with 4 ASR-degraded echo returns
(48 echo cases), against 19 genuine user utterances × 12 sentences (228
interactions), including 8 short interruptions, 4 corrections that reuse her
own vocabulary, and 3 closings.

The pre-fix rule is not a recollection: `legacyIsEchoUtterance` in
`scripts/echo-guard-before-after.ts` is copied verbatim from
`b46b0aa3:src/core/voice/VoiceEngine.ts` and run on the same corpus.

```
before   echo catch 100%    false reject 16.2%    short interruptions rejected 37.5%
after    echo catch 100%    false reject  0.0%    short interruptions rejected  0.0%
                                                  37 interruptions recovered
```

Full artifact: `logs/echo-guard-before-after.json`.

### The fix

Three ordered exceptions, before the fragment rule:

1. **Interrupt lexicon.** If the first word is one of `no, nope, stop, wait,
   hey, hold, hush, quiet, shush, enough, listen, wrong, oi` and the utterance
   is four words or fewer, it is a person, not an echo — whatever she is
   saying.
2. **Questions.** A candidate that starts with an interrogative and carries a
   question mark is a turn. This recovered
   *"is an API a contract or a protocol?"* asked immediately after she said
   almost those words — a genuine correction that the token-overlap test
   discarded because 6 of its 8 words were hers.
3. The original rules then apply unchanged, so her words coming back are still
   discarded in full (echo catch stayed at 100%).

Regression: `tests/voice-echo-guard.test.ts` (6 tests, both directions,
including a non-question echo that must still be caught).

## Required scenario matrix — what is real and what is not

| Scenario | Required | M23.0 |
|---|---|---|
| Ordinary turns without interruption | 10 | 100 turns in `silent-turn-investigation.md` (SIMULATED mic) |
| Interruptions during short speech | 10 | software path only; acoustic BLOCKED |
| Interruptions during long speech | 10 | software path only; acoustic BLOCKED |
| Interruptions during synthesis | 5 | **BLOCKED** — needs the speaker loop |
| Interruptions during response generation | 5 | supersede path verified in M22.9 (0 stale streams) and re-recorded here |
| Silence / background-noise turns | 10 | SIMULATED silence only; no acoustic noise source exists |
| Playback-echo turns | 10 | **BLOCKED** acoustically; the guard-level equivalent is the 48-case echo corpus above |

## Honest reading of the numbers

* A **0% software false-reject rate** does not mean 0% false barge-in in a
  room. It means the decision function no longer discards interruptions it is
  shown. Acoustic echo that ASR turns into *her exact words* is still caught;
  echo that ASR turns into her words **plus a question mark** would now be
  treated as a turn. That trade is deliberate — being talked over is worse
  than occasionally answering a stray fragment — and it must be re-measured
  with real hardware before the barge-in gate can be called verified.
* `no` being heard is a behaviour change with a cost: an echo transcript of
  exactly "no" now becomes a spurious turn. The echo corpus does not produce
  such returns because her sentences do not begin with interruption words; a
  real room might. This is recorded in `known-limitations.md` as the first
  thing a physical run should check.
