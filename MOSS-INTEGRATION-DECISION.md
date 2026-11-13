# MOSS-TTS-Nano: evaluation and integration decision

**Date:** 2026-11-13 · **Branch:** `claude/lelu-worker-recovery-4fio20` · **Local commits only: not pushed, not merged.**
**Continues:** `CPU-TTS-BACKEND-COMPARISON.md` (benchmark, `c91ef21`).

## Decision

**VoxCPM2 stays LÉLU's voice. MOSS-TTS-Nano is integrated as an *opt-in* worker behind the existing speech
interface, and it is not the default.**

The evaluation's own gates didn't pass:

1. **VPS acceptance: BLOCKED.** This container has no access to the Contabo VPS: no SSH key, host, credential or
   connected computer. None of the local results below stand in for VPS acceptance.
2. **Listening comparison: BLOCKED.** I can't listen. A blind A/B pack is ready for you (§4).
3. **Objective quality favours VoxCPM2.** On the same 8 sentences:
   - **word errors:** MOSS 11.1%, VoxCPM2 3.7%. About 1 MOSS utterance in 5 contains a real content error, e.g.
     *"…shared it with your project folder"* → *"…share it with your powder?"*;
   - **similarity to her voice:** MOSS median 0.346, VoxCPM2 0.425.

What MOSS wins decisively, measured locally: **latency**. Her voice is audible **1.2–1.4 s** after LÉLU's reply
with no stalls, against **27–70 s** for VoxCPM2. It needs **1.6–1.9 GB** of RAM against 6.6 GB plus an 11 GiB
load peak. It works through the whole LiveKit pipeline, STOP, barge-in, reconnect, restart and rollback included.

**Switching is a configuration change**, and so is undoing it (§5). The choice to make, once the VPS run and your
listening are done, is a fast but sometimes-wrong voice against a slow but accurate one.

## Status by request item

| # | Item | Status | Evidence |
|---|---|---|---|
| 1 | Recover harness, measurements, transcripts, samples | **VERIFIED** | `c91ef21` intact; `docs/voice/evidence/cpu-tts-benchmark/` (harness, 13 raw runs, ASR, similarity, samples); models and environment present |
| 2 | Benchmark on the Contabo VPS | **BLOCKED** | No access route from this container (checked: `~/.ssh` empty, no host or credential variables, no IP in the deploy docs, `list_computer_folders` empty) |
| 3 | VPS CPU, RAM, latency, RTF, streaming, load behaviour | **BLOCKED on the VPS** / measured locally (below, labelled local) | Run the commands in §6 on the VPS |
| 4 | Listening comparison against VoxCPM2 | **BLOCKED** (needs a human) / **pack ready** | `docs/voice/listening-pack/`: 8 sentences × A/B, loudness-matched, random order, key separate |
| 5 | Name pronunciation and intelligibility | **Investigated locally; PARTIAL** | Respelling fixes stability (§3). Whether "Lay-loo" is *how her name should sound* needs your ear |
| 6 | Worker restart, cancellation, STOP, barge-in, continuity | **VERIFIED locally** (continuity **PARTIAL**) | §2 |
| 7 | Integrate MOSS behind the existing worker interface | **DONE as opt-in; NOT the default** | `services/mossnano/`; the app and agent are unchanged and select it by configuration |
| 8 | VoxCPM2 kept as a tested rollback | **VERIFIED locally**, with an OOM finding | §5 |
| 9 | End-to-end voice acceptance through LiveKit | **VERIFIED locally, simulated microphone** / **NOT TESTED on a real device** | §2 |

## 1. What was built (opt-in, behind the existing contract)

- **`services/mossnano/server.py`.** The same HTTP contract as `services/voxcpm/server.py`: `GET /health`
  (state/ready/selftest) and `POST /v1/audio/speech` (WAV, or chunked PCM16 48 kHz). The app's pool and the LiveKit
  agent use it unchanged. Additions over upstream:
  - ONNX Runtime without spinning or the memory arena;
  - the reference encoded once per worker start;
  - READY only after a real self-test;
  - one generation at a time, with a bounded queue;
  - generation aborted when the client disconnects;
  - the name respelling (§3);
  - a **silence gate** that caps the dead air the model generates (measured 1.8 s between sentences, now 0.3 s)
    without delaying any audio.
- **`services/mossnano/install.sh`.** Pinned code `OpenMOSS/MOSS-TTS-Nano@8b7bcc9` and the ungated weights,
  downloaded **anonymously** (no token, no account). 16 s with a warm cache. 803 MB of code and weights plus a
  1.1 GB environment.
- **`services/voxcpm/workerctl.py`** can supervise either worker (`VOXCPM_SERVER`, `VOXCPM_READY_MARKER`).
- **`services/livekit-agent/agent.py`:**
  - `LELU_AGENT_PREBUFFER_MS`: a jitter buffer for stream playback;
  - per-reply **stall and underrun accounting** in its log;
  - **rejoins a room by itself** after an unexpected drop (§2, a bug found in this run).

## 2. Local acceptance results with MOSS (container: 4 vCPU Xeon, shared with app, agent and LiveKit; NOT the VPS)

| Check | Result |
|---|---|
| Worker start → READY | 12.1 s cold (load 8.9 s); restart 9.4 s. RSS 1.57–1.74 GiB, peak 2.31–2.45 GiB |
| App route `/api/voice/vox/speech` | WAV: first audio 275–444 ms, RTF 0.89–0.95. Stream: first byte **286 ms**, 40 chunks |
| Cancellation through the app | Long stream aborted at its first chunk; the next request finished in 1.07 s, all its own synthesis (no queueing); the worker logged `stream_cancelled` |
| Over LiveKit: reply → audible | **0.30–0.35 s** with no prebuffer, but **454–857 ms of stalls per reply** (shared CPU, RTF about 1) |
| …with `LELU_AGENT_PREBUFFER_MS=1000` | **1.2–1.3 s**, **0 ms stall in 4 of 5 replies** (74 ms in one) |
| STOP (agent level) | nothing audible after STOP was sent |
| Barge-in | her audio ended **174 ms** after overlapping speech began; the interruption became the next turn |
| Browser E2E (iPhone 13 profile, **WAV as microphone**) | Q1 heard, cognition replied in 3.1 s, **audible 1.4 s later** (VoxCPM2: 27.1 s). STOP in a long story: silent **102 ms** after the tap |
| Text continuity | **PARTIAL.** The typed follow-up landed in the **same conversation** as both voice turns (6 messages), but LÉLU could not answer it: OpenRouter **402** (out of credits), Groq **413** (free-tier request size), Cerebras **401** (key), Fireworks suspended. Provider limits, not voice |
| Reconnect (LiveKit server killed) | Loss observed on LiveKit's own resume path. **Bug found:** that path never re-dispatched the agent, so the user was "connected" with nobody listening. **Fixed:** the agent now rejoins by itself, here on attempt 3. Listening again **16.1 s** after the kill; a question asked afterwards was answered |
| Worker restart under a live app | `503 no-ready-worker` while it reloaded, READY in 9.4 s, then 200 with nothing else restarted. The pool's 15 s failure cooldown can delay noticing recovery by up to 15 s |

## 3. Her name

Written "Lélu", MOSS looped (*"Lélu, Lélu, Lélu, Lélu, Lélu, Lélu."*) or garbled the sentence in half the clips.
I tested 7 spellings × 2 sentences × 4 seeds, judged by ASR with a name hint (as production speech-to-text is):

| Spelling | Name recognised | Rest of sentence exact | Repetition |
|---|---|---|---|
| Lélu (as written) | 7/8 | 4/8 | 2/8 |
| Lelu | 7/8 | 6/8 | 0/8 |
| LÉLU | 5/8 | 3/8 | 1/8 |
| **Lay-loo** | **8/8** | **8/8** | **0/8** |
| Laylu | 6/8 | 6/8 | 0/8 |
| Leh-loo | 8/8 | 7/8 | 0/8 |
| Lélou | 4/8 | 2/8 | 1/8 |

The worker therefore says "Lay-loo" (configurable with `MOSS_LEXICON`). **This proves the name is stable and
intelligible, not that it's how she should sound.** That is a question on the rating sheet.

## 4. Quality, and the listening pack

**On the pack's 8 sentences** (ASR word error rate with digits and compound words normalised; ECAPA similarity
against held-out reference audio):

| | Word error rate | Exact | Name recognised | Median similarity |
|---|---|---|---|---|
| VoxCPM2 | **3.7%** | 6/8 | 2/2 | **0.425** |
| MOSS-TTS-Nano | 11.1% | 5/8 | 2/2 | 0.346 |
| (real voice vs itself) | | | | 0.771 |

**MOSS sampling modes** (10 replies): the default `fixed` gave 2.9% content WER; `full` 5.8%; `greedy` **64%**
(it truncates, e.g. "Off. Off."). Keep the default.

**Please listen:** `docs/voice/listening-pack/RATING-SHEET.md`. Rate each pair for "sounds like her",
"natural" and "name right", plus how her name *should* sound. Only then open `ANSWER-KEY.json`.

## 5. Switching and rollback (configuration only)

| | MOSS (opt-in) | VoxCPM2 (default / rollback) |
|---|---|---|
| Worker | `python3 services/voxcpm/workerctl.py start` with `VOXCPM_SERVER=services/mossnano/server.py VOXCPM_PYTHON=.venv-mossnano/bin/python VOXCPM_READY_MARKER=.mossnano/state/model-ready.json VOXCPM_REQUIRED_GIB=3 VOXCPM_PORT=8789 VOXCPM_RUN_DIR=.mossnano/run` | `python3 services/voxcpm/workerctl.py start` |
| App | `VOXCPM_BASE_URL=http://127.0.0.1:8789` | `VOXCPM_BASE_URL=http://127.0.0.1:8788` |
| Agent | `LELU_AGENT_PLAYBACK=stream LELU_AGENT_PREBUFFER_MS=1000` | `LELU_AGENT_PLAYBACK=sentence` |

**The rollback drill (local) passed.** The app and agent were switched back by configuration, and a reply was
spoken over LiveKit through VoxCPM2: ASR exact, 0 stalls, audible 29.4 s after the reply.

**Finding during the drill:** the first VoxCPM2 load was **OOM-killed** although the preflight saw 12.12 GiB
available against the 11.5 GiB threshold. `workerctl` classified it correctly (`oom_killed`, signal 9), and the app,
agent, LiveKit and MOSS all survived. The VoxCPM2 preflight default is now **12.5 GiB**. A clean retry, with MOSS
stopped, loaded fine (265 s from cold disk).

**This means VoxCPM2 is not a usable rollback on the 8 GB VPS at all**, so rollback there would need VoxCPM2 on
another host.

## 6. To finish the VPS acceptance (someone with access)

```bash
# on the VPS, in the app checkout
bash services/mossnano/install.sh                      # anonymous, no secrets
. services/mossnano/workerctl.env                     # the variables in §5
python3 services/voxcpm/workerctl.py start --wait
# CPU/RAM/latency/RTF/streaming, idle and under LÉLU load:
.venv-mossnano/bin/python docs/voice/evidence/cpu-tts-benchmark/moss_bench.py --repo .mossnano/src \
  --ref <12 s WAV of the reference> --out /tmp/moss --threads 2 --no-spin --lean --mode full
.venv-mossnano/bin/python docs/voice/evidence/cpu-tts-benchmark/stall_probe.py http://127.0.0.1:8789/v1/audio/speech
```

Then repeat §2 against the VPS URL, and on a real iPhone (real microphone and speaker): echo-triggered barge-in,
the Safari audio unlock, and the 15 steps.

## 7. Open issues outside the voice code

- **Cognition providers are failing on LÉLU's large tool-carrying requests:** OpenRouter out of credits (402),
  Groq free-tier size limit (413), Cerebras invalid key (401), Fireworks suspended. Voice turns still worked
  because they are smaller. Typed follow-ups did not.
- **The VoxCPM2 preflight margin** is raised (above), but VoxCPM2 can't run on an 8 GB VPS in any case.
