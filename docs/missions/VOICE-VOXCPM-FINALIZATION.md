# LÉLU voice finalization — VoxCPM2, live microphone, speech generation, end-to-end acceptance

Date 2026-11-26 · branch `claude/lelu-voice-finalization-go9hrm` · implementation commit `1410a14a` (base `8785e73b`)
· by Claude (coding assistant) · **committed locally; not pushed, merged or deployed**

> **Verdict.** The whole loop works in the real, built LÉLU app: microphone → transcription → her own runtime and model →
> VoxCPM2 speaking in a voice conditioned on her reference → playback → Stop. It was proven turn by turn in Chromium against
> `bun run server.ts` serving `dist/`. **Two honest limits:**
> 1. **No physical microphone or speaker exists in this cloud container.** The microphone input was a WAV file played
>    into Chromium's capture device (the page's real `getUserMedia` → recorder path, nothing in the page mocked), and
>    playback is proven by the browser's own `playing`/`ended` events, not by a human ear. A person must do the
>    desktop/iPhone check (section 15).
> 2. **VoxCPM2 on a CPU is slow:** RTF 6–8 on 3 cores. Her first spoken word comes **≈28 s** after a short question is
>    transcribed (≈50–55 s for a long answer's first sentence). The voice is consistent and intelligible, but this is not
>    a conversational pace. MOSS-TTS-Nano (already integrated, ~1.3 s) or a GPU is the way to a natural pace.

## 1. Recovery findings

Full inventory: [`VOICE-FINALIZATION-RECOVERY.md`](VOICE-FINALIZATION-RECOVERY.md). In short:

- The VoxCPM2 sidecar **was committed** (11-12/13, `14cf7ec7`…`56a47c18`), so the "not committed" report was stale. Every
  voice branch is merged into HEAD. No branch, stash or worktree holds voice work HEAD lacks.
- The one unmerged VoxCPM2 route (`de4a2653`, with a consent gate) was deliberately superseded in `5e938eed`, so I did not
  revive it.
- The real gaps were not missing code. VoxCPM2 had **never been heard through the app**, and running it for real exposed
  ten defects (section 3).

## 2. Original voice-related branches and commits

Branches (all ancestors of HEAD): `m22.6/voice-runtime-release-qualification` `afcfd8c7`, `m22.7/live-voice-qualification`
`8fe50238`, `m22.9/persistent-voice-runtime` `448770bd`, `m23.0/embodied-conversational-experience` `d2131ea7`,
`claude/lelu-worker-recovery-4fio20` `b00cfefc`, `claude/lelu-voice-https-production-lvv519` `8785e73b`,
`freebuff/44c122e89826b555c8003299` `157d9dfb`. Commits: see the recovery document's VoxCPM2 history table.

## 3. VoxCPM2 implementation status — integrated and operational on CPU

Path: page → `POST /api/voice/tts` (`plugins/voiceApi.ts`) → `relayWorkerSpeech` (`plugins/voxApi.ts`) → `VoxcpmPool`
(`src/core/voice/gpuWorkers.ts`) → `services/voxcpm/server.py` → `VoxCPM.generate` with her reference. The browser
never sees the model, the worker URL or a path.

Defects found by running it for real, all fixed in `1410a14a`:

| # | Found (measured) | Fix |
|---|---|---|
| 1 | The page aborted every VoxCPM2 sentence: fixed 15 s header timeout vs 19–48 s synthesis. She **never spoke** (first run: `ERR_ABORTED` at 16 s). | `/api/voice/status` reports `workerRtf` (from the pool's cached health, one 3 s probe if unknown); the page waits `15 s + 2 × chars × 0.08 s × RTF`, counting sentences queued ahead, capped at 300 s. A fast or unknown engine keeps 15 s. |
| 2 | A PCM stream from a worker at RTF 6 plays as fragments separated by silence. | The relay asks a worker with RTF > `VOXCPM_STREAM_MAX_RTF` (default 2, so MOSS at 0.8–1.3 keeps streaming) for one whole WAV and sends `X-Lelu-Streaming: off:slower-than-realtime`. Nothing is faked as streaming. |
| 3 | All sentences of a reply were requested at once. The worker's queue (4) answered 503 from the 6th and the reply switched to the browser voice. | Look-ahead bounded to 2 sentences (`SYNTHESIS_AHEAD`). |
| 4 | STOP left already-sent sentence requests running on the worker. | `stopSpeaking()` aborts every request it sent. |
| 5 | The worker's `threading.Lock` is not FIFO: sentences 3 and 2 were generated before sentence 1. | `FairTurn`: arrival order, and a waiter whose client has gone gives up its turn (`cancelled_before_start`). |
| 6 | Queue waiting was timed as synthesis: reported RTF 18.75 for a real 7–8. | The clock starts at the turn. |
| 7 | Missing weights → `from_pretrained` would silently download 4.96 GB. | `local_files_only` unless `VOXCPM_ALLOW_DOWNLOAD=1`. State `FAILED` with `weights-missing: run services/voxcpm/bootstrap.py`. |
| 8 | No memory check before a load that peaks at 11.1 GiB. | `VOXCPM_MIN_AVAILABLE_GB` (default 8) → `FAILED insufficient-memory`. `MemoryError` → `out-of-memory`. `/health` reports `availableGiB`. |
| 9 | The label said "Speaking" through 20 s of synthesis with nothing audible, and the turn was logged `spoke` with no audio. | `voiceStatus.ts` shows Listening / Transcribing / Thinking / **Generating her voice…** / Speaking / Voice failed beside the mic. `spoke` is recorded when audio starts, `playback-failed` otherwise. |
| 10 | Noise became a user turn: Whisper returned its prompt "Talking with Lélu." (`no_speech_prob` 0) and she answered it. | `isPromptEcho()` → treated as silence. |

Lifecycle and health are unchanged and were verified: `STARTING → LOADING → INITIALIZING → READY`, with READY only after a
real self-test generation. One model per process, loaded once (the same PID served every run). One generation at a time,
with a bounded queue and an identical-text LRU cache (a repeat answered in **0.05 s** vs 28.3 s, `X-Lelu-Cached: 1`).

## 4. Model and weights status (readiness report)

| Item | Value (measured here unless stated) |
|---|---|
| Implementation | `voxcpm==2.0.3` (OpenBMB), `services/voxcpm/server.py`, CPU torch `2.15.0+cpu` / torchaudio `2.11.1+cpu`, Python 3.12 venv `.venv-voxcpm` (`install.sh`) |
| License / availability | Apache-2.0, ungated: no account or token (HF API `gated: false`) |
| Weights | **Absent at start.** Fetched with `bootstrap.py` (disk check, resumable, per-file size verification): 9 files, **4.96 GB**, in ~60 s, snapshot `7936080b…`. They live in this container's HF cache, so **a new container must fetch them again** |
| Hardware here | 4 vCPU, 15 GiB RAM, no GPU, no swap. Worker pinned to 3 cores (`taskset -c 1-3`, 3 torch threads) |
| Load time | 24.5 s (4 cores, first), 22.0 / 22.5 / 19.5 s (3 cores, warm page cache) |
| Memory | RSS **6.56 GiB** steady (7.33 GiB after generations); **peak 11.1 GiB during load** |
| CPU during synthesis | 270–300 % of 300 % (saturates its 3 cores) |
| Self-test | "Hello, I am ready." 1.28–1.6 s of audio in 12.3–16.3 s, RMS 0.11–0.13 |
| Synthesis RTF in the app | **6.1–8.1** (3 cores, unshared). 105 when Chromium's software-rendered 3D scene shared the same cores (first run: 200.8 s for 1.9 s of speech, see section 13) |
| Output | WAV / PCM16, **48 kHz mono** |
| Streaming | Genuine `generate_streaming` exists (first byte 5.6 s measured), but is not used at RTF > 2 (defect 2) |
| GPU | None available. CUDA install path exists in `install.sh` but was not exercised |

## 5. Microphone integration

The direct browser path is sufficient; LiveKit is **not configured** (`/api/livekit/status` → `{"configured":false}`) and
was not added. In the real UI (Chat → conversation window → mic button `[data-lelu-voice-toggle]`):

- Permission is requested by `getUserMedia` on the tap. The track is `live` while listening and **`ended` after stop**
  in every run (`tracks-after-stop` in each `run*.json`).
- Denied → "Microphone permission denied. Please allow mic access.", idle, no track (`run4-deny`).
- No device → "No microphone was found on this device.", idle (`run4-no-device`).
- Cross-origin frame without `allow="microphone"`: Chromium reports `NotAllowedError: Permission denied` (measured), the
  same error as a person's refusal. The page now checks the frame's permissions policy (`false` measured without the
  attribute, `true` with it) and says the frame blocks it. Production sends `X-Frame-Options: SAMEORIGIN`, so it can't be
  framed cross-origin in the first place.
- Mic start (tap → listening): 1.4–2.4 s on one shared core; 0.14 s in the mobile run.
- Secure context: `getUserMedia` needs HTTPS. Production HTTPS is still undeployed (Mission 1 report), so **the microphone
  cannot work on `http://157.173.116.95` until it is**.

## 6. STT integration

Groq `whisper-large-v3-turbo` through the existing server broker (`/api/model/groq/audio/transcriptions`, key
server-side, free tier). Latency **0.68–2.13 s**. Transcripts were exact for the test speaker. The transcript enters the
same conversation through `VoiceBridge` → `addMessage`, and the reply comes from `AIService.chat`: the same runtime,
memory, tools and intent routing as typed text. Run 2 shows the intent router acting on a voice-era message (it opened
the Voice workspace view). Empty or noise input: no turn (section 9).

## 7. TTS integration

`/api/voice/tts` → VoxCPM2. Every spoken reply in the acceptance runs carries `X-Lelu-Engine: voxcpm2`,
`X-Lelu-Voice-Provider: worker:lelu-reference` and `X-Lelu-Worker: local`. The WAVs were saved byte for byte
(`voice-evidence/audio/`). They round-trip through Whisper as the reply: "Got it, your favorite color is green." Long
replies are split into ≤200-character sentences and synthesized two ahead, in order. Playback never overlaps (one pump).
Failures report `playback-failed`, and the text stays in the chat.

## 8. Voice identity and cloning status — **partial, measured, not verified as her**

- Reference: `services/voice-reference/lelu-voice-reference.m4a` (48.81 s AAC). The first 12 s, decoded to 24 kHz mono, are
  the conditioning (`VOXCPM_REFERENCE_SECONDS`, cached as `.voxcpm/reference-9ac99650243c-12s.wav`). Requirements as used:
  any ffmpeg-decodable clip of clean speech from one speaker, ≥12 s. Configuration is environment only (no rebuild):
  `VOXCPM_REFERENCE_AUDIO`, `VOXCPM_REFERENCE_SECONDS`, `VOXCPM_CFG_VALUE` (2.0), `VOXCPM_TIMESTEPS` (10).
- **A/B control** (`voice-evidence/cloning-ab/`): the same three sentences from the same model, with and without the reference,
  scored by ECAPA (`speechbrain/spkrec-ecapa-voxceleb`, cosine) against the **held-out** 12–48 s of her clip:

  | Audio | Similarity to her (held-out) |
  |---|---|
  | Her own clip, 12–30 s vs 30–48 s | **0.779** |
  | VoxCPM2 **with** her reference (3 sentences) | **0.369 – 0.396** |
  | The app's spoken replies in runs 1–3 | 0.343 – 0.437 |
  | VoxCPM2 **without** reference (generic voice) | −0.008 – 0.018 |
  | espeak-ng test speaker (negative) | −0.062 |

  The reference clearly moves the voice toward hers: from about 0.0 to about 0.38. But that is **about half** of her
  similarity to herself. This is speaker conditioning, not a verified clone, and only a human listening can say whether it
  sounds like her. Pronunciation: Whisper hears her name as "Leilu".
- **Privacy:** the clip was served by the app at `/audio/voice/lelu-voice-reference.m4a` (200, 696,337 bytes). It has moved
  out of `public/` and that URL no longer returns it. **The GitHub repository is public**, so the clip is still public there
  (tree and history). The repository records **no provenance or consent** for the clip
  (`services/voice-reference/README.md`). Both are owner decisions; nothing was uploaded anywhere.

## 9. Chat runtime integration

The same conversation for text and voice, verified across a **browser reload** (run 2: the page reloaded with run 1's
exchange present). A typed follow-up and a spoken question were both answered in context:

- **Run 1 (voice):** "Hello Lélu. My favorite color is green. Please remember that…" → "Got it—your favorite color is green."
- **Run 2, after reload (typed):** "…what is my favourite colour, and did I tell you by voice or by typing?" → "Your favourite
  colour is green, and you told me by typing." (Correct colour. **Wrong modality:** voice turns enter the conversation as
  ordinary user messages, so she cannot tell how they arrived.)
- **Run 2 (voice):** "Lélu, what color did I tell you is my favorite?" → "Your favorite color is green."

No duplicate responses (one assistant message per turn in every run). A barge-in while she spoke the typed reply (run 2)
superseded it, as designed.

## 10. End-to-end test evidence (real built app, real Chromium)

Setup: `npm run build`; `bun run server.ts` with `VOXCPM_BASE_URL=http://127.0.0.1:8788 VOICE_PROVIDER=voxcpm`, and
Anthropic / OpenRouter / ElevenLabs / Meshy variables **removed** (`/api/model/status`: only groq and cerebras configured).
Worker on cores 1–3, browser and server on core 0 (section 13). Harness: `scripts/verify-voice-finalization.cjs`
(it opens Chat, opens the conversation and taps the page's own controls; observation-only instrumentation). Input: an
espeak-ng test speaker, clearly not a person, injected as Chromium's capture file. All logs and screenshots are in
`docs/missions/voice-evidence/`.

| Test | Run | Result |
|---|---|---|
| **A** Microphone | run1 | tap → listening 1.56 s; track `live`; 9.3 s of speech captured by the VAD; transcribed exactly in 0.80 s; track `ended` after stop. **PASS (injected audio, not a physical mic)** |
| **B** Cognition | run1, run2 | the transcript became the user message of the same chat; Groq streamed her reply (1.3 s request). **PASS** |
| **C** Voice generation | run1 | `/api/voice/tts` 200 `audio/wav`, `x-lelu-engine: voxcpm2`, 2.4 s of audio, RTF 7.72; page `play()` → `playing` → `ended`; outcome `spoke`. **PASS (no human ear)** |
| **D** Interruption | run3 (desktop), run7 (mobile) | **Stop speaking** tapped 3.4 s / 2.6 s into her speech → both queued sentence requests `ERR_ABORTED` at once, phase → listening, **0** playback in the next 15 s; worker: queued sentence `cancelled_before_start`, the one mid-generation finished and was discarded (`client_gone_after_generation`: `model.generate` cannot be interrupted mid-sentence). The conversation and text stayed. **PASS** |
| **E** Continuity | run1 → run2 | speak → spoken reply → **reload** → typed follow-up → speak again: same conversation, correct answer each time. **PASS** (modality note in section 9) |
| **F** Failure recovery | run4-deny, run4-no-device, run5, run6, sidecar logs | denied / no device: honest messages, no track. **Weights missing** (worker on :8788 with an uninstalled model): pool `FAILED: weights-missing…`, TTS failed in 0.35 s, label "Listening — her voice failed last turn", outcome `playback-failed`, reply text kept. **Worker killed (`kill -9`) mid-generation:** same honest failure; restarted worker READY in ~20 s, and the next run spoke (run7). Insufficient memory: `FAILED insufficient-memory` (`sidecar-insufficient-memory.log`). **PASS** |
| **G** Mobile | run7 | **Chromium iPhone 13 emulation, not a physical iPhone.** Full turn, VoxCPM2 playback, Stop at 44 px touch size, track released. **PASS in emulation; physical iPhone NOT TESTED** |
| Noise / empty input | run8 | before the fix: pink noise → phantom turn "Talking with Lélu." answered and spoken (`audio/run8-noise-tts-01.wav`). After: 2 transcriptions, **0 turns, 0 chat, 0 TTS**. Pure silence never leaves the VAD. **PASS** |

## 11. Screenshots and audio evidence

- `run1-voice-06-speaking.jpg`: "Generating her voice…" with Stop beside the mic, the reply in the chat.
- `run2-continuity-08-after-turn.jpg`: all three replies after the reload.
- `run5-weights-missing-08-after-turn.jpg`: "Listening — her voice failed last turn".
- `run7-mobile-06-speaking.jpg`: mobile layout. **Nit:** the status chip covers part of the thread's last line while visible.
- Audio: `audio/run*-tts-*.wav` (her VoxCPM2 replies exactly as served), `tts-app-route.wav`, and `cloning-ab/*.flac` (A/B).

## 12. Performance measurements (this container; not the VPS)

| Step | Measured |
|---|---|
| Mic start (tap → listening) | 1.36–2.43 s desktop (shared core), 0.14 s mobile run |
| Capture | VAD ends a turn 0.94 s after speech stops |
| STT (Groq Whisper, request) | 0.68–2.13 s |
| Model request (Groq, streamed) | 1.0–4.0 s |
| Transcript → first reply text | 7.7–11.6 s desktop (page work on one shared core, see section 13); 1.7 s in the mobile run |
| VoxCPM2 initialization | 19.5–24.5 s; peak RSS 11.1 GiB, steady 6.6–7.3 GiB |
| Speech generation | 16.3 s (1.9 s audio) … 47.8 s (7.4 s audio); RTF 6.1–8.1 |
| Transcript → first audible | **27.8 s** (short reply), 28.8 s, 55.1 s / 49.9 s (long reply's first sentence) |
| Cached repeat | 0.05 s |
| Stop → silence | requests aborted within the tap; 0 playback in the following 15 s |
| App server | 59 MB RSS; Chromium not measured separately |
| GPU | none |

## 13. Hardware and resource constraints

- **CPU contention is decisive.** Headless Chromium renders LÉLU's 3D scene in software on the same 4 cores. In the first
  run VoxCPM2 took **200.8 s for 1.9 s** of speech (RTF 104.6), and the server's own timeout answered 504. All accepted
  runs pin the browser to core 0 and the worker to cores 1–3, which is how a deployment separates them (the browser runs
  on the user's device). The VPS figures below are prior records, not this mission's measurements.
- VoxCPM2 needs ≥ 8 GiB free to load (peak 11.1 GiB) and ~7 GiB resident. The Contabo VPS (per earlier reports: MOSS
  1.6–1.9 GB, "VoxCPM2 OOM finding") is why production runs MOSS. Running both workers there at once is unlikely to fit.
- The weights (4.96 GB) and venv (~1.5 GB) are in this ephemeral container only.

## 14. Test results

| Check | Result |
|---|---|
| `tsc --noEmit -p tsconfig.app.json` / `-p tsconfig.node.json` | exit 0 / exit 0 |
| `npm run build` (`tsc -b && vite build`) | exit 0 (final build after every change; chunk-size warnings only) |
| `oxlint` on changed files | exit 0, no findings |
| Voice suites (`tests/voice-*.test.ts`) | **170 pass, 0 fail**, 1 skipped |
| New `tests/voice-finalization.test.ts` | 8/8: state label, RTF parsing, slow worker → WAV + header, fast worker streams, threshold env, page timeout + bounded look-ahead + abort on stop, prompt echo, frame-policy denial |
| `services/voxcpm/test_fair_turn.py` | pass (FIFO + cancelled waiter) |
| VoxCPM2 initialization (real) | READY after self-test, 4 times (19.5–24.5 s) |
| Full `npm test` | **3383 tests: 3350 pass, 4 fail, 29 skipped** (637 s), run before the last two fixes (prompt echo, frame policy), which only add tests and pass in the voice suite. The 4 failures **fail identically on the untouched base commit** (checked in a clean worktree of `8785e73b`): credential-exposure "no workflow hands a provider credential to a build", foundry-m25c "the coat and catsuit handbags are their own nodes", foundry "the three sources are ordered per component", supabase-config "skipping is a remembered, first-class answer" |
| Self-awareness (journal and playbook validity) | see the commit with this report |

## 15. Remaining blockers

1. **Physical devices (owner):** no microphone or speaker exists here. Someone has to tap the mic on a desktop browser and
   an iPhone, speak, hear her, and press Stop.
2. **HTTPS in production (owner authorization):** the microphone needs a secure context. The tooling is ready
   (`deploy/contabo/*`, Mission 1 report) but undeployed, and this mission deployed nothing.
3. **Pace:** VoxCPM2 on CPU gives ~28 s to her first word. For conversation: MOSS-TTS-Nano (integrated, ~1.3 s, lower
   accuracy and similarity per `MOSS-INTEGRATION-DECISION.md`), or VoxCPM2 on a GPU worker (`VOXCPM_WORKERS` supports
   one; none is free and permanent, and none was used).
4. **Cloning is partial** (0.38 vs 0.78). Listening and an owner judgment are needed. Options not tried: a longer
   conditioning window, or `prompt_wav_path` + `prompt_text` (the transcript of the clip).
5. **Reference privacy and consent (owner):** the repository is public; the clip's speaker and consent are unrecorded.
6. **Local STT:** transcription depends on Groq's free tier (an existing account and key; no spend). No on-device or
   server-local Whisper exists yet.
7. A voice turn is stored without its modality, so she may say "you typed".
8. `model.generate` (WAV mode) cannot stop mid-sentence: STOP wastes at most one sentence of worker time.

## 16. Exact files changed (`1410a14a` and the report commit)

`plugins/voiceApi.ts`, `plugins/voxApi.ts`, `src/core/voice/{VoiceEngine,elevenLabsTts,gpuWorkers,speechToText,
transcriptionTransport}.ts`, new `src/core/voice/voiceStatus.ts`, `src/app/scene/genesis/chat/universe/{VoiceToggle.tsx,
chatUniverse.css}`, `services/voxcpm/{server.py,README.md}`, new `services/voxcpm/test_fair_turn.py`,
`services/mossnano/server.py` (reference path only), `public/audio/voice/lelu-voice-reference.m4a` →
`services/voice-reference/lelu-voice-reference.m4a` + new `README.md`, `scripts/voice-clone-reference.cjs` (path), new
`scripts/verify-voice-finalization.cjs`, new `tests/voice-finalization.test.ts`; reports: this file,
`VOICE-FINALIZATION-RECOVERY.md`, `docs/missions/voice-evidence/`, journal
`leluverse/self/journal/2026-11-26-voice-finalization-voxcpm2.md`, playbook
`leluverse/self/playbooks/speak-with-voxcpm2.json`.

Not changed: no new dependency in `package.json`, no new environment variable the app requires (the new ones are
optional: `VOXCPM_STREAM_MAX_RTF`, `VOXCPM_ALLOW_DOWNLOAD`, `VOXCPM_MIN_AVAILABLE_GB`). No provider registry, transport,
chat path, paid API, Anthropic call, LangChain or LangGraph was added. No key appears in code, logs or screenshots.

## 17. Final branch and commit

`claude/lelu-voice-finalization-go9hrm`: `1410a14a` (implementation), then the report commit on top (its hash is given in
the session summary).

## 18. Working-tree status

Clean after the report commit, except files the running app and test suite rewrite
(`leluverse/assets/characters/lelu_character/{manifests/character.json,generation_logs/events.ndjson}`), which are
restored and not committed. Untracked and ignored: `.venv-voxcpm/`, `.voxcpm/`. Local only: **nothing has been pushed**.

## Reproduce

```bash
bash services/voxcpm/install.sh                       # CPU torch + voxcpm 2.0.3 (.venv-voxcpm)
.venv-voxcpm/bin/python services/voxcpm/bootstrap.py  # 4.96 GB weights, disk-checked, verified
OMP_NUM_THREADS=3 taskset -c 1-3 .venv-voxcpm/bin/python services/voxcpm/server.py --port 8788 --warmup
npm run build
VOXCPM_BASE_URL=http://127.0.0.1:8788 VOICE_PROVIDER=voxcpm taskset -c 0 bun run server.ts   # free providers only
taskset -c 0 node scripts/verify-voice-finalization.cjs --mic <question.wav> --out <dir> --label run1 --voice
```
