# WP06 — VOICE IDENTITY RESEARCH

**Priority:** P1 · **Gate G11:** VERIFIED (investigation complete) —
her *identity* is still not established, and this document does not pretend
otherwise.

## 1. The VoxCPM2 failure, re-diagnosed

M22.8 reported `ECONNREFUSED 127.0.0.1:8788` and a list of missing pieces.
M22.9 re-established each one from the machine itself:

| Reported cause | Re-checked on this host | Verdict |
| --- | --- | --- |
| `imageio_ffmpeg` missing | the sidecar's own `selfcheck.py` raised `ModuleNotFoundError: No module named 'imageio_ffmpeg'` (M22.8, unchanged) | confirmed |
| PyTorch missing | `python3 -c "import torch"` → `ModuleNotFoundError: No module named 'torch'` | confirmed |
| No virtualenv | `.venv-voxcpm` does not exist; only the empty cache dir `.voxcpm/` | confirmed |
| No listener on 8788 | nothing bound; the worker cannot start without the above | confirmed |
| GPU resources | no GPU in this container; CPU-only inference for a diffusion-style TTS | confirmed |
| Model weights | not downloaded (deliberate — see resource budget) | confirmed |

The worker code exists (`services/voxcpm/{server.py,install.sh,selfcheck.py,workerctl.py,requirements.lock}`),
so this is a **missing environment**, not a missing implementation.

## 2. Resource budget, measured

| Resource | Value |
| --- | --- |
| Disk free | 28 GB (63 GB total, 55 % used) |
| RAM | 16 GB, 0 swap |
| CPU | 8 vCPU, no GPU |
| Current local voice footprint | `.piper/` = **269 MB** |
| Per-warm-worker resident cost | **95–112 MiB** |

A PyTorch CPU wheel alone is ~800 MB–2 GB, and VoxCPM2-style weights are
multiple GB. On CPU, a diffusion/AR TTS that needs seconds per sentence
cannot serve a conversation, and this mission's own target is 114 ms. The
checkpoint budget for this workspace is 4 GiB compressed, so downloading
multi-GB weights is also outside the environment's contract.

**Decision: do not install VoxCPM2 in this mission.** It is documented as
blocked with a precise reason, not attempted and half-finished.

## 3. A hard finding that changes the voice question

Testing every voice model present, with the installed binary:

| Model | Load | Result |
| --- | --- | --- |
| `amy-low.onnx` (63.1 MB) | ✅ | speaks; 16 kHz; used by every measurement here |
| `amy-medium.onnx` (63.2 MB) | ❌ | `[piper] [error] "aɪ" is not a single codepoint (ids=161,)` → `terminate called after throwing an instance of 'std::runtime_error'` → **process aborts** |
| `voice.onnx` (63.2 MB) | ❌ | same abort, same reason |

The medium and "voice" models are **not usable with this binary build**: their
phoneme id map contains a multi-codepoint entry the binary rejects. This was
not previously known, and it means the candidate set in this environment is
one voice, not three. (The immediate cause is a model/binary version
mismatch, not corruption of the file: the model loads its config and fails
while building the phoneme map.)

## 4. Alternatives, evaluated against what exists here

| Candidate | Licensing | Size | CPU inference | Verdict for this mission |
| --- | --- | --- | --- | --- |
| **Piper `amy-low`** (current) | MIT (piper) / CC-BY voices | 63 MB | 114 ms/sentence warm (measured) | **kept** — the working fallback |
| **Piper other voices** (same binary) | CC-BY / public-domain voices | 20–110 MB | same order | possible if a *compatible* voice model is fetched; the two already present are binary-incompatible |
| **VoxCPM2** | open weights, research licence | multi-GB + torch | too slow on CPU | **blocked**: no torch, no weights, no GPU, over budget |
| **Kokoro-82M (ONNX)** | Apache-2.0 | ~330 MB | plausible on CPU | the most realistic next candidate; **not installed** here (new dependency, new weight download), so nothing is claimed |
| **XTTS / Coqui** | non-commercial licence (CPML) | ~1.8 GB + torch | slow on CPU | rejected on licence and runtime |
| **Cloud cloning services** | paid / account | — | — | **excluded by the mission** (no paid APIs, no accounts) |

No candidate was downloaded. The comparison is therefore a *feasibility*
comparison, not a listening comparison — and that distinction is exactly what
`voice-candidate-comparison.md` records.

## 5. What "her identity" means today, in the product

- `/api/voice/status` and `/api/voice/diagnostic` report
  `voiceIdentity.status: "fallback"` and `cloned: false` for the local voice.
- `voiceIdentity.ts` remains the authority for her ElevenLabs identity
  (Jessica, `eleven_v3`, `Playful, Bright, Warm`) — used when an account is
  configured, and never conflated with Piper.
- The three delivery profiles change **how** `amy-low` speaks, never **who**
  it is. A profile is not an identity, and the code says so.

## 6. Remaining work, in order

1. Obtain one **binary-compatible** Piper voice (or a fixed binary) and run the
   listening protocol in `voice-candidate-comparison.md`.
2. Evaluate **Kokoro-82M ONNX** for CPU speed and licence, as the first
   open-source candidate that could plausibly hold a conversation.
3. Only if a cloned identity is genuinely required: a GPU host, torch, and
   VoxCPM2 — with the budget that implies, and a human listening panel.
