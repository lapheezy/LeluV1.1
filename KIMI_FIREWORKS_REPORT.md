# Kimi on Fireworks: Integration & Verification Report

Date: 2026-11-05. Every number below comes from a real Fireworks API response or a real command run in this session.

## TL;DR

* **Kimi K2.7 Code (`accounts/fireworks/models/kimi-k2p7-code`) is wired in as LÉLU's coding model, but Fireworks does not serve it serverless.** The control-plane record shows `state: READY`, `supportsServerless: false`, `serverlessModes: []` and `deployedModelRefs: []`. A real call returns `404 Model not found, inaccessible, and/or not deployed`. The account `accounts/laelpheru` has **0 deployments**. The model page also lists Serverless as "Not Supported".
* You chose to wire K2.7 Code and test on serverless Kimi, so **all live verification ran on `accounts/fireworks/models/kimi-k3p1-pro` (Kimi K3.1 Pro)**. Nothing in this report claims K2.7 Code ran.
* To make K2.7 Code live you can either create an on-demand Fireworks deployment of it (billed per GPU-hour) or set `FIREWORKS_CODING_MODEL=accounts/fireworks/models/kimi-k3p1-pro`. No code change is needed either way.
* Anthropic is now **disabled by default**, including when a key is present (verified with the real `LELU_ANTHROPIC_API_KEY` set). It is never in the fallback chain unless `LELU_ENABLE_ANTHROPIC=true`.

## 1. Existing architecture (inspected)

| Piece | Where | Finding |
|---|---|---|
| Fireworks adapter | `src/providers/FireworksProvider.ts` | Already OpenAI-compatible: `POST {base}/chat/completions`, Bearer auth, OpenAI tool calling via `openaiTools.ts`. It had no streaming and a 30 s timeout. |
| Endpoint | `src/core/Endpoints.ts` | `FIREWORKS_BASE_URL` defaults to `https://api.fireworks.ai/inference/v1`. This is correct and unchanged. |
| Key | `resolveFirst("FIREWORKS_API_KEY")`, server broker `plugins/modelApi.ts` | `FIREWORKS_API_KEY` **is present** in this environment and authenticates. |
| Registry | `src/core/RegisterAIProviders.ts` | Fireworks is registered at priority 5. No new provider class was needed. |
| Model defaults | `src/core/ProviderModels.ts` | This is the single source of model ids. |
| Routing | `ModelRouter.route` → `ProviderResolver` | Ordering: explicit preference → vision → default provider → priority chain. |
| Coding agent | `EngineeringResolver` (chat), `AnthropicEngineeringAgent` (Anthropic Managed Agents) | Engineering turns used whatever led the chain, which was Anthropic by default. |

`AIService` and `AIRuntime` were not modified.

## 2. Changes

* `ProviderModels.ts`: new `fireworksCoding` entry (`FIREWORKS_CODING_MODEL`, default `kimi-k2p7-code`).
* `AIProvider.ts`: optional `AIRequest.workload?: "coding"`. Unlike `model`, it doesn't pin a Fireworks id onto every provider in the chain.
* `ModelRouter.ts`: `route(request, intent?)`. On engineering intent, the configured coding provider (`VITE_CODING_PROVIDER`, default `fireworks`) leads and `workload: "coding"` is returned. A Kimi descriptor is added to the catalog.
* `ProviderResolver.ts`: passes `context.intent` and marks coding turns on the request.
* `EngineeringResolver.ts`: keyword-detected engineering turns are also marked `workload = "coding"`.
* `FireworksProvider.ts`: coding turns use the coding model with a 180 s budget (tool turns get it too). The request's `AbortSignal` is honoured. Adds **SSE streaming** with accumulated `onDelta`, tool-call deltas assembled by index, and `stream_options.include_usage` so real token counts arrive.
* `core/model/ProviderPolicy.ts` (new): `anthropicEnabled()`, which is true only when `LELU_ENABLE_ANTHROPIC` is true. Used by `AnthropicProvider` (`enabled` getter; `health` and `generate` refuse) and by `AnthropicEngineeringAgent.availability()`.
* `Environment.ts`: `VITE_DEFAULT_PROVIDER` now defaults to `fireworks` (it was `anthropic`), and there is a new `codingProvider`.
* `plugins/runtimeKeyBridge.ts`: bridges the non-secret `FIREWORKS_CODING_MODEL`, `CODING_PROVIDER` and `LELU_ENABLE_ANTHROPIC` to the page. No credentials are added.
* `scripts/kimi-code.ts` (new): the coding harness (see §4).
* `scripts/verify-kimi-fireworks.ts` (new): the live verification.
* `tests/kimi-coding-route.test.ts` (new): offline regression test, 6/6 pass.
* `ENV_VARS.md`, `env.example`: documented.

## 3. Live capability verification (`scripts/verify-kimi-fireworks.ts`, real FireworksProvider)

| Check | Model | Result |
|---|---|---|
| Configured coding model connectivity | kimi-k2p7-code | **FAIL (real): HTTP 404 "not deployed"** |
| Minimal connectivity | kimi-k3p1-pro | PASS: `PONG`, 387 in / 38 out |
| Streaming | kimi-k3p1-pro | PASS: 154 SSE chunks, 58 text deltas, usage reported in stream |
| Tool calling (call → result → answer) | kimi-k3p1-pro | PASS: called `get_line_count({path:"src/core/ProviderModels.ts"})`, answered with the real 141 |
| Streaming + tool call assembly | kimi-k3p1-pro | PASS |
| Multi-turn context | kimi-k3p1-pro | PASS: `ORCHID-4471` |
| Structured output (`response_format: json_schema`) | kimi-k3p1-pro | PASS **at the endpoint** (`{"kind":"fix","risk":1}`); FireworksProvider does not expose `response_format` yet |
| Routing: engineering intent | n/a | PASS: `["Fireworks", …]`, `workload: "coding"` |
| Anthropic disabled by default (real key present) | n/a | PASS: `available=false`, `generate` refused with the policy message |

Usage for the verification run: **2,948 input (478 cached) / 635 output tokens = $0.0114**.

## 4. The coding agent and Fireworks: limitation and harness

The Claude Code session that did this integration runs on Anthropic inference fixed by its hosting platform. It **cannot use Fireworks as its own backend**. So Kimi's coding work runs in `scripts/kimi-code.ts` instead. That harness:

* calls LÉLU's **own** `FireworksProvider` with `workload: "coding"`, so there is no second client and no Anthropic in the path;
* exposes the tools `list_files`, `read_file`, `search` (git grep), `edit_file` (exact unique replace), `write_file` (new files only), and an allowlisted `run` (`typecheck`, `test tests/<f>.test.ts`, `git diff`, `git status`);
* confines every path to `--root` (no `.git`, no `node_modules`), never commits or pushes, and records real usage and cost.

```
npx tsx scripts/kimi-code.ts --root <worktree> --task "<objective>" \
  [--model accounts/fireworks/models/kimi-k3p1-pro] [--out run.json] [--stream]
```

## 5. Real repository task performed by Kimi

* Model: `accounts/fireworks/models/kimi-k3p1-pro`. Root: a disposable `git worktree` at `d3e6e75`, separate from the working tree.
* Task: add `isModelOverridden(id)` to `ProviderModels.ts`, refactor `modelDiagnostics()` to use it, and write `tests/provider-models.test.ts`, then verify.
* What Kimi did, from the real tool log: it listed the repo, read `ProviderModels.ts`, three existing tests, `package.json`, `resolveEnv.ts` and the tsconfigs, and grepped for callers. It then made 2 `edit_file` calls, 1 `write_file`, ran `typecheck` (exit 0), ran the new test (exit 0) and reviewed `git diff`. That took 11 rounds in 115.5 s. One allowlist miss (`git status --short`) was corrected by Kimi on the next round.
* Its diff (+11/−4 in `ProviderModels.ts` plus the new test file) is correct and minimal. The test also clears `VITE_GROQ_MODEL`, which matters because the `VITE_` name takes precedence.
* **Independent re-verification** (run by me, not by Kimi): `tsc -p tsconfig.app.json --noEmit` succeeded and `tsx --test tests/provider-models.test.ts` passed 3/3.
* Usage: **117,393 input (101,577 cached) / 3,436 output tokens (1,580 reasoning)**.
  Cost at $2.00 / $0.20 cached / $10.00 per 1M: 15,816 × $2 + 101,577 × $0.20 + 3,436 × $10 = **$0.0863**.
* Kimi's change stays in the disposable worktree as evidence. It was **not** merged into the branch.

**Total Fireworks spend this session: about $0.098** (plus a few sub-cent probes). Anthropic spend from LÉLU: $0.

## 6. Test suite

Full suite (`tsx --test --test-force-exit --test-concurrency=1 tests/*.test.ts`):

| Tree | Result |
|---|---|
| Baseline `d3e6e75` (untouched worktree) | 427/427 on the second run; the first run failed #82 (live real-model test, "only 1 action(s) were taken") |
| This change | **433/434**. The only failure is the same live test #82 with the same message; it passed in an earlier run on this tree |

* #82 calls a real model and asserts on how many actions the model chooses to take, so it is flaky on both trees. It is not a regression.
* Two regressions found along the way and fixed: (a) the Anthropic adapter tests now opt in with `LELU_ENABLE_ANTHROPIC=true`; (b) suites that switch providers off by assigning `enabled = false` needed a setter, and that setter can never re-enable Anthropic past the policy.
* `--test-force-exit` is needed because `tests/autonomy-end-to-end.test.ts` leaves a `LeluRuntime` health-check timer running, so plain `npm test` never exits. That is pre-existing and also happens on baseline.
* The two `activeProvider: 'Anthropic'` lines in the test log come from stub providers (`model: 'Anthropic-m'`, no usage). No real Claude calls were made.
* `npm ci` fails because `package-lock.json` is out of sync with `package.json` (pre-existing). Dependencies were installed with `bun install --frozen-lockfile`.

## 7. To make K2.7 Code live

1. **Dedicated deployment** (`firectl create deployment accounts/fireworks/models/kimi-k2p7-code`, or the Fireworks console). This is billed per GPU-hour while it runs. Then point `FIREWORKS_CODING_MODEL` at the deployment's model id if Fireworks gives it a deployment-qualified name.
2. **Or** use serverless Kimi now: `FIREWORKS_CODING_MODEL=accounts/fireworks/models/kimi-k3p1-pro`.

**Until one of those is done:** LÉLU coding turns go to Fireworks first and get the real 404. The registry then records a Fireworks failure and puts it in its normal short cooldown, which also briefly skips Fireworks for chat. The turn falls through the existing chain (Groq, Cerebras, …). It **never reaches Anthropic** while the policy is off. The 404 is logged with the model id, so nothing fails silently.

If the key ever goes missing, add `FIREWORKS_API_KEY` as a secret on the server/host that runs `plugins/modelApi.ts` (and on the cloud environment for scripts). The browser never needs it.
