# WP04 — Voice identity investigation (VoxCPM2)

**Question:** why does LÉLU's own speech worker return `ECONNREFUSED 127.0.0.1:8788`,
and can it be made to run here without paid services?

**Answer:** the worker is not running because its Python dependencies are not
installed in this container and were never installed at the baseline. It is a
hard dependency failure, not a LÉLU bug — and it cannot be closed on this
hardware without downloading a multi-gigabyte model.

## What the code expects

`services/voxcpm/server.py` is a FastAPI/uvicorn sidecar around the OpenBMB
VoxCPM2 model, cloned from the reference recording committed in the repository:

```
public/audio/voice/lelu-voice-reference.m4a   ← present (verified by ls)
GET  /health, /metrics, /v1/models
POST /warmup, /v1/audio/speech               ← OpenAI-compatible, WAV or PCM16
```

`src/core/voice/gpuWorkers.ts` builds a pool from `VOXCPM_WORKERS` /
`VOXCPM_BASE_URL`, and adds the loopback worker `127.0.0.1:8788` unless
`VOXCPM_LOCAL_FALLBACK=0`. `plugins/voxApi.ts` reports
`503 not-configured` when the pool is empty, and `503 no-ready-worker` when a
configured worker is not `READY`.

So `ECONNREFUSED 127.0.0.1:8788` means exactly one thing: a worker is
configured by default and **nothing is listening on that port**.

## What was measured here

```text
$ curl -s -m 3 -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8788/health
000            # curl could not connect: connection refused

$ curl -s -m 5 http://127.0.0.1:4180/api/voice/diagnostic | jq .voxcpm
{ "configured": false, "reachable": "unprobed" }
```

`/api/voice/diagnostic` reports `configured: false` because neither
`VOXCPM_BASE_URL` nor `VOXCPM_WORKERS` is set in this runtime; the loopback
default is not a claim of reachability, and the route does not probe it.

### The actual startup failure

Running the project's own self-check produces the reason, not a guess:

```text
$ python3 services/voxcpm/selfcheck.py
{"event": "state", "state": "STARTING", "error": null, "peakGiB": 0.02, "rssGiB": 0.02}
Traceback (most recent call last):
  File ".../services/voxcpm/selfcheck.py", line 170, in main
    engine.prepare_reference()
  File ".../services/voxcpm/server.py", line 240, in prepare_reference
    import imageio_ffmpeg  # ships its own ffmpeg binary
ModuleNotFoundError: No module named 'imageio_ffmpeg'
```

The dependency chain stops even earlier than the model:

```text
$ python3 -c "import torch; print(torch.__version__)"
ModuleNotFoundError: No module named 'torch'
```

`services/voxcpm/requirements.txt` pins `voxcpm==2.0.3`, `numpy`, `soundfile`,
`imageio-ffmpeg`, `huggingface-hub`, and deliberately leaves `torch` /
`torchaudio` to `install.sh` (the correct wheel depends on hardware). Nothing
from that set is installed in this container, and no VoxCPM2 weights are cached
anywhere in the workspace.

## Hardware audit

| Requirement | This container | Verdict |
|---|---|---|
| Python 3.12 | 3.12.3 present | ok |
| `torch` + `torchaudio` | absent | blocking |
| `voxcpm` (2.0.3), `soundfile`, `imageio-ffmpeg` | absent | blocking |
| VoxCPM2 weights (~2 B parameters, ~8 GB VRAM recommended) | not downloaded | blocking |
| GPU | none (`nvidia-smi` absent) | CPU-only inference |
| RAM | 15.6 GiB total, ~15 GiB available | sufficient for a quantised CPU build, tight for fp32 |
| CPU | 8 vCPU | minutes per sentence for a 2 B model on CPU |
| Reference recording | `public/audio/voice/lelu-voice-reference.m4a` present | ok |
| Licence | Apache-2.0 (model and reference implementation) | ok, no account needed |

**Why this is not attempted here:** installing CPU torch plus the model would
add several gigabytes to a workspace with a 4 GiB checkpoint budget, and a 2 B
autoregressive speech model on 8 CPU cores is minutes per sentence — it could
not serve a conversation, which is what this mission is about. That is an
honest engineering judgement, not a claim that the model is unusable.

## What would unblock it (procedure, not a claim)

On a machine with a GPU (or a rented free-tier GPU notebook — the `deploy/` kits
already target Kaggle/Colab/HF Spaces):

```bash
bash services/voxcpm/install.sh          # detects the device, installs a matching torch pair
VOXCPM_WARMUP=1 python3 services/voxcpm/server.py --port 8788
curl -s http://127.0.0.1:8788/health     # must answer {"ready": true, ...}
```

then point LÉLU at it:

```bash
VOXCPM_BASE_URL=http://127.0.0.1:8788 VOICE_PROVIDER=voxcpm bun run server.ts
```

The existing contract does not change: `voiceIdentity.ts` stays the single
definition of *who* she sounds like, the sidecar decides *how* it is synthesised,
and `/api/voice/tts` remains the only route the page calls.

## The three systems, kept separate

The mission insists these are independent, and this work keeps them so:

| System | Question | Current state | Where it lives |
|---|---|---|---|
| **Voice identity** | what does she sound like? | **fallback** — Piper `amy-low`, labelled `local-piper`, `cloned: false` | `voiceIdentity.ts`, `/api/voice/tts` provider header, `/api/voice/diagnostic` `voiceIdentity.status` |
| **Speech intelligence** | how does she communicate? | streaming sentences, normalization, turn ownership | `VoiceEngine`, `spokenText.ts` |
| **Emotional expression** | how does delivery change with context? | **not implemented** — no prosody model, no emotion conditioning | — (deliberately not coupled to identity) |

Piper is not presented as her voice anywhere: the route header is
`X-Lelu-Voice-Provider: local-piper:amy-low`, the diagnostic says
`status: "fallback"`, and `cloned` is hard-coded `false`.

## Conclusion

* Why `ECONNREFUSED`: no process on 8788, because the Python sidecar's
  dependencies are absent (verified traceback: `ModuleNotFoundError`), and the
  model is not present.
* Why it is not fixed here: no GPU, no installed torch, multi-GB weights, and a
  CPU inference cost incompatible with conversation.
* What is preserved: the entire VoxCPM2 path, the worker contract, and Piper as
  an accurately labelled fallback.
* Alternative providers are compared in `tts-provider-comparison.md`.
