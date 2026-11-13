# Zero-cost CPU voice: backend comparison and recommendation

> **Follow-up (same day): `MOSS-INTEGRATION-DECISION.md`.** MOSS is now an opt-in worker behind the existing
> interface, and VoxCPM2 stays the default. The VPS run and the listening test are still blocked. Paired tests
> found MOSS less accurate (11.1% vs 3.7% word error) and less similar (0.346 vs 0.425) than VoxCPM2.

**Date:** 2026-11-13 · **Branch:** `claude/lelu-worker-recovery-4fio20` · **Committed locally only (not pushed, not merged).**
**Production code:** unchanged. This is an isolated benchmark, and integration waits for your decision.

## Recommendation

**MOSS-TTS-Nano ONNX is the CPU backend to adopt, provided it passes on the Contabo server first.**

- **Speed:** her voice starts in **0.26–0.40 s**, against **27–70 s** for VoxCPM2 on the same CPU.
- **Memory:** **1.9 GB** resident (2.5 GB peak), against 6.6 GB (11 GiB peak) for VoxCPM2.
- **Playback:** streams at about real time on 2–3 cores.
- **Voice:** its similarity to the reference is equal to VoxCPM2's (median 0.354 vs about 0.35).
- **Cost:** Apache-2.0, downloads anonymously, no GPU, no paid API, no secret.

**Pocket TTS is rejected.** Its voice-cloning weights are gated behind a Hugging Face account, and you've ruled out
tokens. Its ungated variant can only use preset voices, so it can't speak in LÉLU's voice at all.

**The Contabo check itself is BLOCKED.** This development container has no SSH, API or credentials for the VPS.
Every number below was measured in this container: 4 vCPU Intel Xeon @ 2.10 GHz, AVX-512/AMX, 15.7 GiB RAM, no
GPU. Where the VPS's 8 GB matters, I measured against that limit. The VPS's CPU model is unknown (possibly AMD), and
ONNX speed can differ there. Run `docs/voice/evidence/cpu-tts-benchmark/moss_bench.py` on the VPS before switching.

## 1. Candidates: repository, download, licence

| | MOSS-TTS-Nano ONNX | Pocket TTS |
|---|---|---|
| Model repositories | `OpenMOSS-Team/MOSS-TTS-Nano-100M-ONNX` + `OpenMOSS-Team/MOSS-Audio-Tokenizer-Nano-ONNX` (Hugging Face) | `kyutai/pocket-tts` (cloning) / `kyutai/pocket-tts-without-voice-cloning` |
| Code | `github.com/OpenMOSS/MOSS-TTS-Nano` @ `8b7bcc9` (`onnx_tts_runtime.py`, `ort_cpu_runtime.py`) | `pocket-tts` 4.0.1 on PyPI |
| Licence | **Apache-2.0** (model, codec and code) | CC-BY-4.0 |
| Gated? | **No.** Anonymous download verified with `HF_TOKEN=` and `HF_HUB_DISABLE_IMPLICIT_TOKEN=1`: 20 files, **729 MB, 12 s** | **Yes** (`gated: auto`). A cloning weight download without a token returned **HTTP 401** |
| Account or secret needed | **None** | A Hugging Face account, acceptance of Kyutai's terms, and a token, which are **not allowed** |
| Clones from reference audio only (no transcript) | **Yes** (`--prompt-audio-path`) | Cloning variant only |
| Decision | **Benchmarked** | **Rejected** (gated) |

**Runtime dependencies:** `onnxruntime` 1.32.0, `numpy`, `sentencepiece`, `soundfile`. The published wrapper also
imports `torch` 2.7.0+cpu and `torchaudio`, but **only** to load and resample the reference clip (lines 446–451).
That can be replaced with `soundfile` + numpy, which drops about 800 MB of the 900 MB environment. Weights take
729 MB on disk.

## 2. Measured results (isolated, CPU-only, this container)

The reference is the authorised `public/audio/voice/lelu-voice-reference.m4a` (sha256 `9ac99650…`). It was read
only, not modified and not transcribed. Its first 12 s were used for conditioning (the same slice VoxCPM2 uses),
written to a scratch WAV outside the repository. Encoding it takes 1.6 s, done **once** per worker start, and the
codes are reused.

### Configuration matters more than anything else

Each ONNX graph gets its own thread pool, and by default the idle threads busy-wait ("spin"). At 4 threads that
oversubscribes the 4 cores.

| Setting | First audio | RTF (synthesis time ÷ audio length) | Cores used while speaking |
|---|---|---|---|
| published defaults, 4 threads | 268–332 ms | 1.69–1.86 (slower than real time) | about 3.9 |
| defaults, 2 threads | 279–388 ms | 0.84–0.96 | about 2.9 |
| defaults, 1 thread | 473–596 ms | 1.42–1.67 | 1.0 |
| **spinning off, 3 threads** | **248–417 ms** | **0.79–1.07** | **about 2.0** |
| spinning off, 4 threads | 264–361 ms | 0.75–1.05 | about 2.2 |

### Recommended setting: 3 threads, spinning off, memory arena off ("lean")

| Metric | Result (12 repeated plus 10 varied replies) |
|---|---|
| Model load | 2.6 s |
| **First audio** | **262–395 ms** |
| **Gapless streaming** | the head start needed so playback never stalls is **0 ms** for 10 of 10 replies (worst 64 ms over all idle runs) |
| RTF | 0.76–1.02 |
| **RAM** | **1.86 GB resident, 2.54 GB peak** (published defaults: 3.28 GB resident, 3.29 GB peak) |
| Memory drift | none: resident memory flat over the last 7 of 12 runs (3,276 MiB at default settings; 1.85–1.87 GB lean) |
| **STOP / cancel** | generation ends **48–101 ms** after the cancel request (checked between generated frames) |

### Under load (the VPS also runs LÉLU CORE, the agent and LiveKit)

With two busy-loop processes occupying 2 of the 4 cores, I ran five repeats per setting:

| Setting | First audio | RTF | Head start for gapless playback |
|---|---|---|---|
| 2 threads | 349–431 ms | 1.06–1.18 | 120–613 ms; one outlier 2.3 s |
| 3 threads | 389–508 ms | 1.19–1.26 | 848–1,087 ms; one outlier 4.2 s |

**On a busy shared VPS, use 2 threads and a 0.5–1 s playback buffer.** Occasional long sentences may still stall
briefly. The VPS's real background load is unmeasured.

### Two simultaneous requests (separate processes)

| First audio | RTF | Gapless head start | RAM |
|---|---|---|---|
| 361–397 ms | 1.14–1.16 | 0.6–0.7 s | 3.1 GB **each** at default settings |

At about 1.9 GB each with the lean setting, two processes still wouldn't leave room on 8 GB beside LÉLU.
**Run one worker and queue requests**, as the current sidecar already does.

## 3. Quality

**Intelligibility.** I generated 10 LÉLU-style replies with distinct seeds and transcribed them with independent
ASR (faster-whisper small.en):

- **8 of 10 were spoken exactly.** Two "errors" are only digit formatting ("24" for "twenty four").
- **Her name is the weak spot.** "Lélu here" was heard as *"are you here?"*. In another sentence, "I'm Lélu" was
  **repeated** (*"I'm Ariel, I'm Ariel"*), which is a genuine generation artifact, not ASR noise.
- **One small slip:** "I've saved" came out as "I saved". In a long sentence, "light" became "lightning".
- **Likely mitigation (not tested):** a phonetic respelling of the name before synthesis.

**Voice similarity to the reference.** This uses ECAPA cosine against held-out reference audio (12–48 s), which
neither model was conditioned on:

| Source | Score |
|---|---|
| Real voice vs itself | **0.771** |
| MOSS-TTS-Nano, 10 replies | **0.225–0.454, median 0.354** |
| VoxCPM2, 8 outputs (earlier mission) | 0.27–0.44, median about 0.35 |
| A different speaker (ElevenLabs "Jessica") | −0.06 to 0.01 |

The two models are equally similar to her. **Neither is a close clone**, and no human listening test has been done.

## 4. MOSS-TTS-Nano vs VoxCPM2 on the same CPU

| | VoxCPM2 (current) | MOSS-TTS-Nano ONNX (lean, 3 threads) |
|---|---|---|
| Parameters | 2.29 B | about 0.1 B |
| Load | 16–24 s warm; **320 s** cold after a container restore | 2.6 s |
| RAM | 6.6 GB resident, **11 GiB peak** (cannot load on an 8 GB VPS) | **1.9 GB resident, 2.5 GB peak** |
| First audio | **27–70 s** (in the LiveKit run) | **0.26–0.40 s** |
| RTF | 4–5 | 0.76–1.02 |
| Streaming | starved; the agent buffers whole sentences | gapless with no pre-buffer when idle |
| STOP | cancels between streamed chunks | 48–101 ms |
| Similarity (median) | about 0.35 | 0.354 |
| Name "Lélu" | read correctly in the samples checked | sometimes unclear or repeated |
| Licence / access | Apache-2.0 / ungated | Apache-2.0 / ungated |

## 5. Integration plan (not executed; waiting for your go-ahead)

Replace **only the synthesis backend behind the existing sidecar contract**. The app and agent already speak it:
`GET /health` with `state`/`ready`, and `POST /v1/audio/speech` returning WAV, or PCM16 48 kHz mono with
`stream: true`.

1. **New sidecar** `services/mossnano/server.py`, implementing the same API and lifecycle as
   `services/voxcpm/server.py`: STARTING → LOADING → INITIALIZING → READY after a real self-test. It would use
   3 threads (2 on a busy VPS), spinning off and the arena off, encode the reference once, cancel on client
   disconnect, and run one generation at a time behind a queue.
2. **Point the pool at it** with the existing `VOXCPM_BASE_URL` (or `VOXCPM_WORKERS`).
   **Unchanged:** LiveKit, the token endpoint, VoiceEngine, AIService, MultiChatStore, the mic controls, STOP,
   reconnect.
3. **Agent setting:** `LELU_AGENT_PLAYBACK=stream`, adding a small (about 0.5 s) jitter buffer for a busy VPS.
   That's a few lines in the agent.
4. **Keep VoxCPM2** until MOSS passes the acceptance list on the VPS: real inference, cloning, first audio,
   continuous playback, STOP, barge-in, continuity, worker restart, stability over repeated conversations.

## 6. Remaining blockers and risks

- **BLOCKED:** benchmark and acceptance on the actual Contabo CPU (no access from here).
- **Name pronunciation and occasional repetition** (above): test a respelling, and listen.
- **CPU contention** on a 4-vCPU VPS can make long sentences stall without a playback buffer.
- **The wrapper imports torch** for one function; replace it before production to keep the worker small.
- **Not yet tested with MOSS:** barge-in, continuity, worker restart and LiveKit playback. Those parts of the
  pipeline are model-independent and passed with VoxCPM2 (`LIVEKIT-VOICE-ACCEPTANCE-REPORT.md`), but must be
  re-run once MOSS is behind the sidecar.

## Reproduce

```bash
git clone https://github.com/OpenMOSS/MOSS-TTS-Nano            # @ 8b7bcc9
uv venv venv-moss --python 3.12
uv pip install --python venv-moss/bin/python onnxruntime==1.32.0 numpy sentencepiece soundfile huggingface-hub \
  torch==2.7.0 torchaudio==2.7.0 --extra-index-url https://download.pytorch.org/whl/cpu
HF_TOKEN= HF_HUB_DISABLE_IMPLICIT_TOKEN=1 venv-moss/bin/python -c "from huggingface_hub import snapshot_download as d
for r in ('OpenMOSS-Team/MOSS-TTS-Nano-100M-ONNX','OpenMOSS-Team/MOSS-Audio-Tokenizer-Nano-ONNX'):
    d(r, local_dir='MOSS-TTS-Nano/models/'+r.split('/')[1], token=False)"
venv-moss/bin/python docs/voice/evidence/cpu-tts-benchmark/moss_bench.py --repo MOSS-TTS-Nano \
  --ref REF_12s.wav --out out --threads 3 --no-spin --lean --mode full   # also: stability | quality | worker
```

The raw results (JSON lines per run), ASR transcripts, similarity scores and audio samples are in
`docs/voice/evidence/cpu-tts-benchmark/`.
