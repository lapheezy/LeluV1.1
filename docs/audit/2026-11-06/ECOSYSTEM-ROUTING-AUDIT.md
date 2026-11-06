# ECOSYSTEM ROUTING — DIAGNOSIS, FIX AND ACCEPTANCE

Date **2026-11-06** · branch `claude/master-integration` · base `914d580`.

## 1. What was asked

Live Chat must deliver `IntelligenceResolver` answers for operational questions,
never a provider answer that replaces, duplicates or bypasses them. The work had
to be measured, not inferred: stage order, claims, handoffs, provider fallback
and final ownership.

## 2. Instrumentation (shipped)

`src/core/router/RoutingTrace.ts` records one turn per `RouterContext`:
stage order, `handled`, provider/model, duration, mid-flight notes (intent,
fetch outcome, refusal reason) and the final owner. It is bounded (40 turns),
readable at `globalThis.__LELU_ROUTING_TRACE__`, and changes no routing.
`AIRouter.route()` now opens the trace, delegates to `routeThroughStages()`, and
closes it with the response actually returned. All stage calls run through
`traced()`, which is a pass-through.

## 3. Measurement — four live turns

Captured verbatim in `evidence/ecosystem-routing/stage-routing-traces/captured-traces.json`.

| # | Prompt | intelligence | Final owner |
|---|---|---|---|
| 1 | Why can't you run OpenHands? | handled, 3618 ms | `IntelligenceResolver` (capability-explanation) |
| 2 | Why can't you run OpenHands? (identical) | handled, 5952 ms | `IntelligenceResolver` |
| 3 | What's blocking OpenHands from running? | **declined after 11 623 ms** | **`OpenRouter`** — model answer |
| 4 | same prompt after the fix | handled, 1933 ms | `IntelligenceResolver` |

Turn 3's note is the whole diagnosis:

```
intelligence.fetch  declined the turn: Cannot read properties of undefined (reading 'length')   ok=false
final               owner=OpenRouter provider=OpenRouter model=openrouter/free chars=550
```

## 4. Root cause

1. `getJson()` treats any 2xx as data: `response.json().catch(() => ({}))`.
   A non-JSON body (proxy/HTML/empty answer during a slow collection) therefore
   becomes `{}` with `response.ok === true`.
2. `formatExplanation({})` then read `payload.reasons.length` on `undefined` and
   threw `TypeError: Cannot read properties of undefined (reading 'length')`.
3. The catch returned `handled: false` — a deliberate "no data, no answer" rule —
   so `ProviderResolver` took the turn and answered an **operational** question
   from model context. That is the fabricated status the stage exists to prevent.

Why the second identical message appeared to issue no explain request: it was the
same failure, observed from the UI side. Once a turn declined, the provider's
answer replaced it and no second fetch appeared. With the stage healthy, two
identical prompts produce two explain calls (turns 1 and 2), so there is **no
separate second-turn suppression** in the router.

## 5. Fix

- `coerceExplanation()` / `coerceSnapshot()` validate the response shape before
  formatting; a body without `capabilityId`/`state` or usable snapshot arrays is
  refused with the reason, never formatted.
- `formatExplanation()` tolerates absent `reasons`/`requirements` arrays.
- **An operational question never falls through to the model any more.** When
  the surface cannot be read, the stage answers deterministically that live state
  could not be read, names the reason, and says it will not guess. Ordinary
  conversation never reaches this path — the intent detector declines it before
  any fetch — so provider fallback for chat is unchanged.
- The catch records `intelligence.fetch … ok=false` in the trace, so this class
  of failure is visible instead of silent.

## 6. OpenCode integration

`plugins/integration/opencode.ts` (server) + `src/core/engineering/OpenCodeBackend.ts`
(orchestrator backend) + two routes + registration in `IntegrationState`.

- `GET /api/integration/opencode/health` — reads `OPENCODE_BASE_URL` server-side,
  reports `not_configured` when unset, and a real status when set.
- `POST /api/integration/opencode/run` — dispatches `POST /session` then
  `POST /session/{id}/message` (text parts), bounded, same-origin, token-gated.
  Refuses with 503 and the real reason when unconfigured — never redirected to
  the local runtime.
- Registered with `EngineeringOrchestrator`, so the engineering snapshot now
  reports "backend registered, runtime not configured" instead of "no backend".

**Live evidence** (`evidence/ecosystem-routing/opencode/http-refusal-and-health.json`):
health `not_configured` (`contacted:false`), run `503 not_configured`, empty
changed files and commands.

**Honest state:** the engine is **NOT_CONFIGURED** in this environment. The
dispatch path is implemented and stub-tested; it has **not** been verified
against a live OpenCode server.

## 7. Acceptance status

| Required live test | Status | Evidence |
|---|---|---|
| Why OpenHands cannot run | **PASS** | turns 1–2 traces; grounded answer rendered |
| Ask again, identical wording | **PASS** | turn 2 trace, owner `IntelligenceResolver` |
| Differently phrased activation/blocker question | **PASS** | turn 4 trace after fix (turn 3 is the captured failure) |
| Current ecosystem snapshot | **NOT RUN LIVE** | stage unit-tested with the live payload shape; browser stopped rendering after the dev-server restart |
| Activation plan | **NOT RUN LIVE** | same |
| Unrelated conversational question | **NOT RUN LIVE** | routing path unchanged; full suite covers resolvers |
| Provider fallback when the surface is unavailable | unit-tested (**PASS**) | `operational-chat-stage.test.ts`: honest refusal, no fabrication |

The browser environment was unstable during this run: tabs stalled (even `1+1`
timed out), the preview hostname 502'd until the dev server was registered, and
after the plugin restart the page stopped mounting. The final state is recorded
verbatim in `evidence/ecosystem-routing/final-acceptance/browser-state.txt`:
title `LÉLU`, `#root` empty, **21** DOM nodes (document scaffolding only), no JS
exception, and module requests answering **503** through the preview tunnel while
the same modules answer **200** from the server itself. That is a delivery
failure of the dev-server module graph, not a client crash and not evidence
about the routing fix either way.

The two captured screenshots (`live-chat/03-blocking-openhands.png`,
`repeated-questions/02-identical-repeat.png`) were taken **while LÉLU was still
answering** and therefore do **not** prove the correct answers; they are kept only
as an honest record of the attempt. The traces — not the screenshots — are the
evidence for turns 1, 2 and 4. I have **not** claimed the not-run rows as passing.

## 8. Checks

| Check | Result |
|---|---|
| `npx tsc -b --force` | exit 0 |
| `tests/routing-trace.test.ts` | 5 pass |
| `tests/operational-chat-stage.test.ts` | 8 pass |
| `tests/opencode-integration.test.ts` | 7 pass |
| `tests/engineering-chain.test.ts` + `tests/tool-availability.test.ts` | updated for the traced call shape, pass |
| Full suite | **1433 tests, 1431 pass, 0 fail, 2 skipped**, exit 0 |

## 9. Remaining limitations

1. Snapshot, plan, unrelated-question and fallback turns still need live capture
   on a stable browser; the code paths are unit-tested, the live chat runs are not.
2. OpenCode's dispatch has not met a real server; `OPENCODE_BASE_URL` is unset.
3. `RoutingTrace` is in-memory per page load — reloading discards it.
4. The engineering snapshot's `executable` for OpenCode stays false until health
   reports healthy; that is intended, not a gap.
