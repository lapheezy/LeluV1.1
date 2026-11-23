# WP06 — Vocal Identity Readiness

**Status: UNRESOLVED — and honestly labelled as such.**

| Label | Meaning | Applies to |
|---|---|---|
| **Generic fallback** | a working voice that is not her identity | `amy-low` — **the only voice in use** |
| **Candidate voice** | a model that would be evaluated if it ran | `amy-medium`, `voice` (alba) — both blocked by format |
| **Verified LÉLU identity** | a voice proven by listening to be hers | **none** |

## What the runtime reports, and what it must never report

The server's own diagnostic already refuses the claim:

```json
"voiceIdentity": { "name": "Lélu", "provider": "piper", "status": "fallback", "cloned": false }
```

`status: "fallback"` and `cloned: false` are read from the runtime, not written
by this document. No artifact in M23.0 describes Piper output as her cloned or
verified voice, and no listening claim is made anywhere, because no speaker
exists in this container.

## What changed in M23.0

Nothing about the voice itself. What changed is that the *reason* the medium
voices fail is now known and reproducible:

* not a corrupt model,
* not ONNX Runtime,
* not a missing espeak data set,
* but a **phoneme-map format mismatch** — five multi-codepoint keys
  (`aɪ aʊ ɔɪ eɪ oʊ`) that Piper 1.2.0 refuses because it looks phonemes up by
  codepoint.

That converts "unresolved" from a mystery into a bounded engineering task.

## The shortest path to a better voice

| Step | Cost | Effect |
|---|---|---|
| 1. Obtain a Piper build that maps phoneme strings (piper-phonemize lineage) | one binary | unlocks `amy-medium` **and** `voice` (alba, en-GB RP) |
| 2. Or obtain a medium model published with a single-codepoint map | one model | same quality, no runtime change |
| 3. Validate warm-worker compatibility | one soak run | confirms 22.05 kHz and the profile flags survive |
| 4. **Listen** to the same script in all three profiles | needs a human with a speaker | the only step that can promote an identity |
| 5. Record the decision and the reason | one document | stops the fallback drifting into a claim |

Steps 1–3 are engineering and could be done without a listener. They were not
done in this pass because they require downloading a different binary or model
under a 4 GiB budget, and because doing them *without* step 4 would still leave
the identity unresolved — the same verdict, with more disk used.

## Guard that should follow

The warm pool currently discovers an unusable voice the hard way: the worker
loads a 63 MB model, the binary aborts on the first sentence, and the pool has
to classify the death as a crash and respawn. A pre-flight check is cheap and
should be added before any medium voice is adopted:

> read `<model>.onnx.json`, count phoneme-map keys longer than one codepoint,
> and refuse the voice with a clear message if the runtime cannot address them.

That turns a crash loop into a startup error. It is recorded in
`known-limitations.md` as the one operational gap this mission leaves in the
voice-identity area.

## Verdict

**LÉLU does not yet have her own voice.** She has a working, measured,
correctly-labelled fallback and a understood path to a better one. Claiming
more than that would be exactly the kind of evidence-free statement this
mission forbids.
