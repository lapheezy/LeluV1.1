# LÉLU V1.1 — MISSION 3

LIVE AUTONOMOUS ACTIVATION & COGNITIVE ACCEPTANCE

**Verdict: live autonomous activation is NOT established.** The provider path is real and
reachable, but the token budget was exhausted and the chat surface could not be driven in this
environment. Everything else in the mission was completed and is recorded below without softening.

---

## 1. Starting point and preservation

| Item | Value |
| --- | --- |
| Branch | `claude/unified-canonical-integration` |
| Commit | `7345ad6` (remote `ls-remote` verified identical) |
| Working tree | clean; primary worktree untouched (4 pre-existing paths preserved) |
| Canonical | `claude/master-integration` @ `ce768e08` — recorded, **not modified** |
| Isolated branch | `claude/live-autonomous-activation`, created from `7345ad6` |

No force-push, reset or rebase was performed. **No application source was changed.** This mission
was activation and validation; the only additions are acceptance scripts and this evidence.

Preserved and still present in the branch: spatial portal ownership, Mission 2.15.6 mobile
placement and restoration, `EnvironmentOrchestrationEngine`, the six environment tools, the single
`ToolRegistry`/dispatcher, Chat Universe, Creation Studio, Visual Studio, `WorkspaceEngine`,
`InterfaceOrchestrator`, approval/event/statistics systems.

## 2. Provider configuration — what actually exists

- **Transport:** the browser never holds a provider key. `src/providers/*` call the same-origin
  broker (`plugins/modelApi.ts`, `/api/model/<provider>/…`); the **server** resolves the credential
  (`BrokerTransport.ts` decides brokered vs direct).
- **Credential source:** this project's secrets arrive as bare platform names (`Anthropic`,
  `Groq`, …). `plugins/bareSecretAliases.ts` fills the documented names from them **only where the
  documented name is absent**, and `plugins/runtimeKeyBridge.ts` publishes only non-secrets to the
  page. `envPrefix` stays `VITE_`/`NEXT_PUBLIC_`.
- **Verified at boot** (`/tmp/live-dev.log`): `[env] bare secret names supplied ANTHROPIC_API_KEY,
  GROQ_API_KEY, OPENROUTER_API_KEY, GITHUB_MODELS_TOKEN, MESHY_API_KEY, ELEVENLABS_API_KEY,
  SUPABASE_PUBLISHABLE_KEY`.
- **Server-side broker status** (`GET /api/model/status`):

| Provider | Key present | Usable |
| --- | --- | --- |
| groq | yes | true |
| openrouter | yes | true |
| githubModels | yes | true |
| anthropic | yes | **false** — policy off (`LELU_ENABLE_ANTHROPIC` unset) |
| cerebras / mistral / fireworks / gemini | no | false |

- **Model identifiers:** `groq → openai/gpt-oss-120b` (`src/core/ProviderModels.ts`),
  `openrouter → openrouter/free`, `githubModels → provider default`.
- **Routing order:** `VITE_DEFAULT_PROVIDER` is unset, so the configured default is `fireworks`
  (no key) and the registry priority chain decides: OpenRouter 2 → Groq 2.5 → … → GitHub Models 10.
  Provider priority and fallback rules were **not** changed.
- **No secret was printed, logged, committed or placed in a source file.** `/api/env-check` reports
  presence only (`SET (56 chars)`), and `docs/acceptance/master-integration/records/bundle-secret-scan*
  .txt` still records the provider key as absent from every built file.

## 3. Live provider evidence (what was actually reachable)

**Real successful generation through the application's own broker:**

- `POST /api/model/groq/chat/completions` → **200**, `openai/gpt-oss-120b`,
  `chatcmpl-1f4522ec-…`, real reasoning tokens, `total_tokens: 103`.
- `POST /api/model/openrouter/chat/completions` → **200**, routed to
  `xingchen-agi/xing4.0-29b-a4b:free` via provider `Phala`.
- `POST /api/model/githubModels/chat/completions` → **200**, body `OK`.
- From the page itself, the app's transport produced a **200** from Groq
  (4 messages, 5,100 characters of prompt) — a real model call made by the application, not by a test.

**Then the quota ran out, and the app said so:**

| Recorded request | Result |
| --- | --- |
| `openrouter` `openrouter/free` | **429** `Rate limit exceeded: free-models-per-day`, `X-RateLimit-Limit: 50`, `Remaining: 0`, reset `1794182400000` |
| `groq` `openai/gpt-oss-120b` | **429** `tokens per day (TPD): Limit 200000, Used 199672, Requested 1606`, retry in `9m12s` |

This is the precise blocker: **the configured free tiers are spent for the day.** OpenRouter's free
allowance is at 0 of 50; Groq is at 199,672 of 200,000 daily tokens, so even the *smallest* app turn
(1,606 tokens requested) is refused.

Also observed and reported as a finding: after the Groq 429 the chain produced **no** request to
`githubModels`, even though that rung answers 200. Whether that is the rung budget, the intent's
provider preference, or the registry's 429 parking was not determined — the failure is recorded, not
explained away.

## 4. The second blocker: the chat surface could not be driven

Three real entry attempts in headless Chromium (software WebGL), against the running app:

1. Home shell → `What LÉLU is doing — open chat` → no `[data-lelu-chat-window]`.
2. Home shell → `Travel to Conversation` → destination changed (atmosphere/text changed), no chat window.
3. Home shell → `Summon the chat` → no chat window within 20 s; a longer wait hung the page.

`docs/acceptance/live-autonomous/probe-entry.json`, `probe-chat.json`, `live-turn.json` record the
real DOM at each step. Because no composer ever mounted, no user turn could be typed, so **workflows
A–G were not executed** and no environment was created by a live model in this run.

Consequence for requirement §2 and §3: the six environment tool schemas being offered in a **real**
model request, and the model's **actual** choice among them, remain **unverified live**. They are
verified in-process only (see §6) — the difference matters and is not blurred here.

## 5. Screenshots / browser evidence

`docs/acceptance/live-autonomous/shots/` — `home.png` (the real home surface with the provider
build stamp), `summon-9s.png` (state nine seconds after pressing "Summon the chat"), and
`blocked.png` (the exact page state when the driver had to stop because no composer existed).
There is no screenshot of a created environment, because none was created.

## 6. What *is* proven (in-process, not live)

`tests/environment-integration.test.ts` (7/7) drives the production `ProviderResolver` tool loop
with a scripted provider and asserts: the six tools are offered by `toolSchemasForModel()` with
resolvable model-facing names; each of compose / present / mutate / manage / save / restore
dispatches through the real dispatcher into `EnvironmentOrchestrationEngine` and `WorkspaceEngine`;
in-place mutation keeps the view id and advances the revision; save→clear→restore round-trips through
`KvStore`; and a refused operation returns an honest failure.

This proves **wiring**, not cognition. It is categorised as a scripted-provider integration test —
never as a real-model test.

## 7. Persistence

Environment snapshots are stored by `EnvironmentOrchestrationEngine` through `KvStore`, which is
backed by `localStorage` in the page. That is **local-device persistence only**: no server store, no
cross-device restore, and none is claimed. This run did not exercise a live save/restore, because no
environment was created.

## 8. Failure handling — what was observed

- Both exhausted providers returned their real upstream error and were reported as failures; the
  chain walked from OpenRouter to Groq rather than stopping at the first.
- No reply was fabricated: with both rungs refusing, the recorded transcript contains no assistant
  message claiming completed work.
- The broker's own protections behaved: cross-origin requests refused, no key in any response,
  status served as booleans, and an upstream 401/403 is remembered so a revoked key stops being
  retried.
- **Not exercised:** provider timeout, malformed tool-call arguments, partial multi-tool execution,
  follow-up generation failure — each needs a live turn that this environment could not obtain.

## 9. Gates (this branch, `claude/live-autonomous-activation`)

| Gate | Result |
| --- | --- |
| `bunx tsc -b --force` | **PASS** (exit 0) |
| `bun run build` | **PASS** (exit 0) |
| `bun run lint` | **PASS** (exit 0) |
| `bun run test` | **PASS** — 1,824 pass, 0 fail, 6 skipped |
| Existing baseline preserved | yes — identical counts to the integration branch; no test deleted or weakened |

Logs: `/tmp/live-tsc.log`, `/tmp/live-build.log`, `/tmp/live-lint.log`, `/tmp/live-test.log`.
Browser checks: `probe-entry.mjs`, `probe-chat.mjs`, `live-turn.mjs` (all in
`docs/acceptance/live-autonomous/scripts/`).

## 10. Remaining blockers

1. **Daily token budget exhausted** — OpenRouter free 0/50; Groq 199,672/200,000 TPD. The app's real
   turn (tool schemas included) cannot fit. This is a billing/plan limit, not a code defect.
2. **Chat surface not reachable by the driver** in this headless environment — no composer mounted
   from any of the three real entry controls, so no conversational turn could be sent.
3. **Anthropic is policy-off** (`LELU_ENABLE_ANTHROPIC` unset) — deliberate, unchanged.
4. **The chain did not reach the working `githubModels` rung** after a 429; recorded as an
   unexplained failure.
5. **Renderer/UI evidence of a model-created environment** therefore does not exist for this mission.

## 11. What is needed to finish Mission 3

- Provider capacity for roughly a dozen turns: a Groq Dev tier or paid credits, or an Anthropic
  opt-in, so the ~20k-token tool-carrying requests fit the daily budget.
- A supported path to open the chat under automation (the app's own entry control in a non-headless
  or full-GPU browser), or an exported selector/route for the chat surface.
- With those, workflows A–G and the failure matrix in §8 can be executed exactly as specified, and
  evidence per turn recorded by the drivers already committed here.

## 12. Merge readiness

**Not merge-ready, and nothing is claimed to the contrary.** No live workflow was proven, so the
mission's success criterion — that LÉLU understands a request, decides whether an environment is
needed, selects tools, creates/evolves a workspace, presents artifacts, saves, restores and
continues — is **unmet in evidence**, while the underlying systems remain green under every gate.
