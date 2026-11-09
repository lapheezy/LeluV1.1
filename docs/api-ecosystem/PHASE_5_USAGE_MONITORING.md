# Phase 5 — Usage, Token, Cost and Resource Monitoring

**Status:** PARTIAL.
- Done: AI and knowledge-source accounting, aggregation, persistence and source budgets.
- Not done: AI-provider budgets are not enforced (recorded only). Usage is stored per browser (localStorage), not synced to Supabase or aggregated server-side. No price table exists, so AI cost is "unknown" unless a provider reports it.
**Code commit:** `c274436`

## Design (`src/core/observability/UsageLedger.ts`)

| Recorded | Source of truth |
|---|---|
| AI call: provider, model, ok/failed, latency, rate-limited | `ProviderResolver.meteredGenerate`, which wraps **every** `provider.generate` of the tool loop. Recording only the final response would undercount: one answer took 4 billed calls in the live run. Failures are recorded at `markFailure`. |
| Tokens: input, output, cached input, reasoning | Normalised from the provider's own `usage` (Anthropic `input_tokens…`, OpenAI-compatible `prompt_tokens…/…_details`, Gemini `…TokenCount`). Not reported → `null`. |
| Cost | `reported` only when the provider returns `usage.cost`; otherwise `unknown` and counted in `unknownCostCalls`. Never estimated. |
| Knowledge-source call: source, ok/failed, latency, results, rate-limited (429 / "rate limit" in the error) | `ResearchResolver.runProviders`, which every source call passes through |
| Aggregates | Per day × source, kept 62 days. Views: session, today, 7 days, month. Persisted in `localStorage` (`lelu.usage.v1`) with the last 100 events. |
| Budgets | Per source: `dailyCalls`, `monthlyCalls`, `dailyTokens`. A warning at ≥ 80 %; a **hard stop** at the cap, checked before the call. The refusal is recorded as the attempt's error, so the turn says why the source was skipped. Never reroutes to a paid source. |

## Live data (real calls, desktop currency turn)

| Event | Values |
|---|---|
| Fireworks generate #1 | 1,031 in / 475 out tokens, 3.0 s |
| frankfurter | ok, 1 result, 4.6 s |
| wikipedia | ok, 0 results, 1.3 s |
| gdelt | failed "gdelt timed out", 12.4 s |
| rss | failed "rss timed out", 4.2 s |
| Fireworks generate #2, #3 | 16,621 / 113 and 618 / 297 tokens |
| Cost | Unknown for every call (Fireworks reports no cost) |

[evidence/phase4/usage-desktop.png](evidence/phase4/usage-desktop.png) shows these rows in the app.

## Tests (offline)

- Usage normalisation across provider families, including absent → `null` (not 0).
- Aggregation by period; a new day starts at 0; aggregates survive a reload; a new session starts empty.
- Budget: warning at 4/5 (80 %), refusal at 5/5, per-source isolation.
- `ResearchResolver` integration: a call is recorded, and an over-budget source **is not called**.

## Anthropic

`ANTHROPIC_API_KEY` is **not set** in this container, so Anthropic could not be exercised live and is reported as unconfigured. Its `usage` shape (`input_tokens`, `output_tokens`, `cache_read_input_tokens`) is covered by the normalisation test. Routing and priority were not changed.
