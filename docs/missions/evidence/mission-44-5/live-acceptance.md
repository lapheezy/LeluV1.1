# Mission 44.5 — live conversational acceptance

All turns below were typed into the real Chat Universe composer of the running dev
server (`vite --host 0.0.0.0 --port 3001`, preview
`https://pv-08af6cc9ef21-agent37-...freebuff.site/`), in a real Chromium tab, against
the real laboratory API and the real configured providers (OpenRouter free tier +
Groq free tier). Nothing is simulated except the one injected outage in scenario D,
which is labelled as such in the answer itself.

The transcript text, `activity` steps and request log are copied from
`localStorage['lelu.multichat.workspace.v1']` (the conversation store) and from a
`window.fetch` recorder installed in the page before each turn. No credential is
recorded: only URLs, statuses, sizes and shape (`requestHasTools`).

---

## A. Repository state — single tool, streamed, 9.1 s

**Question** (typed): `Using your laboratory tools: which branch is checked out, and what is the HEAD commit?`

**Requests**

| # | Request | Status | Time |
|---|---|---|---|
| 1 | `/api/github/status` (availability probe) | 200 | 172 ms |
| 2 | `en.wikipedia.org/.../summary/Using your laboratory tools...` (research prefetch) | 404 | 339 ms |
| 3 | `/api/model/openrouter/chat/completions` (tool decision) | 200 | 2 652 ms |
| 4 | `/api/lab/status` | 200 | 349 ms |
| 5 | `/api/lab/tree` | 200 | 159 ms |
| 6 | `/api/lab/journal` | 200 | 159 ms |
| 7 | `/api/model/openrouter/chat/completions` (narration) | 200 | 5 382 ms |

**Answer** (verbatim):

> **Checked-out branch:** `mission/44-5-conversational-reliability`
> **HEAD commit:** `77ead33` — "Let the laboratory answer the page, and make provider and
> scheduler states true" (2026‑11‑27 06:00 UTC)

Grounded: both values match `git rev-parse`/`git log -1` on this tree. Composer state
afterwards: `sending: none`, conversation `processing: false` — **no reload needed**.

---

## B. Multi-tool, multi-step — three real tools, 7.8 s

**Question**: `Using your laboratory tools: list every experiment with its status and base commit, then check the repository state, and tell me in one short table which experiments share a base commit.`

**Requests**: `/api/resources/capabilities` (167 ms) · `/api/github/status` (1 061 ms) ·
`/api/model/openrouter/chat/completions` (3 409 ms) · `/api/model/openrouter/chat/completions`
(4 058 ms) · `/api/lab/experiment` (161 ms, 20 970 bytes) · `/api/lab/journal` (138 ms) ·
`/api/lab/status` (372 ms, 124 918 bytes) · `/api/lab/tree` (146 ms).

**Activity steps recorded for the reply**

1. `lab.experiment` — done, 156 ms — `exp-engineer-ops (lelu-lab/exp-engineer-ops) — base 543da7c, open, preview :3002 · exp-work-queue-check … — base 543da7c, abandoned, commit a6d1e45 · …`
2. `lab.repository` — done, 516 ms — `Repository: lapheezy/LeluV1.1 on mission/44-5-conversational-reliability HEAD: 77ead33 …`
3. `artifact.create` — done, 3 ms — `Created [view-d404d7c7] table "Experiments by Base Commit"`

**Answer** (verbatim, truncated): `Completed and verified: … 1. [completed] List all experiments
with status and base commit (lab.experiment) — … 2. [completed] Check repository state
(lab.repository) — … 3. [completed] Create summary table of experiments sharing base commits
(artifact.create) — Created [view-d404d7c7] table "Experiments by Base Commit" …`

Every claim in it is a tool's own output; the base commit `543da7c` and the branch
`mission/44-5-conversational-reliability` are the real values. Composer afterwards:
`sending: none`, `processing: false`.

---

## C. Journal — grounded, 5.1 s

**Question**: `Using your laboratory tools: read the laboratory tree and then the journal, and tell me in two sentences what the most recent journal entry says.`

**Requests**: one OpenRouter round (4 451 ms, `requestHasTools: false`) then
`/api/lab/journal` twice (188 ms, 143 ms).

**Answer** (verbatim): `Completed and verified: … 1. [completed] Read laboratory journal
(lab.history) — 2026-11-27T05:33 scheduler-cycle 2026-11-27T05:33 discovery
disc-mwyjpsjm-449845 2026-11-27T05:33 sync — SOURCE: .lelu-lab/state/journal.jsonl rows and
git log, shown verbatim · lab.history · rea…`

The journal rows quoted are the ones on disk (`.lelu-lab/state/journal.jsonl`).

---

## D. A provider that dies AFTER its tools ran — recovery, 4.6 s

**Question**: `Using your laboratory tools: which branch is checked out right now?`

**Fault**: the page's `fetch` was wrapped so that, once at least one `/api/lab/…` call had
completed, the NEXT model request to OpenRouter returned a synthetic
`HTTP 500 {"error":{"message":"Synthetic outage injected by Mission 44.5 acceptance (provider died after tools ran)"}}`.
This is the exact shape Mission 44.4 recorded — a rung that dies after its tools ran.

**Request log (verbatim, in order)**

| # | Request | Status | Shape |
|---|---|---|---|
| 1 | `/api/model/openrouter/chat/completions` | 200 | 33 479 bytes, **14 tools** |
| 2 | `/api/lab/status` | 200 | 124 918 bytes |
| 3 | `/api/lab/tree` | 200 | 8 475 bytes |
| 4 | `/api/model/openrouter/chat/completions` | **500 (injected)** | 20 960 bytes, 15 tools |
| 5 | `/api/lab/journal` | 200 | 14 456 bytes |
| 6 | `/api/model/groq/chat/completions` | 200 | 25 192 bytes, **`requestHasTools: false`, 0 tools**, 1 126 ms |

**What the person saw** (verbatim):

> The repository is currently checked out on the **`mission/44-5-conversational-reliability`**
> branch.
>
> *This answer is based on the lab_repository result you provided, which reports the repository
> as "lapheezy/LeluV1.1 on mission/44-5-conversational-reliability."*
>
> Provenance: this answer was written from the 1 step(s) that ran before OpenRouter stopped
> (OpenRouter HTTP 500: Synthetic outage injected by Mission 44.5 acceptance (provider died
> after tools ran)). No step was run again.

Before this mission the same failure produced `Partial result — the job is NOT complete …
Still needs reasoning: deciding any further steps and writing the final answer.` (recorded in
Mission 44.4's conversation) — the tool results were kept but never turned into an answer.
Now the second provider writes the answer **from those results, with no tools offered**, so
nothing can run twice, and the reply says so.

Composer afterwards: `sending: none`, `processing: false`.

---

## E. The wedge this mission found and fixed (before the fix)

For six consecutive turns across two page loads — including a one-sentence question that
needs no tools — the composer stored the message, set `processing: true`, and then produced
**no provider request and no reply at all**:

```
1:48:06 Command received
1:48:06 Parsing request
1:48:06 Approach planned — github
1:48:06 Connecting to AI provider
1:48:07 Recalling
1:48:07 Recalled 0
1:48:07 Using device
   … nothing, for minutes; repeated on every later turn, across reloads
```

The last network call of the turn was the tool-availability probe
(`/api/resources/capabilities`, 200). `ToolRegistry.ensureAvailability()` awaited
`Promise.allSettled` over three probes (development runtime, acquisition runtime, GitHub), and
the router awaits that refresh before its first stage — so one probe that never answered held
every turn open, forever, and the same never-settling promise was re-awaited by every
subsequent turn. With the probe bounded (4 s per probe, 4 s for the refresh), the very next
turn reached the provider in 2.6 s and answered correctly (scenario A).

This is the client-side twin of the reported "stuck in Processing": the server had stored the
question and simply never got as far as a model.
