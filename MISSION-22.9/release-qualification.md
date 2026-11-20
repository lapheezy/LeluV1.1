# RELEASE QUALIFICATION

**Branch:** `m22.9/persistent-voice-runtime`
**Baseline:** `43db0a06` (M22.8 candidate)
**Canonical:** `543da7c8` — untouched.

## Decision

> **CONDITIONALLY APPROVED — for the M22.9 branch only.**
> Not promoted, not merged, canonical untouched. Promotion requires explicit
> authorization, and the conditions below are what a promotion review should
> weigh.

## What qualifies

1. **The primary engineering target is met.** Her voice model is loaded once
   and stays loaded: 20 consecutive sentences, **1 model load**, one PID,
   median **114 ms** per sentence against 453 ms cold (−75 %), 2.5 s versus
   9.2 s of wall time for 20 sentences (measured, `logs/warm-runtime.json`).
2. **The end-to-end pipeline improved in a real browser.** Transcript →
   first audio median **3 518 → 2 480 ms** (−29 %), P90 **5 721 → 3 664 ms**
   (−36 %), across 30 turns in a 7-minute session.
3. **Recovery is implemented and tested**, not asserted: crash → reported →
   replaced; unloadable model → named as a load failure; cancellation → does
   not cost the model; queue → bounded; shutdown → kills the workers.
4. **Delivery is now hers.** Three profiles resolved from her developed
   identity, 30 representative replies tested, and the same sentence measures
   5.10 / 5.24 / 5.60 s across the profiles.
5. **Diagnostics tell the truth**, including `cloned: false`,
   `voiceIdentity.status: fallback`, `hardware.verified: false`, and the real
   worker facts.
6. **No regression:** typecheck 0, build 0, lint 0 errors, full suite and
   voice suites reported in `M22.9-verification-report.md`.
7. **The fallback still exists and is tested.** `LELU_PIPER_PERSISTENT=0`
   restores the M22.8 PCM path exactly, and a warm failure falls back to it
   automatically.

## Conditions (why not unconditional)

1. **No hardware acceptance.** There is no audio device in this environment.
   G6 and G7 are BLOCKED. Nothing here proves a person can hear her or be
   heard by her.
2. **First-audio still misses the 2 s target** (median 2.48 s, P90 3.66 s).
   The speaker is no longer the bottleneck; the model's first sentence is.
   Any claim that "the latency target is met" would be false.
3. **Her voice identity is not established.** The only loadable voice is
   `amy-low`, and two other models abort. No listening evaluation has run.
4. **The five-minute conversation is simulated**, and three of its ten
   scripted beats (correction, contextual reference, topic return) did not
   run.
5. **Four of thirty turns produced no speech.** Named in
   `five-minute-conversation-acceptance.md`; unexplained at the model level
   and worth a follow-up.
6. **Streaming granularity regressed** (per sentence, not per sample) as the
   price of the warm model. Measured and judged a net win, but it is a trade.

## Promotion advice

A promotion review should treat items 1–4 of the conditions as **blocking a
"voice is finished"** statement while **not blocking the runtime change**,
which is independently valuable, measured, reversible
(`LELU_PIPER_PERSISTENT=0`) and covered by tests. Item 5 deserves one
investigation before any claim of conversational reliability.
