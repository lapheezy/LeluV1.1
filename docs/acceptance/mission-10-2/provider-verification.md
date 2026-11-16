# Provider configuration and reliability

Source of truth: `GET /api/model/status` on the running dev server, captured to
`provider-status.json` during this mission. No key values are recorded anywhere.

| Provider | Configured | State | Meaning |
|---|---|---|---|
| OpenRouter | yes | `COMPLETION_VERIFIED` (HTTP 200) | a real completion succeeded on this run |
| Groq | yes | `CAPACITY_LIMITED` (HTTP 429) | key works; account quota/rate limit refused the call |
| GitHub Models | yes | `CONTRACT_VIOLATION` | endpoint answered, response did not match the expected contract |
| Anthropic | no | `POLICY_DISABLED` | opt-in only (`LELU_ENABLE_ANTHROPIC`); never a silent fallback |
| Cerebras, Mistral, Fireworks, Gemini | no | `UNCONFIGURED` | no key present |
| Respan gateway | no | not running | local operator-run gateway, loopback only |

## Where keys are read

- `src/core/resolveEnv.ts` is the single resolver. Its comment records the
  measured reason there is **no `import.meta.env` rung**: a dynamic read makes
  Vite inline every `VITE_`-prefixed value into the client bundle, which once put
  eight canary credentials into three chunks.
- Server-side reads go through `process.env` (unprefixed first), so the browser
  never receives a model credential.
- `plugins/runtimeKeyBridge.ts` publishes only non-secret configuration as
  `__LELU_*__` globals; the page source captured during this mission shows
  `LELU_PROVIDER_RUNG_BUDGET_MS`, not a key.
- `plugins/modelApi.ts` keeps a per-provider key-name list and falls back to the
  broker, so a provider is either brokered or has its own key — the browser is
  not a credential source.
- `src/core/model/ProviderKeyRing.ts` supports rotation (`_1.._4`, `*_KEYS`)
  and is the only place that enumerates key names for a provider.

## Determinism

Selection order is explicit (`Environment.ts` priorities 1–8, Anthropic
priority 7 and policy-disabled), and `ProviderResolver` walks them in order with
a per-rung budget and a chain budget. A provider that fails is recorded with its
reason (`CAPACITY_LIMITED`, `CONTRACT_VIOLATION`, timeout) and the chain moves
on — it does not silently swap in a different provider and call it the same
answer, because the answering provider's name travels with the result.

## What is not claimed

No new key was created and no paid provider was enabled by this mission. Groq's
429 is a real quota refusal from this environment, not a code defect. GitHub
Models' `CONTRACT_VIOLATION` is recorded as-is; it is not diagnosed here.
