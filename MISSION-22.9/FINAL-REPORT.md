# MISSION 22.9 — PERSISTENT VOICE RUNTIME — FINAL REPORT

Recovery, completion and end-to-end acceptance, 2026-11-22. Work packages:
`01-BRANCH-RECOVERY.md` … `07-PERFORMANCE-REPORT.md`, `ACCEPTANCE-MATRIX.md`;
evidence in `persistent-runtime/` (`test-results.json`, `logs/`,
`screenshots/`, `scripts/`). This file is in the commit it describes, so it
cannot name that commit's hash: the hash is the branch head that follows
`b46b0aa3` on the remote (see §G).

## A. Branch recovery

* Branch `m22.9/persistent-voice-runtime` exists; recovered exactly at
  `b46b0aa33c6e8873e8f2f7f5ade05884d102e1d5` (remote = local; 14 ahead / 0
  behind canonical `543da7c8`). Clean tree. 14 unique commits listed in WP01.
* Fetch issue: no defect in the branch. A whole-repository `git fetch --prune`
  (~70 branches with large binary evidence) did not finish within the tool
  window; the single exact ref fetched immediately. The mobile picker failure
  is plausibly the dotted/slashed name off the first page of ~70 branches —
  inferred, not reproduced.

## B. Implementation

**Already existed (kept):** one VoiceEngine routed into the same
`AIService.chat` and conversation as typed chat; sentence-streamed speech
owned by its turn; barge-in on Web Speech and Whisper paths; echo and
duplicate guards; warm local Piper; failure notices shown not spoken.

**Completed:**
1. Persistent capture lifecycle — track `ended`/`mute` handling, re-acquire
   with bounded retry, honest end on denial/no device, `captureSuspended`
   state that never shows "listening" without a microphone.
2. Page lifecycle — `visibilitychange` (resume capture / restart recognizer),
   `pagehide` (release mic, no auto-restart), `online`, permission revocation.
   Bound once.
3. Concurrency — single-flight start, second tap = stop, late streams released,
   no second permission prompt after a denial.
4. Speech failures on the streamed path — reported, browser-voice fallback; TTS
   header timeout (15 s).
5. Found live and fixed: markdown blocks no longer become one 413-refused
   speech request; first-audio latency no longer credited to the wrong turn;
   `bargeIns` diagnostic live.
6. UI — the primary Chat Universe mic now shows the real microphone state and
   targets the composer's conversation; Genesis mic can always be turned off;
   44 px touch target.

**Files changed:** `src/core/voice/VoiceEngine.ts`,
`src/core/voice/elevenLabsTts.ts`, `src/core/voice/useVoice.ts`,
`src/app/scene/genesis/GenesisChat.tsx`,
`src/app/scene/genesis/chat/universe/ChatUniverse.tsx`,
`src/app/scene/genesis/chat/universe/chatUniverse.css`,
`tests/voice-persistent-session.test.ts` (new), `MISSION-22.9/**` (evidence).

**Architecture connections verified live:** mic button → VoiceEngine →
`/api/voice` STT relay (Groq Whisper) → `AIService.chat` (Groq/OpenRouter) →
MultiChatStore conversation → streamed sentences → `/api/voice/tts` (local
Piper warm worker) → browser playback → state back to the button.
No parallel engine, runtime or memory; no LangChain/LangGraph; no Anthropic
(the `LELU_ANTHROPIC_API_KEY` present in this environment was removed from
the server process for every live run); no ElevenLabs spend (keys removed
likewise); no new dependency; no Supabase access.

## C. Voice functionality

| Capability | Result |
| --- | --- |
| Listening | One stream for a whole multi-turn session; indicator follows real state; re-acquired after loss in 817 ms |
| Transcription | 13/13 lines verbatim (Groq Whisper, simulated microphone); STT request 348–991 ms |
| Cognition | Same runtime and conversation as typed; context carried into typed chat (run 3) |
| Speech | Every TTS request 200 in the final runs (18–32 per run); playback events observed; no speaker |
| Barge-in | 5 live interruptions over her speech, stop 1.4–2.2 s after the user's line; 3× repeated in unit tests |
| Persistence | Conversation persists (MultiChatStore); remount restores turn; reload never re-opens the mic by itself |
| Recovery | TTS 500, mic loss, STT network abort, real provider outage — session survives each |

## D. Test results

* Targeted voice: **141/141** (20 files; new file 20/20 — and 21/21 of its
  checks fail against the original engine).
* Full suite: **2 346 tests, 2 339 pass, 1 fail, 6 skipped.** The one failure,
  `tests/genesis-interface.test.tsx`, is pre-existing and environmental
  (Excalidraw CSS subpath under Node) and fails identically at baseline.
  Baseline: 2 326 / 2 317 / 3 fail.
* Typecheck 0 · Lint 0 errors, 175 warnings (same set as baseline) · Build 0.
* Browser: 3 desktop runs, 1 mobile-emulation run, 1 recovery run, 2
  resource probes — all completed.
* Physical device: **not executed** — no microphone, speaker or iPhone.

## E. Performance

* Transcript → first text median ≈ 2.5 s (712–5 056 ms); first text →
  audible median ≈ 0.8 s; transcript → audible 1.2–6.3 s desktop, 0.7 s on the
  fastest mobile turn. Model time dominates.
* Tap → microphone live: median 1 224 ms (611–1 725).
* 30 start/stop cycles: streams 30 acquired / 30 released / 0 open;
  AudioContexts 61 created / 61 closed; window/document listeners flat; heap
  +3.2 MB vs +2.0 MB idle control (≈ 40 KB/session, no growing structure found).
* No regression against earlier M22.9 numbers. Markdown replies now make more,
  shorter speech requests.

## F. Acceptance matrix

| Gate | Status | | Gate | Status |
| --- | --- | --- | --- | --- |
| G1 | VERIFIED | | G11 | PARTIALLY VERIFIED |
| G2 | VERIFIED | | G12 | VERIFIED |
| G3 | PARTIALLY VERIFIED | | G13 | VERIFIED |
| G4 | VERIFIED | | G14 | VERIFIED |
| G5 | PARTIALLY VERIFIED | | G15 | VERIFIED |
| G6 | PARTIALLY VERIFIED | | G16 | VERIFIED |
| G7 | PARTIALLY VERIFIED | | G17 | VERIFIED |
| G8 | VERIFIED | | G18 | PARTIALLY VERIFIED |
| G9 | VERIFIED | | G19 | VERIFIED |
| G10 | VERIFIED | | G20 | VERIFIED |

Evidence per gate: `ACCEPTANCE-MATRIX.md`. None BLOCKED or FAILED. Every
PARTIAL is the hardware gap: no physical microphone, speaker or iPhone
(Safari / installed PWA) exists in this environment, so acoustic capture,
audibility, echo, false barge-in and WebKit lifecycle are unobserved.

## G. Source control

* Starting head `b46b0aa3`; work committed on top of it on
  `m22.9/persistent-voice-runtime`; pushed fast-forward, never forced.
* Canonical `543da7c8` only read; production branches untouched.
* Final commit SHA and remote SHA: reported in the session summary and
  readable as `git rev-parse origin/m22.9/persistent-voice-runtime`.

## H. Recommendation

**APPROVED WITH LIMITATIONS.** The persistent voice runtime works end to end
through LÉLU's own cognition in the browser, recovers from every software
failure tried, and releases every resource it takes. It is not yet accepted on
real audio hardware or on an iPhone; the 17 steps of WP06 should be run once on
each before promotion.

Known limitations carried forward: interruption needs ~0.9 s of user silence
plus transcription before she stops (recording path); a reply cancelled by
barge-in keeps AIService's "Stopped…" record rather than the partial text
already spoken; a failing speech server receives one request per queued
sentence; "what is my name"-style typed questions are routed to the local
identity path, not the model.
