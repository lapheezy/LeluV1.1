# MISSION 22.8 — FINAL REPORT

**LÉLU real-time conversational intelligence**
Branch `m22.8/real-time-conversational-intelligence`, from `8fe50238`.
Canonical `543da7c8` untouched. Decision: **CONDITIONALLY APPROVED**.

---

## 1. What was already working

Inherited from M22.7 and still working after this mission:

* microphone capture through `getUserMedia`, energy VAD on the audio thread
  (`vadWorklet.ts`), echo guard (`isEchoUtterance`), barge-in predicate
  (`isBargeIn`);
* transcription via the browser recognizer, ElevenLabs Scribe or the Groq
  Whisper relay, with a live fallback between them;
* `AIService.chat()` as her only cognition — tools, memory, routing, personality
  and the conversation store were not touched;
* local Piper synthesis behind `/api/voice/tts`, with an honest provider label;
* playback through `HTMLAudioElement`, chunked by `chunkForSpeech`;
* failure classification (`turnFailure.ts`), budget metering, provider resource
  accounting, and a seven-turn conversation with continuity.

## 2. What was broken

| # | Defect | Precise cause (not the symptom) |
|---|---|---|
| 1 | Replies detached from newer input | streamed deltas had no turn identity; only `conversationId` was filtered |
| 2 | Speech waited for the whole reply | the spoken path awaited `chat()` and then called `speakResponse` |
| 3 | Microphone "paused" during fallback TTS | it was open, but `getUserMedia({audio:true})` asked for no AEC, so her own voice flooded the capture and had to be discarded by the echo guard |
| 4 | Interruption could not cancel generation | cancelling stopped the current utterance only; the queue and the in-flight TTS response survived |
| 5 | Formatting read aloud | no normalization layer existed anywhere in the TTS path |
| 6 | Piper stood in for her voice | no identity, and no diagnostic saying so |
| 7 | Diagnostics lied during speech | the 5 s capability poll rebuilt `_diagnostics` and reset live fields mid-reply |
| 8 | Latency grew across turns | each sentence after the first waited out a complete synthesis |

## 3. What was changed

| File | Change |
|---|---|
| `src/core/voice/VoiceEngine.ts` | stream ownership; streamed spoken turns; latency measurement; AEC/NS/AGC capture; live diagnostics preserved; normalization wired into every speech path |
| `src/core/voice/elevenLabsTts.ts` | synthesis-ahead queue; incremental PCM playback on `AudioContext`; stop/cancel covers both transports |
| `src/core/voice/spokenText.ts` **(new)** | the pure spoken-language normalization layer |
| `plugins/voiceApi.ts` | `GET /api/voice/diagnostic`; `--output_raw` PCM streaming with the model's real sample rate |
| `src/app/scene/genesis/GenesisChat.tsx` | passes its turn id to the streaming speech calls |
| `src/app/scene/genesis/VoiceBridge.tsx` | publishes `window.__leluVoice` |
| `tests/` (6 new files) | 24 regression tests for the defects above |
| `MISSION-22.8/` | this evidence package |

No new service, agent, registry, ledger, voice subsystem or conversation store
was created. No LangChain/LangGraph, no Anthropic, no paid API.

## 4. What was newly implemented

1. **Turn ownership at the speech boundary** — `beginStreamingSpeech(owner)`,
   `feedStreamingSpeech(text, owner)`, `finishStreamingSpeech(text, owner)`, with
   dropped deltas counted in `staleStreamsDropped`.
2. **Spoken turns stream** — a voice turn subscribes to the same model stream a
   typed turn uses, guarded by `_turn.id` and the conversation id.
3. **Synthesis-ahead queue** — the next sentence is synthesised while the
   current one plays; a stop drops what is still synthesising.
4. **Incremental PCM playback** — `/api/voice/tts` with `stream: true` returns
   `audio/L16` from `piper --output_raw`; the page schedules each chunk as an
   `AudioBuffer` and starts on the first one.
5. **`toSpokenText`** — markdown, emoji, URLs, code, numbers, money,
   percentages and abbreviations, with identifiers protected.
6. **Runtime diagnostic** — `GET /api/voice/diagnostic` (server, no network, no
   key) plus `window.__leluVoice` (client), covering every item WP06 lists.
7. **Echo-cancelling capture** — `echoCancellation`, `noiseSuppression`,
   `autoGainControl` requested, with a plain-stream fallback.
8. **Latency instrumentation** — `firstTextLatencyMs`, `firstAudioLatencyMs`,
   `ttsQueueDepth`, `TurnLatency` per turn.

## 5. What was successfully verified

* **Streaming works:** 34 and 39 sentences spoken across 19-turn sessions;
  1.6–2.1 sentences per turn, spoken while the reply was still being generated.
* **Ownership works:** the M22.7 drift is reproduced in
  `voice-turn-ownership.test.ts` and the stale reply produces no audio.
* **Normalization works:** 61 assertions across 21 markdown, 20 emoji, 10
  technical and 10 numeric/abbreviated replies; no artefact reached a TTS
  request in any live run.
* **Interruption works (software):** 6–13 barge-ins per run, each followed by a
  new transcript and a new answer; 25 buffers played to completion in the final
  run, 10 were stopped.
* **Incremental playback works:** 25 PCM buffers scheduled, 25 `onended`.
* **Recovery works:** empty synthesis → 502; playback failure → demotion and
  re-probe; cancellation → next turn clean.
* **Regression:** 2310 tests / 2300 pass / 2 pre-existing failures / 8 skipped;
  typecheck 0; build 0; lint 0 errors, 174 warnings.

## 6. What remains partially verified

* live stale-drop (count 0 — unit-proven, not live-observed);
* inter-sentence audio discontinuity (only indirect evidence);
* runtime recovery after a server restart with a live page (not run);
* multi-turn continuity with a deliberate topic-resume script (not scripted);
* all acoustic claims (see §7).

## 7. What remains blocked

* **Physical microphone and speaker** — the entire `hardware-acceptance.md`
  matrix (A1–A5, B1–B4, C1–C8, D1–D7, E1–E4) is unexecuted.
* **Acoustic echo cancellation and false barge-in rate** — needs a room.
* **LÉLU's own voice (VoxCPM2)** — no torch, no weights, no GPU;
  `ModuleNotFoundError: imageio_ffmpeg` is the captured cause, and CPU inference
  of a 2 B model could not serve a conversation.

## 8. Actual latency improvements

Measured, same harness, same container, simulated microphone.

| Metric | M22.7 | M22.8 (WAV) | M22.8 (PCM, final) |
|---|---|---|---|
| ASR median | ~300 ms | 499 ms | 457 ms |
| Transcript → first TTS request (median) | **3000 ms** | 3034 ms | **1626 ms** |
| Transcript → first audio (median) | not measured | 4969 ms | **3518 ms** |
| P90 → first audio | — | 7120 ms | 5721 ms |

Read this carefully:

* the **first-audio median improved by ~1.4 s** versus the immediately preceding
  implementation;
* **most of that is not PCM.** Within-run, `firstAudio − firstTts` was 1935 ms
  (WAV) / 1794 ms / 1892 ms (PCM): incremental PCM moved the first sample
  earlier by only ~0.1 s here, because Piper reloads its model per request;
* the **2 s first-audio target is missed** and is reported as missed.

## 9. Voice identity progress

The question "why ECONNREFUSED" is answered with a traceback, not a guess: the
sidecar cannot import its dependencies, and no model exists. The identity target
remains VoxCPM2 (Apache-2.0, cloning, already integrated); a CPU-capable interim
option (Chatterbox Nano / Pocket TTS) is compared and **not adopted**, because
choosing a voice needs a listening test.

Piper is labelled everywhere as a fallback: `X-Lelu-Voice-Provider:
local-piper:amy-low`, `voiceIdentity.status: "fallback"`,
`voiceIdentity.cloned: false`. No document, route or UI string claims Piper is
LÉLU.

## 10. Regression results

```
typecheck   exit 0
build       exit 0  (✓ built in 7.70s)
lint        0 errors, 174 warnings   (identical to M22.7)
tests       2310 · 2300 pass · 2 fail · 8 skip · 264 s
voice       98 · 97 pass · 1 skip · 0 fail
```

The two failures are the same pre-existing ones (`genesis-interface.test.tsx`,
`sandbox-security` egress expectation). No test was weakened or skipped.

## 11. Resource consumption

| | |
|---|---|
| Server, live voice session | 75 MiB RSS |
| Build | `✓ built in 7.70s` |
| Full suite | 264 s |
| One browser acceptance run | 112–286 s |
| Piper | one short-lived process per sentence, 0.45–2.0 s |
| GPU | none used (none exists) |

## 12. Branch and commits

```
branch   m22.8/real-time-conversational-intelligence
parent   8fe502382fb9911629860bda08d90dcff0be7fdc   (M22.7, remote-verified)
```

Implementation commit and remote-verification commit are recorded in
`REMOTE-VERIFICATION.md` (hashes are only written there once the remote reports
them back).

## 13. Canonical

`543da7c8d7876258869d928648cffa913cd10649` — **untouched**. No merge, no
promotion, no force-push, no history rewrite. The M22.7 branch still points at
`8fe50238` and `MISSION-22.7/` is unmodified.

## 14. Is the candidate safe to promote?

**No, not to canonical.** It is safe to keep, review and demonstrate:

* it preserves every M22.7 capability and its evidence;
* it fixes the four software defects that made conversation unnatural
  (ownership, full-reply wait, formatting read aloud, un-cancellable speech);
* it documents, rather than hides, what it did not achieve.

It is **not** eligible for promotion until a real microphone and speaker execute
`hardware-acceptance.md`, and until a decision is made about hosting LÉLU's own
voice. Two latency targets remain unmet and are stated as unmet.

## Comparison against M22.7, in one line

M22.7 proved LÉLU *has* a voice; M22.8 makes that voice belong to the turn the
person just spoke, starts it before the answer is finished, stops it when they
speak, and says out loud only what a person could say — while leaving her real
voice, and the hardware proof of it, still to come.
