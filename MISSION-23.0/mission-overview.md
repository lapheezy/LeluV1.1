# M23.0 — Mission Overview

**Mission:** LÉLU — Embodied Conversational Experience
**Class:** P0/P1 experience qualification
**Parent:** M22.9 Persistent Voice Runtime
**Baseline candidate:** `b46b0aa3` (M22.9 branch head)
**Canonical (untouched):** `543da7c8`
**Working branch:** `m23.0/embodied-conversational-experience`

---

## What this mission is for

M22.9 proved the *runtime*: one model initialisation for twenty sentences,
114 ms median warm synthesis, crash recovery, bounded queues, cancellation
without reloads, three delivery profiles, and zero stale responses in a
30-turn run.

What it could not prove is that a *person* can hold a conversation with her.
Eight limitations were left open, and four of them are not environmental —
they are defects in what the runtime does when something goes wrong:

1. No physical microphone acceptance.
2. No physical speaker acceptance.
3. Acoustic echo cancellation unmeasured.
4. False barge-in frequency unknown.
5. The seven-minute conversation used a recorded WAV, not live speech.
6. **Four of thirty simulated turns produced no speech.**
7. LÉLU's vocal identity unresolved.
8. Natural conversational behaviour not demonstrated with a human.

M23.0 does not rebuild M22.9. The persistent Piper architecture, the delivery
profiles and the warm-worker pool are preserved exactly; the work is in the
experience around them.

## The central finding

Item 6 was treated as the P0 it is. The four silent turns were reproduced
from the original evidence, traced to a cause that was *in the server log the
whole time*, and fixed:

> The M22.9 run was executed against free-tier model providers that were
> returning HTTP 429 (Groq tokens-per-minute and tokens-per-day exhausted,
> OpenRouter free-models-per-day exhausted) with retry windows of 11 s to
> 27 minutes. A refused reply is classified as a failure notice, and the
> voice engine's Mission 10.3 rule was "a failure notice is never spoken".
> The rule was right about not reading an error message aloud as her answer.
> It was wrong about the consequence: the person heard **nothing at all**,
> with no error, no failed request and no diagnostic record — which is exactly
> why the four turns could not be classified afterwards.

Two mechanisms produced the pairs (turns 18+19 and 28+29):

| Mechanism | Effect |
|---|---|
| Provider refusal (429) | reply is a failure notice → deliberately unspoken → silence |
| Turn supersede | the stalled turn is replaced by the next question; its stream is dropped on purpose, and nothing recorded the drop |

Both are now *recorded* and the first is *spoken*: every turn ends with a
reason in a per-turn ledger, and a refusal produces a short, fixed holding
line in her voice instead of silence.

## What was and was not possible here

| Capability | This container |
|---|---|
| Physical microphone | **absent** — no `/dev/snd`, no ALSA, no sound server |
| Physical speaker | **absent** |
| USB / PCI audio | **absent** — no such device nodes, no `lspci`/`lsusb` |
| Browser audio | works, against a *simulated* capture file |
| CPU / RAM | 8 vCPU, 16 GB, no GPU |
| Network | available (free-tier model providers, rate-limited) |

Everything measured in this mission is therefore **software acceptance with a
simulated microphone**. Physical acceptance is prepared, documented and
**BLOCKED**, never claimed.

## Work packages and status

| WP | Subject | Status |
|---|---|---|
| WP01 | Physical audio hardware discovery | VERIFIED (inventory); hardware absent |
| WP02 | Real microphone and speaker acceptance | BLOCKED (no device) — procedure prepared |
| WP03 | Acoustic echo cancellation, false barge-in | PARTIALLY VERIFIED (software); AEC BLOCKED |
| WP04 | The four silent turns | VERIFIED — root cause, fix, regression, 100-turn run |
| WP05 | Five-minute live human conversation | BLOCKED (no device) — protocol prepared |
| WP06 | LÉLU's vocal identity | VERIFIED investigation; identity still unresolved |
| WP07 | Personality and emotional expression | VERIFIED (delivery resolution + 30 replies) |
| WP08 | Runtime and resource qualification | VERIFIED (30-minute soak) |
| WP09 | Regression and independent verification | VERIFIED |

Per-gate scorecard: `release-qualification.md`.
