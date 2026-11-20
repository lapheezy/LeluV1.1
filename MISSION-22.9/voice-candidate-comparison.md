# VOICE CANDIDATE COMPARISON

**WP06 deliverable.** Same sample text for every candidate, same binary, same
host. What could be measured was measured; what needs ears is marked as
needing ears.

## Sample text (identical everywhere)

> "Delivery is the part of speech that carries meaning without changing a
> single word."

## 1. Models present on this host

| Model | Bytes | Loads? | Duration of the sample | Bytes of audio | Notes |
| --- | --- | --- | --- | --- | --- |
| `amy-low.onnx` | 63 104 526 | ✅ | **5.35 s** | 171 308 | 16 kHz; the only usable voice |
| `amy-medium.onnx` | 63 221 984 | ❌ **aborts** | — | — | `"aɪ" is not a single codepoint (ids=161,)` → `runtime_error` |
| `voice.onnx` | 63 221 984 | ❌ **aborts** | — | — | identical failure |

`MISSION-22.9/audio/profile-amy-low.wav` is the surviving sample.

Why the medium model matters and why it is not a corrupt file: Piper parses
the model's config, then fails while building the **phoneme id map**, because
one entry (`aɪ`, a diphthong) is two codepoints. That is a model/binary
version mismatch, not a truncated download — the file sizes are complete and
identical to each other.

## 2. Delivery profiles on the one usable voice (measured)

| Profile | `length_scale` | Duration | vs baseline |
| --- | --- | --- | --- |
| `warm` | 1.00 | 5.24 s | — |
| `calm` | 1.12 | **5.60 s** | +6.9 % |
| `bright` | 0.92 | **5.10 s** | −2.7 % |

Audio: `audio/delivery-warm.wav`, `audio/delivery-calm.wav`,
`audio/delivery-bright.wav`. This is a *delivery* comparison, not identity.

## 3. Speed and resource measurements

| Candidate | Cold load | Warm synthesis | Resident | Verdict |
| --- | --- | --- | --- | --- |
| `amy-low` + persistent worker | 351 ms (prewarm) | **114 ms** median | 95–112 MiB | shipping |
| `amy-low` cold per sentence | 426–453 ms | — | one process at a time | M22.8 path, kept as fallback |
| `amy-medium` | aborts | — | — | unusable |
| VoxCPM2 | not installed (no torch) | — | multi-GB | blocked |
| Kokoro-82M ONNX | not installed | — | ~330 MB weights | untested, plausible |

## 4. The protocol for the listening evaluation (not yet run)

Adoption requires a human panel, because naturalness, pronunciation and
"does this sound like her" are not measurable by a test runner.

1. Generate the same 10 sentences per candidate (five conversational, five
   technical with names/numbers) at a fixed delivery profile.
2. Blind the files (random ids, no model names) and have at least two
   listeners rate 1–5 on: pronunciation, clarity, naturalness, consistency
   across sentences, expressiveness.
3. Reject any candidate that mispronounces a technical term or a number.
4. Only a candidate that passes **both** the blind panel and the latency
   budget (< 700 ms warm per short sentence) may be adopted.
5. Until then, `amy-low` remains the fallback and is described as a fallback.

**Status: NOT RUN.** No candidate was adopted, and none is described as
LÉLU's voice.
