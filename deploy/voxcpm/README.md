# LÉLU — VoxCPM2 voice identity deployment

Her voice is cloned from the committed recording:

```
public/audio/voice/lelu-voice-reference.m4a     (committed, never modified)
```

by **`openbmb/VoxCPM2`** (OpenBMB, Apache-2.0 — code and weights), served by a
local inference process. The browser never receives the reference audio, the
transcript or a model credential; the page only ever posts text and receives
audio bytes.

```
LÉLU cognition
   └─ completed response text
        └─ src/core/voice/elevenLabsTts.ts         (existing seam, unchanged shape)
             └─ src/core/voice/adapters/VoxCpmTts.ts   (this provider, isolated)
                  └─ POST /api/voice/voxcpm/tts         (plugins/voxcpmApi.ts)
                       └─ POST /v1/audio/speech         (this directory)
                            └─ VoxCPM2.generate(...)    (official SDK)
```

## Hardware

| Item | Requirement |
|---|---|
| VRAM | **~8 GB** for `openbmb/VoxCPM2` at BF16 (official figure); ~6 GB with a Nano-vLLM path, ~5 GB with llama.cpp-omni GGUF |
| GPU | Any CUDA GPU with ≥8 GB; an RTX 4090 measures **RTF ≈ 0.12** (about 8× real time) after warm-up |
| Disk | ~5 GB for BF16 weights + ~1 GB Python/CUDA wheels |
| CPU | works, but a 2 vCPU / 4 GB CPU-only host cannot run this at usable speed |

A CPU-only host can *install* the model and cannot *serve* it usefully. The
route reports that honestly rather than answering with slow or empty audio.

## 1. Prepare the reference clip

```bash
./deploy/voxcpm/prepare-reference.sh
```

Writes `deploy/voxcpm/reference/lelu-voice-reference-44k-mono.wav` (generated, not
committed) and prints both SHA-256s. The original `.m4a` is only read.

**Important — the committed clip is a multi-voice acted scene.** Spectral analysis
of the committed recording shows the dominant pitch moving between roughly 87 Hz
and 368 Hz second to second with no silent gaps, and its transcript is a dialogue
with more than one speaker ("…honey, you're gonna need it", "Are you serious?",
"I want it"). Cloning the whole file clones *the scene*, and similarity to any one
speaker will be low. Cut the stretch that is **one** person speaking:

```bash
START=39 DURATION=8 ./deploy/voxcpm/prepare-reference.sh
```

Then set `VOXCPM_REFERENCE_TEXT` to the exact transcript of that window.

## 2. Run the inference server

```bash
python -m venv .venv-voxcpm && . .venv-voxcpm/bin/activate
pip install "voxcpm>=2.0" soundfile

export LELU_VOICE_CONSENT_ATTESTED=true     # see the consent gate below
python deploy/voxcpm/lelu_voxcpm_server.py  # 127.0.0.1:8000
```

Check it:

```bash
curl -s http://127.0.0.1:8000/health
# {"status":"ok","model":"openbmb/VoxCPM2","loaded":false,...}
```

`loaded:false` means the weights are not in memory yet — they load on the first
generation. That is not an error.

If you prefer OpenBMB's production stack, `vllm serve openbmb/VoxCPM2 --omni
--port 8000` also answers `/v1/audio/speech`; see the caveat in
`lelu_voxcpm_server.py` about reference-audio field names on that path.

## 3. Point LÉLU at it

```bash
VOXCPM_BASE_URL=http://127.0.0.1:8000
VOXCPM_MODEL=openbmb/VoxCPM2
VOXCPM_REFERENCE_WAV=deploy/voxcpm/reference/lelu-voice-reference-44k-mono.wav
VOXCPM_REFERENCE_TEXT=            # blank = the built-in transcript
LELU_VOICE_CONSENT_ATTESTED=true
```

Verify:

```bash
curl -s localhost:5173/api/voice/voxcpm/status
# {"configured":true,"referenceLoaded":true,"consentAttested":true,...}
```

Then use voice in LÉLU: her reply is spoken by her cloned voice. If the clone
fails, the configured server provider answers instead (and the failure is
reported), so a broken model never silences her.

## Consent gate

Cloning a voice is lawful only with the speaker's permission. Both the route and
the inference server refuse to generate unless `LELU_VOICE_CONSENT_ATTESTED` is
exactly `true`:

- route → `403`, nothing reaches the model;
- server → refuses to start (`exit 2`).

Set it **only** when the reference recording is your own voice or you hold the
speaker's explicit authorisation. This is an attestation by the operator; it is
not something the software can verify.

## What is and is not verified

| Claim | Status |
|---|---|
| Reference asset exists, decodes, is 48.8 s AAC-LC 44.1 kHz stereo | **verified** (`ffmpeg` full decode, no errors) |
| Transcript of the recording | **machine-transcribed** (Whisper base + small agree); one word uncertain |
| Route contract: reference + transcript are sent, failures reported | **tested offline** (`tests/voice-voxcpm.test.ts`) |
| Consent gate refuses generation | **tested offline** |
| VoxCPM2 serving generated audio here | **not verified** — no GPU with ≥8 GB VRAM in this environment |
| Speaker similarity of the clone | **not evaluated** — requires listening to generated audio |

Do not read this directory as evidence that a clone was produced. See
`docs/voice/MISSION_2_VOICE_IDENTITY_REPORT.md`.
