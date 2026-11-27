# Narration acceptance — Mission 44.4 (WP01)

All turns below ran in the **real app** (browser, `https://pv-08af6cc9ef21-…freebuff.site/`,
dev server on `127.0.0.1:3001`) against the **real broker** and the **real laboratory API**.
Captured 2026-11-27.

## What "fresh conversation" means here

A new conversation was created with the Universe's own **New chat** control; the composer
reported the target as `New chat` before the first send (`targetBefore: "New chat"`), and the
thread contained exactly one user message before the reply arrived. It has no prior turns.

Honest qualification: this is a new **conversation**, not a new browser profile. The app's
persisted store still held three older conversations (restored as windows on reload); their text
is never replayed into a new conversation, but it is visible in the app. Nothing from them was
sent to the model in these turns — the captured request bodies show only the new thread.

## The first defect this found: laboratory POSTs refused behind the preview proxy

Question 1:
> "From your laboratory journal: what exactly does the record contain? Use your laboratory tools
> and quote the fields. If the record does not say what an experiment built, say so explicitly."

Network trace of that turn (recorded by wrapping `window.fetch` in the page):

```
POST /api/execution/events                       403
POST /api/model/openrouter/chat/completions      200   (request 24,000 bytes)
GET  /api/lab/journal                            200
GET  /api/lab/journal                            200
POST /api/execution/events                       403
POST /api/model/openrouter/chat/completions      200
```

The model's tool calls were refused by the laboratory:

```
lab_history    — done:   2026-11-27T05:33 scheduler-cycle
lab_history    — failed: "lab.history" failed: Cross-origin laboratory requests are not permitted.
lab_history    — failed: "lab.history" failed: Cross-origin laboratory requests are not permitted.
lab_experiment — failed: "lab.experiment" failed: Cross-origin laboratory requests are not permitted.
lab_history    — done:   2026-11-27T05:33 scheduler-cycle

2 step(s) succeeded and are saved; 3 failed.
```

The answer was a **partial**, and it said so:

> Partial result — the job is NOT complete. OpenRouter stopped before I could finish (OpenRouter
> timed out after its 12.0s budget.). What actually ran: … 2 step(s) succeeded and are saved;
> 3 failed. Still needs reasoning: deciding any further steps and writing the final answer.
> Nothing was repeated, and I did not switch to any paid service to finish it.

**Cause, measured:** `plugins/labApi.ts` compared `new URL(origin).host` with `Host` only. The
preview proxy forwards with `Host: 127.0.0.1:3001` while the page's origin is the public preview
host. A GET omits `Origin` and passed; every POST carried it and was refused. So reads worked and
every action failed — exactly the failure shape above.

**Fix:** the same three rules the broker already uses (`crossOrigin` in `plugins/modelApi.ts`):
`Sec-Fetch-Site: same-origin`, the `LELU_LAB_ALLOWED_ORIGINS` allowlist, then host equality
**including `X-Forwarded-Host`**. A genuinely cross-site page still fails all three.

**Live proof after the fix** (`curl` against the running server, no key printed):

| Request | Result |
|---|---|
| `POST /api/lab/experiment` with the real page `Origin` + token + `Sec-Fetch-Site: same-origin` | **400** `"This action needs an experiment id."` — the origin gate was passed, request reached validation |
| same request from `Origin: https://evil.example` | **403** `Cross-origin laboratory requests are not permitted.` |

Regression tests: `tests/self-development-lab.test.ts` → 16/16, including the three new origin
cases (proxy-rewritten host served, same-origin account accepted, cross-site still refused).

## Grounded answer that then succeeded (experiment history)

Question 2, same conversation, with the origin fix live:

> "Which experiments does your laboratory record list? Give their ids and statuses exactly as
> recorded, and state plainly what the record does not contain. Use your laboratory tools."

The reply:

> Laboratory experiment record (exact fields):
>
> | Experiment ID | Status | Base commit | Notes |
> | exp-engineer-ops | open | 543da7c | preview on :3002 |
> | exp-work-queue-check | abandoned | 543da7c | commit a6d1e45 |
> | exp-api-error-status | abandoned | 543da7c | commit 5e88ccd |
> | exp-verification-honesty | abandoned | 543da7c | (no commit recorded) |
> | exp-work-queue-check-v2 | verified | 543da7c | commit 5e87d34 |
> | exp-api-error-status-v2 | verified | 543da7c | commit 810ac33 |
> | exp-verification-honesty-v2 | verified | 543da7c | commit c7a1f2e |
> | exp-experiment-selector | verified | 543da7c | commit 5ff4a33, preview on :3002 |
>
> What the record does NOT contain: any description of what each experiment intends to build or
> change; any narrative of what an experiment actually built (the record only shows worktree
> existence, ancestry, status, and commit hashes); timestamps, authors, or detailed diffs; test
> results, verification evidence, or acceptance criteria.
>
> The tool's own LIMITS note confirms: "It reports worktrees, ancestry and status. It does not
> report what an experiment intends or what it will change."

Every row matches `git worktree list` exactly (branch, base commit `543da7c`, status). No count of
"zones/hubs/links" appears anywhere. The refusal text is the tool's own, not the model's invention.

## Repository / commit / scheduler questions

Question 3 (repository status, commit history, scheduler): the model called `lab.repository` and
the **tool card** in the transcript reported the real values:

```
[completed] Get lab repository status (lab.repository) —
Repository: lapheezy/LeluV1.1 on mission/44-4-recovery-acceptance
HEAD: adaa97a — "Record the Mission 44.3 checkpoint and final commit in its report"
(Codebuff, 2026-11-26T13:39:31+00:00)
Working tree: …
```

This is correct (44.3's version guessed "typically main/master"). The **final prose reply did not
arrive**: the turn stopped after the tool card. This is a provider-side limit, not a narration
defect — see the next section.

Question 4 (scheduler, retried in the same conversation): fell through to Groq and produced:

> Partial result — the job is NOT complete. Groq stopped before I could finish (Groq returned no
> usable content.). What actually ran: tools_catalog — done; tools_catalog — done. All 2 step(s)
> that ran succeeded and are saved. … I did not switch to any paid service to finish it.

So the scheduler question has **no grounded chat answer** in this mission. The scheduler's real
state was verified directly instead (see `scheduler-recovery.md`), not narrated.

## Provider behaviour behind these partial results

| Provider | Observed on these turns |
|---|---|
| OpenRouter (`nvidia/nemotron-3-ultra-550b-a55b:free`) | streams reasoning first; killed by the page's **12.0 s** per-rung budget on multi-tool turns |
| Groq (`openai/gpt-oss-120b`) | fast for a single call (0.24 s measured in 44.3), but **"returned no usable content"** on the tool-catalogue turn |

Both failures are reported by the app **honestly**, with the tools that ran and the tools that
failed, and neither invents a result. The 12 s budget and Groq's empty-content path are recorded
as limitations of this mission, not fixed here: changing a global stall budget is not a change
to make on this evidence alone.

## Verdict for WP01

- Laboratory questions reach the **real model**, not the spatial builder (no canned spatial reply
  appeared in any fresh turn; the `LAB_RECORD` guard from 44.3 holds).
- Tool results carry `SOURCE:` / `LIMITS:` into the model request: verified by capturing the
  request body — it contains both markers (`provenance: true` in the recorded trace).
- The model uses those results and repeats **no** unsupported historical claim: the experiments
  answer is field-for-field true and explicitly lists what the record cannot support.
- A fresh conversation **can** produce a complete grounded answer (experiments). It does not yet
  reliably produce one for every question, because the free providers fail or time out mid-turn;
  the app degrades to an honest partial rather than to invention.
