# VOICE IDENTITY READINESS

**WP06 deliverable.** A status, not an aspiration.

## Readiness by layer

| Layer | State | Evidence |
| --- | --- | --- |
| **Consistent voice across requests** | **READY** | one warm worker per profile; every sentence of the browser run that used `warm` came from PID 417019, `modelLoads` did not increase |
| **Consistent voice across machines** | **READY** (local) | the voice is a file on the server (`.piper/voices/amy-low.onnx`), not the visitor's OS |
| **Her identity (ElevenLabs)** | **CONFIGURED, UNUSED** | `voiceIdentity.ts` still governs when an account exists; no paid call was made or is claimed |
| **A voice that is HER, not a placeholder** | **NOT READY** | `voiceIdentity.status: "fallback"`, `cloned: false` — every endpoint says so |
| **Cloned identity (VoxCPM2)** | **BLOCKED** | no torch, no weights, no GPU, over the workspace budget |
| **Voice choice (more than one usable voice)** | **NOT READY** | the only two other models on this host abort on a phoneme-map error |
| **Delivery shaped by her personality** | **READY** | three profiles resolved from developed traits; measured 5.10 / 5.24 / 5.60 s on one sentence |
| **Listening evaluation of candidates** | **NOT DONE** | protocol written, panel not convened |

## What a user actually hears today

- One voice: `amy-low`, 16 kHz, a Piper voice — clear, intelligible, and
  **not** a clone of anything of hers.
- Her pace shifts with what she is doing (technical → measured, playful →
  lively) once her identity has developed those traits, and stays neutral
  until then.
- If an ElevenLabs account is configured *and* spending is authorised, that
  identity takes over; this mission did neither.

## The shortest honest path to "her voice"

1. **Repair the candidate set first.** Fetch a Piper voice compatible with the
   installed binary (or replace the binary). This is a small, offline step and
   unblocks any listening comparison at all.
2. **Run the blind panel** in `voice-candidate-comparison.md` on 2–3 real
   candidates.
3. **Only then** discuss cloning: it needs a GPU host, torch, weights, and a
   consent/reference-audio process — none of which exists here.

## What must never be written in a report

- "LÉLU's cloned voice" while `cloned: false` is served by the diagnostic.
- "Her voice identity is established" because one voice is consistent.
- "Voice comparison complete" because two files failed to load.
