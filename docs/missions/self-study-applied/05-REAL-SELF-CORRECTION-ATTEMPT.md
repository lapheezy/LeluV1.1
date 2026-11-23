# Real self-correction attempt: result

Owner's instruction (on accepting improvement 2): *"make sure she uses it and actually corrects something herself."*

**Result: she did not correct anything yet.** Nothing was planted to make it happen. Everything below is from real runs.

## What ran

| | Run 1 (2026-11-16 ~19:55 UTC) | Run 2 (2026-11-17 00:21 UTC, after quota reset) |
|---|---|---|
| Source access | Real development runtime: an isolated worktree served by `server.ts` | same |
| Background allowance | default 10/day, paced (not raised) | same |
| Model calls spent | 1, refused: Groq daily token limit → background paused until UTC midnight | 1, answered by Groq |
| Conclusions | 37 no-change, 1 insufficient (all deterministic) | 37 no-change, 2 insufficient (deterministic) + 1 insufficient (model) |
| "Change" proposals | 0 | 0 |
| Evidence | `evidence/real-run-1-dev-runtime-40-cycles.json` | `evidence/real-run-2-after-reset.json` |

Her own checks in a real browser (Chromium, Vite build): **23/23 self-tests pass, and diagnostics show 0 warnings and 0 errors.** None of her deterministic instruments currently sees anything broken.

## What she spent her one call on, and what that teaches

In run 2 the allowance let her make one model call. She spent it on cycle 1, a knowledge-gap study, *"What do I actually know about Latest frontier model architectures, and is it true?"* The model's conclusion was honest:

> The provided evidence contains only failed YouTube and news searches and a handful of unrelated arXiv papers; none address current frontier model architectures, benchmarks, or pricing.

So her scarce call went on evidence that was mostly failed searches. The rule that decides when a study deserves a model call looks at *where a question came from*, not at *whether the evidence can support a judgement*. That is a concrete, evidenced weakness in how she spends her allowance, and a candidate for the next improvement.

## A real defect in her own records she has not found herself

`SelfStudyEngine.failureSignature` strips every number from an evidence line. It also treats a summary line containing "failed" as a failure. Real objectives produced:

- `What is causing this failure: provider Groq — priority ., enabled, IN COOLDOWN, …?` (run 1, cycle 4)
- `What is causing this failure: Self-test suite: / passed, failed?` (from "22/23 passed, 1 failed", in the development-record tests)

This is not fixed. If it were fixed by hand it would not be her correction.

## Why she could not get further tonight

- Each conclusion that needs judgement needs a model call. Under the owner's allowance she gets at most 10 a day, spaced about 2.4 h apart.
- A fix also needs model calls: her `ProposalEngineer` writes the code. Those are owner-approved development and do not count against the background allowance, but they still need provider quota.
- Provider state in this environment: Groq answers again; OpenRouter's free daily requests and the Cerebras key failed earlier; Anthropic is disabled by policy.

## Options (owner's decision)

1. **Wait:** she keeps studying at 10 calls a day and may find something over the coming days.
2. **Raise the allowance** temporarily in Settings → Usage & budgets.
3. **Give her an objective:** for example, "fix the malformed failure questions in your self-study". It would be your objective, not her own discovery, but her own loop would do the work through both gates.
4. **Make improvement 4 "spend calls only where the evidence can support a judgement"**, the weakness her own run just showed.
