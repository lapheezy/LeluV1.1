# WP01 — Conversation synchronization

**Priority:** P0 · **Status:** VERIFIED (software), with one live-run caveat stated below.

## The defect, exactly

M22.7 recorded that "responses can become detached from newer user input". Two
separate paths produced that:

### 1. The spoken turn had no stream at all

`VoiceEngine.handleUserSpeech` called `ai.chat(...)` and, when it returned,
called `speakResponse(response.text)`. Nothing in that path was tied to the
turn that asked for it beyond a late `turnId` check, and nothing was spoken
before the whole answer existed.

### 2. The streamed path had no owner

`GenesisChat` opened the stream with `beginStreamingSpeech()` and fed it with
`feedStreamingSpeech(event.text)`. The engine kept a single cursor and a single
`lastSpokenText`, but no notion of *whose* reply it was speaking. The
subscription filtered on `event.conversationId` only. Two turns in the same
conversation therefore looked identical to the speech layer:

* turn A is aborted (`cancelInFlightTurn`) and turn B begins;
* A's provider keeps emitting deltas for a few hundred milliseconds after the
  abort;
* those deltas pass the conversation filter, advance B's cursor, and are spoken
  as if they were B's answer.

The user hears an answer to a question they have already replaced, and the
transcript on screen no longer matches the voice in the room. That is the
"reply queue drift" M22.7 left open.

## What was implemented

### Turn identity at the speech boundary

`beginStreamingSpeech(owner?)` now takes the identity of the turn that owns the
reply and returns the owner actually in force:

```ts
const owner = crypto.randomUUID();          // VoiceEngine, per spoken turn
voiceEngine.beginStreamingSpeech(exchangeId); // GenesisChat, per typed turn
```

`feedStreamingSpeech(text, owner?)` and `finishStreamingSpeech(text, owner?)`
call `ownsStream(owner)` first. A feed from any other owner is dropped **and
counted**:

```ts
private ownsStream(owner?: string): boolean {
  if (!owner || !this.streamOwner) return true;
  if (owner === this.streamOwner) return true;
  this.staleStreamDrops += 1;
  this.patchDiagnostics({ staleStreamsDropped: this.staleStreamDrops });
  return false;
}
```

The count matters: a dropped reply is indistinguishable from a bug unless the
drop is observable. `staleStreamsDropped` is served by the runtime diagnostic
and published on `window.__leluVoice`.

Unowned callers keep working (a feed with no owner is accepted), so no existing
contract was broken.

### A spoken turn now streams — and owns its stream

```ts
const streamOwner = crypto.randomUUID();
let streamStarted = false;
const unsubscribeStream = ai.subscribeStream((event) => {
  if (this._turn?.id !== turnId) return;                     // superseded turn
  if (event.conversationId && conversationId && event.conversationId !== conversationId) return;
  if (!event.text) return;
  if (!streamStarted) { streamStarted = true; this.beginStreamingSpeech(streamOwner); }
  this.feedStreamingSpeech(event.text, streamOwner);
});
```

Ownership is checked **twice**, deliberately:

1. `this._turn?.id !== turnId` — the turn-level guard. A newer transcript
   replaces `this._turn`, so the older turn's deltas stop being spoken at the
   first delta after the takeover.
2. `ownsStream(owner)` — the stream-level guard, which also covers a second
   streaming source in the same turn.

### Cancellation, three layers

| Layer | Mechanism | What it stops |
|---|---|---|
| Turn | `AIService.cancelActiveTurn` / `AbortController` | the model request and its tool loop |
| Stream | `ownsStream` + `_turn.id` check | deltas that arrive after the abort |
| Audio | `cancelSpeech()` → `stopSpeaking()` | the playing buffer, the synthesis-ahead queue, and the in-flight PCM stream |

`stopSpeaking()` now also stops the new PCM player and cancels its reader, which
aborts the HTTP response and kills the synthesiser server-side — an interruption
no longer leaves a voice generating a sentence nobody will hear.

### Recovery

A cancelled turn is not a dead conversation:

* `cancelSpeech()` resets `streaming`, `streamFinalizing`, `streamCursor`, and
  emits one `speech end` activity event;
* `handleUserSpeech` follows the new transcript immediately (the old turn's
  `chat()` rejection is caught and classified by `turnFailure.ts`);
* the next `beginStreamingSpeech` sets a fresh owner and an empty echo-guard
  text, so the following answer is spoken normally.

## Evidence

### Unit — the protection itself

`tests/voice-turn-ownership.test.ts` (4 tests, all passing):

```
✔ a new turn takes the stream, and the old turn's deltas are dropped  (166 ms)
✔ a reply that names no owner is still spoken (older callers keep working)
✔ cancelling speech leaves the next turn free to speak
✔ latency is reported as unknown until a real turn measures it
```

The first test performs exactly the M22.7 failure: turn A speaks a sentence,
turn B takes ownership, then A's remaining deltas and its `finish` arrive. No
audio is produced for A, `staleStreamsDropped >= 2`, and B's own reply still
plays and settles.

### Live — the browser does not drift

Two browser runs (21 and 19 turns, real model, real local speaker):

| Run | Transcripts | TTS requests | Stale drops | Outcome |
|---|---|---|---|---|
| dense fake mic (`interruption-run.json`) | 21 | 18 | 0 | conversation continued through 13 barge-ins |
| paced fake mic (`latency-acceptance.json`) | 19 | 31 | 0 | every transcript answered within its own turn |

**Caveat, stated rather than hidden:** `staleStreamsDropped` is 0 in both live
runs because neither run produced an overlapping pair of turns in the same
conversation — the transcript capture rate was slower than the turn lifecycle.
The drop path is therefore proven by the unit test and by the ownership code,
not by a live occurrence in these runs. That is a PARTIAL live verification of
G3/G4 and it is recorded as such in `release-qualification.md`.

### Conversation ordering

Ordering is preserved by construction rather than by a queue in the speech
layer:

* transcripts are emitted by one VAD loop at a time (`whisperLoopBusy`
  single-flight guard);
* each transcript creates its turn record before any audio exists
  (`emitTurn` happens first);
* `feedStreamingSpeech` only ever speaks text **before** the cursor, in
  arrival order, and `speakText` is ordered by one pump;
* the conversation's stored messages are written by `AIService` and the
  `VoiceBridge` utterance listener, both keyed to the turn that produced them.

No second conversation store, turn manager or audio queue was introduced: this
is the existing `VoiceEngine`, the existing `AIService` stream and the existing
`chunkForSpeech`/`speakText` path.

## What is not fixed

* **Cross-device ordering.** Two tabs sharing a conversation can still speak
  simultaneously; the ownership token is per page, not per account.
* **A reply already spoken cannot be un-spoken.** If a turn is superseded after
  its first sentence played, the user has heard a sentence of an obsolete
  answer. It stops immediately (verified) but cannot be retracted.
* **The abort is cooperative.** A provider that ignores the abort signal will
  still be talking to a turn whose audio is dropped; the user hears nothing,
  but the request is not free.
