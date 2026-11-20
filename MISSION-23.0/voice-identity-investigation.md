# WP06 — Why the Medium Voices Fail (Investigation)

**Status: VERIFIED (root cause identified and reproduced).**

## The reported failure

M22.9 recorded that `amy-medium.onnx` and `voice.onnx` abort with:

```
[piper] [error] "aɪ" is not a single codepoint (ids=161,)
terminate called after throwing an instance of 'std::runtime_error'
  what():  Phonemes must be one codepoint (phoneme id map)
```

The hypothesis on the table in M22.9 was that the models were unusable. They
are not. They are **incompatible with this Piper build**, and the difference is
in the voice configuration, not the neural network.

## Reproduction

```
$ ./.piper/piper/piper --version
1.2.0

$ printf 'Hello there, this is a voice test.\n' | piper -m .piper/voices/amy-medium.onnx -f /tmp/t.wav
[piper] [error] "aɪ" is not a single codepoint (ids=161,)   ← aborts, no audio
```

The failure is **not** about the sentence. `amy-low` synthesises the same
text, and text full of diphthongs, without difficulty:

```
$ for t in "I like my bike at five." "Hello there, this is a voice test." \
           "The time is right for a bright light."; do
      printf '%s\n' "$t" | piper -m .piper/voices/amy-low.onnx -f /tmp/t.wav
  done
Real-time factor: 0.0449   ← "I like my bike at five."
Real-time factor: 0.0404   ← "Hello there, this is a voice test."
Real-time factor: 0.0416   ← "The time is right for a bright light."
```

## The difference is the phoneme map

Parsing the three voice configuration files:

| Voice | `phoneme_type` | espeak voice | sample rate | map keys | **multi-codepoint keys** |
|---|---|---|---|---|---|
| `amy-low` | *(absent)* | `en-us` | 16 000 | 130 | **0** |
| `amy-medium` | `espeak` | `en-us` | 22 050 | 166 | **5** (`aɪ aʊ ɔɪ eɪ oʊ`) |
| `voice` | `espeak` | `en-gb-x-rp` | 22 050 | 166 | **5** (`aɪ aʊ ɔɪ eɪ oʊ`) |

Piper 1.2.0 splits espeak's IPA output into **UTF-8 codepoints** and looks each
one up. A map keyed by whole phonemes (`aɪ` = one phoneme, two codepoints)
cannot be addressed that way, so the lookup throws. `amy-low` uses the older
single-codepoint map and works. This is a **runtime/model generation
mismatch**: the two medium voices require a runtime that maps phoneme strings
rather than codepoints.

**`voice.onnx` is not a second copy of `amy-medium`.** Same file size
(63 221 984 B) but different content and a different speaker:

```
$ sha256sum .piper/voices/*.onnx
a5a91abb…  amy-low.onnx
cf9ccdec…  amy-medium.onnx
1f9da809…  voice.onnx        ← dataset "alba", en-gb-x-rp, not "amy"
```

So the M22.9 record's "two failing models" are two *different* voices that fail
for the same, single reason. The failure is one defect, not two.

## What is NOT the cause

Ruled out by the evidence above:

* **ONNX Runtime** — the same `libonnxruntime.so.1.14.1` loads `amy-low` in
  114 ms.
* **Model corruption** — size and header are consistent; the abort happens
  after the model loads, inside phoneme lookup.
* **espeak-ng data missing** — `espeak-ng` and `espeak-ng-data` are present in
  `.piper/piper/` and produce IPA for `amy-low`.
* **Sample rate / audio config** — 22 050 Hz is not rejected anywhere; the
  throw is in `phoneme_ids`, before inference.
* **The sentence** — the same text succeeds on `amy-low`.

## What would fix it

One of these, in order of cost:

1. **A Piper build that maps phoneme strings, not codepoints.**
   The `piper-phonemize`-based runtimes accept multi-codepoint map keys. This
   is the clean fix and it makes all five medium voice models usable.
   Not executed in this mission: it requires downloading a different binary,
   and the fallback voice is not blocked (see `voice-identity-readiness.md`).
2. **A medium voice with a single-codepoint map.** Equivalent quality, same
   warm-worker path, no runtime change. Requires finding a voice published in
   the older format.
3. **Reject mismatched voices at load time instead of aborting the worker.**
   This is the operational fix, and it is what protects the runtime today: the
   pool must not spend a model load on a voice it cannot use. See
   `known-limitations.md` for the current behaviour and the guard that should
   follow.

## Conclusion

LÉLU's identity is not blocked by a broken model. It is blocked by a
**runtime-format mismatch** that is fully understood, isolated to two
identifiable voices, and fixable with a known substitution. `amy-low` remains
the operational fallback and is what every measurement in this mission used.
