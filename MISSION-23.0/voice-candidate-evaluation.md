# WP06 — Voice Candidate Evaluation

**Status: PARTIALLY VERIFIED.** One candidate runs. Listening evaluation:
**NOT TESTED** (no speaker). No candidate is claimed as LÉLU's identity.

## Candidates

| Candidate | Format | Sample rate | Runtime | Runs here? |
|---|---|---|---|---|
| `amy-low.onnx` | legacy codepoint map | 16 kHz | Piper 1.2.0 | **yes** |
| `amy-medium.onnx` | espeak phoneme map (5 multi-codepoint keys) | 22.05 kHz | needs phoneme-string runtime | **no** — `"aɪ" is not a single codepoint` |
| `voice.onnx` (alba, en-GB RP) | espeak phoneme map (5 multi-codepoint keys) | 22.05 kHz | needs phoneme-string runtime | **no** — same abort |

Root cause for the two failures: `voice-identity-investigation.md`. It is a
runtime-format mismatch, not a broken model, and `voice.onnx` is a *different*
speaker (alba), not a duplicate of `amy-medium`.

## Measured synthesis of the same script

Script: *"Hello. I'm Lélu. Let me tell you what I found, and then you can tell
me whether it is useful."* — the same text through the three delivery
profiles of the working voice, so pace can be compared without changing
speaker.

| Profile | `length_scale` | Audio duration | Inference | Real-time factor |
|---|---|---|---|---|
| bright | 0.92 | 5.840 s | 0.976 s | 0.167 |
| warm (default) | 1.00 | 5.968 s | 0.856 s | 0.143 |
| calm | 1.12 | 6.368 s | 1.287 s | 0.202 |

*Calm is 9.0% longer than bright and 6.7% longer than warm* — the same 8–15%
band M22.9 measured, reproduced on the M23.0 branch.

**Caveat on these numbers:** they were produced while the 100-turn acceptance
run was using the CPU, so the inference times (0.86–1.29 s) are inflated
against an idle machine. The **durations** are a property of the text and the
profile and are not affected by CPU contention; the inference times are.

Samples: `audio/profile-warm.wav`, `audio/profile-calm.wav`,
`audio/profile-bright.wav` (48 kHz-safe 16 kHz mono PCM, playable directly).

## Criteria, scored honestly

| Criterion | amy-low | amy-medium | voice (alba) |
|---|---|---|---|
| CPU-compatible | yes (RTF 0.02–0.20) | — cannot run | — cannot run |
| Offline | yes | yes | yes |
| Open source | yes (Piper voice, MIT-style model release) | yes | yes |
| Voice cloning | **no** — generic TTS voice | no | no |
| Model size | 63 MB | 63 MB | 63 MB |
| RAM when warm | 109–157 MiB per worker | unknown | unknown |
| Init time | ~360–460 ms (measured at boot) | unknown | unknown |
| Synthesis latency | 114 ms short-sentence median (M22.9), 657 ms live median | unknown | unknown |
| Reproducible | yes, byte-identical args | blocked | blocked |
| Naturalness | **not judged** — nobody heard it | — | — |
| Expressiveness | pace/variation only, no word emphasis | — | — |

## Why no new candidate was installed

The mission allows investigating other CPU voice models. Two things stopped a
download in this pass, both resource-based rather than policy-based:

1. **Every viable neural clone needs weights and a runtime that do not fit the
   budget.** VoxCPM2 needs a multi-GB checkpoint plus torch; this container has
   no GPU and a 4 GiB working budget already carrying a 269 MB voice set.
2. **A downloaded model cannot be accepted without a listener.** The mission's
   own rule — *"require actual listening evaluation before adopting a
   candidate"* — cannot be satisfied here, because there is no speaker. Adding a
   model nobody can hear would convert an honest "unresolved" into an
   unfalsifiable claim.

## Conclusion

`amy-low` remains the **operational fallback**, and must be described that way:
a generic Piper voice, not her cloned voice, not her verified identity. The
path to a medium-quality voice is known and cheap (a phoneme-string Piper
build, or a legacy-format medium model); the path to a *cloned* voice is not
available under this mission's constraints.
