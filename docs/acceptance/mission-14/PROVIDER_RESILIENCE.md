# MISSION 14.2 — PROVIDER RESILIENCE AND INTELLIGENT FAILOVER

Date: 2026-11-15
Repository: `lapheezy/LeluV1.1`
Branch: `freebuff/8994d7c2e03123fc8927b6fc`

## Result

**PARTIAL — live cooldown enforcement and recovery are verified; long-window recovery and a full tool turn under an 8k TPM cap remain blocked.**

The existing provider architecture was preserved. No parallel provider registry, orchestrator, LangGraph/LangChain or paid dependency was added.

## Implementation

### Rate-limit intelligence — `plugins/modelApi.ts`

- `noteRetryAfter()` now learns a credential’s next usable time from, in order:
  1. Groq’s body text `try again in 27.3s / 35m36s`;
  2. the HTTP `Retry-After` header (seconds or date);
  3. `X-RateLimit-Reset` (Unix seconds or milliseconds);
  4. OpenRouter’s `metadata.headers["X-RateLimit-Reset"]` inside the JSON error.
- Cooldowns are per credential, capped at 24 hours, and keep the **later** of an existing and a new deadline.
- When **every** configured credential for a provider is cooling, the broker answers `429` with `code: PROVIDER_COOLDOWN`, `Retry-After`, `retryAfterAt` and `retryAfterSeconds` **without calling upstream**. This removes the retry loop that previously hit the same spent keys on every round.
- A real 2xx clears the serving credential’s cooldown, so recovery is observed rather than assumed.
- Short retry hints (≤ 8 s, inside the page’s 12 s rung watchdog) are still waited out on the last key. Longer windows are returned immediately.
- `/api/model/status` now reports `retryAfterAt` / `retryAfterSeconds` and sets `providers[id] = false` while every credential is cooling. `CONFIGURED` is still never treated as “working”.

### Provider-health surface

- `src/core/model/ProviderHealth.ts`: `BrokerProviderObservation` carries `retryAfterAt` and `retryAfterSeconds`; `deriveBrokerHealth` forwards them.
- `src/app/scene/genesis/GenesisCognitionPanel.tsx`: Continuity tab shows `· retry in Ns` next to provider failures.
- Existing provider identity, availability, last success, last failure, failure status and evidence timestamps are unchanged.

## Live verification

All calls went through the real same-origin broker on the real dev server. No credentials are recorded.

### A. Failover and recovery

| Step | Result |
|---|---|
| Status before | `openrouter CONFIGURED`, `groq CONFIGURED`, no success/failure yet |
| OpenRouter request 1 | **429** on all three configured credentials (`free-models-per-day`) |
| OpenRouter request 2 | **429 `PROVIDER_COOLDOWN`**, upstream not called again |
| Groq `openai/gpt-oss-20b` | **200** real completion object; status became `COMPLETION_VERIFIED` with `lastSuccessAt` |
| Status after | OpenRouter `CAPACITY_LIMITED`, Groq `COMPLETION_VERIFIED` |

The first sequence shows a provider recovering from a prior 429 to a real 200. The OpenRouter cooldown reset is about 8 hours away, so its own recovery was **not** waited for.

### B. Selection after final code

| Step | Result |
|---|---|
| OpenRouter status before | `available: true`, `CONFIGURED` |
| First OpenRouter 429 | all credentials tried once |
| Second OpenRouter request | local `PROVIDER_COOLDOWN`, `retryAfterSeconds: 29334` |
| Status after | `available: false`, `retryAfterAt: 1794787200000` |

This confirms a cooling provider is removed from the offered chain, not merely annotated.

## Required-scenario matrix

| # | Scenario | Status | Evidence |
|---|---|---|---|
| 1 | All providers healthy | **PARTIAL** | Groq returned a live 200; OpenRouter was already exhausted. Three providers configured; all healthy simultaneously was not observed. |
| 2 | Primary returns 429 | **VERIFIED live** | OpenRouter 429 on three credentials; cooldown served locally on retry. |
| 3 | Primary returns 401 | **VERIFIED in test (mocked upstream)** | `tests/model-broker.test.ts` existing invalid-key test. No live credential was damaged to force it. |
| 4 | Primary returns 500 | **VERIFIED in test (mocked upstream)** | New test: 503 passes through and status becomes `UNREACHABLE`. |
| 5 | Malformed completion | **VERIFIED in test (mocked upstream)** | New test: 200 `text/plain` becomes `BROKER_CONTRACT_VIOLATION`, status `CONTRACT_VIOLATION`, no success timestamp. |
| 6 | HTTP 200 but invalid content | **VERIFIED live** | GitHub Models still returns `200 text/plain "OK "`; broker returns 502 contract violation. |
| 7 | All remote providers unavailable | **NOT OBSERVED THIS RUN** | Groq served a real 200; OpenRouter and GitHub Models were unavailable. |
| 8 | Local fallback available | **VERIFIED live** | Mission 14.1 attempts stored provider `offline`; the local projector answered without tools. It does **not** perform continuity retrieval. |
| 9 | Provider recovers after cooldown | **PARTIAL** | Groq recovered from earlier 429s to a 200 with a success timestamp. OpenRouter’s 8-hour reset was not waited for. |
| 10 | Tool-enabled conversation survives provider switching | **VERIFIED (follow-up)** | OpenRouter 429 → Groq ran `mission.find`, `mission.brief`, `mission.update` and wrote the final answer in conversation `4903d20a-4cbb-4389-a441-16ac463ed39a`; `provider: Groq`, `source: ai`. |

## Tests and checks

| Check | Result |
|---|---|
| `tests/model-broker.test.ts` | **13/13 pass** |
| `tests/mission-continuity.test.ts` | **16/16 pass** |
| TypeScript (`npm run typecheck`) | **exit 0** |
| Lint (`npx oxlint`) | **exit 0**, 0 errors, 409 existing warnings |
| Production build (`npm run build`) | **exit 0**, built in 6.12 s |
| Full suite (`npm test`) | **2198 pass / 2 fail / 8 skipped of 2208**, exit 1 — the same two pre-existing failures (`tests/genesis-interface.test.tsx`, `tests/sandbox-security.test.ts`) |

New broker tests pin: provider-wide cooldown served without upstream, status exposes the reset window and removes the provider, 5xx ⇒ `UNREACHABLE`, and 200 non-JSON ⇒ `CONTRACT_VIOLATION` with no success timestamp.

## Follow-up fixes (2026-11-15)

Three new defects were measured and fixed while making 14.1 pass:

1. **No-tool final rounds** (`src/core/router/finalRound.ts`)
   With tools withheld, history still carried assistant `tool_calls` and `role:"tool"`. Groq `openai/gpt-oss-20b` answered:
   `400 tool_use_failed — "Tool choice is none, but model called a tool"`.
   The final round now replaces that envelope with a plain user message carrying every tool result verbatim, its success flag and an explicit “no tools are available” instruction. No evidence is dropped.
2. **Context was outside the ceiling** (`src/core/router/RequestBudget.ts`, `ProviderResolver.ts`)
   Providers append `request.context` as a second system message after the fitter measured the request. The fitter counted the first system message only, so a ~21 KB self-state block arrived unmeasured; the measured failing request was 23,672 bytes / 5,890 prompt tokens. `contextBytes` is now counted, and a mission-resume turn replaces the self-description block with a short source-of-truth note while preserving `## LIVE RETRIEVAL RESULTS`.
3. **A resume turn paid for tools it did not need** (`src/core/tools/ToolSchemas.ts`)
   The continuity family plus discovery and `self_operational` was offered; the model spent the minute on `system.config` and `self.operational` before reading the ledger. A resume turn now receives exactly `mission_list`, `mission_find`, `mission_brief`, `mission_update`.

Routing fixes were also required: `ProjectResolver` claimed “resume the …” and `IntelligenceResolver` claimed “what is blocked”. A mission-resume turn now goes to the provider before those deterministic stages, and `Orchestrator` no longer sends a long resume prompt into task planning.

## Final review hardening (2026-11-15)

The final review added the following, all covered by tests:

- declared reset windows are stored as `retryAfterAt` and the half-open probe is refused until that time;
- a key slot keeps the longer of its policy cooldown and the provider's declared reset;
- a spent daily allowance is not retried smaller, while a size refusal still degrades through reduced and no-tool rounds;
- the no-tool final round now ends with a trusted runtime guard after the nonce-delimited untrusted evidence;
- request accounting now includes whole tool messages, provider context and the identity prompt, and cannot drop the materialized prompt while suppressing the provider append;
- a local mission edit clears `sync: synchronized`.

Live broker observation after the acceptance turns: Groq recorded `lastSuccessAt 2026-11-15T20:39:41.632Z`, then a later real 429 put it in `CAPACITY_LIMITED` with `retryAfterAt 20:58:48.531Z`. The accepted turn's 200s are not rewritten as healthy now. Focused tests: **74/74 pass**. Full suite: **2215 pass / 2 fail / 8 skipped of 2225**, with both failures reproduced at baseline `97fe447`.

## Limits

- A turn still cannot wait out a 30–45 s provider window inside the 12 s rung watchdog. The broker returns the truthful reset window instead of blocking the UI.
- The resolver does not pre-read `/api/model/status`; it may make one cheap local cooldown request before falling through. The broker refuses that request without upstream traffic.
- Local fallback is text-only and does not call continuity tools; its answer must never be labelled model-authored.
- No 401/500 was induced on a live credential; those paths are covered by mocked-upstream tests only.

## Evidence

- `artifacts/mission-14-next/provider-resilience.json` (both live sequences, status before/after, shortened provider errors)
- `artifacts/mission-14-next/cross-conversation-success.json` (the completed tool-enabled turn)
- `docs/acceptance/mission-14/CROSS_CONVERSATION.md` (retrieval, persistence and reload proof)
- `docs/acceptance/mission-14/REPORT.md` (§1.7.2, updated provider rows)
