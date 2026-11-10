# LÉLU VOX RECOVERY LEDGER — authoritative

**Audit date:** 2026-11-10
**Audited commit (HEAD):** `62ad31068243880e9ce105b3a50f46c167d6f2db`
**Branch audited:** `integration/lelu-four-workforce-consolidation` (remote tip, verified)
**Method:** read-only Git/object inspection first, then measurable verification (tests, typecheck,
live dev server, dependency and environment probes). Nothing was rewritten, reset or discarded.

> **One-line verdict.** Every *committed* piece of LÉLU voice work is intact and pushed, and it passes
> its own tests today (43/43) with a clean typecheck. **Zero VoxCPM2 artifacts exist in any reachable
> ref, commit or file.** Her voice output is blocked by a credential/quota condition, not by code.
> Voice → avatar lip sync is wired for the *browser* voice only, not for her own ElevenLabs voice.

---

## 1. Git and working-tree recovery report

| Item | Finding |
|---|---|
| HEAD | `62ad310` — exactly the last recorded checkpoint |
| Working tree | **clean** (0 entries, including ignored files) |
| Stashes | none |
| Worktrees | this chat only (`/workspace/chats/b088dc5ba2641bf17f787206`) |
| Reflog | only this chat's creation (`reset: moving to HEAD` at 19:59Z) |
| Remote branch tip | `integration/lelu-four-workforce-consolidation` → **`62ad310`** (fetched, identical) |
| Branch named in the brief | `freebuff/5fa8ea2e11de68a9029c7387` → **does not exist on GitHub** (`couldn't find remote ref`) |
| `freebuff-base` (`beb4289`) | unrelated empty "Initial cloud project"; contains none of this code |
| Reachable commits | 575. **None** adds or removes a line containing `voxcpm` (case-insensitive pickaxe across all refs) |
| `voxcpm` in any working-tree file | **none** |
| Last commit | `62ad310` "Add LÉLU voice reference audio for Freebuff" — one binary, 696,337 bytes, `public/audio/voice/lelu-voice-reference.m4a` |

**What this proves, and what it does not.** Committed work is fully recovered: nothing that reached a
commit is missing, and the remote matches local exactly. It does **not** prove the crashed session
wrote no VoxCPM2 code — it proves that nothing it wrote was committed or pushed. Uncommitted work would
live only in that session's own worktree, which this chat cannot read (separate chat, separate OS user).
The absent remote branch confirms that session never pushed.

**Recoverable from the crashed session:** the reference audio (committed) and nothing else, from here.
**Lost:** any uncommitted VoxCPM2 edits, scripts, or notes — presumptively, but unprovable from this side.

**Housekeeping risk (pre-existing, untouched):** `.g_build`, `.g_lint`, `.g_test`, `.g_tsc`, `.ours`,
`.theirs`, `.inspect.mjs` are *tracked* at the repository root (gate logs and merge artifacts). They are
not voice work and were left alone; they should be removed or gitignored separately.

---

## 2. Complete inventory of previous Vox work (what actually exists)

| Area | Artifact | Lines | State |
|---|---|---|---|
| Engine | `src/core/voice/VoiceEngine.ts` | 2185 | functional; one singleton |
| App bridge | `src/app/scene/genesis/VoiceBridge.tsx` | 61 | functional |
| React mirror | `src/core/voice/useVoice.ts` | 63 | functional |
| TTS (her voice) | `src/core/voice/elevenLabsTts.ts` | 176 | functional; serialised chain + stop |
| STT (her ears) | `src/core/voice/elevenLabsStt.ts` | 105 | functional; name normalisation |
| STT (Whisper) | `src/core/voice/transcriptionTransport.ts` | 68 | functional; through the model broker |
| VAD (audio thread) | `src/core/voice/vadWorklet.ts` | 126 | functional |
| Turn failures | `src/core/voice/turnFailure.ts` | 87 | functional |
| Adapters | `src/core/voice/adapters/VoiceAdapters.ts` | 430 | **not wired** into the engine |
| Orphan recorder | `src/core/voice/audioRecorder.ts` | 232 | orphan (verify script only) |
| Partly duplicated | `src/core/voice/speechToText.ts` | 171 | `mapMediaError` used; `buildTranscriptionForm` duplicated |
| Server broker | `plugins/voiceApi.ts` | 406 | live; registered in `vite.config.ts:326`, `server.ts:486` |
| Separate variant | `src/og/lib/voice-engine.ts` + `VoicePanel.tsx` | 114 | OG workspace only; not the Genesis path |
| Test-only panel | `src/app/scene/genesis/integration/VoiceStudioPanel.tsx` | — | referenced by one test |
| Reference audio | `public/audio/voice/lelu-voice-reference.m4a` | — | committed, **cited by no code** |
| Tests | 5 files (`voice-adapters`, `voice-elevenlabs`, `voice-continuity`, `voice-core-integration`, `voice-streaming-tts-state`) | 882 | **43/43 pass today** |
| Evidence | `docs/acceptance/mission-11-2/`, `docs/voice/evidence/*`, `scripts/verify-voice-*.cjs` | — | historical live runs |

---

## 3. Voice architecture dependency map (as built — preserve it)

```
Entry: CoreHoldGesture (hold the planet) · SpatialNavigator mic · ChatUniverse "Talk to LÉLU"
                                  │
                                  ▼
 VoiceEngine (singleton)  src/core/voice/VoiceEngine.ts
   mic ........ getUserMedia                  → one MediaStream, no duplicates
   ears ....... Web Speech (continuous+interim)
                → ElevenLabs Scribe  POST /api/voice/stt   (first choice)
                → Groq Whisper       broker audio/transcriptions (technical fallback)
   VAD ........ recordUtterance(): AnalyserNode energy VAD  (300 ms floor, 150 ms speech,
                900 ms silence, 20 s cap, 10 s no-speech)   :1169
                vadWorklet AudioWorklet, same rules on the audio thread   vadWorklet.ts:66
   guards ..... isEchoUtterance (echo) · duplicate-utterance window (4 s) · barge-in :1434
   cognition .. AIService.chat(text, media, undefined, {conversationId})   :1490
                — the SAME call typed chat makes; MultiChatStore active id; ScreenShare attachments
   voice ...... speakText() → /api/voice/tts → <audio> serialised chain     elevenLabsTts.ts:97
                fallback: speechSynthesis (0 voices in this VM)            :1565
                barge-in: stopSpeaking() releases the chain                elevenLabsTts.ts:160
   state ...... idle → listening → processing → speaking (+ diagnostics)   :2085
                                  │
                                  ▼
 VoiceBridge.tsx → addMessage() (same store as typing) + setVoice() → GenesisCore 3D Core
                                  │
                                  ▼
 GenesisChat.tsx → begin/feed/finishStreamingSpeech() while a typed reply streams
                                  │
                                  ▼
 Avatar: LeluAnimation.onSpeech() builds a viseme timeline from speech-activity events
         (LeluAnimation.ts:239); LeluBody.tsx:387 derives facial expression on speech start
```

Server side (key never in the browser):

```
plugins/voiceApi.ts   GET  /api/voice/status → {configured, stt, voiceId, modelId, sttModelId}
                      POST /api/voice/tts    → audio/mpeg (xi-api-key attached server-side)
                      POST /api/voice/stt    → {text, usage}   (Scribe)
                      rate-limited, cross-origin 403, 900-char / 12 MB caps, X-Lelu-Usage
plugins/integrationApi.ts:499  GET /api/integration/voice — adapter/VAD/benchmark health (auth-gated)
plugins/integration/services.ts:190  Pipecat probe — health check only, no transport
```

**Two concrete integration gaps found during this audit (not previously documented as such):**

1. **Her own voice does not drive lip sync.** `emitSpeechActivity` is only called from the browser
   `speechSynthesis` path (`VoiceEngine.ts:1983/1988`) and from `settleSpeech`/`cancelSpeech`. The
   ElevenLabs path (`speakThroughElevenLabs`, `:1565`) updates *diagnostics* only. So when she speaks in
   her real voice, `LeluAnimation` never receives `start`/`word`, and the viseme timeline stays empty.
   Voice/avatar sync therefore exists, but only for the fallback browser voice.
2. **The adapter layer is a health probe, not a pipeline.** `WhisperAdapter`, `KokoroAdapter`,
   `VadDetector` are imported by `tests/voice-adapters.test.ts` and `plugins/integrationApi.ts` only.
   `VoiceEngine` imports neither. There is no second engine (good) and no Kokoro/whisper.cpp path (fact).

---

## 4. Completed / partial / failed / missing matrix

### A. Successfully completed (with reproducible evidence)

| Capability | Evidence |
|---|---|
| Voice input: mic → VAD → STT → cognition | Live run 2026-11-10T06:48:45Z: 5/5 utterances heard, Groq Whisper 456–537 ms (`docs/acceptance/mission-11-2/voice-conversation.json`) |
| Voice shares one conversation with text | `VoiceEngine.ts:1490` passes `{conversationId}` to the same `AIService.chat`; replies stored by AIService |
| Streamed replies count as speech, settle correctly, chain releases on stop | `44befd3` + `tests/voice-streaming-tts-state.test.ts` (3 tests) |
| Server-brokered ElevenLabs TTS/STT routes | `plugins/voiceApi.ts`; 8 tests today; historical live 200 with 23,030 bytes audio |
| Energy VAD + audio-thread turn detection | `VoiceAdapters.ts` + `vadWorklet.ts`; 43 tests |
| Barge-in logic, echo guard, duplicate suppression | `VoiceEngine.ts:1434–1500`; `voice-continuity.test.ts` |
| Voice → chat store → 3D Core phase | `VoiceBridge.tsx`; `voice-core-integration.test.ts` |
| Cost metering of provider calls | `UsageBudgetGate` in both `elevenLabs*.ts`; `voice-elevenlabs.test.ts` |
| Whole voice suite + typecheck today | **43/43 pass** (4.9 s); `tsc -b --force` exit 0 |

### B. Partially completed

| Capability | What exists | What is missing |
|---|---|---|
| Her voice audibly speaking | complete transport, tested | provider refuses (no key here; quota historically). **No playback proven today** |
| Barge-in over audible speech | unit-tested; echo guard written | never executed against real audio (nothing was audible to interrupt) |
| Voice ↔ avatar lip sync | viseme timeline + visitor events | **not driven by ElevenLabs audio** (§3 gap 1) |
| Whisper.cpp / Kokoro / Silero | adapters, chunk planner, benchmark, honest health | never wired into `VoiceEngine`; no servers; no ONNX weights |
| Pipecat realtime | health probe + documented degradation | no WebRTC/streaming transport |
| Typed + voice interleaving | same store by construction | harness could not find the composer; **not verified live** |
| Mobile voice | `capacitor.config.ts`, secure-context scheme | **no `android/` or `ios/` project**, no device, no emulator |
| VoxCPM2 | reference audio asset committed | **no code, no adapter, no config, no test** |
| Long conversation (20 turns) | — | provider chain could not carry it; 2/5 turns failed on cognition |

### C. Failed attempts / what must not be repeated

| Attempt | Actual cause (evidence where available) |
|---|---|
| VoxCPM2 implementation sessions | **No artifacts survive.** Cannot be diagnosed from the repository: no log, no script, no diff, no branch. Reported as unknown, not as a code fault |
| ElevenLabs TTS live reply | `401 quota_exceeded` — free tier 9,994/10,000 characters used (Mission 11.2 report) |
| ElevenLabs Scribe on real speech | refused by the same quota; Groq Whisper carried every turn |
| Speech chain hanging after a stop | real bug, **fixed** in `44befd3`: a paused element fires no `ended`, so the serialised chain never settled |
| Browser-voice fallback promise | notice claimed a browser voice on a runtime with 0 voices; wording corrected in `44befd3` |
| Typed turn inside the voice harness | composer not present in that scene state; a harness limitation, not a product failure |
| Provider chain reliability | Groq 5 ok / 6 fail, OpenRouter 0/3, GitHub Models 0/1, Anthropic `POLICY_DISABLED` in that run |

### D. Missing (nothing exists)

- Any VoxCPM2 code, adapter, route, environment name, model file, transcript of the reference clip.
- Silero ONNX weights and `onnxruntime` (confirmed absent from `package.json`/`bun.lock`).
- Sidecar HTTP servers for whisper.cpp / Kokoro / VoxCPM2.
- Streaming (WebRTC/WebSocket) transport for audio in either direction.
- Acoustic echo cancellation (the echo guard is a text heuristic).
- Mobile platform projects and any device test.
- Lip sync driven by her real audio.

---

## 5. Why the previous sessions crashed — what the evidence permits

**There is no crash log, core dump, OOM record or Freebuff error trace in this repository.** The words
"crash" in the docs refer to unrelated things (mobile main-thread starvation at 2 fps; the Genesis error
boundary; a dev-server crash in the model broker). Any statement about the *cause* of the previous
account's crashes would be invention. What can be said with evidence:

| Observation | Status |
|---|---|
| The session stopped after `62ad310` (07:09Z, 2026-11-10) | **fact** — no later commit, no push of its branch |
| It had reached "prepare a voice-cloning reference clip" | **strong inference**: the only artifact is an orphan M4A referenced by nothing |
| VoxCPM2 is a Python/PyTorch 2B model (~8 GB VRAM, several GB of weights, Python 3.10–3.12, FFmpeg for reference audio) | **fact** (upstream docs) — it cannot run inside this Vite/Bun web repo, this VM has no GPU, and shell commands are capped at 5 minutes |
| Long model downloads / torch installs inside a chat session are non-durable and easily exceed command limits | **fact about this runtime**, a plausible trigger, **not proof** |
| Nothing written was committed | **fact** — which is why a crash cost the work |

**Conclusion:** the crashes cost the work because of *process*, not because of LÉLU's code. The smallest
durable fix is the checkpoint discipline in §8, and any VoxCPM2 work must happen behind an HTTP boundary,
never as a Python install inside this repository.

---

## 6. Blocker re-verification (historical findings re-measured today)

| Historical finding | Re-measured state today | Method |
|---|---|---|
| Whisper/Kokoro/Pipecat configuration incomplete | **Still true.** Adapters exist and are tested; none is wired into the engine. `WHISPER_BASE_URL`, `KOKORO_BASE_URL`, `PIPECAT_BASE_URL` unset | code trace + environment probe |
| Required environment variables missing | **Was true at audit time; superseded the same day — see §6.1.** No `.env*` existed then and `GET /api/voice/status` → `{"configured":false,"stt":false,…}`; the operator then provisioned platform secrets and the *names* were the blocker | live server |
| Silero ONNX dependency absent | **Still true.** No `silero`/`onnxruntime` in `package.json` or `bun.lock`; code reports `silero-onnx (absent) — adaptive energy VAD in use` | dependency read |
| Synthesis unavailable in the headless environment | **Superseded — see §6.1.** `/api/voice/tts` returns real `audio/mpeg` now by rotating three accounts; what is still absent is `/opt/pw-browsers/chromium`, so the Playwright harness needs `PW_CHROMIUM` | filesystem probe + live TTS |
| Microphone/engine backend and credentials not established | **Partly superseded — see §6.1.** Groq and ElevenLabs credentials are present and authenticate; Supabase is still absent, so `/api/integration/voice` still refuses | live server |

**What VoxCPM2 can actually do (upstream, not integrated here):** 30-language synthesis, voice design
from a text description, reference-clip cloning (no transcript needed), hi-fi cloning with a transcript,
48 kHz output. **What is integrated:** nothing. **What is theoretical for LÉLU:** all of it.

### 6.1 Credential recheck — what the platform actually delivers (measured 2026-11-10)

The secret store delivers **bare platform names**, not the names any code reads:

| Platform secret | Length | Documented name(s) it must supply |
|---|---|---|
| `Elevenlabs` | 51 | `ELEVENLABS_API_KEY` |
| `Groq1`, `Groq2`, `Groq3` | 56 each | `GROQ_API_KEY` (from slot 1) + `GROQ_API_KEY_1..3` |
| `Openrouter1`, `Openrouter2`, `Openrouter3` | 73 each | `OPENROUTER_API_KEY` (from slot 1) + `OPENROUTER_API_KEY_1..3` |
| `Github` | 43 | `GITHUB_MODELS_TOKEN` |
| `Meshy` | 42 | `MESHY_API_KEY` |

`plugins/bareSecretAliases.ts` already mapped the *un-numbered* names, so one key named `Groq` would
have worked. It had no entry for `Groq1..3` / `Openrouter1..3`, so `ProviderKeyRing` read `GROQ_API_KEY`
and `GROQ_API_KEY_1..4` and found **nothing**: six valid credentials, zero slots. Fixed by adding
numbered-slot aliases (slot 1 also supplies the base name every single-key path reads) and by judging
the "already set?" hole **per name** rather than per alias, so an operator-set `GROQ_API_KEY` no longer
blocks `GROQ_API_KEY_2` from arriving via `Groq2`.

Measured after the fix (`vite dev`, live requests):

| Check | Result |
|---|---|
| `GET /api/voice/status` | `{"configured":true,"stt":true,"voiceId":"cgSgspJ2msm6clMCkdW9","modelId":"eleven_v3","sttModelId":"scribe_v1"}` |
| `GET /api/env-check` | `VITE_GROQ_API_KEY` SET (56), `VITE_OPENROUTER_API_KEY` SET (73) |
| `GET /api/model/status` | groq CONFIGURED, openrouter CONFIGURED, githubModels CONFIGURED |
| Key ring, one live request per credential | Groq ×3 → HTTP 200 AUTHENTICATED; OpenRouter ×3 → HTTP 200 AUTHENTICATED |
| `POST /api/model/groq/chat/completions` | HTTP 200, served `openai/gpt-oss-120b` |
| `POST /api/model/openrouter/chat/completions` | HTTP 200, routed to `liquid/lfm-3-1.7b:free` |
| `GET elevenlabs.io/v1/user/subscription`, per account | `Elevenlabs` 10,000/10,000 · `Elevenlabs2` 0/10,000 · `Elevenlabs3` 0/10,000 — three valid keys, 20,000 characters unspent |
| `POST /api/voice/tts`, before slot rotation | **HTTP 502 → upstream 401** (`quota_exceeded`) |
| `POST /api/voice/tts`, after slot rotation | **HTTP 200 `audio/mpeg`**, 82,798 B and 71,514 B; `X-Lelu-Usage` reports 57 characters per call |

**Conclusion:** the credential blocker is closed. Cognition rotates across three Groq and three OpenRouter
credentials, and **her voice speaks**: the three ElevenLabs accounts are separate free tiers, so
`plugins/voiceApi.ts` spends them as slots — a spent account cools for fifteen minutes and the next one
receives the same request — which turns the exhausted first account into one refused call instead of
silence. Measured: two consecutive syntheses, both HTTP 200 `audio/mpeg`, 57 characters billed each.
`stt:true` means voice *input* runs on the same rotation.

---

## 7. Consolidated implementation plan (prioritised)

**P0 — restore the ability to prove anything (no new code). DONE for credentials (§6.1):**
`/api/voice/status` reports `configured:true, stt:true`, provider credentials are mapped and rotating, and
`/api/voice/tts` returns real audio by spending the three ElevenLabs accounts in turn. What remains is a
Chromium path via `PW_CHROMIUM` for the audible end-to-end harness.
*Verification:* audible reply in `scripts/verify-voice-conversation.cjs`; transcripts in the ledger.
*This is still the gate for every claim about her voice.*

**P1 — close the two proven code gaps, smallest change each.**
(a) Emit `start`/`end` speech-activity from the ElevenLabs path so the avatar's viseme timeline is fed by
her real voice. (b) Where speech actually starts playing, emit one `start` per segment with that segment's
text. *Verification:* unit test asserting activity events on the ElevenLabs path + a live run showing the
visemes move while audio plays.

**P2 — verify what was never verified.** Barge-in over audible speech; typed turn during/after a spoken
turn (fix the harness selector, not the app); 20-turn conversation on a provider that can carry it.

**P3 — optional local TTS/STT, behind the existing seam.** Wire `KokoroAdapter`/`WhisperAdapter` into
`VoiceEngine` **only** as alternative providers selected by env, never as a second engine and never as a
default. Keep ElevenLabs primary.

**P4 — VoxCPM2, only as an HTTP sidecar.** A Python service on a GPU machine exposing a small HTTP API;
a new adapter beside `KokoroAdapter`; the app talks to it through a server route (key/base URL server-side).
Reference clip: convert `lelu-voice-reference.m4a` → mono WAV, and produce its transcript for hi-fi mode.
Do **not** add Python, torch or model weights to this repository; do **not** let the browser call the
sidecar directly; degrade to ElevenLabs when it is unreachable. *This cannot run in the current VM and
cannot be deployed to a Worker.*

**P5 — mobile.** `cap add android`, then test permission, audio routing, background/foreground on a real
device. Nothing mobile is claimable before that.

**P6 — cleanup (separate decision):** `audioRecorder.ts`, the OG voice engine, `VoiceStudioPanel`, the
duplicated form builder, and the tracked `.g_*`/`.ours`/`.theirs` artifacts.

**Estimate:** P0 15–30 min once secrets exist · P1 half a day · P2 half a day · P3 1–2 days ·
P4 2–5 days plus GPU hosting · P5 1–2 days plus a device · P6 2–4 hours.

**Major risks:** free-tier quota exhaustion mid-verification; provider-chain instability being mistaken
for a voice fault; a VoxCPM2 sidecar quietly becoming a second voice engine; uncommitted work being lost
again on a crash; mobile claims without a device.

---

## 8. Safe checkpoint strategy (so the next account repeats nothing)

1. **Commit and push at every milestone**, even a failed one. An unpushed commit is a lost commit.
2. One branch per workstream, cut from `integration/lelu-four-workforce-consolidation`; never force-push,
   never reset, never `checkout -- .`.
3. Evidence beside the code: `docs/voice/evidence/<milestone>/run.json` plus this ledger updated in the
   same commit as the change it describes.
4. Record **names** of required environment variables (never values) and the exact command that produced
   each result.
5. Before starting VoxCPM2: prove the sidecar answers on its own machine, then record its URL/contract.
   If it cannot answer, stop — do not start an install inside this repository.
6. Leave a one-paragraph "next action" at the bottom of this file before ending a session.

---

## 9. Next action (edit this line when you resume)

> Credentials are proven (§6.1): cognition rotates 3 Groq + 3 OpenRouter, and `/api/voice/tts` returns real
> `audio/mpeg` by rotating 3 ElevenLabs accounts. Next: supply `PW_CHROMIUM` and run
> `LELU_BASE=http://127.0.0.1:5173/ node scripts/verify-voice-conversation.cjs <utteranceDir> <outDir>` for
> the audible end-to-end check. Do not write VoxCPM2 code until a sidecar answers a health request.
