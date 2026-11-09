# Provider routing

## The rule

`AIProviderRegistry` remains the single provider registry. LiteLLM, Qwen3-Coder or
any other routing layer is a **layer behind** it, never a second one. Nothing in
this work changes how LÉLU selects a provider.

## Current behaviour (unchanged, verified by the existing suite)

```
AIService → ModelRouter → ProviderResolver → AIProviderRegistry → provider → BrokerTransport
         → /api/model/<provider>/<path> → server broker → provider API
```

- Provider credentials are **server-owned**; the browser never holds one.
- `ModelRouter` orders providers: explicit request → configured coding provider →
  configured default (`VITE_DEFAULT_PROVIDER`) → capability hints.
- Anthropic is **opt-in** (`LELU_ENABLE_ANTHROPIC=true`); a failing turn never
  silently lands on Claude.
- Failure classification (`credential-refused`, `timeout`, `network`, `billing`,
  `model-not-found`, `bad-request`) drives the cooldown, and a refused key rests
  for 15 minutes instead of retrying every turn.

## What this session added

| Addition | File | State |
|---|---|---|
| LiteLLM gateway health + role documentation | `plugins/integration/services.ts` | adapter only; `LITELLM_BASE_URL` unset ⇒ `not_configured` |
| Qwen3-Coder as a catalogue entry | — | **not implemented** (see below) |
| Model-gateway span in the trace | `src/core/observability/Telemetry.ts` | implemented and evidenced |

### Why Qwen3-Coder is not registered

Registering a coding model is cheap in code (an OpenAI-compatible provider
descriptor plus a `ModelRouter` catalogue entry). Two facts stopped it:

1. **No credential for any Qwen-compatible endpoint exists in this runtime.**
   Registering a provider that cannot answer adds a fallback rung that always
   fails — the exact defect `ModelRouter`'s own comments record for retired
   models (`llama-3.3-70b` on Cerebras, `llama-v3p1-70b` on Fireworks).
2. **The weights cannot run here.** 8 vCPU / 15 GB / no GPU, and the mobile
   target is a phone. Local inference of a 30B+ coding model is not feasible, and
   claiming otherwise would be the kind of statement the spec forbids.

The correct next step is to register the descriptor **when** an endpoint is
chosen, and to prove it with a real completion — not to add a green row now.

## How to add a routed model (procedure, not a claim)

1. Choose the endpoint (DashScope, OpenRouter, or a self-hosted vLLM behind
   LiteLLM) and put its key in the **server** environment only.
2. Add the model id to `src/core/ProviderModels.ts` (one place, per its own
   contract) and a `ModelDescriptor` to `ModelRouter`'s catalogue with real
   context-window and tool-support values.
3. Register the provider in `src/core/RegisterAIProviders.ts`; it appears in
   `ENV_VARS.md`'s provider table.
4. Prove it: `tests/provider-availability.test.ts`-style broker test plus one
   live completion recorded in the evidence directory.
5. Only then update this document to say the model is available.

## Fallback guarantees that still hold

- A provider failure is visible in `GET /api/model/status` (booleans only).
- A failed turn advances the chain; it never silently downgrades the *reported*
  provider.
- `/api/integration/status` reports the gateway's real state without exposing a
  key name's value — only names and booleans.
