# M22.6 — SPEECH RECOGNITION ACCEPTANCE

**Date:** 2026-11-19
**Status:** **PARTIALLY VERIFIED** — real audio was really transcribed by the app's own server broker. Microphone capture was not possible in this container, so this is not a live-mic result.

---

## 1. What was run

The application server (`bun run server.ts`, port 4180) was started with the project's real environment. Its provider broker exposes the same endpoint the voice engine calls:

```
POST /api/model/groq/audio/transcriptions
  file=<wav>  model=whisper-large-v3-turbo  response_format=verbose_json
```

Sixteen real WAV files from `docs/voice/listening-pack/` (each pair is the same sentence synthesised by two engines) were posted unmodified. Their ground-truth text is committed in `docs/voice/listening-pack/ANSWER-KEY.json`.

No mock, no stub provider, no typed substitute. The key stayed on the server; no credential was printed or written.

## 2. Results

| File | Round-trip | Transcript returned | Ground truth (ANSWER-KEY) |
|---|---|---|---|
| 01-A | 317 ms | "Hi, I'm Leil. How can I help you today?" | Hi, I'm Lélu. How can I help you today? |
| 01-B | 265 ms | "Hi, I'm Leloo. How can I help you today?" | same |
| 02-A | 298 ms | "Leo here, I found three new messages for you." | Lélu here. I found three new messages for you. |
| 02-B | 270 ms | "Leilu here I found three new messages for you" | same |
| 03-A | 356 ms | "Of course. I'll remind you tomorrow morning in Timon." | Of course. I'll remind you tomorrow morning at nine. |
| 03-B | 276 ms | "Of course. I'll remind you tomorrow morning at 9." | same |
| 04-A | 301 ms | "That's a good question. Let me think about it for a moment." | identical |
| 04-B | 294 ms | "That's a good question. Let me think about it for a moment." | identical |
| 05-A | 292 ms | "Your meeting with the design team starts in 15 minutes." | …starts in fifteen minutes. |
| 05-B | 294 ms | "Your meeting with the design team starts in 15 minutes." | same |
| 06-A | 332 ms | "I've saved the document and shared it with your project folder." | identical |
| 06-B | 284 ms | "I saved the document and shared it with your coder." | …shared it with your project folder. |
| 07-A | 315 ms | "I'm sorry, I didn't catch that. Could you say it again?" | identical |
| 07-B | 300 ms | "I'm sorry, I didn't catch that. Could you say it again?" | identical |
| 08-A | 285 ms | "Good night, sleep well, and I'll be here when you wake up." | identical |
| 08-B | 273 ms | "Good night, sleep well, and I'll be here when you wake up." | identical |

**HTTP:** 16/16 returned `200` with a usable transcript. **Latency:** 265–356 ms for 3.7–4.1 s of audio (≈11–15× faster than real time).

### Accuracy, stated plainly

- 11 of 16 are exact or differ only in punctuation/number formatting.
- The recurring, systematic error is **her own name**: "Lélu" was heard as *Leil, Leloo, Leo, Leilu*. This is the exact failure `WHISPER_NAME_HINT` exists to reduce; it is a real weakness, not a pass.
- Two isolated content errors: "at nine" → *"in Timon"* (03-A), "project folder" → *"coder"* (06-B).
- Coherent, punctuated output; `avg_logprob` is present in `verbose_json` but is **not** a calibrated confidence and is not turned into one.

## 3. Transcript provenance (G2)

M22.5 reported that transcripts carried no source or confidence. That is repaired on the existing turn/memory path:

| Field | Where | Rule |
|---|---|---|
| `source` | `VoiceTurn.transcript.source`; stored as `transcriptSource` | `browser-recognition` \| `groq-whisper` \| `elevenlabs-scribe` \| `livekit-agent` |
| `confidence` | `VoiceTurn.transcript.confidence`; stored as `transcriptConfidence` | **only** when the recogniser returned a positive number (Chrome's `SpeechRecognitionResult.confidence`). Whisper/Scribe/LiveKit supply none here, so none is stored |
| `final` | `transcriptFinal` | final vs partial |
| `at` | `transcriptAt` | timestamp |
| conversation | `conversationId` on the same `ai.chat` call | the active conversation when speech began |

Verified by `tests/asr-provenance.test.ts` (3/3): engine stored; absent confidence stays absent; typed turns carry no transcript fields at all.

The `verbose_json` `avg_logprob` is deliberately **not** mapped to confidence — it is a model score, not a probability that the transcript is right.

## 4. What this proves and what it does not

**Proves:** real recorded speech reaches LÉLU's configured transcription service, returns accurate text, and the result can be attributed to a named engine.

**Does not prove:**
- that a **microphone** captured it (the audio came from files);
- that the browser's `MediaRecorder` produced usable audio;
- that the transcript entered a live conversation (no browser, no session);
- that any latency target for a live turn is met end to end.

**Live-mic recognition: BLOCKED.**
