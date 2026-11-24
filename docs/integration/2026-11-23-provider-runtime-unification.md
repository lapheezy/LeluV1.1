# Provider environment and runtime unification — 2026-11-23

**Branch:** `claude/supabase-security-closure-sly009`, starting at `0cdedced`; implementation commit `78ab6d48`. The working tree was clean at the start.
**Scope:** credential resolution for Groq, OpenRouter, Cerebras, Fireworks, Mistral and Gemini, plus voice.
Anthropic was only examined, not used.

**Status: integration repaired; live-verified for 2 of 6 providers.** Every provider now resolves its credential
through one contract. Groq and OpenRouter (chat and voice) were verified with real requests through the server
broker. The other four could not be live-verified, for reasons outside the code:

* Cerebras: the stored key is rejected upstream (401 "Wrong API Key").
* Fireworks, Mistral, Gemini: no key exists in this environment.

All four are verified to the request boundary with stubbed upstreams (§5).

---

## 1. Environment variable compatibility matrix

The single source is `src/core/model/ProviderCredentials.ts`. The first *usable* value wins; numbered slots and lists
add keys for rotation. Nothing was renamed: every name any consumer accepted before is still accepted by its own
provider.

| Provider | Canonical (set this on the server) | Also accepted, in order | Lists | Refused (never adopted) |
|---|---|---|---|---|
| groq | `GROQ_API_KEY` | `VITE_GROQ_API_KEY` (legacy, read first), `GROQ_API_KEY_1`…`_4` | `GROQ_API_KEYS`, `GROQ_KEYS` | — |
| openrouter | `OPENROUTER_API_KEY` | `VITE_OPENROUTER_API_KEY` (legacy, first), `OPEN_ROUTER_API_KEY`, `OPENROUTER_API_KEY_1`…`_4` | `OPENROUTER_API_KEYS` | — |
| cerebras | `CEREBRAS_API_KEY` | `VITE_CEREBRAS_API_KEY` (legacy, first) | — | — |
| fireworks | `FIREWORKS_API_KEY` | `VITE_FIREWORKS_API_KEY` (legacy, first) | — | — |
| mistral | `MISTRAL_API_KEY` | `VITE_MISTRAL_API_KEY` (legacy, first) | — | — |
| gemini | `GEMINI_API_KEY` | `VITE_GEMINI_API_KEY` (legacy, first), `GOOGLE_GENERATIVE_AI_API_KEY`, `GOOGLE_API_KEY` (generic, now last) | — | — |
| githubModels | `GITHUB_MODELS_TOKEN` | `VITE_GITHUB_TOKEN` (legacy, first) | — | `GITHUB_TOKEN`, `GITHUB_CODESPACE_TOKEN` |
| anthropic *(not authorised; opt-in)* | `ANTHROPIC_API_KEY` | `VITE_ANTHROPIC_API_KEY`, `LELU_ANTHROPIC_API_KEY`, `CLAUDE_API_KEY` | — | — |

**What each name was accepted by, before this change** (✓ accepted, — ignored):

| Name | Broker (browser path) | Key ring / provider (direct path) | Environment.ts | ConfigStatus | /api/env-check |
|---|---|---|---|---|---|
| `GROQ_API_KEY_2` | ✓ | ✓ | — | — | — |
| `GROQ_API_KEYS` / `GROQ_KEYS` | — | ✓ | — | — | — |
| `OPEN_ROUTER_API_KEY` | ✓ | ✓ | — | — | — |
| `OPENROUTER_API_KEY_2`, `OPENROUTER_API_KEYS` | ✓ / — | ✓ / ✓ | — | — | — |
| `GOOGLE_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY` | ✓ | ✓ | — | Gemini not listed | — |
| `GITHUB_MODELS_TOKEN` | ✓ | — | — | — | — |
| `GITHUB_TOKEN` (ambient CI token) | — | — | — | **✓ (false positive)** | — |

After the change, every row is ✓ in every column, except that `GITHUB_TOKEN` is refused everywhere.

**Validation** (applies everywhere). A value is **invalid**, reported with its reason and never sent, when it:

* contains whitespace;
* is shorter than 8 characters;
* is a template value: `your-…`, `…-here`, `<…>`, `${…}`, `changeme`, `...`, and similar;
* carries another provider's distinctive prefix (`gsk_`, `sk-or-`, `csk-`, `AIza`, `sk-ant-`). A key is never
  rejected merely for *lacking* its own prefix.

The states are `configured`, `missing` and `invalid`. Where a credential is configured but cannot be used, the broker
adds `POLICY_DISABLED`, `SPEND_NOT_AUTHORIZED`, `COOLDOWN` and the new `INVALID_CREDENTIAL`. **Client vs server:**
all values are read server-side (process env, or a `__LELU_*__` global injected by a native shell). Nothing reads
`import.meta.env`, and `runtimeKeyBridge` publishes no model key.

## 2. Provider registration and runtime dependency map

```
Browser turn
  AIRuntime ─ registerAIProviders() ─ AIProviderRegistry (9 providers: Local, OpenRouter, Groq, Cerebras,
  │                                    Mistral, Fireworks, Anthropic, Gemini, GitHub Models)
  │            └ primeBrokerStatus() → GET /api/model/status        (server's answer = availability)
  ├ ModelRouter: explicit preference → coding provider → VITE_DEFAULT_PROVIDER (fireworks) → priority chain
  └ ProviderResolver: one fallback chain, skips unavailable/cooling providers
        provider.generate() → endpointUrl(id) = /api/model/<id>/…   (browser: brokered, no auth header)
                                   │
Server (server.ts / vite dev)      ▼
  plugins/modelApi.ts (broker) ── resolveProviderCredentials(id, process.env)   ← THE CONTRACT
        ├ spendPolicy (zero-spend: paid providers need the user's grant)
        ├ LELU_ENABLE_ANTHROPIC gate
        └ key rotation over every usable credential → upstream provider API

Direct runtimes (Node scripts, native shells, server-side tools)
  provider constructor → primaryCredential(id)  ← THE CONTRACT
  ProviderKeyRing.readEnvironment(id)           ← THE CONTRACT

Voice
  speechToText.ts / VoiceEngine.ts / native speech capability
        → transcriptionTransport.localTranscriptionKey()  ← THE CONTRACT (groq)
        → POST /api/model/groq/audio/transcriptions (same broker, multipart preserved)

Diagnostics
  Environment.ts (chat providers) · ConfigStatus.ts · /api/env-check · /api/provider-health  ← THE CONTRACT
```

**Runtimes:**
* `server.ts` (Bun/Node, production) and the Vite dev server mount the broker, env API and voice API.
* `main.ts` (Deno) mounts the env API but **not** the model broker or the voice API (§8).

## 3. Root-cause report (WP01)

| # | Finding | Category | Effect |
|---|---|---|---|
| R1 | Seven separate credential lists: broker, key ring, 7 provider constructors, Environment, ConfigStatus, env-check, provider-health | duplicate resolvers / naming | Consumers disagreed about the same environment |
| R2 | Broker ignored `GROQ_API_KEYS` / `GROQ_KEYS` / `OPENROUTER_API_KEYS`; the key ring accepted them | registration / runtime | A list-only deployment: server said Groq UNCONFIGURED while holding keys; every browser turn skipped it |
| R3 | Environment, ConfigStatus and env-check read only `VITE_X` / `X` | readiness (false negative) | Numbered slots, `OPEN_ROUTER_API_KEY` and Google names showed MISSING while the broker used them |
| R4 | ConfigStatus accepted the ambient `GITHUB_TOKEN` | readiness (**false positive**) | Reported GitHub Models configured in CI/Codespaces; the provider and the broker both refuse that token |
| R5 | Any non-empty string counted as a key | readiness (**false positive**) | `your-key-here`, or a Groq key pasted into `OPENROUTER_API_KEY`, read as configured and was sent upstream |
| R6 | Gemini absent from ConfigStatus | readiness | LÉLU could not report Gemini's configuration |
| R7 | `/api/provider-health` sent a **live Anthropic request** whenever any Anthropic key existed, ignoring `LELU_ENABLE_ANTHROPIC` | **Anthropic activation path** | The only path that bypassed the opt-in policy. This environment holds `LELU_ANTHROPIC_API_KEY`, so a health call here would have contacted Anthropic |
| R8 | `/api/provider-health` probed only Groq, OpenRouter and Anthropic, and only each provider's first key | readiness | Cerebras, Mistral, Fireworks and Gemini had no check at all. Measured: OpenRouter reported failing (key 1 daily quota, 429) while the broker answered via key 2 |
| R9 | Voice asked for the Groq key three times (`speechToText.ts`, `VoiceEngine.ts`, `native/capabilities/speech.ts`), each reading only `__LELU_GROQ_API_KEY__` | voice bypass | A channel no server fills. In Node/native runtimes voice saw no key even where chat had one. The unavailable message told users to set `VITE_GROQ_API_KEY`, the one name that must not be used |
| R10 | `Environment.ts` model defaults differed from `ProviderModels.ts` (e.g. Cerebras `llama3.1-8b` vs `gpt-oss-120b`; Mistral small vs large) | diagnostics | Diagnostics named models no request used. Nothing read them for requests |
| R11 | `OpenRouterProvider` read `window.location.origin` whenever `window` existed | runtime initialisation failure | In Node runtimes that shim `window` for storage (the repo's own `scripts/verify-provider-health.ts`), every OpenRouter request failed before sending |

Not a defect, but it governs selection. The broker's zero-spend policy classes Fireworks, Mistral and Gemini as
paid, and they are unavailable without the user's spend grant. `VITE_DEFAULT_PROVIDER` defaults to `fireworks`, so
in this configuration the default is never the first to answer. Turns fall through to Groq and OpenRouter `:free`
by design.

## 4. Implementation changes (minimal)

| File | Change |
|---|---|
| `src/core/model/ProviderCredentials.ts` (new) | The contract: spec table (§1), validation, `resolveProviderCredentials`, `primaryCredential`, `credentialReport` (no key material), `describeCredentialState`. Dependency-free; runs in the browser, Bun/Node and Deno |
| `plugins/modelApi.ts` | `keyNames` = `credentialNames(id)`; credentials from the contract (lists accepted, invalid values never sent); new `INVALID_CREDENTIAL` state; the 503 for a missing credential names the state and the rejected names |
| `src/core/model/ProviderKeyRing.ts` | Reads the contract; its own `SLOT_NAMES` / `LIST_NAMES` removed |
| Groq, OpenRouter, Cerebras, Fireworks, Mistral, Gemini, GitHubModels providers | `primaryCredential(id)` replaces each private name list. `AnthropicProvider.ts` is **unchanged** |
| `src/providers/OpenRouterProvider.ts` | `window.location?.origin` guard (R11) |
| `src/core/voice/transcriptionTransport.ts` | `localTranscriptionKey()`: the one voice credential question, via the contract |
| `speechToText.ts`, `VoiceEngine.ts`, `native/capabilities/speech.ts` | Their three private readers removed; corrected diagnostic text |
| `src/core/Environment.ts` | Chat providers via the contract (`credentialState`, canonical `keyVar`, actionable warning); model fields from `ProviderModels`. Anthropic entry unchanged |
| `src/core/config/ConfigStatus.ts` | Providers via the contract; Gemini added; `GITHUB_TOKEN` false positive removed; `missing` names the canonical variable |
| `plugins/envApi.ts` | `/api/env-check`: per-provider `providers` block (state, source, count, rejections; no lengths or values). `/api/provider-health`: Anthropic probe gated on policy (R7); Groq/OpenRouter try keys like the broker (R8); zero-cost model discovery for Cerebras, Mistral, Fireworks, Gemini |
| `scripts/verify-bundle-secrets.ts` | 11 more server-only canaries: every alias, slot and list name the contract accepts |
| `scripts/verify-provider-runtime-live.ts` (new) | Live, zero-spend request-path check through the real broker (§5) |
| `tests/provider-credentials.test.ts` (new) | 43 tests (§7) |
| 4 existing test files | Only fake key values lengthened (e.g. `"k1"` → `"gsk_test_k1"`) to pass the ≥8-character rule the key ring already applied. No assertion changed |
| `ENV_VARS.md` | Matrix updated |

Packages: no dependency added, and neither `package.json` nor `package-lock.json` was touched.

## 5. Provider-by-provider verification

The **live** columns use the real keys present in this environment (names only: Groq ×4, OpenRouter ×4,
Cerebras ×1). The requests went through the real broker under an isolated zero-spend policy, via
`scripts/verify-provider-runtime-live.ts` and `/api/provider-health`. The **stubbed** columns use real classes with a
substituted `fetch` (`tests/provider-credentials.test.ts`).

| Provider | Registered | Credential (this env) | Readiness | Model | Stubbed request path | Live request (broker) | Errors | Status |
|---|---|---|---|---|---|---|---|---|
| Groq | ✓ | configured, 4 keys | available (free) | `openai/gpt-oss-120b` | ✓ api.groq.com, own key | **200, "OK"** | 401/429 rotate keys (existing tests) | **Operational** |
| OpenRouter | ✓ | configured, 4 keys | available (`:free` model) | `nvidia/nemotron-3-ultra-550b-a55b:free` | ✓ openrouter.ai, own key | **200, "OK"**; key 1 out of daily free quota (429), key 2 answered | rotation verified live | **Operational** |
| Cerebras | ✓ | configured, 1 key | broker marks it unauthorised after the 401 | `gpt-oss-120b` | ✓ api.cerebras.ai, own key | **401 "Wrong API Key"** (chat, and model discovery) | reported as auth failure, not network | **Blocked: key rejected upstream** |
| Fireworks | ✓ | **missing** | unavailable ("Set FIREWORKS_API_KEY") | `accounts/fireworks/models/gpt-oss-120b` | ✓ api.fireworks.ai, own key | not run: no key; paid (needs spend grant) | — | **Blocked: no key** |
| Mistral | ✓ | **missing** | unavailable | `mistral-large-latest` | ✓ api.mistral.ai, own key | not run: no key; paid | — | **Blocked: no key** |
| Gemini | ✓ | **missing** | unavailable | `gemini-2.0-flash` | ✓ generativelanguage.googleapis.com, own key (`x-goog-api-key`) | not run: no key; paid | — | **Blocked: no key** |

**Selection and fallback.** Tests prove:
* each registered provider reaches its own host with its own key;
* registration without a credential is reported unavailable;
* one provider's key never configures another;
* paid providers become available only after a spend grant.

The 212 existing broker, registry, fallback and runtime tests pass.

## 6. Voice integration verification

* **One pathway.** All three voice modules ask `localTranscriptionKey()` → the Groq contract. In a browser it is
  normally empty: the request goes to `/api/model/groq/audio/transcriptions` with no auth header, and the server
  attaches its own key. A test asserts that no voice module reads `__LELU_GROQ_API_KEY__` or
  `import.meta.env.VITE_GROQ_API_KEY` itself.
* **Contract behaviour (tests).** A key under `GROQ_API_KEY_3` alone is found. An OpenRouter-shaped key in
  `GROQ_API_KEY` is never used for Whisper.
* **Live.** A one-second synthetic WAV was posted through the broker's transcription route: **HTTP 200** from
  `api.groq.com`, response `{"text":" ."}` (a tone has no words). The multipart body survived the broker intact.
* **Bundle.** No canary for any Groq name shipped (§7).
* **Not verified:** a real microphone session in a browser, and ElevenLabs STT (outside this mission).

## 7. Build and test report (bounded; real exit codes)

| Check | Bound | Result |
|---|---|---|
| `npm run typecheck` (`tsc -b --force`) | 900 s | **exit 0, 42 s** (final run; an earlier run took 79 s) |
| `npm run build` (`tsc -b && vite build`) | 1500 s | **exit 0, 49 s**; 7,922 modules |
| `scripts/verify-bundle-secrets.ts` (real production build with canaries) | 1500 s | **exit 1**: 56 checks pass, 1 fails. Every forbidden, server-only and bridge canary is absent. The failing heuristic matches Excalidraw's prebuilt public config (`VITE_APP_PLUS_EXPORT_PUBLIC_KEY`, an RSA public key) and example text `VITE_KEY=value` in `StudioSecurity.ts`. **Identical on the starting commit** |
| `tests/provider-credentials.test.ts` (new) | 600 s | **43/43 pass** |
| Provider, broker, voice, runtime and config suites (20 files) | 1200 s | **212/212 pass** |
| Negative control: old `envApi.ts` restored | — | the Anthropic-gate and env-check tests fail, as intended |
| `scripts/verify-provider-health.ts`, credentials unset | 300 s | exit 1, 3 checks fail. **Identical on the starting commit**: the script still expects Anthropic first and `no_credentials` rather than `disabled` |
| Full `npm test` (3,258 tests) | 3000 s | **exit 1 in 547 s: 3,245 pass, 3 fail, 10 skipped.** The 3 failures are the pre-existing M25 wardrobe/asset tests (`foundry-m25c`, `foundry`, `outfit-switching`), shown to fail identically on the untouched code in the previous mission. No other failure |

**Live network activity in this session** (all free tier; zero spend; **no request to Anthropic**):

* `scripts/verify-provider-runtime-live.ts`: Groq chat ×1, OpenRouter ×2 (key rotation), Cerebras ×1 (401), Groq
  Whisper ×1.
* `/api/provider-health`, run twice: Groq chat ×2, OpenRouter chat ×3 or fewer (the second run rotated keys), Cerebras model list ×2.
* **Unplanned:** `scripts/verify-provider-health.ts` once, before I knew real keys were present. Its `verifyLive()`
  sent one request each to Groq, OpenRouter and Cerebras. Anthropic was reported `disabled` and not contacted.

## 8. Remaining blockers and exact remediation

| # | Blocker | Remediation |
|---|---|---|
| B1 | **Cerebras key rejected** (401 "Wrong API Key", chat and model listing) | Replace `CEREBRAS_API_KEY` in the server environment with a valid key from cloud.cerebras.ai. Then run `npx tsx scripts/verify-provider-runtime-live.ts` (expect `cerebras … brokerStatus 200`) |
| B2 | **No Fireworks, Mistral or Gemini key** in this environment | Set `FIREWORKS_API_KEY`, `MISTRAL_API_KEY`, `GEMINI_API_KEY` on the server (not `VITE_`) |
| B3 | Fireworks, Mistral and Gemini are paid under the zero-spend policy, and Fireworks is `VITE_DEFAULT_PROVIDER` | Your decision. Either authorise spend in your own words in LÉLU (a scoped, time-limited grant), or, if an account is genuinely free-tier, declare it with `LELU_SERVICE_COST_MISTRAL=free` / `LELU_SERVICE_COST_GEMINI=free`. Or set `VITE_DEFAULT_PROVIDER=groq` so the default is a free provider |
| B4 | OpenRouter key 1 has exhausted its daily free quota | None needed; rotation handles it. It resets daily |
| B5 | `main.ts` (Deno) mounts no model broker or voice API | Deploy with `server.ts` (Bun/Node), which mounts both, as Contabo does. A Deno deployment needs `createModelApi` and the voice API mounted, with a byte-preserving body adapter (its current `connectToFetch` decodes bodies as text, which would corrupt audio) |
| B6 | Bundle-scan heuristic fails on third-party public config (pre-existing) | Exclude `node_modules`-originated public names (Excalidraw's `VITE_APP_*`), and the documentation string in `StudioSecurity.ts`, from that heuristic only. Every canary check is unaffected |
| B7 | `scripts/verify-provider-health.ts` encodes the pre-opt-in Anthropic order (pre-existing) | Update its expectations to the policy (Anthropic `disabled`, chain led by the free providers). Not changed here, to stay off Anthropic behaviour |
| B8 | `scripts/verify-continuous-cognition.mjs` contains a keyless direct call to `api.anthropic.com` (a historical control) | Not run. Remove it, or gate it on `LELU_ENABLE_ANTHROPIC`, if that script is ever used again |
| B9 | A real microphone session in a browser was not exercised | Open LÉLU through `server.ts`, start voice, speak; `/api/model/status` → `groq: true` is the precondition |

**Anthropic (WP05).**
* **Not activated, no requests.**
* The one path that bypassed the policy (R7) is now gated.
* The chat provider, the engineering agent and the broker were already gated, and are unchanged.
* `LELU_ENABLE_ANTHROPIC` is unset here.
* The contract lists Anthropic's names for diagnostics only. Its credential is resolved only by the existing broker
  route (which refuses without the policy) and by the health probe when the policy is on.
* **Predeploy backup files:** none exist in this checkout. Nothing under `deploy/` was touched.
