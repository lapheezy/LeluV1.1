# WP06 — Real end-to-end acceptance

**What is real:** the built app, its server, Groq Whisper transcription
(server relay), LÉLU's AIService/chat runtime and its model providers (Groq
and OpenRouter answered; no Anthropic — key removed from the server process),
the local Piper speaker, Chromium's audio pipeline and playback events.
**What is simulated:** the microphone (a WAV of four spoken lines fed by
`--use-file-for-fake-audio-capture`, built by
`persistent-runtime/scripts/build-session-mic.py`; plan in
`logs/mic-plan.json`). **What is absent:** any speaker or human listener.

Mic plan (seconds from microphone start): L1 1.5–7.8 "Hello Lélu. My name is
Sam. Can you tell me about the city of Lima in Peru?" · L2 14.8–20.1 "Wait,
stop. Tell me one interesting fact about the ocean instead." · L3 26.6–30.5
"Sorry, hold on. What is seven times eight?" · L4 46.5–50.1 "Thank you. What
did I say my name was?"

## The 17 steps (desktop run 3 — `logs/e2e-desktop-run3.json`; runs 1–2 agree unless noted)

| # | Step | Result | Evidence |
| --- | --- | --- | --- |
| 1 | Open LÉLU | ✅ | `desktop-01-loaded.png` (identical flow in every run) |
| 2 | New conversation | ✅ fresh profile, Chat Universe | `desktop-02-chat-open.png` |
| 3 | Activate mic | ✅ one `getUserMedia`, `listening` | `session.getUserMediaCalls: 1` |
| 4 | Speak a question | ✅ (simulated) L1 | mic plan |
| 5 | Transcription received | ✅ verbatim ("7 times 8" rendered as digits), STT request 0.35–0.62 s | `stt[]` |
| 6 | Cognition runtime receives it | ✅ user message + reply in the active MultiChatStore conversation, `provider: OpenRouter` | `conversationAfter` |
| 7 | Real response | ✅ Lima overview | idem |
| 8 | Spoken | ✅ 18/18 `/api/voice/tts` 200 (local-piper), `playing` events | `tts[]`, `media[]` |
| 9 | Speak again, no restart | ✅ 4 turns, 1 stream | `getUserMediaCalls: 1` |
| 10 | Interrupt while speaking | ✅ L2 and L3 both ended while phase = `speaking` | `bargeInFromPhase` |
| 11 | Playback stops | ✅ phase left `speaking` 1.6 s / 1.4 s after the line ended; `bargeIns: 2` | idem |
| 12 | New utterance processed | ✅ ocean fact; 56 | `conversationAfter` |
| 13 | Continue | ✅ L4 → "Sam" | idem |
| 14 | Switch to typed chat | ✅ typed in the same composer/window | `desktop-run3-05-typed-handoff.png` |
| 15 | Same context | ✅ "We've discussed Lima, Peru, an ocean fact, the product of 7 × 8, and you reminding me of your name, Sam." (`provider: Groq`) | `typedReply` |
| 16 | Recoverable failure → recovery | ✅ see recovery run | `logs/e2e-recovery.json` |
| 17 | End, mic cleanup | ✅ `active:false`, `micStreamsOpen 0`, every track `ended`, button `off` | `session` |

Runs 1 and 2 of step 15 asked "Which city did I first ask you about, and what
is my name?". That question is routed to LÉLU's local identity path
(`provider: brain`), not the model: run 2 answered "Your name is Sam."; run 1
answered from `OfflineComposer` that it had no established details. That is the
existing cognition router's behaviour for "what is my name" questions, not a
loss of conversation. Run 3's model-routed question is the context proof.

Barge-in caveat (an earlier, superseded run of the same script whose log was
overwritten — reported from the session transcript, not from a committed
file): turn 1 was cancelled by the barge-in while still being written (the
model had called two tools; first text at 9.3 s). The chat then kept
`"Stopped. Already ran: workflow_run, capabilities_list."` as that turn's reply,
which is AIService's existing cancellation record: the partial answer that had
already been spoken is not kept in the chat.

## Recovery run — `logs/e2e-recovery.json`

| Failure injected | Observed |
| --- | --- |
| Speech server 500 for every sentence of a reply | session stayed `active`, phase back to `listening`, `ttsStage: failed`, reply text in the conversation |
| Microphone track ended (real `track.stop()` + `ended` event) | re-acquired in **817 ms**; `captureLosses 1`, `captureRecoveries 1`, `micStreamsOpen 1`; next utterance transcribed and **spoken** (11.6 s after the loss, including the 7.8 s line replayed by the fake device) |
| Transcription request aborted (`internetdisconnected`) | session stayed active; the next utterance was transcribed and processed |
| 10 start/stop cycles | `micStreamsOpen 0`, acquired = released = 13, every track `ended`, lifecycle listeners 4 throughout |
| Real provider outage (happened on its own in a mobile run) | "offline mode" notice shown, not spoken; the next turn answered and spoken |

## Measured timings

| Measure | Values (ms) | Source |
| --- | --- | --- |
| Speech capture → transcript: end of line → transcript | ≈ 0.9 s VAD silence + STT request 348–991 (median 458) | `stt[].ms` (3 desktop runs) |
| Transcript → model first text | 712–5 056 (median of 12 turns ≈ 2 500) | `turns[]` |
| Model first text → first audible | 134–2 685 (median ≈ 800) | `turns[]` |
| Transcript → first audible | 735 (mobile); desktop 1 241–6 273 (median ≈ 3 900) | `turns[]` |
| Interruption: end of user line → she stopped | 1 401 / 1 606 (run 3), 2 195 / 1 676 (run 1), 1 840 (run 2) | `bargeInFromPhase` |
| Mic loss → microphone live again | 817 | recovery |
| Mic loss → next reply audible | 11 590 | recovery |

Interruption latency is dominated by turn detection: the recording path decides
a user turn after ~0.9 s of silence and then transcribes it; the stop itself is
synchronous with that decision. Run 2's second line was not counted as a
barge-in: her reply had finished before the line ended.

## Hardware acceptance gap

No physical microphone, speaker or iPhone was available. G5–G7 and G11 are
therefore software-verified only; physical acoustic behaviour (echo, false
barge-in, real speech recognition accuracy, iOS lifecycle) remains to be
accepted on a device.
