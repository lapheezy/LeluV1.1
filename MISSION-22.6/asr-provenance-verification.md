# M22.6 — ASR PROVENANCE VERIFICATION (G2)

**Date:** 2026-11-19
**Status:** **VERIFIED (unit + controlled acceptance)** — every recognised turn can name the engine that produced it, and confidence is stored only when the engine reported one.
Live-microphone provenance is **BLOCKED** with the rest of the live gate.

---

## 1. The gap M22.5 reported

`VoiceTurn` carried `user: string` and nothing about how that string was obtained. Browser recognition, Whisper, ElevenLabs Scribe and the LiveKit agent were indistinguishable, and no confidence existed — so a misheard sentence could not be traced to its engine, and a typed sentence could not be distinguished from a spoken one.

## 2. What was implemented

### 2.1 On the turn

```ts
export interface TranscriptProvenance {
  source: "browser-recognition" | "groq-whisper" | "elevenlabs-scribe" | "livekit-agent";
  confidence?: number;   // ONLY when the engine returned a positive number
  final: boolean;
  at: number;
}
```

`VoiceEngine.handleUserSpeech(text, transcript?)` stores it on `VoiceTurn.transcript`. Each call site supplies the **actual** engine:

| Path | Source assigned | Confidence |
|---|---|---|
| Chrome/WebKit `SpeechRecognition` final result | `browser-recognition` | `result.confidence` when > 0, else omitted |
| ElevenLabs Scribe (`transcribeUtterance`) | `elevenlabs-scribe` | omitted (response shape supplies none) |
| Groq Whisper fallback | `groq-whisper` | omitted (Whisper returns no calibrated confidence) |
| LiveKit agent transcript message | `livekit-agent` | omitted |

`avg_logprob` from `verbose_json` is deliberately **not** converted into confidence: it is a model score, not a correctness probability.

### 2.2 Into the conversation and memory

`handleUserSpeech` passes `{ conversationId, transcript }` to `AIService.chat`. The chat options type carries `transcript`, and the post-turn consolidation forwards it:

```ts
await this.memory.learn(message, response.text, taskId, {
  transcriptSource, transcriptFinal, transcriptAt, transcriptConfidence?,
});
```

`MemoryBridge.learn` merges that object into the provenance context it already hands `Brain.learn`; `Brain.learn` forwards it to `MemoryEngine` (the M22.5 repair), which stores it on the pattern.

A typed turn passes no transcript object, so its stored memory has **no** `transcriptSource`. That distinction is what makes "recognised" vs "typed" answerable later.

## 3. Evidence

| Check | Result |
|---|---|
| `tests/asr-provenance.test.ts` | **3/3 pass**: engine stored; absent confidence stays absent; typed turns carry no fields |
| Controlled acceptance | a discovery recorded with `transcriptSource: "groq-whisper"` was recalled from the store with that source intact |
| Voice suites | 77 tests, 76 pass, 1 intentional skip, 0 fail |
| Typecheck | passes |

## 4. Boundaries preserved

- **No invented confidence.** If the engine does not report one, the field is absent. A fabricated 0.9 would be worse than silence.
- **No permanent memory by default.** A spoken sentence still goes through `MemoryBridge`'s scope check; "for this chat only" is still not persisted.
- **No raw audio retained.** Only the transcript and its metadata are stored.
- **No second transcript store.** Provenance rides on the existing `VoiceTurn` and the existing memory pattern.

## 5. What is not verified

- Live microphone → transcript provenance: **BLOCKED** (no browser/device).
- Correction of a mis-transcribed turn: a user restating a sentence supersedes the remembered *fact*, but there is no transcript-annotation record. This remains **NOT IMPLEMENTED**.
- Browser `confidence` is preserved only where the engine reports it; the actual value stream was not observed live.
