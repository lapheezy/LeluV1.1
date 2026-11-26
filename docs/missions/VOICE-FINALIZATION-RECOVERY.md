# Voice finalization — WP01 recovery inventory

Date 2026-11-26 · branch `claude/lelu-voice-finalization-go9hrm` (base `8785e73b`) · by Claude (coding assistant)

## How this was searched

| Where | What was done | Result |
|---|---|---|
| Local branches | `git branch -a` | `claude/lelu-voice-finalization-go9hrm`, `integration/lelu-four-workforce-consolidation` |
| Remote branches | `git ls-remote origin` (101 refs: 76 heads + PR refs), then `git fetch origin '+refs/heads/*:refs/remotes/origin/*' --depth=300` | every head fetched |
| Unmerged voice work | for every remote head: `git log HEAD..<branch> -- services/voxcpm services/mossnano services/livekit-agent plugins/voiceApi.ts plugins/voxApi.ts plugins/livekitApi.ts plugins/voxcpmApi.ts src/core/voice deploy/voice deploy/voxcpm` | **none**: no branch has voice commits that HEAD lacks |
| Named voice branches | `m22.6/voice-runtime-release-qualification` `afcfd8c7`, `m22.7/live-voice-qualification` `8fe50238`, `m22.9/persistent-voice-runtime` `448770bd`, `m23.0/embodied-conversational-experience` `d2131ea7`, `claude/lelu-worker-recovery-4fio20` `b00cfefc`, `claude/lelu-voice-https-production-lvv519` `8785e73b`, `freebuff/44c122e…` `157d9dfb` | all are ancestors of HEAD (`git merge-base --is-ancestor`) |
| Stashes / worktrees | `git stash list`, `git worktree list` | 0 stashes, 1 worktree (this one) |
| Uncommitted / untracked | `git status` at start | clean |
| History search | `git log --all -i --grep=voxcpm`, `-S voxcpm`, `--name-only -- '*voxcpm*'` | see the table of commits below |
| Model directories | `~/.cache/huggingface`, `.venv-voxcpm`, `.voxcpm` | **absent** in this container at start (fresh clone) |
| Reports | `services/voxcpm/README.md`, `MOSS-INTEGRATION-DECISION.md`, `CPU-TTS-BACKEND-COMPARISON.md`, `LIVEKIT-VOICE-ACCEPTANCE-REPORT.md`, `docs/voice/LELU_VOX_RECOVERY_LEDGER.md`, `docs/deploy/MISSION-1-VOICE-HTTPS-REPORT.md`, `MISSION-22.6…23.0/*` | read |

**The historical claim "the VoxCPM2 sidecar code was not committed" is no longer true.** It was committed on
2026-11-12/13 (`14cf7ec7` … `56a47c18`) and is in HEAD under `services/voxcpm/`.

## VoxCPM2 history (all in HEAD)

| Commit | Date | What |
|---|---|---|
| `de4a2653` | 11-10 | First VoxCPM2 route (`plugins/voxcpmApi.ts`, `deploy/voxcpm/*`) with a consent gate `LELU_VOICE_CONSENT_ATTESTED`. **Superseded** in merge `5e938eed` (11-15): "a second VoxCPM2 route beside the canonical one… Mounting both would be two voice systems." Its files are not in HEAD; the consent gate was explicitly left open as "worth a deliberate decision". |
| `62ad3106` | 11-10 | Reference clip `public/audio/voice/lelu-voice-reference.m4a` (no provenance or consent note) |
| `14cf7ec7` | 11-12 | `services/voxcpm/` sidecar: server, bootstrap, install, selfcheck |
| `fdad947e` | 11-12 | CPU load cost measured (`probe_memory.py`) |
| `36bf4e22` | 11-12 | Single-instance worker lifecycle (`workerctl.py`), READY only after a self-test |
| `7e76c1a7` | 11-12 | Pool picks a worker only once it has proven it can speak |
| `56a47c18` | 11-13 | App routes `/api/voice/vox/health|speech` → worker, streaming + cancellable |
| `d5591cf6` | 11-13 | Fixes from the first browser end-to-end runs |
| `35f6e737` `b00cfefc` | 11-13 | MOSS-TTS-Nano added behind the same contract, opt-in; "VoxCPM2 stays default" |
| `322900be` | 11-24 | `/api/voice/tts` (the route the page uses) speaks through the configured worker |

## Component inventory and classification

Classes: **1** working · **2** implemented but disconnected · **3** partial · **4** present but broken · **5** discussed,
never implemented · **6** stranded on another branch · **7** missing. "Before" is the state found at `8785e73b`;
"Now" is after this mission (evidence in `VOICE-VOXCPM-FINALIZATION.md`).

| Component | Location | Before | Now |
|---|---|---|---|
| Voice engine (mic, VAD on the audio thread, record → transcribe → `AIService.chat` → speak, barge-in, echo guard) | `src/core/voice/VoiceEngine.ts` (3460 lines), `vadWorklet.ts`, `audioRecorder.ts` | 1 | 1 |
| Mic button in every chat composer | `src/app/scene/genesis/chat/universe/VoiceToggle.tsx` | 1 | 1, plus a real-state label and **Stop speaking** |
| App-level bridge (voice utterances into the same conversation) | `src/app/scene/genesis/VoiceBridge.tsx` | 1 | 1 |
| STT: Groq Whisper through the server broker (key server-side) | `transcriptionTransport.ts`, `/api/model/groq/audio/transcriptions` | 1 | 1; prompt echo on noise filtered (was **4**: noise became a user turn) |
| STT: ElevenLabs Scribe | `elevenLabsStt.ts` | 1 but paid; refused without spend authorization | unchanged, not used |
| TTS route the page calls | `plugins/voiceApi.ts` `/api/voice/tts` | 1 for MOSS / ElevenLabs / Piper | 1 for VoxCPM2 too |
| VoxCPM2 sidecar | `services/voxcpm/server.py` | **3**: never run end to end in the app; downloads 5 GB silently if weights are missing; no memory guard; non-FIFO queue; queued work not cancellable | **1** on CPU (slow; see report) |
| VoxCPM2 weights | Hugging Face `openbmb/VoxCPM2` (Apache-2.0, ungated) | **7** in this container | fetched by `bootstrap.py`, 4.96 GB, verified |
| Worker pool / failover | `src/core/voice/gpuWorkers.ts` | 1 | 1, now reports the worker's measured RTF |
| Page TTS queue and player | `src/core/voice/elevenLabsTts.ts` | **4** with a slow worker: fixed 15 s header timeout aborted every VoxCPM2 sentence; unbounded look-ahead caused 503 and a voice switch mid-reply; STOP left queued requests running | 1 |
| MOSS-TTS-Nano worker (fast CPU voice) | `services/mossnano/` | 1 (opt-in; what the Contabo VPS runs) | 1, untouched except the reference path |
| LiveKit transport and agent | `plugins/livekitApi.ts`, `src/core/voice/livekitTransport.ts`, `services/livekit-agent/`, `LivekitVoiceDock.tsx` | 2: implemented and tested in earlier missions, **not configured** here (`/api/livekit/status` → `{"configured":false}`), and the engine falls back to the direct path | unchanged; deliberately not configured (no second transport needed) |
| ElevenLabs TTS | `elevenLabsTts.ts` + route | 1 but paid | unchanged, refused without spend authorization |
| Piper (local CPU voice) | `plugins/persistentPiper.ts` | 2: not installed here | unchanged |
| Reference clip | was `public/audio/voice/lelu-voice-reference.m4a` | **4 for privacy**: served by the app to any browser (`GET /audio/voice/lelu-voice-reference.m4a` → 200, 696,337 bytes) | moved to `services/voice-reference/` (no longer served); the **repository is public** on GitHub, so it is still public there |
| Voice-cloning consent gate | `de4a2653` only | 6, superseded | still absent; recorded as an owner decision |
| Microphone in a cross-origin iframe | preview hosts | historical: missing `allow="microphone"` | production sends `X-Frame-Options: SAMEORIGIN` (cannot be framed); inside such a frame the error now says so instead of "please allow mic access" |
| HTTPS on the production IP (required for `getUserMedia`) | `deploy/contabo/https-ip.sh`, workflow | 3: tooling ready, not deployed (Mission 1 report) | unchanged: deployment needs owner authorization |
| Acceptance harness | `scripts/verify-voice-e2e.cjs`, `MISSION-22.7/scripts/*` | 1 (older UI) | new `scripts/verify-voice-finalization.cjs` drives the current UI |
| Local STT (on-device or server Whisper) | — | **5** | still 5: Groq's free tier is the transcriber; see the report's "Remaining blockers" |

## Recovery decisions

1. **Nothing had to be recovered from another branch**: every voice branch is merged, and the only unmerged VoxCPM2
   code (`de4a2653`) was deliberately superseded by the canonical worker. Re-mounting it would create the second voice
   system the constraints forbid.
2. **Reuse `services/voxcpm` + `VoxcpmPool` + `/api/voice/tts` as they are**, and fix what running them for real in
   the app exposed. No new route, provider registry, transport or chat path.
3. **LiveKit stays unconfigured.** The direct browser path (getUserMedia → recorder → broker → `/api/voice/tts` →
   player) carries the whole loop. LiveKit is not marked complete because its packages exist.
4. **The reference clip leaves `public/`**, with a fallback in both workers for an unmoved checkout. Making it truly
   private (the repository is public) and recording consent are owner decisions.
