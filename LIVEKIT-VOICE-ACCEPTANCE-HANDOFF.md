# LiveKit voice acceptance: handoff

**Prepared:** 2026-11-13, on `claude/lelu-worker-recovery-4fio20` (canonical base `098dd3e`).
**Scope:** an inventory and an acceptance plan only. **No LiveKit work was started.** Every statement below is labelled with
how it was established: by reading code, by a measured run, or as a proposal.

## 0. The headline

**LÉLU has no LiveKit implementation.** Every branch was searched (27 remote refs, excluding docs):

- no `livekit-client` / `livekit-server-sdk` / `@livekit/*` dependency;
- no `livekit` Python package;
- no token endpoint;
- no agent worker;
- no room code.

The word appears in code only in two places:

- `src/core/operational-intelligence/repositories.ts:402–430`. This is a catalog entry, not code. It records
  `livekit`: "No media server is deployed, so transport is NOT_CONFIGURED", and `livekit-agents`: "Not adopted: it would add
  a second agent runtime".
- `tests/agentic-live.test.ts:50`, where `livekit` is used as a test ID string.

The next mission is therefore a **build-and-accept** mission, not just acceptance.

### Earlier architecture decisions

These are binding unless the owner changes them:

| Source | Decision |
|---|---|
| `docs/voice/MISSION_10_VOICE_MOBILE_MULTIMODAL_REPORT.md:44` | `livekit/agents` **rejected for the web path**: "cognition runs in the page". |
| `docs/audit/INTEGRATION_CONFLICT_REPORT.md:19` | "LiveKit is **transport only**. LÉLU's cognition and SHAMAN remain the only orchestration." |
| `docs/architecture/LELU_UPGRADE_ARCHITECTURE.md:154,166` | LiveKit is deliberately not wired into chat; it lives behind the Device Bridge as an optional `MediaGateway`. |
| `docs/audit/INTEGRATION_CONFLICT_REPORT.md:108` | Open question: **will the owner host a LiveKit server (and TURN)?** It must be answered before any real media test. |

**The owner needs to decide one thing before building.** The planned pipeline (Silero VAD → Groq Whisper → cognition → VoxCPM2
→ LiveKit playback) puts turn-taking in a server-side agent. That reverses the Mission 10 decision. It is acceptable only if
the agent stays transport-only:

- it calls LÉLU's existing cognition (`AIService.chat` and the model broker);
- it never becomes a second brain;
- it never duplicates `VoiceEngine`'s barge-in and turn rules.

## 1. What exists today (read from code)

| Piece | Where | State |
|---|---|---|
| Voice engine (mic, VAD, STT routing, barge-in, echo check) | `src/core/voice/VoiceEngine.ts` (singleton) | Working in the browser. One `getUserMedia({audio:true})` call (around line 628). |
| VAD | `src/core/voice/vadWorklet.ts` | **Energy-based**: noise floor from the first 300 ms, speech after 150 ms above it, end of turn after 900 ms below it, 20 s cap. It runs in an AudioWorklet. **Not Silero.** |
| Groq Whisper STT | `src/core/voice/transcriptionTransport.ts` → `/api/model/groq/…` (server broker) | `whisper-large-v3-turbo`, with a name prompt for "Lélu". **The key stays on the server**; the broker attaches it. |
| ElevenLabs STT/TTS | `src/core/voice/elevenLabs{Stt,Tts}.ts`, `plugins/voiceApi.ts` (`/api/voice/stt`, `/api/voice/tts`, `/api/voice/status`, `/api/voice/resources*`) | Live; a key ring with quota handling. |
| VoxCPM2 worker | `services/voxcpm/` (`server.py`, `workerctl.py`), pool in `src/core/voice/gpuWorkers.ts` | Verified on CPU in a cloud container (see `WORKER-RESOURCE-RECOVERY-REPORT.md`). **Not routed from the app yet.** |
| Fake-mic browser harness | `scripts/verify-voice-e2e.cjs` | Chromium with `--use-fake-ui-for-media-stream --use-fake-device-for-media-stream --use-file-for-fake-audio-capture=<wav>` |

## 2. Token endpoint and security limitations

**There is no token endpoint.** The following is a proposal, not something that exists.

- **Server-side only.** Add it as a route in the existing plugin and server pattern (as `plugins/voiceApi.ts` is registered in
  both `vite.config.ts` and `server.ts`). Do not create a new server.
- **Authenticate first.** Derive the identity from the existing Supabase session on the server. Never accept an identity from
  the request body.
- **Room isolation.** Derive the room name on the server from the authenticated user ID, for example `lelu-<uuid>`. The grant
  allows `roomJoin` for **that room only**, `canPublish` (microphone) and `canSubscribe`, with a short TTL (≤ 10 min) and
  refresh on reconnect. Reject any client-supplied room name that does not match.
- **Secrets never reach the page.**
  - `plugins/runtimeKeyBridge.ts:95–118` states the rule: anything in `BRIDGED_KEYS` is inlined into the HTML as
    `window.__LELU_*__` and ships in the Android bundle. **Never add a LiveKit key or secret there.**
  - **Never use a `VITE_` / `NEXT_PUBLIC_` prefix for them.** `vite.config.ts` sets `envPrefix: ["VITE_", "NEXT_PUBLIC_"]`.
  - The browser receives only the signed JWT and the `LIVEKIT_URL`.
- **Limitations to accept or solve:**
  - Without a hosted LiveKit server (self-hosted or LiveKit Cloud) and TURN, nothing can connect.
  - Rate-limit token issuance per user.
  - A token log must not record the JWT.

## 3. Required project secrets

| Name | Where | Exists today? |
|---|---|---|
| `LIVEKIT_URL` (`wss://…`) | server; also sent to the browser (not a secret) | **No** |
| `LIVEKIT_API_KEY` | server only | **No** |
| `LIVEKIT_API_SECRET` | server only, **never `VITE_`** | **No** |
| `GROQ_API_KEY` / `VITE_GROQ_API_KEY` (Groq1–3 ring) | server (broker) | Yes (`ENV_VARS.md:18,435`, `plugins/modelApi.ts:79`) |
| Supabase URL and publishable key; service role on the server only | as today | Yes |
| `VOXCPM_BASE_URL` + `VOXCPM_TOKEN`, or `VOXCPM_WORKERS` (JSON) | server | Code exists; **no hosted worker yet** |
| `VOICE_PROVIDER` (`voxcpm` / `elevenlabs` / `auto`) | server | Code exists (`gpuWorkers.ts:416`) |

## 4. LiveKit agent startup instructions

**There is no agent to start.** Proposed shape, unverified:

- A Python worker using `livekit-agents` with the Silero plugin, run as its own process. It could live in
  `services/livekit-agent/`, next to `services/voxcpm/`.
- Started by a supervisor (systemd or the `workerctl.py` pattern) with:
  - `LIVEKIT_URL`, `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET`;
  - LÉLU's server base URL, for the broker and cognition;
  - the VoxCPM worker URL and token.
- It joins only the rooms the token endpoint names, and does three things:
  - subscribes to the user's microphone track;
  - runs Silero VAD on it;
  - publishes one audio track back.
- Pin versions on first install and record a `requirements.lock`, as `services/voxcpm/install.sh` does.
- Check the exact CLI and API against the version you install; nothing about it was run here.

## 5. VOX worker dependency (measured)

| Fact | Value |
|---|---|
| Contract | `GET /health` (`state`, `ready`) · `POST /v1/audio/speech` (WAV, or a chunked PCM16 stream with `stream: true` + `response_format: "pcm"`) · bearer `VOXCPM_TOKEN` |
| Output | 48 kHz mono, which matches WebRTC/Opus 48 kHz with no resampling |
| Speed on CPU (4 vCPU with AMX-BF16) | **RTF 4–5**: a 2.5 s reply takes about 12 s. **Not usable for live conversation.** |
| Cold start to READY | about 29 s; peak 11.1 GiB RAM; resident 6.6 GiB |
| Streaming endpoint | present in `server.py`, **not exercised in the recovery mission (UNVERIFIED)** |

**Consequence:** live LiveKit playback through VoxCPM2 needs a GPU worker, or a streaming path whose first chunk arrives fast
enough. Measure the time to the first chunk before building on it. Until then, a fallback is mandatory: ElevenLabs, then the
browser voice, through the existing `VOICE_PROVIDER=auto`.

## 6. Existing `VoiceEngine` integration points

- **STT:** VoiceEngine → ElevenLabs Scribe (`/api/voice/stt`) first, then the Groq Whisper fallback through the broker. A
  LiveKit agent should reuse **the same broker route** for Groq Whisper and not hold its own Groq key path.
- **Cognition:** replies go through LÉLU's `AIService.chat` and the model broker. The agent must call that and must not
  instantiate its own LLM client.
- **Barge-in and echo:** `isBargeIn()` (`VoiceEngine.ts:363`) and the echo check by "what she said". The rule is: two or more
  words that are not her own voice. Keep **one** definition; don't fork it into the agent.
- **TTS:** `elevenLabsTts.speakText` today. The pool route to VoxCPM2 (README steps 3–5) is still unbuilt.

## 7. Microphone permission findings (from code)

`VoiceEngine` classifies microphone failures. These are fatal and don't retry: `permission`, `insecure`, `no-device`,
`unsupported`, `blocked-embed` (`VoiceEngine.ts:356`).

- **Insecure context:** `!window.isSecureContext` produces "Microphone requires HTTPS". LiveKit has the same requirement.
- **Permission denied:** "Microphone permission denied" (`permission-denied` maps to `permission`). The UI must send the user
  to re-grant; retrying does nothing.
- **Embedded frames:** an iframe without `allow="microphone"` is reported as `blocked-embed`.
- **Single stream:** one `MediaStream`, with no duplicate `getUserMedia`. A LiveKit `LocalAudioTrack` must reuse or replace
  that stream rather than open a second one. Otherwise there are two mics and a double-permission prompt on iOS.

## 8. Known cloud-browser limitations (this environment)

- **No real microphone or speaker.** Headless Chromium has no audio device. Capture can only be tested with the fake-device
  flags (§1) and a WAV fed in. Playback can only be verified by bytes, track events and an ASR round-trip, never by ear.
- **WebRTC egress is UNVERIFIED.** Outbound traffic goes through an HTTPS proxy; UDP media to a LiveKit or TURN server may be
  blocked. Test TCP/TLS (443) TURN fallback first. If it fails, real-media tests must run on a device or a VM with open egress.
- **Containers are ephemeral.** The VoxCPM worker survives turns but not a container reclaim (measured). An agent and worker
  hosted in a session container are only test fixtures.
- **Real microphone acceptance needs a human on a real phone or desktop.** It cannot be claimed from this container.

## 9. End-to-end acceptance tests still outstanding

Each test passes only on the observable evidence listed. A mock does not count.

| # | Test | Pass criteria |
|---|---|---|
| 1 | Authenticated token issuance | Unauthenticated request → 401. An authenticated one → JWT whose decoded grant names only `lelu-<own uuid>`, TTL ≤ 10 min. No secret in the response, the logs or the page source. |
| 2 | Room isolation | User A's token cannot join user B's room (server refuses). Two concurrent users never receive each other's tracks. |
| 3 | LiveKit connection | The browser reaches `connected` against the hosted server, through TURN/TLS if UDP is blocked. Reconnect after a network drop takes < 10 s. |
| 4 | Real microphone capture | On a real device, the mic track is published and server-side audio levels are non-zero. One `getUserMedia` only. Denial maps to `permission`. |
| 5 | Silero VAD | On a recorded utterance, the start and end of speech fall within ±200 ms of the labelled boundaries. Silence produces no turn. Background noise produces no false turn. |
| 6 | Groq Whisper transcription | Through the broker: transcript WER below the agreed threshold on a fixed clip, including the name "Lélu". The Groq key is never in the browser. |
| 7 | LÉLU cognition | The transcript reaches `AIService.chat` through the existing broker. The reply is attributable in the logs to the existing orchestration, with no second LLM client. |
| 8 | VOX/VoxCPM2 speech | The reply is synthesised by a READY worker, and an ASR round-trip matches the reply text. Time to first audio is measured. Fallback to ElevenLabs is observed when the worker is not READY. |
| 9 | LiveKit audio playback | The agent's track is received in the browser and the decoded audio passes an ASR round-trip. Lip-sync and avatar events still fire. |
| 10 | Interruption, reconnection, recovery | Speaking over her stops playback within 300 ms (`isBargeIn` rule). A dropped connection resumes the same room and the same conversation. A worker restart mid-session falls back, then recovers. |

## 10. Prerequisites for the next mission

1. Owner decision on §0: agent-side turn-taking versus in-page, and who hosts LiveKit and TURN.
2. A LiveKit server (Cloud or self-hosted), with `LIVEKIT_URL`, `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET` in the project
   secrets, server-only.
3. A hosted VoxCPM2 worker on persistent infrastructure (GPU strongly preferred), with `VOXCPM_BASE_URL` and `VOXCPM_TOKEN`.
4. A real device available for tests 4, 9 and 10.
