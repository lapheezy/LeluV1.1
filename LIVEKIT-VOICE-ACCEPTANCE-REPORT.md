# Mission 6.3: LiveKit voice acceptance report

**Date:** 2026-11-13 · **Branch:** `claude/lelu-worker-recovery-4fio20` (on top of canonical `098dd3e`, not merged)
**Where it ran:** one ephemeral cloud container: 4 vCPU (AMX-BF16), 15.7 GiB RAM, no GPU. There was no iPhone,
no public URL and no Contabo access.

## Verdict

**LÉLU's voice now works end to end, in this container. It has not been tested on a real iPhone, and it is not
hosted anywhere persistent.**

The full chain ran in a headless browser emulating an iPhone 13, with a WAV file standing in for the microphone:

- the app's token endpoint;
- a real `livekit-server`;
- the voice agent;
- Groq Whisper through LÉLU's broker;
- LÉLU's own cognition, in the same conversation as text chat;
- the VoxCPM2 worker;
- the audio track played back in the page.

STOP silences her mid-sentence. Reconnection and worker restarts recover by themselves.

Every real-device step is **NOT TESTED**. Persistent hosting is **BLOCKED**: the Contabo VPS 4 has 8 GB of RAM,
and the speech model needs about 11.5 GiB to load.

**One-line result:** a question was spoken, heard and transcribed exactly. LÉLU replied "Paris is the capital of
France.", and she was heard saying it. Independent ASR of the audio the page actually received reads back
*"Paris is the capital of France."*

## Status by requirement

| Requirement | Status | Evidence |
|---|---|---|
| LiveKit installed and version verified | **VERIFIED** | `livekit-server` **1.13.11**, built from source (`livekit/livekit@0f22974`, Go toolchain auto-selected 1.26). `livekit-client` 2.24.0 and `livekit-server-sdk` 2.19.3 (`package.json`). Python `livekit` 1.2.0, `livekit-api` 1.2.2, `livekit-agents` 1.8.11, `livekit-plugins-silero` 1.8.11 (`services/livekit-agent/requirements.txt`). |
| Cloud vs self-hosted | **Decided: self-hosted for development** | There are no LiveKit Cloud credentials in this environment, so the fastest real route was a local server. For the iPhone, LiveKit Cloud is recommended (`deploy/voice/README.md`). |
| Authenticated token endpoint | **VERIFIED** (logic and a real server) / **BLOCKED** (real Supabase sign-in) | `POST /api/livekit/token`, `plugins/livekitApi.ts`. `tests/livekit-token.test.ts` (6 tests) covers: 503 without configuration, 401 without identity, room derived from the verified user, a grant for one room only, TTL ≤ 10 min, no admin rights, and the secret never in a response. Identity uses the existing Supabase check (`verifyRequestIdentity`). That couldn't run here: there is no Supabase URL in this environment, and the Supabase connector was disconnected. |
| Real room and participant connection | **VERIFIED** | Live test: the room was created with `maxParticipants` 3, and a Python RTC participant joined with the app-issued JWT (`roomSid RM_…`, CONNECTED). In the browser E2E, the session went from `connecting` to `connected` in 0.7 s. |
| Exact voice reference identified | **VERIFIED: one file** / **UNVERIFIED: "BEER voice" identity** | `public/audio/voice/lelu-voice-reference.m4a`: AAC-LC M4A, 44.1 kHz, stereo, 48.81 s, sha256 `9ac99650…a241ae`, committed in `62ad310`, readable. **None of the 27 branches, no commit and no file mentions "BEER"**. It's the only reference recording in the repository. See *Needs your confirmation* below. |
| Worker loads that reference, and every request uses it | **VERIFIED** | Worker `/health` → `reference.source = …/lelu-voice-reference.m4a`, the same sha256, the first 12.0 s at 24 kHz mono. `server.py` passes `reference_wav_path` on every generation. |
| Generated audio intelligible | **VERIFIED** | ASR read back exactly every sentence tested: worker, app route, streamed, agent over LiveKit, and received in the browser. |
| Generated audio consistent with the reference | **PARTIAL** | Speaker embeddings (ECAPA cosine, against held-out reference audio; see `docs/voice/evidence/voice-identity/`): real voice vs itself **0.771**; VoxCPM2 output **0.27–0.44**; received over LiveKit (Opus) **0.22**; a different speaker (ElevenLabs Jessica) **−0.06 to 0.01**. Conditioning clearly pulls toward her voice, but it isn't a close clone. No listening test was done. |
| App ↔ worker integration (WAV, stream, errors, timeouts) | **VERIFIED** | `GET /api/voice/vox/health` and `POST /api/voice/vox/speech` (`plugins/voxApi.ts`) go through `VoxcpmPool` and choose only READY workers. **WAV:** 4.48 s of audio, RTF 5.04. **Stream:** `audio/L16;rate=48000`, first byte 5.5 s of 23.9 s. **Cancellation:** the follow-up after an aborted stream synthesised immediately. **While loading:** 503 `no-ready-worker` with the state. `tests/voice-vox-routes.test.ts`: 6/6. |
| Worker restarts independently of LÉLU CORE | **VERIFIED** (container) | Worker stopped and started under a running app: the app kept serving, speech was refused honestly while loading, and the first request after READY returned 200. ASR: "I am back, and nothing else had to restart." |
| Full mic → LiveKit → agent → cognition → VoxCPM2 → LiveKit → user loop | **VERIFIED, simulated mic** / **NOT TESTED on a device** | `scripts/verify-livekit-voice-e2e.cjs` (iPhone 13 profile). Q1 timeline: heard at 52.4 s, reply 3.2 s later, audible 27.1 s after that (CPU synthesis), finished at 85.7 s. |
| Same cognition and context as text | **VERIFIED** | Transcripts go through `VoiceEngine.handleUserSpeech`, then `AIService.chat` with the active `MultiChatStore` conversation. There is no LLM client in the agent (`services/livekit-agent/agent.py`). |
| Text continuity after voice | **VERIFIED** | After ending voice, a question typed in the real composer was answered: *"You first asked me by voice, 'What is the capital of France?'"* That's one conversation of 6 alternating messages. |
| VAD and turn-taking | **VERIFIED** | Silero VAD in the agent: speech detected, end of turn detected, clicks under 0.3 s ignored. |
| STOP actually stops audio and generation | **VERIFIED** | **Agent level:** silent at the receiver 42 ms after STOP. **Browser:** the element muted at once, the agent's track silent 234 ms later, and the received audio ends mid-sentence (ASR: *"The ocean stretched out before her like a"*). Generation is aborted too: closing the stream ends the worker's generator. |
| Interruption / barge-in | **VERIFIED, slower than target (PARTIAL)** | Speaking over her stopped her **534 ms** after the overlapping speech began; the handoff targeted 300 ms. Silero needs about 0.5 s to call it speech. Barge-in also fired in a browser run. **Echo** (her own voice through a phone speaker) has **NOT been tested**. It relies on the browser's echo cancellation. |
| Mute / unmute | **NOT TESTED** | Implemented (`setMicMuted`, which calls `setMicrophoneEnabled`); no test toggled it. |
| Mic permission handling | **PARTIAL** | Errors are mapped through the existing `mapMediaError` (permission, insecure, no-device). The iOS audio unlock runs inside the tap, and an "Enable audio" button appears when Safari blocks playback. **Not exercised on Safari.** |
| Reconnect after connection loss | **VERIFIED** | `scripts/verify-livekit-reconnect.cjs`: the server was killed, the page *observed* the loss (`rejoining` ×4), and it was back and listening **8.1 s** later (6 s of that was the deliberate restart pause). A question asked after recovery was answered. |
| Persistent hosting | **BLOCKED** | No Contabo access from this container. The VPS 4 (8 GB) cannot load the worker. Units and topology are written (`deploy/voice/`) but **not deployed**. |
| Startup after host reboot | **BLOCKED** | Depends on the hosting above. |
| Real iPhone acceptance (15 steps) | **NOT TESTED** | No device, and no public HTTPS deployment for a phone to reach. |

## Needs your confirmation: which recording is the "BEER voice"?

I didn't substitute a voice. The worker uses the only reference recording in the repository, and nothing names it
"BEER":

| Candidate | What it is |
|---|---|
| `public/audio/voice/lelu-voice-reference.m4a` | **The only reference recording anywhere in the repo.** 48.81 s, iPhone-style M4A, created 2026-11-10 06:56:58Z, committed in `62ad310` "Add LÉLU voice reference audio for Freebuff". Currently loaded by the worker. |
| `docs/voice/evidence/*/tts-sample-*.mp3` | ElevenLabs output in the "Jessica" voice: generated audio, not a reference recording |

If the BEER voice is a different recording, it isn't in the repository. Add it and set `VOXCPM_REFERENCE_AUDIO`.
Then rerun `docs/voice/evidence/voice-identity/speaker_similarity.py`.

## Latency (CPU worker, measured in the iPhone-profile run)

| Stage | Q1 (short) | Q2 (long story) |
|---|---|---|
| End of speech → transcript | 0.7 s of silence ends the turn, then Groq Whisper 332–671 ms | same |
| Transcript → reply text (LÉLU cognition) | 3.2 s | 2.5 s |
| Reply → first audio (VoxCPM2, whole first sentence) | **27.1 s** | **69.6 s** |

Speech synthesis on CPU is the bottleneck: about 4–5× slower than real time. Streaming playback starved and
stuttered (a 3 s reply spread over 10 s), so the agent buffers each sentence before playing it. A GPU worker
(`LELU_AGENT_PLAYBACK=stream`) is what makes conversation natural.

## What the runs exposed (all fixed and committed)

1. **The dock invited speech before she could hear.** The agent subscribed to the mic about 14 s after joining,
   and the first question was lost. The agent now sends `listening`, and the page waits for it.
2. **A speech timeout cut sentences, and a cut stream looked like an empty success.** The timeout is now 90 s +
   1 s/char; a mid-stream failure destroys the response; and zero-sample speech is reported as an error.
3. **A stale `stopped` for a finished turn flipped a new reply's phase.** The agent no longer reports a stop that
   interrupted nothing, and the page ignores other turns' notices.
4. **The `workerctl` watchdog SIGTERMed a worker that was already stopping**, because it read `STOPPED` as an
   unfinished startup. It now guards startup only (verified: a stop after the window is `stopped`, rc 0).
5. **The access gate would have refused the agent in production.** Its token now opens exactly two POST routes
   (tests confirm nothing else).
6. **A reconnected session kept the old error text.** It's cleared on a successful join.
7. **The token TTL read `""` as 0.** It now defaults to 600 s.

## Environment findings that affect you

- **Your Fireworks account is suspended** (HTTP 412 on every call). LÉLU tries Fireworks first, so each turn lost
  about 9 s before falling back, and with conversation context turns ran past LÉLU's chain budget. The
  successful runs launched the dev server without `FIREWORKS_API_KEY`. That was an environment change only;
  nothing in the repo was changed.
- **The first model load after a container restore took 320 s, not 17 s.** The disk cache was cold and I/O
  pressure was 86–94%.
- **Headless rendering of the 3D scene starved WebRTC on 4 vCPUs** (connection drops, 52 s cognition). On a phone
  profile with the chat open, the scene isn't rendered, and everything was fast.

## How it starts

LÉLU's existing voice entry points (the composer's **Talk to LÉLU** mic, the navigator mic, holding the planet)
call `VoiceEngine.toggle()`. When the server reports LiveKit configured, that starts a LiveKit session; otherwise
it uses the browser voice as before.

While a session is live, a small dock appears above the composer with **Mute · Stop · End** (and **Enable audio**
if Safari blocks playback). It's hidden when LiveKit isn't configured.

## Reproduce (development container)

```bash
# 1. LiveKit server (self-hosted, loopback)
/home/user/livekit/bin/livekit-server --config .livekit/livekit.yaml
# 2. speech worker
python3 services/voxcpm/workerctl.py start --wait
# 3. app (LIVEKIT_* and LELU_VOICE_AGENT_TOKEN in the environment;
#    LELU_LIVEKIT_DEV_IDENTITY only for loopback development)
npx vite --host 127.0.0.1 --port 5173
# 4. agent
.venv-livekit-agent/bin/python services/livekit-agent/agent.py
# 5. tests
npx tsx --tsconfig tsconfig.test.json --import ./tests/support/ignore-css.mjs --test \
  tests/livekit-token.test.ts tests/voice-vox-routes.test.ts tests/access-gate.test.ts
node scripts/verify-livekit-voice-e2e.cjs <fake-mic.wav> <out>   # q1.wav + q2.wav with long silences
node scripts/verify-livekit-reconnect.cjs <mic.wav> <out>
```

Test status at commit: voice, LiveKit and gate suites **91 pass, 1 fail, 2 skipped**. The one failure,
`voice-continuity` "a streamed reply ends in listening/idle", **fails identically with canonical's
`VoiceEngine.ts` swapped in**, so it predates this work. `tsc -b --force` passes.

## Next mission

1. **Host it.**
   - Choose LiveKit Cloud (fastest for iPhone), or self-host on the VPS with TLS and TURN.
   - Put the VoxCPM2 worker on a GPU host (or a CPU host with ≥ 16 GB) behind an authenticated tunnel.
   - Install `deploy/voice/*.service`, and set the environment names in `deploy/voice/README.md`.
2. **Fix the providers.** Restore Fireworks billing, or take it off the front of LÉLU's routing.
3. **Confirm the BEER voice** (above).
4. **Run the 15-step iPhone acceptance** against the hosted URL, with a real microphone and speaker. Pay
   particular attention to echo-triggered barge-in and the Safari audio unlock.
