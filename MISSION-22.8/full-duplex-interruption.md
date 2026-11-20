# WP03 — Full-duplex listening and natural interruption

**Priority:** P0 · **Status:** PARTIALLY VERIFIED. The software path is verified
with simulated audio; the acoustic claim (real room, real echo) is **BLOCKED**
without a physical microphone and speaker.

## The M22.7 limitation, precisely

The mission text says "the microphone pauses during fallback TTS playback". The
code tells a more specific story, and the difference matters for what had to be
fixed:

* `whisperFallbackLoop` already *records* while she speaks, and it already calls
  `cancelSpeech()` when it hears a transcript that `isBargeIn()` accepts.
* What it did **not** do was make that capture usable: `getUserMedia({audio:true})`
  asked for no signal processing, so her own voice came back through the device
  at nearly full level. The loop therefore transcribed her own speech, and the
  echo guard had to throw those transcripts away — burning an ASR request per
  sentence and, when ASR mistook her words for new ones, creating fake turns.

So the half-duplex behaviour was real but was **acoustic**, not a deliberate
pause: a capture that hears the speaker cannot be trusted to decide who is
talking.

## What was implemented

### 1. Echo-cancelling capture

```ts
navigator.mediaDevices.getUserMedia({
  audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
}).catch(() => navigator.mediaDevices.getUserMedia({ audio: true }))
```

A browser that refuses the constraints still gets a stream (the echo guard is
the fallback), and a browser that accepts them removes her own output from the
capture using the platform's AEC.

### 2. Capture stays open across the whole turn

The VAD loop is not suspended during `speaking`, `processing` or `awaitingVoice`.
It records the next utterance while the previous answer is still being spoken —
that is what makes interruption possible at all.

### 3. A barge-in decision with two independent gates

```ts
if (this.isSpeaking() && isBargeIn(heard, this.lastSpokenText)) {
  this.bargeIns += 1;
  this.cancelSpeech();
  this.noteFailure({ kind: "user-cancellation", message: "You spoke over her, so she stopped." });
}
```

* `isBargeIn` (existing, pure): at least two words **and** not an echo of what
  she is saying, by exact match, substring, or ≥70 % token overlap.
* `lastSpokenText` is now the **spoken** text, accumulated per sentence — not
  the rendered reply. Before this mission the streamed path recorded the
  rendered text (or nothing at all), so the echo comparison was made against the
  wrong string.

### 4. Interruption stops everything, not just the current sentence

`cancelSpeech()` now:

* sets `cancelFlag` so the next streamed sentence is not enqueued;
* calls `stopSpeaking()`, which stops the current `<audio>` **and** the new PCM
  player, cancels its reader (aborting the HTTP response and killing Piper
  server-side), and drains the synthesis-ahead queue;
* drains `speechSynthesis` and its pending counter;
* resets `streaming`, `streamFinalizing`, `streamCursor`, `streamSegmentsPending`;
* returns the phase to `listening` and emits exactly one `speech end` activity
  event.

### 5. The conversation survives the interruption

The interrupted turn is classified as `user-cancellation` (never spoken as her
answer), the new transcript becomes a fresh turn with its own `streamOwner`, and
the audio pipeline is usable immediately. This is covered by
`tests/voice-turn-ownership.test.ts` — "cancelling speech leaves the next turn
free to speak".

## The eight required behaviours, and where each is proved

| # | Required behaviour | Evidence |
|---|---|---|
| 1 | LÉLU begins speaking | live run: 25–34 TTS requests, 25 buffer starts |
| 2 | User interrupts her | live run: barge-ins counted in `window.__leluVoice.diagnostics.bargeIns` |
| 3 | Incoming audio is detected | VAD on the audio thread (`vadWorklet.ts`) logs `{"on":"audio","spoke":true,…}` per turn |
| 4 | Playback stops promptly | PCM player `stop()` + reader cancel; unit test "a stop halts playback and aborts the stream" |
| 5 | Obsolete generation is cancelled | `cancelInFlightTurn` on new speech while `_turn.response === null` |
| 6 | New speech is transcribed | live run: every barge-in is followed by a new transcript |
| 7 | LÉLU responds to the new input | live run: turns continue after interruption (13 and 7 barge-ins in the two runs) |
| 8 | Conversation continuity preserved | 19–21 turns in one session, topic continuity per `VoiceTurn` history |

### Live numbers

| Run | Turns | Barge-ins | Buffer stops (`pause`) | Outcome |
|---|---|---|---|---|
| dense fake mic (`logs/interruption-run.json`) | 21 | 13 | — | conversation continued; 18 TTS requests spoken |
| paced fake mic (`logs/latency-acceptance.json`) | 19 | 7 | 10 | long answers cut by the next question, then answered |

The dense run is the closest thing this container can produce to "a person
talking over her": the fake device emits a new question every 1.4 s, so she is
interrupted almost continuously and still completes the session.

## What is NOT verified (BLOCKED)

1. **Acoustic echo cancellation in a real room.** The simulated microphone is a
   file; it never contains her voice mixed with room reflections. Whether the
   browser's AEC suppresses her speaker output well enough for `isBargeIn` to
   fire only on the user is **unknown here**.
2. **Speaker-to-microphone leakage.** With no speaker, there is no acoustic path
   to test.
3. **Barge-in latency as a human perceives it.** The stop is immediate in
   software (`AudioBufferSourceNode.stop()`), but "prompt" for a listener also
   depends on device buffering, which cannot be measured without a device.
4. **Double-talk.** User speaking at the same time as her, at similar level, is
   exactly the case AEC handles worst and the case a file cannot produce.

The procedure to close these is in `hardware-acceptance.md`; until it is run,
G8/G9 remain PARTIAL and G15 remains BLOCKED.

## Design notes for the hardware pass

* `echoCancellation` is requested, not assumed: the diagnostic should be read on
  the target device (`window.__leluVoice.diagnostics.fullDuplex`,
  `bargeIns`).
* If AEC is insufficient, the next step is a **playback reference signal**
  (Web Audio graph knows what is playing) and gating the VAD on correlation with
  it — not a different architecture, an extra input to the existing decision.
* The one-word barge-in threshold (`>= 2` words) is deliberate: a cough or a
  single "mm" should not stop her mid-sentence. It is a listening-test parameter
  and will need tuning with real speech.
