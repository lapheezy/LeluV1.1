# WP07 — Personality and Emotional Expression

**Status: VERIFIED (delivery resolution and word preservation).**
Audio-character listening evaluation: **NOT TESTED** (no speaker).

## The three questions, kept separate

M22.9 proved the delivery profile reaches the synthesiser. It did not show the
profile is *hers*. M23.0 separates the three things that are easy to blur:

| Question | Authority | Measured how |
|---|---|---|
| **What** she says | her cognition (`AIService`, her identity, memory) | the words must survive delivery unchanged |
| **How** she says it | `speechDelivery.ts` → `speechProfile.ts` | one named profile, chosen by register |
| **Why** that way | her developed traits | a trait under development may not move it |

No parallel personality system was created. The resolver reads the same
`LeluIdentity` traits (`playfulness`, `patience`) that the rest of her
cognition uses, and only once the identity system itself considers a trait
developed (`emerging`, `established`, `evolving`). A `candidate` trait — an
observation, not a characteristic — cannot change her voice, which is what
stops one conversation being audible as a personality change.

## Result — 30 replies, 10 registers

```
30/30 registers classified as intended
30/30 replies kept every meaning-bearing term when spoken
30/30 replies resolved to a named profile

  supportive  3 → calm        humorous    3 → bright     correction 3 → calm
  serious     3 → calm        research    3 → calm       technical  3 → calm
  excited     3 → bright      long-form   3 → calm       question   3 → warm
  casual      3 → warm
```

Full artifact: `logs/personality-expression-matrix.json`.

**Register → delivery is deterministic and consistent:** three independent
replies in each register resolved to the same profile, so the delivery is a
property of what the reply is doing, not of which sentence happened to be
picked.

**The words do not move.** Every reply was passed through `toSpokenText`, the
only component allowed to reformat for the ear, and every meaning-bearing term
survived: *Lima*, *Cusco*, *tsc*, *endpoint*, *commit*, *branch*. Numbers are
spoken, not spelled — `114 milliseconds` becomes *one hundred fourteen
milliseconds* — which is correct for an ear and is why the check accepts
either form.

**Her personality actually changes delivery**, in a bounded way — 12 of 30
replies:

| Identity | Effect |
|---|---|
| seed (no developed traits) | register alone decides |
| playfulness developed (0.7 × 0.75) | casual / question / humorous pull one step → `bright` |
| patience developed (0.8 × 0.8) | `bright` pulls back → `calm`; patience outranks playfulness |
| playfulness as a *candidate* trait | no effect at all |

That last row is the important one: an undeveloped trait is silent, so her
voice cannot flicker with a passing observation.

## Required capabilities — coverage

| Capability | How it is expressed | Status |
|---|---|---|
| Casual conversation | `warm` | VERIFIED (3 replies) |
| Technical explanations | `calm` (measured pace) | VERIFIED (3) |
| Curiosity | question register → `warm`, bright with developed playfulness | VERIFIED (3) |
| Humour | `bright` | VERIFIED (3) |
| Excitement | `bright` | VERIFIED (3) |
| Calm reassurance | `calm` | VERIFIED (3) |
| Serious communication | `calm` | VERIFIED (3) |
| Corrections | `calm` — a correction is not a mood | VERIFIED (3) |
| Expressive emphasis | profile-level pace/variation, per sentence | PARTIALLY VERIFIED — no per-word emphasis exists |
| Context-appropriate pauses | `sentenceSilence` per profile (0.14–0.30 s) | PARTIALLY VERIFIED — sentence-level only |

## What this does not establish

* **Naturalness, warmth and expressiveness are listening judgements.** No
  speaker exists here, so nobody heard these 30 replies. The profile mapping is
  verified; the *sound* is not.
* Emphasis is per-sentence prosody, not stress on a chosen word. Piper 1.2.0
  offers no word-level control, and inventing one out of SSML the engine
  ignores would be a claim without a mechanism.
* Pauses are between sentences. A pause *inside* a sentence for dramatic effect
  is not implemented.
