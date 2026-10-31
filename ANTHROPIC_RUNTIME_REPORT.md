# Anthropic runtime hardening — Cognition & Systems Engineering

Scope: the Anthropic provider, the server model broker, and the router's tool
loop. Avatar rendering, Blender, Meshy assets and the 3D room were not touched.

This work builds on the existing broker (`plugins/modelApi.ts`), provider
(`src/providers/AnthropicProvider.ts`) and router
(`src/core/router/ProviderResolver.ts`). No new runtime, client or agent loop
was added.

## Why

Commit `8bb9f0e` made Anthropic LÉLU's primary provider. On current Claude
models, several ordinary turns failed with a 400 or came back wrong, and the
fallback chain hid this by answering from another vendor:

| # | Defect | Effect before | Fix |
|---|---|---|---|
| 1 | Default model `claude-sonnet-4-5` | Previous generation | Default is now `claude-opus-5-5` (`ProviderModels`, `Environment`, `ModelRouter`, `env.example`) |
| 2 | `temperature` always forwarded | 400 on every `ProjectInterpreter` / `SelfStudyEngine` / `LocalRuntime` call (they send `temperature: 0`/`0.2`) → silent fallback | Sent only to models that accept it (`acceptsSamplingParams`) |
| 3 | Tool turns rebuilt from text + toolCalls | Thinking blocks between tool rounds lost | Raw blocks carried on `AIResponse.providerBlocks` → `AIMessage.providerBlocks` and replayed verbatim on every round, including the closing round that withholds tools (append-only, per preserved-thinking rules) |
| 4 | Stream read `stop_reason` from `message`, not `delta` | `finishReason` never set on streamed turns | Read from `message_delta.delta`; usage merged |
| 5 | Stream `error` events ignored | Partial reply after an overload returned as complete | Turn fails, the chain moves on |
| 6 | `refusal` → "no usable content" thrown | Same request re-asked of another vendor (routes around the decline) | Returned as LÉLU's answer; streamed partial replaced; server-side `fallbacks: "default"` opt-in on supported models |
| 7 | `max_tokens` mid-`tool_use` | Truncated call executed (earlier "empty file" bug) | Last call dropped, `metadata.truncatedToolCall` set |
| 8 | Only first text block read | Multi-block replies truncated | All text blocks joined |
| 9 | No retry on 429/529/5xx | One overload dropped the primary for the whole turn | Up to 2 retries, `retry-after` honoured, 8s cap |
| 10 | Broker kept streaming after client disconnect | Up to 120s of upstream billing for no one | Upstream aborted on client `close` |
| 11 | Broker had no spend limit | Any network client could spend the operator's quota | Per-address fixed-window limit, `LELU_BROKER_RATE_PER_MIN` (default 120) |
| 12 | Broker dropped every page header | `anthropic-beta` (fallback opt-in) could never reach Anthropic | `anthropic-beta` passed through only if it matches `^[a-z0-9-]+(,…)*$` |

## Changed files

| File | Change |
|---|---|
| `src/providers/AnthropicProvider.ts` | Items 2–9. New exports: `acceptsSamplingParams`, `supportsServerFallback`, `SERVER_FALLBACK_BETA`, `retryDelayMs`, `replayableBlocks` |
| `src/providers/AIProvider.ts` | New `ProviderBlocks` type; optional `AIMessage.providerBlocks`, `AIResponse.providerBlocks` |
| `src/core/router/ProviderResolver.ts` | Copies `response.providerBlocks` onto the recorded assistant tool turn (3 lines) |
| `plugins/modelApi.ts` | Items 10–12. New export `createRateLimiter`; `BrokeredProvider.passHeaders`; `ConnectLikeReq.socket`, `ConnectLikeRes.on/writableFinished` (optional) |
| `plugins/runtimeKeyBridge.ts` | Bridges `ANTHROPIC_REFUSAL_FALLBACK` to the page (a switch, not a secret) |
| `src/core/ProviderModels.ts`, `src/core/Environment.ts`, `src/core/model/ModelRouter.ts` | Default model id |
| `env.example`, `ENV_VARS.md` | New settings, credential table (adds `LELU_ANTHROPIC_API_KEY`), reply-handling contract |
| `tests/anthropic-integration.test.ts` | New: 20 assertions over the real provider and broker, `fetch` stubbed |
| `tests/engineering-agent.test.ts` | Pre-existing failure fixed: the "missing credential" test cleared only `ANTHROPIC_API_KEY`, so a `LELU_ANTHROPIC_API_KEY` in the environment made the agent "available" |

## Dependencies

None added. Requires `AbortSignal.any` (Node ≥ 20.3, Bun; Node 22 in this
container).

## APIs / contracts

- **`POST /api/model/anthropic/*`**: can now return `429` + `Retry-After` from
  the broker itself (body `{ ok: false, error: "Broker rate limit reached…" }`).
  It honours `anthropic-beta` from the page. Other endpoints are unchanged.
- **Provider contract**: providers MAY set `AIResponse.providerBlocks`. The
  router replays it only on the same provider's next tool round. Other
  providers ignore the field.
- **Refusal**: an Anthropic response with `stopReason: "refusal"` is a normal
  answer (`metadata.refusal.category`). It is not a failure, and the chain does
  not continue.

## Integration requirements

- **Credential**: set `LELU_ANTHROPIC_API_KEY` (or `ANTHROPIC_API_KEY`) on the
  server. Never set it with a `VITE_` prefix.
- **Model access**: the key's organisation must have access to
  `claude-opus-5-5`, or `ANTHROPIC_MODEL` must name one it does have. A 404
  shows up as `Anthropic failed 404` and the chain falls back.
- **Refusal fallback**: uses beta `server-side-fallback-2026-07-01`. If an org
  rejects it, set `ANTHROPIC_REFUSAL_FALLBACK=off`.
- **Cost**: Opus 5.5 costs $4 / $20 per MTok, against $3 / $15 for Sonnet 4.5.
  `ANTHROPIC_MODEL=claude-sonnet-5-5` costs $2 / $10.
- **Exposure**: the broker is not authenticated. Behind anything other than
  localhost, put auth in front of `/api/model/*`. The rate limit bounds spend;
  it does not stop it.

## Verification

- `tests/anthropic-integration.test.ts`: 20 pass / 0 fail.
- Typecheck: `tsc -p tsconfig.app.json` and `tsc -p tsconfig.node.json` clean.
  `oxlint` is clean on the changed files.
- Full suite, using the per-file loop from `tests/README.md`: see the commit
  message for the measured counts.
- **Verified live** against `api.anthropic.com` on `claude-opus-5-5`, using the
  container's `LELU_ANTHROPIC_API_KEY`. Six calls, each run on both the new code
  and the previous commit (`93f8dc0`):

  | Path | Previous code | New code |
  |---|---|---|
  | Plain reply | ok | ok; fallback beta accepted (`usage.iterations` present) |
  | `temperature: 0` (internal callers) | **400** `temperature is deprecated for this model` | ok |
  | Tool request → tool round → closing round without tools | ok | ok (raw blocks replayed) |
  | Streaming | ok, but no stop reason; usage reports 1 output token | `end_turn`, final usage |

  The system prompt is present (534 tokens served from the prompt cache).
  Refusal, `max_tokens` truncation, overload retry and mid-stream errors were
  not triggered live; the stubbed tests cover them.
- **Correction:** an earlier version of this change rewrote tool history into
  text when tools were withheld, assuming the API rejects tool blocks without a
  tools list. Live testing showed it does not, so that rewrite was removed:
  history is now replayed unchanged.
- **Not covered by a test**: the 3-line `ProviderResolver` change. The existing
  `tool-calling.test.ts` that drives the resolver does not finish within 90s
  (pre-existing, listed in `tests/README.md`).
