# Runtime recovery and the runtime diagnostic (WP06)

**Status:** diagnostics VERIFIED; recovery paths PARTIALLY VERIFIED (the ones
that need a network/provider failure were exercised at unit/route level, the
physical ones are BLOCKED — see `hardware-acceptance.md`).

## Why this exists

M22.7's most expensive failure was not silence: it was a conversation that
looked alive and was not. A turn that fails must leave a mark the user can read,
a state the next turn can start from, and a diagnostic that says which stage
died. Three mechanisms do that, all pre-existing, now joined by a single
diagnostic surface.

## The failure matrix

| Failure | Where it is caught | What the user sees | Does the conversation recover? | Verified |
|---|---|---|---|---|
| Provider timeout | `classifyProviderError` → `provider-timeout` | "The model provider did not answer in time. Nothing was lost — ask again." (shown, **not spoken**) | yes — loop returns to listening | unit (`turnFailure`) + live M22.7 |
| Network failure | same classifier | network-specific message | yes | unit |
| Provider unavailable (quota/key/4xx-5xx) | `failureFromResponse` | provider message, not spoken as her answer | yes | unit |
| Transcription failure | `whisperFallbackLoop` catch | "I couldn't make out what you said — transcription failed." | yes, retries after 1 s | live M22.7 (observed), unchanged |
| Playback failure | `speakText` `onFail` → `demoteFromElevenLabs` | "Her own voice could not be played… the answer is in the conversation." | yes — next reply re-probes the server | unit (`voice-streaming-tts-state`) |
| User cancellation / barge-in | `isBargeIn` → `cancelInFlightTurn` | "You spoke over her, so she stopped." | yes — next turn is fresh | live M22.8 (7–13 barge-ins per run) |
| Spent budget | `BudgetExhaustedError` | budget notice, listening stops (not a silent stall) | after replenish | unit |
| Stale stream after supersession | `ownsStream` / `_turn.id` guard | nothing (the newer answer is the one heard) | yes | **unit** (live count 0 — see caveat) |
| Local synthesiser produced nothing | `synthesizeLocalStream` close handler | 502 with `{ok:false}` | client falls back to browser voice or reports playback failure | route test |
| Local synthesiser crashed | `child.on("error")` | 502 (if nothing was sent) / stream ends | next segment retried | route test (empty output) |
| Every voice account exhausted | `resources.plan` refusal | 503 + `Retry-After` + reason | yes, after cooldown | unit (`voice-resources`) |
| Server restart | — | page reconnects or needs a refresh | conversation history persists (MultiChatStore) | **not verified in this mission** (would need a supervised restart with a live page) |

### What "recovered" means here

A turn is recovered when all four are true:

1. the phase is not left at `speaking` or `processing`;
2. no audio from the failed turn is still queued (`ttsQueueDepth` back to 0,
   `chainActive` false);
3. the failure is not stored as her answer in the conversation;
4. the next transcript produces a new turn (a fresh `turnId` and `streamOwner`).

(1)–(3) are the existing M22.7 contract; (4) is what M22.8 added to the spoken
path, because a spoken turn now owns a stream.

## The runtime diagnostic

### Server — `GET /api/voice/diagnostic`

Makes **no network call** and reads **no key value**. It reports what is wired
on this process:

```json
{
  "ok": true,
  "asr":   { "provider": "groq-whisper-relay", "model": "whisper-large-v3-turbo", "configured": true },
  "ai":    { "provider": "client-reported", "note": "see VoiceEngine diagnostics" },
  "tts":   { "provider": "local-piper", "configured": true,
             "voiceId": "local-piper:amy-low", "modelId": null, "localBinary": true },
  "voiceIdentity": { "name": "Lélu", "provider": "piper", "status": "fallback", "cloned": false },
  "streaming": { "sentenceStreaming": true, "synthesisAhead": true, "firstAudioMeasured": true },
  "interruption": { "fullDuplexCapture": true, "bargeIn": "energy-vad + transcript ownership",
                    "echoCancellationRequested": true },
  "hardware": { "verified": false, "reportedBy": "client",
                "note": "microphone, speaker and echo cancellation are client facts" },
  "voxcpm": { "configured": false, "reachable": "unprobed" }
}
```

Design rules it follows:

* **`ai` is client-reported.** Probing a paid model to answer a health check
  would spend money to produce a number that is stale by the time it is read.
* **`hardware.verified` is always `false`.** The server cannot see a microphone;
  claiming otherwise would be exactly the failure this mission forbids.
* **`voxcpm.reachable` is `"unprobed"`.** The worker's own `/health` is the
  authority; a TCP connect from this route would prove a socket, not a model.
* **No secrets.** Test asserts no key fragment appears in the response.

Verified by `tests/voice-runtime-diagnostic.test.ts` (3 tests): no-provider,
local-Piper-fallback, ElevenLabs-identity; each runs with a fetch stub that
**throws on any outbound request**, proving the route opens no socket.

### Client — `window.__leluVoice`

Published by `VoiceBridge` (same convention as `window.__leluReadiness` and
`window.__leluRenderStats`):

```ts
{ at, phase, active,
  diagnostics: {
    sttSupported, ttsSupported, micAvailable, secureContext,
    micPermission, micStreamActive, recognitionActive,
    transcriptReceived, responseReceived, ttsRequested, audioGenerated,
    audioPlaying, ttsStage,
    streaming, staleStreamsDropped, firstTextLatencyMs, firstAudioLatencyMs,
    ttsQueueDepth, bargeIns, fullDuplex
  },
  turnLatency: { turnId, transcriptAt, firstTextAt, firstAudioAt } }
```

This closes a real M22.7 defect found while adding it: the 5-second capability
poll rebuilt diagnostics from static capability and **reset live fields**
(`ttsStage`, `audioPlaying`, `transcriptReceived`) while a reply was playing, so
the panel could report "idle" mid-sentence. Live facts are now kept in
`this.live` and merged over recomputed capability, so a poll no longer erases
what the pipeline just did.

### The ten things WP06 asks the diagnostic to identify

| Asked | Where answered | Can the server know it? |
|---|---|---|
| Browser availability | `window.__leluVoice.diagnostics` (`sttSupported`, `ttsSupported`, `secureContext`) | no — client |
| Microphone availability | `micAvailable`, `micPermission`, `micStreamActive` | no — client |
| Speaker availability | `ttsAvailable`, `ttsStage`, `audioPlaying` | partially — server knows the provider, client knows the device |
| ASR provider | `diagnostic.asr.provider` | yes |
| AI response provider | `ai.provider = "client-reported"` + `turnFailure` | no — deliberately |
| TTS provider | `diagnostic.tts.provider` | yes |
| Voice identity status | `diagnostic.voiceIdentity.{status,cloned}` | yes |
| Streaming status | `diagnostic.streaming` + `diagnostics.streaming` | yes |
| Interruption status | `diagnostic.interruption` + `diagnostics.bargeIns` | config yes, behaviour client |
| Network connectivity | `navigator.onLine` is **not** used; the real signal is the `turnFailure` kind | no — client |

## Reproducing the checks

```bash
# server surface
curl -s http://127.0.0.1:4180/api/voice/diagnostic | jq
# route tests (no network allowed by the stub)
npx tsx --test tests/voice-runtime-diagnostic.test.ts

# client surface, in the browser harness output
jq '.diagnostics, .turnLatency' MISSION-22.8/logs/latency-acceptance.json
```

## Still open

* A supervised **server restart with a live page** was not executed; the
  conversation store is the authority and the voice session must be restarted by
  the user. D5 in `hardware-acceptance.md` is the row that closes it.
* Rate limiting was verified at unit level (`voice-resources.test.ts`), not by
  driving the real route to 70 requests in a minute.
