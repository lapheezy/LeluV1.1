# LÉLU worker recovery and resource forensics report

**Date:** 2026-11-12 · **Repository:** `lapheezy/LeluV1.1` · **Recovery branch:** `claude/lelu-worker-recovery-4fio20`
**Starting commit:** `098dd3e` (canonical tip, verified) · **Not pushed, not merged.**

## Verdict

**Yes, within one cloud session. No, across sessions, on this platform.**

LÉLU's intended voice model (`openbmb/VoxCPM2`, unchanged, bf16 as published) now runs through a managed worker on this
container. The worker:

- enforces a single instance and owns its PIDs;
- refuses to load when memory is short;
- reaches READY only after a real generation;
- produced speech that an independent ASR model transcribed word for word.

It survives individual tool calls and a turn boundary (§9). It **cannot** outlive the cloud container. When the container is
reclaimed, the process, the 5.1 GB weight cache and the 2.4 GB Python environment all go with it. A worker that lasts beyond
sessions needs a dedicated runtime (§11–12).

The repeated failure was not a mystery bug. **Loading VoxCPM2 on CPU peaks at about 11 GiB.** That peak comes from
the library building all 2.29 B parameters in fp32 before casting them. The earlier session loaded the model on a shared
~15 GB machine where another chat's worker already held about 5 GB. There was no memory check, and the load ran inside an
interactive turn.

---

## 1. Repository and Git baseline

| Item | Finding |
|---|---|
| Remote | `https://github.com/lapheezy/LeluV1.1` ✔ |
| Canonical `integration/lelu-four-workforce-consolidation` | remote tip **`098dd3e`**. It has not advanced, and it was never modified here. |
| `3d8671e..098dd3e` | 11 commits; `3d8671e` is an ancestor of `098dd3e`. Includes `14cf7ec` (VoxCPM2 sidecar, by Codebuff) and the voice/ElevenLabs work. |
| Container at start | fresh (uptime 26 s), clean tree, no stashes, local `claude/lelu-worker-recovery-4fio20` = `claude/master-integration` = `fd649b9` |
| `fd649b9` vs canonical | ancestor of canonical (0 ahead, 52 behind), so the recovery branch was **fast-forwarded** to `098dd3e` (no history rewritten) |
| Remote refs inspected | 27 branches (all fetched) |

Commits on the recovery branch, on top of `098dd3e`:

| Commit | What it does |
|---|---|
| `fdad947` | memory probe and first measured inference (evidence) |
| `36bf4e2` | worker manager (`workerctl.py`), server lifecycle and self-test |
| `7e76c1a` | pool selects a worker only when it is READY; tests; ASR evidence |
| *(this commit)* | this report |

## 2. Recovered implementation

**The interrupted launcher work was not recoverable, because it never reached Git.**

- I searched every one of the 27 remote branches for `setsid`, PID files and `.pid` handling under `services/` and
  `scripts/`. The only hits are the unrelated dev-server runners (`scripts/support/server-runner.ts`,
  `scripts/verify-development.ts`). Those hits are present on canonical too.
- The VoxCPM2 work itself *was* committed (`14cf7ec`, now in canonical): `services/voxcpm/{server,bootstrap,selfcheck}.py`,
  `install.sh`, and `src/core/voice/gpuWorkers.ts`. It was all reused unchanged except where §6 says otherwise.
- `services/voxcpm/README.md` and `docs/voice/LELU_VOX_RECOVERY_LEDGER.md` place the earlier work on a Codebuff VM:
  `/workspace/chats/<id>`, 8 cores, 15 GB, one OS user per chat. That machine's worktrees, PID files, logs and HF cache
  cannot be reached from this cloud container.
- The only Claude session in this account that touched VoxCPM (`session_017r5V6RsZLcHiEmBo1X3pNi`) found no
  VoxCPM files in its container and stopped. It hit a usage limit and never wrote a launcher.

Because nothing survived, the launcher was written fresh (§6). It follows the plan the brief describes: PID-file ownership,
setsid, exit-code capture, and no pattern-based killing.

## 3. Root cause of the resource failures

| Hypothesis | Verdict | Evidence |
|---|---|---|
| 4. Model-loading memory spike | **Primary cause** | Peak RSS (VmHWM) is **10.85–11.15 GiB** across 5 loads; steady state is **6.3–6.7 GiB**. `voxcpm/model/voxcpm2.py:1142` constructs the model in default fp32 (2,290,004,544 params × 4 B = **8.53 GiB**), then casts to bf16 and reads the 4.27 GiB checkpoint. |
| 1. Insufficient RAM | **Yes, on the earlier machine** | That machine had ~15 GB with a ~5 GB co-tenant worker, leaving about 10 GB or less: below the 11 GiB peak, with no swap. Reproduced safely here: with one worker resident, MemAvailable was 8.31 GiB, and the preflight refused a second load (`insufficient_memory`). |
| 2. Cloud execution limits | **Contributing** | The earlier load ran in the foreground of an interactive turn. Here, detached processes survive tool calls (§9), so a load no longer needs to fit inside one tool call. |
| 3. CPU bf16 incompatibility | **Not on this host** | This host's Xeon has AMX-BF16 and AVX512-BF16; load takes 17 s and RTF is about 4. The earlier VM's CPU flags are unknown; on a CPU without native bf16, matmuls are emulated and much slower. *Unverified for that machine.* |
| 5. Duplicate initialization | **No** | One `LOADING` per process (lock-guarded `ensure_model`); the manager refuses a second instance (`already_running`). |
| 6. Stalled loader | **No; it only looked like one** | `Running on device: cpu, dtype: bfloat16` (`voxcpm2.py:176`) is the **last line printed before the silent heavy phase**. A forced-timeout run caught RSS at 4.23 GiB and rising, 6 s after that line. A log that "stops" there belongs to a process inside its memory peak. Here that phase finishes in ~17 s. |
| OOM killer in this container | none | `/proc/vmstat oom_kill` = 0 throughout; no cgroup memory cap (the bound is the 16 GB VM). |

**Limit of this finding:** the earlier VM cannot be inspected from here, so its exact kill signal is not proven. What is
proven is the arithmetic: an 11 GiB transient does not fit in about 10 GB without swap.

## 4. RAM and CPU measurements (this container)

| Resource | Value |
|---|---|
| CPU | 4 vCPU, Intel Xeon @ 2.10 GHz, `avx512_bf16 amx_bf16 amx_tile avx512f avx2` |
| RAM | 15.71 GiB total, 0 swap, no cgroup memory limit (Firecracker VM) |
| Disk | 29 GB free at start |
| GPU | none |

All five loads were cold process starts. "Warm" means the weights were already in the page cache; it made no difference,
because the load is CPU-bound.

| Run | Start → READY | Load | Self-test | Peak RSS | Steady RSS |
|---|---|---|---|---|---|
| probe (`probe_memory.py`) | n/a | 17.7 s | n/a | 10.85 GiB | 6.28 GiB |
| worker #1 (cold) | 29.1 s | 17.4 s | 8.1 s (1.28 s of audio) | 11.11 GiB | 6.56 GiB |
| worker #2 (over a stale PID file) | 28.1 s | n/a | n/a | n/a | n/a |
| worker #3 (after an external SIGKILL) | 29.0 s | n/a | n/a | n/a | n/a |
| worker #4 (persistence run) | 28.0 s | n/a | n/a | 11.15 GiB | 6.59 GiB |

The worker's peak includes the self-test; inference adds only about 0.3 GiB above steady state. During one load,
system MemAvailable fell from 14.9 to 4.5 GiB.

## 5. Model-loading findings

- **Model:** `openbmb/VoxCPM2`, revision `7936080b41163874f38610f46f438e2c0757f9fd`. Architecture `voxcpm2`, checkpoint dtype
  **bf16** (every tensor), 2,290,004,544 parameters.
- **Files:** `model.safetensors` 4.58 GB and `audiovae.pth` 0.38 GB; 4.96 GB in total. The repo's `bootstrap.py` downloaded and
  verified them (exit 0).
- **Runtime:** `voxcpm 2.0.3`, `torch 2.15.0+cpu`, `torchaudio 2.11.1+cpu`, Python 3.12.3, installed by the repo's
  `install.sh` (`requirements.lock` committed). These are the versions the README recorded.
- **Precision:** the config's `dtype: bfloat16` is kept on CPU (`pick_runtime_dtype` changes it only for MPS). The AudioVAE runs
  in fp32 by design. **No precision, model or backend was changed.**
- **Load sequence and its memory:**
  1. build the model in fp32 (~8.5 GiB);
  2. `.to(bf16)`;
  3. `load_file` the 4.27 GiB checkpoint into memory;
  4. `load_state_dict`.
- **Weights are loaded once** per process.
- `optimize` (torch.compile) stays off. The library supports it only on CUDA, and turning it on also triggers the
  library's own warm-up generation.
- **Output:** 48 kHz.

### Options to lower the peak

None of these is implemented. Each needs approval.

| Option | Expected memory | Speed | Quality risk |
|---|---|---|---|
| Build directly in bf16 or on the meta device, and load with `assign=True` / mmap | peak ~5–6 GiB (est.) | load slightly faster | None in principle (same bf16 weights). But non-persistent buffers such as RoPE tables would be computed in bf16 instead of cast from fp32, so it needs a tensor-equality check against the stock load. It also patches a third-party loader. |
| Add swap (≥ 6 GiB) | peak fits on an ~8 GB machine | the load becomes I/O-bound; slower | none |
| int8 dynamic quantization of Linear layers (CPU) | ~3 GiB resident (est.) | possibly faster on CPU | **Real.** The AR and diffusion stack may degrade; needs ASR and listening evaluation. |
| GPU (≥ 12 GB VRAM) | RAM is used only while staging | upstream reports faster than real time; **not measured here** | none |

## 6. Launcher implementation

### `services/voxcpm/workerctl.py` (new; stdlib only, never imports torch)

Commands: `preflight`, `start`, `stop`, `restart`, `status`, `speak`.

- **Single instance and ownership.** `start` spawns a supervisor with `start_new_session=True` (setsid). The supervisor owns
  one `server.py` child. `.voxcpm/run/worker.pid` records:
  - both PIDs;
  - their kernel start times (`/proc/<pid>/stat` field 22);
  - a random launch id carried on the supervisor's command line.

  A start or stop is serialised with `flock`.
- **Process identity verification.** A process is signalled only if three things hold:
  - its start time matches the record;
  - for the supervisor, its cmdline carries the launch id;
  - for the worker, it is `server.py` and its parent is the verified supervisor.

  There is no `pkill` and no pattern matching. A record that fails verification is reported as stale and removed, and the
  process it names is left alone.
- **Memory preflight.** MemAvailable, together with cgroup headroom when a limit exists, must be at least 11.5 GiB (measured peak
  plus margin; `VOXCPM_REQUIRED_GIB`). The preflight also checks the weights marker, the venv and the port.
- **Startup timeout.** The supervisor's watchdog ends the worker if it has not reached READY or FAILED in time
  (`VOXCPM_STARTUP_TIMEOUT`, default 600 s).
- **Exit-code capture.** `worker.exit.json` records the returncode, the signal, the last worker state, memory, uptime and the
  OOM-kill delta.
- **Failure classification:** `insufficient_memory · weights_missing · port_in_use · already_running · startup_timeout ·
  load_error · selftest_failed · oom_killed · killed_externally · crashed · stopped`.
- **Logging:** structured JSON lines in `supervisor.log` and `worker.log`. The token is passed by environment and never
  logged.
- **Workers never download:** `HF_HUB_OFFLINE=1`.

### `services/voxcpm/server.py` (edited)

- A lifecycle state machine, `STARTING → LOADING → INITIALIZING → READY | FAILED` (`STOPPED` on exit), written atomically to
  `VOXCPM_STATE_FILE` and exposed on `/health` as `state`, `ready`, `stateError`, `selftest` and `memory`.
- **READY requires a self-test.** One real generation from the reference clip must return at least 0.3 s of audio with
  RMS ≥ 0.005. If the self-test fails, the worker drops the model and goes to FAILED.
- SIGTERM and SIGINT shut down gracefully. A port already in use is reported as FAILED with exit code 98, not a traceback.

### `services/voxcpm/probe_memory.py` (new)

A one-shot diagnostic. It runs the exact `Engine` path and prints phase timings with RSS and peak RSS.

## 7. Worker lifecycle results

Every result below was run in this container. The JSON evidence is in `docs/voice/evidence/worker-recovery/`.

| Scenario | Result |
|---|---|
| Cold start, `--wait` | `STARTING → LOADING → INITIALIZING → READY` in 29.1 s ✔ |
| Second `start` while running | refused `already_running`, rc 3 ✔ |
| Second instance on another port while one is resident | refused `insufficient_memory` (8.31 GiB available < 11.5 GiB) ✔ |
| Graceful `stop` | 1.8 s, returncode 0, classified `stopped`, 0 OOM kills ✔ |
| Forged PID file naming a live foreign process (PID 88, the sandbox telemetry collector) | detected as recycled (start time differs), **not signalled**, removed; PID 88 still running ✔ |
| `start` over that stale record | logged `stale_pid_file`, then READY in 28.1 s ✔ |
| External SIGKILL of our own worker | classified `killed_externally` (signal 9, no OOM delta), state FAILED ✔ |
| `start` after that failure | READY in 29.0 s ✔ |
| Startup timeout (8 s budget) | ended mid-load at 8.5 s, classified `startup_timeout`, no process left behind ✔ |

Note on the timeout case: when the worker is ended mid-load, it exits with SIGABRT (`terminate called without an active
exception`), because torch's C++ load is torn down at interpreter exit. The classification is still correct, and the
supervisor escalates to SIGKILL after 30 s if needed.

## 8. Actual inference results

| Output | Requested text | Audio | Synthesis time | RTF | Independent ASR (faster-whisper small.en) |
|---|---|---|---|---|---|
| `probe-run1.wav` | "Hello. I am Lélu, and this is my own voice." | 3.68 s, 48 kHz, RMS 0.114 | 17.3 s | 4.7 | "Hello, I am Lulu, and this is my own voice." |
| `worker-speech-1.wav` (over HTTP through the worker) | "Good evening. I'm Lélu, and this voice is running on a worker I manage myself." | 4.16 s | 17.2 s | 4.14 | "Good evening, I'm Leilu, and this voice is running on a worker I manage myself." |
| self-test (every start) | "Hello, I am ready." | 1.28 s, RMS 0.129 | 8.1 s | ~6 | not transcribed |

- Every word matches except the name, which English ASR spells phonetically.
- Both WAVs are committed.
- This proves intelligible speech of the requested text, conditioned on the committed reference clip. It is **not speaker
  verification**, and **CPU inference is about 4× slower than real time**.

## 9. Persistence findings

| Question | Answer | Evidence |
|---|---|---|
| Does a setsid process survive the end of a tool call? | **Yes** | The probe, the worker and the heartbeat each started in one tool call and kept running through dozens of later calls. |
| Does it survive the end of a turn? | **See the addendum below.** | The heartbeat (`.voxcpm/logs/heartbeat.log`, every 10 s) records worker liveness and uptime across the turn boundary. |
| Does it survive a container reclaim or a new session? | **No, by construction** | The container is ephemeral and reclaimed after inactivity. The process, `.venv-voxcpm` (2.4 GB), the HF cache (5.1 GB) and `.voxcpm/` all live on the container disk. A new session starts with no `torch` and no weights, which this session confirmed at its own start. |
| Cost to rebuild in a fresh container (measured) | **about 2 minutes** | `install.sh` 54 s (from file timestamps), weight download ≤ 25 s (4.96 GB), start to READY about 29 s |
| Is a dedicated runtime needed? | **Yes** | That is the only way to get a worker that outlives development sessions. |

## 10. LÉLU integration status

| Item | Status |
|---|---|
| Endpoint | `http://127.0.0.1:8788` (`VOXCPM_HOST` / `VOXCPM_PORT`) |
| Contract | `GET /health` · `GET /v1/models` · `POST /warmup` · `POST /v1/audio/speech` (OpenAI-shaped; WAV or PCM16 stream) |
| Health | `/health` now includes `state` and `ready`; READY means proven by inference |
| Authentication | `VOXCPM_TOKEN` bearer token; open on loopback, **required for any tunnel**. `/health` exposes `authRequired`, never the token. |
| Availability detection | `VoxcpmPool` (`src/core/voice/gpuWorkers.ts`) now treats only `READY` as available, and puts a FAILED or INITIALIZING reason in `detail`. Older workers fall back to `loaded`. |
| Timeouts | Pool probe 2.5 s. **A speech request on CPU takes about 4× the audio length** (17 s for 78 characters), so a caller's timeout must scale with text length. |
| Errors | 401 bad token, 400/413 bad or oversized input, 503 queue full or model unavailable; the pool maps each to a reason |
| Recovery | Pool cooldown 60 s, cleared by `markSuccess`. The worker side is `workerctl start` / `restart`, and the classification says why the last one ended. |
| Tests | `tests/voice-voxcpm-worker.test.ts`: 6/6 pass, including a **live** probe of the running worker through the pool. `tsc -b --force` passes; it had never completed for `gpuWorkers.ts` before. Voice suite: 65 pass, 1 skipped, 1 failure in `voice-continuity.test.ts` ("a streamed reply ends in listening/idle"), which **fails identically on canonical with this change stashed**, so it is unrelated. |
| **Not wired yet** (pre-existing gap, unchanged) | `plugins/voiceApi.ts` does not route to `VoxcpmPool`, and `src/core/voice/voxCpmTts.ts` does not exist. The app therefore still speaks through ElevenLabs or the browser. The architecture to finish it already exists (`VOICE_PROVIDER`, the pool, and the README's steps 3–5). Nothing parallel was added. |

## 11. Remaining blockers

1. **No persistent runtime.** The cloud container cannot host a worker that outlives the session (§9).
2. **CPU speed.** RTF is about 4: a sentence takes about 4× its own length to synthesise. Conversational use needs a GPU or
   pre-generation.
3. **Memory peak.** Hosting needs at least 11.5 GiB *available* at load time on CPU, unless the loader option in §5 is
   approved.
4. **App wiring.** `voiceApi.ts` → pool → `voxCpmTts.ts` is unwritten.
5. **No speaker verification.** ASR proves the words, not the timbre. A listening check or a speaker-embedding comparison
   against the reference clip is still owed.

## 12. Recommended next mission

**"VoxCPM2 dedicated worker and app wiring."**

1. **Choose the runtime, in this order:**
   - (a) a small always-on GPU VM (≥ 12 GB VRAM, 16 GB RAM, 20 GB disk);
   - (b) a CPU VM with 16 GB RAM, 4 or more AVX512-BF16/AMX cores and swap, accepting RTF ≈ 4;
   - (c) a free GPU notebook (Kaggle, Colab), accepting that it sleeps.

   On the chosen machine, run `install.sh`, `bootstrap.py` and `workerctl.py start` under systemd (`Restart=on-failure`,
   with `ExecStart` running `workerctl start --wait` or `server.py` directly). Expose it only through an authenticated tunnel
   with `VOXCPM_TOKEN`.
2. **Point LÉLU at it** with `VOXCPM_WORKERS` / `VOXCPM_BASE_URL` and `VOXCPM_TOKEN`.
3. **Implement README steps 3–5:**
   - `/api/voice/vox/*` routes in `plugins/voiceApi.ts`, backed by `VoxcpmPool`;
   - `voxCpmTts.ts`, with ElevenLabs and browser fallback;
   - tests against a fake sidecar, with timeouts scaled to text length.
4. **Optionally, with approval,** prototype the low-peak loader (§5) behind a flag, gated on a tensor-equality test and an
   ASR comparison.

## Reproduce

```bash
bash services/voxcpm/install.sh
.venv-voxcpm/bin/python services/voxcpm/bootstrap.py
python3 services/voxcpm/workerctl.py preflight
python3 services/voxcpm/workerctl.py start --wait
python3 services/voxcpm/workerctl.py speak --text "Hello. I am Lélu."
python3 services/voxcpm/workerctl.py status
python3 services/voxcpm/workerctl.py stop
VOXCPM_LIVE_URL=http://127.0.0.1:8788 npx tsx --tsconfig tsconfig.test.json \
  --import ./tests/support/ignore-css.mjs --test tests/voice-voxcpm-worker.test.ts
```

## Addendum: turn-boundary persistence

*Pending at commit time; filled in after the turn boundary.*
