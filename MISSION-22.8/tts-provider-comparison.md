# TTS provider comparison (WP04)

Constraints that decide this table, in order:

1. **No paid APIs, subscriptions or accounts** (mission constraint).
2. **No GPU in this container**, 8 vCPU / 16 GiB RAM — anything that needs a
   datacentre card is a deployment target, not a local one.
3. **LÉLU's voice identity must be hers** — cloning from the committed reference
   recording, not a stock voice presented as her.
4. **Licence must permit use in this project** — an Apache-2.0/MIT model first.
5. **The fallback must stay working** — Piper is operational today and must not
   be displaced by an unverified experiment.

Figures below are from the projects' own cards and from published comparisons
(linked), not from benchmarks run here. Nothing in this table was executed in
this container except Piper.

| Provider | Params | Weights licence | Voice cloning | First audio | CPU-only | Runs here |
|---|---|---|---|---|---|---|
| **Piper** (`OHF-Voice/piper1`) | 21–137 MB per voice | engine GPL-3.0; each voice separately licensed | **no** | ~390 ms on an M2 CPU | yes, it is the design goal | **yes — operational** (`local-piper:amy-low`) |
| **VoxCPM2** (OpenBMB) | 2 B | Apache-2.0 | **yes**, from a reference clip | streaming (48 kHz) | possible via GGUF/llama.cpp-omni; ~8 GB VRAM recommended for the PyTorch path | **no** — torch/model absent, no GPU |
| **Kokoro-82M** (hexgrad) | 82 M | Apache-2.0 | no (54 preset voices) | 0.9–1.3 s whole sentence, M2 CPU | yes (ONNX) | not attempted |
| **Chatterbox** (Resemble AI) | 110 M Nano / 350 M Turbo / 500 M Multilingual | MIT | **yes**, zero-shot from ~5–10 s | Nano ≈ 3× faster than real time on 8 CPU cores | yes (Nano, `device="cpu"`) | not attempted |
| **Pocket TTS** (Kyutai) | 100 M | CC-BY-4.0 (attribution) | **yes**, from a short recording | 250–430 ms on an M2 CPU | yes (ONNX, WASM) | not attempted |
| **Qwen3-TTS** (Alibaba) | 0.6 B / 1.7 B | Apache-2.0 | **yes**, ~3 s reference | ~97 ms streaming (vendor figure) | CUDA-oriented in practice | not attempted |
| **XTTS v2** (Coqui) | ~0.5 B class | **CPML — non-commercial** | yes | — | yes | rejected: licence |
| **Orpheus 3B** | 3 B | Apache-2.0 | yes + emotion tags | ~200 ms (vendor) | impractical | not attempted |
| **ElevenLabs** | hosted | proprietary | yes (voice id) | ~0.5–2 s | n/a | **not used** — paid, needs an account; the route exists but is disabled by spend policy |

Sources: [VDF AI — Best Local TTS Models (2026)](https://vdf.ai/blog/best-local-tts-models),
[micdrop — Open Source TTS Ranked (2026)](https://micdrop.dev/blog/top-open-source-text-to-speech-models),
[quantacloud — licence/VRAM comparison](https://quantacloud.net/guides/open-source-tts-models),
[webdiga — Chatterbox on CPU](https://webdiga.com/local-text-to-speech-models/),
[dasha — self-hosted TTS for voice agents](https://dasha.ai/blog/best-self-hosted-tts).

## Reading the table for LÉLU

### Identity: VoxCPM2 stays the target

It is the only provider here that is simultaneously (a) Apache-2.0, (b) a
cloning model, (c) already integrated behind `services/voxcpm` and
`plugins/voxApi.ts`, and (d) driven by a reference recording already committed
to the repository. Replacing it would replace the integration, not just a
model. Its blocker is hardware, and `voice-identity-investigation.md` records
the exact failure and the unblock procedure.

### A CPU-capable identity, if VoxCPM2 cannot be hosted

If the project must clone on CPU without a GPU host, the candidates are
**Chatterbox Nano (MIT, 110 M, ~3× real time on 8 cores)** and
**Pocket TTS (CC-BY-4.0, 100 M)**. Both are permissively licensed, both clone
from a short reference, and both are small enough for this container's RAM. They
are **not implemented and not verified here**: choosing between them needs a
listening test on LÉLU's actual reference audio, which is a human judgement, not
a benchmark.

Reported state of Chatterbox is inconsistent across the 2026 sources — two
describe the family as retired in August 2026, others list current Nano/Turbo/
Multilingual releases. Adopting it would mean owning a fork; that risk is
recorded rather than glossed over.

### Expressiveness is a third system, not this one

Orpheus (emotion tags) and Chatterbox Turbo (`[laugh]`-style tags) change
*delivery*. The mission explicitly separates voice identity from emotional
expression, and this mission did not couple them: nothing in the speech path
conditions prosody on context, and the identity provider choice above is
independent of any future expression layer.

### What is actually wired

```
page ──POST /api/voice/tts──► plugins/voiceApi.ts
                                 ├─ ElevenLabs (paid; disabled by spend policy) → audio/mpeg
                                 ├─ local Piper, WAV            → audio/wav
                                 └─ local Piper, --output_raw   → audio/L16 (streamed)
```

`/api/voice/diagnostic` reports which of them is live, and
`voiceIdentity.status` says `identity` / `fallback` / `absent` — never a
promise the runtime cannot keep.

## Verdict

| Decision | Choice | Why |
|---|---|---|
| Operational fallback | **Piper `amy-low`** | runs here, sub-second synthesis, honest label |
| Identity target | **VoxCPM2** | already integrated, Apache-2.0, clones from the committed reference |
| Identity interim on CPU | **Chatterbox Nano or Pocket TTS** (candidate, unverified) | permissive licence, small, CPU-capable — needs a listening test before adoption |
| Rejected | XTTS v2 (non-commercial), Orpheus 3B (size), ElevenLabs (paid) | licence, hardware, authorization |
