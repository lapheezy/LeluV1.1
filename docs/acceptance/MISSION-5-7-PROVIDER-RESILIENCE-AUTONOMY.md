# MISSION 5.7 — PROVIDER RESILIENCE & LIVE AUTONOMY COMPLETION

Isolated branch. Non-Anthropic only. Canonical untouched. Nothing rebuilt, and
no autonomy is claimed that did not happen.

**Headline: I found the real GitHub Models defect — and it is worse than a
missing credential.** The provider is not usable, `/api/model/status` says it
is, and the broker route answers with a body that is not a completion. The
live cycle still could not complete, because the only capable provider
returned 429 during the turns.

## 1. Starting state (verified)

`claude/mission-5-6-live-autonomy-completion` @ `59f9137`, local == remote, tree
clean, canonical `ce768e08…` unchanged, 60 evidence directories preserved,
`toolSchemasForRequest` and the `full → reduced → none` degradation present.
Branch: `claude/mission-5-7-provider-resilience-autonomy`.

## 2. Gate A — the GitHub Models mismatch, diagnosed

The directive's premise was that the token might be mis-mapped. It is not. Three
independent facts:

1. **`/api/model/status` reports configuration, not capability.** It answers
   "a key string exists", so it says `githubModels:true` even when nothing can
   authenticate. That is a reporting-semantics defect.
2. **The adapter refused brokered sends.** `GitHubModelsProvider.generate`
   threw *"GitHub Models token missing."* whenever there was no local key,
   without consulting `isBrokered()` — which the seven other brokered adapters
   all do. A brokered request carries no key by design; the server attaches it.
   **Fixed**, and pinned by a new regression test in
   `tests/broker-consolidation.test.ts` (14/14 pass).
3. **The route itself does not serve a completion.** Measured raw:

```
POST /api/model/githubModels/chat/completions
HTTP/1.1 200 OK
Content-Type: text/plain
Content-Length: 4

OK
```

That is not a model response. Mission 5.5's direct `/user` probe with the same
credential returned **401 Bad credentials**. So GitHub Models is
**INVALID-CREDENTIALS / UNAVAILABLE**, and fixing the guard alone cannot make
it work.

**What I did not do:** change the status endpoint. Making it truthful requires a
real per-provider capability probe — an architectural addition this mission
forbids ("no new subsystems"). It is recorded as an **open defect**, not
reported as fixed.

Provider matrix (verified, not assumed):

| Provider | Class | Evidence |
|---|---|---|
| Groq | **CAPACITY-LIMITED** | real 200 completion; `environment_compose` tool call proven in 5.5; another 200 observed live here |
| OpenRouter | CAPACITY-LIMITED | key 200, every chat 429 free-models-per-day |
| GitHub Models | **INVALID-CREDENTIALS** | broker 200 text/plain "OK"; 5.5 `/user` 401 |
| Cerebras / Mistral / Fireworks / Gemini | UNAVAILABLE | not configured |
| Anthropic | excluded by policy | not enabled, not used, not suggested |

## 3. Gate B — fallback and resilience

Unit-proven (9/9): size refusal degrades twice before dropping tools; a spent
daily allowance is *not* retried; a non-size refusal is *not* retried; the rung
budget never turns a user Stop into a fallback; the chain stops starting rungs
when its budget is spent.

Live: the chain advanced provider by provider (Groq 200 → Groq 429 →
OpenRouter 429), parked each refusal in cooldown, and ended with the app's own
*"No AI providers are available."* — no invented completion. A live
second-provider fallback completing a **tool** turn was not possible, because
the only capable provider and its alternates were simultaneously unavailable.
**PARTIAL.**

## 4. Gate C — tool budget

Mechanism verified by tests (8/8 scoping, 9/9 rung budget): an environment turn
carries the six environment tools; a refused turn retries with a reduced set
(≤3, environment family first) before any tool-less retry. The exact
prompt/history/schema **token split was not measured** — the turns that would
produce it were refused before a split could be logged. **PARTIAL**; no second
tool list exists and no capability was removed.

## 5. Gate D — renderer listeners

Mission 5.6's numbers (141→407 MB, 8,961→17,424 listeners, flat DOM) said
*that* accumulation happens, not *where*. I implemented attribution —
`DOMDebugger.getEventListeners` on window and document, aggregated by the
(script, line) that registered each listener — and captured the baseline:

| Sample | Listeners | Distinct source sites |
|---|---|---|
| window @ start | 63 | 57 |
| document @ start | 3 | 3 |

The **after-cycles sample is missing**: the probe exceeded its 280 s budget
while the live cycle probe held a browser. So: no leak is claimed, and none is
denied. The method is in place and is the correct next measurement.

## 6. Gates E–H, J — the live cycle

The Gate E instruction was submitted to the **real Chat Universe composer** in
a real browser session (guest entry, no injected responses). Three turns
recorded, 173 s / 171 s / 171 s, **one module window, contents `chat surface`**,
no page errors, no crashes. Requests: Groq 200, then Groq 429, then OpenRouter
429.

One Groq request genuinely succeeded — but no environment surface was created,
and the turns settled on the chat surface with the app's provider notice. The
deterministic "1 tool used · 1 issue" line from earlier missions is **not**
counted as autonomy.

| Gate | Status |
|---|---|
| E environment construction | **BLOCKED** |
| F self-inspection & correction | **BLOCKED** (nothing constructed; no defect invented) |
| G evolution & persistence | **BLOCKED** / NOT TESTED (5.6 verified only the storage plumbing) |
| H Cosmos presentation | **BLOCKED** (no rebuild attempted) |
| I memory & reflection | **PARTIAL** — wiring unchanged, live effect unverifiable |
| J end-to-end autonomy | **BLOCKED** |

## 7. Regression

`bunx tsc -b --force` **exit 0**. Targeted: broker-consolidation **14/14**,
provider-rung-budget **9/9**, tool-schema-scoping **8/8**. The full suite was
launched detached; its log is at `test-suite.log` and the result is whatever
that log states — if it did not finish in this session, that is a limitation,
not a pass. Mobile viewports: re-run this mission; if the sweep did not finish,
Mission 5.6's 4/4 PASS stands as the last verified measurement.

## 8. Changed

- `src/providers/GitHubModelsProvider.ts` — brokered-aware send-time guard
- `tests/broker-consolidation.test.ts` — regression pin for that guard
- `docs/acceptance/mission-5-7/` — probes, evidence, screenshots

No provider priority, credential, model id or canonical branch was touched. No
registry, dispatcher, engine or renderer was added or duplicated.

## 9. Remaining blockers

1. **Capacity**: Groq's free daily allowance is the only tool-capable path and
   it is intermittent; OpenRouter's free daily allowance is spent.
2. **GitHub Models is genuinely broken**, not merely unconfigured: its token is
   rejected (401) and its broker route returns "OK" rather than a completion.
3. **`/api/model/status` over-reports** configuration as availability — open
   defect, deliberately not papered over.

## 10. Merge-readiness

**Merge-ready as a fix; not complete as a milestone.** The GitHub Models guard
is a real, pinned correction. The autonomy lifecycle remains unproven, and the
evidence says so plainly.
