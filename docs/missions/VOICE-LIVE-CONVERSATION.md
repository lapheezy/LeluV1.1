# LÉLU live conversation: continuous, interruptible voice in the same Chat Universe thread

Date 2026-11-26 · branch `claude/lelu-live-voice-conversation-bepg8m` · base `30eb458e` (voice finalization, fast-forwarded in) · implementation `972b509a`
· by Claude (coding assistant) · **committed locally; not pushed, merged or deployed**

> **Verdict.** In the real, built app one tap on the microphone now holds a **live session**. The person can speak
> turn after turn, and every utterance becomes a user message in the same Chat Universe thread. LÉLU's written reply
> appears there first, and VoxCPM2 then speaks the same words. The person can cut in and she stops, and they can type
> mid-session without losing anything. Tests A–G pass in Chromium against the production build (G in iPhone 13
> *emulation*).
>
> **The honest limit is speed.** On this CPU (2 cores for VoxCPM2) she is first heard **15–19 s** after the person
> stops talking: 13.5–22 s across the runs, and ≈28 s before this mission. Her voice is **85 %** of that. Transcription
> takes 0.5–0.7 s and her written reply 1–1.4 s. Natural conversational pace needs a GPU worker or a faster voice, and
> that is the owner's decision (section 6).
>
> **What was not tested:** a physical microphone, speaker or iPhone. The input is a synthetic test speaker played into
> Chromium's capture device, and playback is proven by the browser's media events, not by an ear.

## 1. WP01: what existed, what was missing

The voice-finalization commits `1410a14a` and `30eb458e` were on `claude/lelu-voice-finalization-go9hrm`, which is this
branch's base plus exactly those two commits. They were fast-forwarded in, so both are preserved unchanged.

**Already in place and reused:** one `VoiceEngine` singleton; `VoiceBridge` → `addMessage` (the one conversation store);
`AIService.chat` (Groq/Cerebras, the same path as typed text); a VAD-per-utterance Groq Whisper loop; `/api/voice/tts` →
VoxCPM2 with sentence look-ahead; echo guard; turn ledger; Stop speaking. **No second engine, store or router was
added.**

**What was missing or wrong for a *live* conversation** (each found by reading the code or by running it):

| # | Found | Effect | Fix |
|---|---|---|---|
| 1 | The capture loop awaited each transcription before recording again | 0.7–2 s after every utterance was not heard | Next utterance recorded at once; transcriptions handled strictly in spoken order (`transcribeInOrder`) |
| 2 | Barge-in waited for the whole interrupting sentence **and** its transcription | She talked over the person for seconds | Onset **holds** her playback; the transcript then stops her (real interruption) or resumes her (echo, noise, nothing) |
| 3 | A cancelled sentence's `onFail` fired once the next reply cleared the global `halted` flag | The engine counted it a voice failure and spoke it in the **browser voice** (proven: the test fails on the old player) | Cancellation per sentence |
| 4 | A hold landing before audio started rejected `play()` with `AbortError`, which was treated as failure | "Voice failed", demoted to another voice (live run A1) | AbortError during a hold is a pause |
| 5 | Two look-ahead requests sent together reached the worker in either order | A reply's 2nd sentence was generated first; the 1st waited 38 s | Against a worker slower than real time, sentences are requested one after another |
| 6 | VoxCPM2 re-encoded the 12 s reference on **every** sentence | +4.3 s per sentence (3 cores), 5.8–6.1 s (2 cores) | Reference encoded once (during the self-test, before READY) and reused |
| 7 | A sentence aborted by a barge-in kept the worker busy until its end | At RTF 9 the next reply queued ~1 min behind it, timed out, "Voice failed" | Worker stops a generation **between steps** when its client has gone |
| 8 | Noise reached Whisper, which answered "Thank you." / "." | Phantom user messages; a phantom barge-in; Groq 429 → "offline" (live run, before fix) | Voicing gate in the audio-thread VAD: no voiced sound, no upload, no hold |
| 9 | "Listening" was shown while nothing was recording (Web Speech failing over to Whisper) | First words lost while the label claimed otherwise | "Starting the microphone…" until capture really runs |
| 10 | The Universe thread never showed interim words | WP03 | `VoiceInterim`: recogniser's interim words as the person's line, in the same thread |
| 11 | A voice turn reached the model as plain text; after a barge-in her history held the whole reply | She said "you told me by typing" (finalization report); she didn't know what was heard | `spokenTurnNote`: "spoken aloud" + what of her last reply was actually heard |
| 12 | Mobile status chip floated over the thread | Covered the last line of text (iPhone 13 emulation) | On ≤ 640 px the status is a row inside the composer, in flow |
| 13 | A first clause was sent as "surface,."; "(984 feet)" as its own bracketed piece | Odd prosody; VoxCPM2 regenerated the bracketed piece until the page gave up (67 s) | Clause marks kept; asides spoken between commas; "≈" → "about" |
| 14 | A reply cut off before any audio had no outcome in the turn ledger | "unexplained" silence (M23.0 invariant) | Recorded as `cancelled` |

## 2. WP02–WP05, WP07: how the live session behaves now

- **Persistent session (WP02).** One tap on `[data-lelu-voice-toggle]`; the same `MediaStream` serves every turn. The
  session ends only by the same button. States: *Starting the microphone… → Listening → Hearing you… → Transcribing →
  Thinking → Generating her voice… → Speaking → (Voice failed — the reply is in the chat) → Voice session ended*. A
  denied or missing microphone says so; a lost track shows *Microphone paused* and is re-acquired.
- **Transcripts in the thread (WP03).** Each final utterance → `VoiceBridge` → `addMessage` → the open conversation, worded
  exactly as transcribed. Interim words show as the person's line in progress where the recogniser has them (Web Speech
  on desktop Chrome / Safari); the Whisper path has none, so nothing is invented. Duplicates within 4 s, Whisper's prompt,
  text with no letters, and unvoiced sound never become messages.
- **Written and spoken together (WP04).** Her reply streams into the thread; the first piece goes to VoxCPM2 as soon as
  its first clause is complete. In every run the text appeared before the audio, and the spoken text is the written
  text (spoken-text normalization only: numbers, symbols). If VoxCPM2 fails, the text stays and the label says *Voice
  failed*; the browser voice is never substituted silently (finalization behaviour, unchanged).
- **Barge-in (WP05).** Onset of *voiced* speech while she is speaking → her audio is **paused within the same tick**
  (`heldWithinMs: 0`; media `pause` within 0.1 s of the held state). Transcript arrives → real interruption: playback
  stopped, every queued request aborted, the worker's generation stopped at its next step, her context gets what was
  heard. Otherwise she **resumes from the same position** (measured: paused at 1.18 s, resumed at 1.18 s). Stop
  speaking (■) is shown whenever she generates or speaks; the microphone button ends the session.
- **Chat Universe integration (WP07).** No new panel or workspace. Desktop: chip above the mic; phone: a row inside the
  composer. Typing works throughout and the reply is spoken in the same voice and thread.

## 3. WP08: acceptance results (production build, Chromium)

Setup: `npm run build`; `scripts/live-conversation-serve.sh` (server from an **allowlist**: only Groq and Cerebras
keys; `/api/model/status` → groq and cerebras configured, all others UNCONFIGURED); VoxCPM2 worker alone on cores 2–3,
browser + server on 0–1 (section 7). Harness `scripts/verify-live-conversation.cjs` taps the microphone **once** per
session. Input: `scripts/live-conversation-mic.cjs`, a synthetic test speaker (VoxCPM2 conditioned on the public Piper
"amy" sample: not a person and not LÉLU), each clip checked through Whisper first. Per-run JSON, summaries,
screenshots and every TTS WAV are in `docs/missions/live-voice-evidence/runs/`.

| Test | Run | Result |
|---|---|---|
| **A** Continuous | `A-continuous` | One tap, three spoken questions → 3 user messages verbatim, 3 replies in order, in context ("there" = Paris, "it" = Eiffel Tower). **4/4 sentences played to `ended`, all `X-Lelu-Engine: voxcpm2`, voice `worker:lelu-reference`**. 0 barge-ins. Track `ended` after the session. **PASS** |
| **B** Text + voice | `A-continuous`, all runs | Written reply before audio in every turn (`textBeforeAudio: true`); spoken text = written text. **PASS** |
| **C** Barge-in | `C-barge-in`, `C-hold-resume-and-barge-in` | Two successive interruptions in one session: the ocean reply stopped after 2 of 4 sentences, the Mars reply after its first clause; aborted requests `ERR_ABORTED`, worker `cancelled_mid_generation`; the interrupting questions answered; **no stale audio** (next sound was the new reply). A sentence already generated when the person started speaking was held and then discarded unplayed. **PASS.** Caveat: in these runs the onsets fell *between* her sentences (she is silent ~80 % of a long reply at this RTF, see §6); in-audio pause/resume at the exact position is shown in `E-noise-bursts-BEFORE-voicing-fix` (holds 14, resumed 10). |
| **D** Continuity | `D-voice-and-typing` | Spoke "favourite colour is green" → **typed** "what is my favourite colour?" mid-session (session stayed active) → "green", spoken by VoxCPM2 → spoke again, answered in context. **PASS** |
| **E** Noise / silence | `E-noise-and-silence`; before/after `E-noise-bursts-BEFORE-voicing-fix` vs `C-hold-resume-and-barge-in` | Pink noise, bursts, clicks, 25 s silence → **0 transcriptions, 0 messages** (4 non-speech turns); then a real question was heard. Before the voicing gate the same 25 bursts produced "Thank you." and "." messages and a phantom barge-in; after: `nonSpeechTurns: 25`, 0 phantoms, 0 false holds. Acoustic echo of her own voice cannot be produced here (no speaker→mic path); the text echo guard is unit-tested. **PASS (synthetic noise)** |
| **F** Failures | `F-deny`, `F-no-device`, `F-failure-recovery` | Denied → "Microphone permission denied…"; no device → "No microphone was found…"; **VoxCPM2 killed** → reply text kept, "her voice failed last turn", `playback-failed`, no other voice; **worker restarted** → next turn spoken by VoxCPM2 in the same session; **network cut** → transcription `ERR_INTERNET_DISCONNECTED`, session kept listening, next question answered after reconnection; **mic track ended** (simulated: the harness ends the track; Chromium's fake device cannot be unplugged) → *Microphone paused* → re-acquired (`captureRecoveries 1`), conversation continued. Streams acquired 2 / released 2. **PASS** |
| **G** Mobile | `G-iphone13-emulation` | iPhone 13 **emulation**: one tap, question, barge-in, typed message mid-session, VoxCPM2 playback, ended. Status row inside the composer (screenshots `-03-speaking-2`, `-06-ended`); nothing covers the thread. **PASS in emulation; physical iPhone NOT TESTED.** |

Known behaviour, not changed: a pause of more than 0.9 s inside a question ends the turn (the clips that split had 1.13–1.23 s
pauses). The second half then supersedes the first, and both lines stay in the thread (D, E, F).

## 4. WP06: latency (final Test A, VoxCPM2 on 2 cores)

| Stage | Measured |
|---|---|
| Microphone → utterance closed (VAD) | 0.9 s of silence after the last word (by design) |
| Speech end → transcript handled (page) | **1.26 / 1.65 / 1.64 s** (Groq Whisper request 0.46–0.70 s) |
| Transcript → her written reply visible | **1.93 / 2.46 / 1.39 s** (Groq chat, streamed: 0.93–1.35 s for the whole reply) |
| VoxCPM2 first sentence (worker's own time) | **11.6 / 14.9 / 12.2 s**, RTF 4.8–4.9, whole WAV (`X-Lelu-Streaming: off:slower-than-realtime`) |
| Transcript → first audio | **13.8 / 17.1 / 13.8 s** |
| **Speech end → she is heard** | **15.1 / 18.7 / 15.4 s** (before: ≈28 s on 3 cores) |
| Interruption: onset → her audio paused | same main-thread tick as the onset (≈0.2 s of speech + one voiced window) |
| Interruption: onset → stopped (transcript) | 4.3–5.2 s (end of their utterance + Whisper) |
| Interruption: page abort → worker stops | next generation step (~0.65 s at 2 cores) |

Bench, worker alone on 3 cores (`latency-bench/`, `latency-bench-reuse/`):

| | Before (reference per call) | Reference reused |
|---|---|---|
| 89-char sentence, 10 steps | 22.6 s | 18.2 s |
| 27-char clause, 6 steps | 9.0 s | **4.3 s** |
| Reference encode | 4.3 s per sentence | once, before READY |
| Whisper word accuracy, 10 / 6 / 4 steps | 1.0 / 1.0 / **0.67** (4 steps garbles) | — |

**Not changed:** `VOXCPM_TIMESTEPS` stays 10. Six steps is about 25–40 % faster and Whisper still hears every word, but
no speaker-similarity check could be run (installing the scorer was not permitted here), so her voice is not altered on
an unmeasured judgment. The owner can set `VOXCPM_TIMESTEPS=6` after listening.

## 5. CPU and memory

| Process | Measured |
|---|---|
| VoxCPM2 worker | load 18–25 s, **peak 11.1 GiB**, steady RSS **6.9–7.6 GiB**; CPU 200 % of 2 cores (299 % of 3) while generating, ~0 idle |
| App server (bun) | 62–71 MiB, ~0 % |
| Chromium (software 3D, no GPU) | 1.9–2.4 GiB, **184–188 %** of its 2 cores |

## 6. The hard limit, quantified

At RTF ≈ 4.8 (2 cores) or 4–6.6 (3 cores), every second of her speech costs about 5 s of generation. So:
- **First word ≥ ~6–9 s** after the transcript for the shortest first clause, about 12–15 s for a short sentence. This
  is generation time, not overhead (transcription + model ≈ 1.5–2.5 s).
- In a multi-sentence reply she is **silent ~80 % of the time** between sentences (e.g. 5.6 s of audio, then a 22 s
  gap). Streaming the WAV doesn't help: it would play the same gaps as fragments.
- **A natural pace (first word ≈ 1–2 s) needs RTF ≲ 0.3:** VoxCPM2 on a GPU worker (`VOXCPM_WORKERS` supports one), or a
  different engine. Both are owner decisions; nothing was switched. The barge-in, cancellation and ordering work in
  this mission is what makes a faster worker usable as a live voice.

## 7. Environment constraints found

- **The browser and VoxCPM2 must not share cores here.** With the browser on one core, its audio thread starved and whole
  utterances reached the page as silence (`C` first attempts). Sharing the worker's cores slowed VoxCPM2 ~8×, and the
  page's header timeout then aborted sentences. Final runs: browser + server on cores 0–1, worker on 2–3. In
  production the browser runs on the person's device.
- **Pre-existing defect (not fixed, out of scope):** without WebGL the app retries `THREE.WebGLRenderer` creation in a
  loop (344 errors in one minute).

## 8. Tests

| Check | Result |
|---|---|
| `tsc --noEmit -p tsconfig.app.json` / `-p tsconfig.node.json` | exit 0 / exit 0 |
| `npm run build` | exit 0 (chunk-size warnings only) |
| New `tests/voice-live-conversation.test.ts` | **14/14**: hold/resume, stop during hold, stale reply never plays nor "fails" (fails on the old player), first-clause boundary, spoken-turn note, single-word interrupts, states, capture-loop order, serial synthesis against a slow worker, hold before audio is not a failure, voicing (speech vs white/brown noise), bracketed asides |
| `services/voxcpm/test_step_cancel.py`, `test_fair_turn.py` | pass |
| All voice suites (`tests/voice-*`, `personality-voice*`) + `self-awareness` | **229 tests: 228 pass, 0 fail**, 1 skipped (final code) |
| One existing assertion changed | `voice-finalization.test.ts`: against a slow worker **one** request in flight (was 3); reason in the test |
| Full `npm test` | **3398 tests: 3364 pass, 5 fail, 29 skipped** (543 s; run before the last two small edits, the `cancelled` outcome and bracket asides, which the voice suites above cover). All 5 failures are pre-existing: the four the finalization report recorded (credential workflow, two foundry, supabase-config), plus `outfit-switching` "she changes on her own by occasion…", which **fails identically on the untouched base `8785e73b`** (checked in a clean worktree). |

## 9. Remaining limitations

1. **Pace:** 15–19 s to her first word on this CPU (§6).
2. **No physical device:** desktop and iPhone checks with a real microphone and speaker (and acoustic echo
   cancellation) are for a person. Production HTTPS is still required for the microphone (finalization report).
3. **Interim words** only where the browser recogniser runs (Web Speech). In this headless Chromium Web Speech fails
   (`audio-capture`) and Whisper is used, so interim display was not exercised in a browser here.
4. **A mid-audio barge-in by a real question** was not caught in the browser, only mid-audio hold/resume by sound
   (see C caveat). Every real interruption landed between her sentences.
5. **Turn splitting** on pauses > 0.9 s (§3).
6. The voicing gate is calibrated on one real recorded human voice (her reference clip) and synthetic noise.
   Unusual voices (whisper, very breathy speech) are untested.
7. Weights (4.96 GB) and venv live in this container only.

## 10. Files changed

Implementation: `src/core/voice/{VoiceEngine,elevenLabsTts,vadWorklet,voiceStatus,spokenText}.ts`,
`src/app/scene/genesis/chat/universe/{VoiceToggle.tsx,VoiceInterim.tsx (new),UniverseChatWindow.tsx,chatUniverse.css}`,
`services/voxcpm/server.py`, new `services/voxcpm/test_step_cancel.py`. Tests: new
`tests/voice-live-conversation.test.ts`, `tests/voice-finalization.test.ts` (one assertion). Tooling: new
`scripts/{verify-live-conversation.cjs,live-conversation-mic.cjs,live-conversation-serve.sh,live-conversation-report.cjs,voice-live-latency-bench.cjs}`.
Evidence: `docs/missions/live-voice-evidence/`. Self-knowledge: journal
`leluverse/self/journal/2026-11-26-live-voice-conversation.md`, playbook
`leluverse/self/playbooks/live-conversation-voxcpm2.json`.

No dependency, provider, paid API, Anthropic call, LangChain or LangGraph was added; no key appears in code, logs or
evidence. New optional worker settings: `VOXCPM_REUSE_REFERENCE` (default on), `VOXCPM_CANCEL_MID_SENTENCE` (default on).

## Reproduce

```bash
bash services/voxcpm/install.sh && .venv-voxcpm/bin/python services/voxcpm/bootstrap.py
OMP_NUM_THREADS=2 taskset -c 2-3 .venv-voxcpm/bin/python services/voxcpm/server.py --port 8788 --warmup
npm run build && bash scripts/live-conversation-serve.sh /tmp/server.log &
node scripts/live-conversation-mic.cjs compose --dir docs/missions/live-voice-evidence/mic \
  --spec "sil:20,a1,sil:80,a2,sil:80,a3,sil:70" --out /tmp/A.wav
taskset -c 0,1 node scripts/verify-live-conversation.cjs --mic /tmp/A.wav --out /tmp/runs --label A
node scripts/live-conversation-report.cjs /tmp/runs/A.json
```
