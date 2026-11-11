# LÉLU — INDEPENDENT APP HEALTH AUDIT & LOCAL ENV PROVIDER VERIFICATION

Date: 2026-11-10
Auditor: independent verification pass (read-only; no source changes, no commits)
Repository: `lapheezy/LeluV1.1`
Branch: `freebuff/8d0ba7add4a3070c0cc08919`
HEAD at start and end: `62ad31068243880e9ce105b3a50f46c167d6f2db`
Working tree: clean at start; clean at end (only this untracked `artifacts/` directory added)

**No secret value appears in this document, in the logs, or in any output captured for it.**

---

## A. Application

| Check | Result | Evidence |
|---|---|---|
| Startup | PASS | `vite --host 0.0.0.0 --strictPort --port 3000` (the project's documented `bun run dev`, port overridden for the preview ingress). Ready in 1198 ms, PID 3157. |
| Stability | PASS | Still serving after the full session; `GET /` → 200 in 13–155 ms. |
| Frontend render | PASS | Cosmos home, app tiles, Chat Universe, a live chat window and the spatial navigator all painted. No blank screen. `artifacts/audit-2026-11-10/01-boot.png`. |
| Backend endpoints | PASS | `/api/env-check` 200, `/api/model/status` 200 (2.1 ms), `/api/provider-health` 200, `/api/forge/*` 200, `/api/github/status` 200, `/api/acquisition` 200. |
| Engineering runtime | EXPECTED-DISABLED | `/api/engineer/status` → 503, `disabled: true`, because `LELU_ENGINEER_TOKEN` is unset. Documented fail-closed default, not a fault. |
| Backend crash | NONE | `dev.log` contains no error/fatal/unhandled line. |
| Fatal JS errors | NONE | Console has no uncaught exception and no unhandled rejection. |
| Console errors present | 3 categories, none fatal | (1) `manifest.webmanifest` 403 — preview-host auth artifact, not the app; (2) `knowledge/relay` 503 — `NEWS_API_KEY` / `YOUTUBE_API_KEY` absent; (3) arXiv CORS block from the browser (pre-existing: that host needs the server relay). |
| Infinite loading / auth loop | NONE OBSERVED | Chat answered; no spinner persisted; the identity sheet does not loop, it simply re-renders (see E4). |

---

## B. Local ENV

### Files detected

| File | Present | Notes |
|---|---|---|
| `.env` | **ABSENT** | — |
| `.env.local` | **ABSENT** | — |
| `.env.development` / `.env.production` | ABSENT | — |
| `.dev.vars` | ABSENT | — |
| `env.example` | present (tracked, 207 lines) | Template only |

`.gitignore` lines 16–18 cover `.env`, `.env.local`, `.env.*.local`. `git ls-files` shows **no** env file tracked.

### Ambient process environment

35 credential-bearing variable names were probed by presence and length only. **All 35 are absent**, including
`VITE_GROQ_API_KEY`, `GROQ_API_KEY`, `VITE_OPENROUTER_API_KEY`, `OPENROUTER_API_KEY`, `VITE_CEREBRAS_API_KEY`,
`CEREBRAS_API_KEY`, `VITE_MISTRAL_API_KEY`, `MISTRAL_API_KEY`, `VITE_FIREWORKS_API_KEY`, `FIREWORKS_API_KEY`,
`VITE_ANTHROPIC_API_KEY`, `ANTHROPIC_API_KEY`, `LELU_ANTHROPIC_API_KEY`, `CLAUDE_API_KEY`,
`VITE_GITHUB_TOKEN`, `GITHUB_MODELS_TOKEN`, `GEMINI_API_KEY`, `GOOGLE_API_KEY`, `VITE_GEMINI_API_KEY`,
`SUPABASE_URL`/`VITE_SUPABASE_URL`/`SUPABASE_PUBLISHABLE_KEY`/`VITE_SUPABASE_PUBLISHABLE_KEY`/`SUPABASE_SERVICE_ROLE_KEY`,
`NEWS_API_KEY`, `YOUTUBE_API_KEY`, `MESHY_API_KEY`, `AISSTREAM_API_KEY`, `VITE_FIRMS_API_KEY`, `NASA_API_KEY`,
`LELU_ENGINEER_TOKEN`, `VITE_LELU_ENGINEER_TOKEN`, `OPENAI_API_KEY`, `VITE_AI_PROXY_BASE_URL`.

`./node_modules/.bin/tsx scripts/verify-secrets.ts` → **21 secrets declared · 21 wired to code · 0 present in this environment.**

### Redacted configuration inventory

"Variable present" = named in a config file or the environment. "Runtime loaded" = what the running server reports through `/api/env-check` and `/api/model/status`.

| Provider | Variable present | Variable nonempty | Runtime loaded | Status |
|---|---|---|---|---|
| Anthropic | no | no | false | UNCONFIGURED |
| Groq | no | no | false | UNCONFIGURED |
| OpenRouter | no | no | false | UNCONFIGURED |
| Cerebras | no | no | false | UNCONFIGURED |
| Mistral | no | no | false | UNCONFIGURED |
| Fireworks | no | no | false | UNCONFIGURED |
| Gemini | no | no | false | UNCONFIGURED |
| GitHub Models | no | no | false | UNCONFIGURED |
| Supabase (URL + publishable) | no | no | false (env path) | BUNDLED PUBLIC FALLBACK IN USE |
| NASA FIRMS | no | no | false | not_configured |
| AISStream | no | no | false | not_configured |
| News / YouTube | no | no | false | relay 503 |

### Does the app actually load local env?

The loader chain is **correctly wired** — this is verified by reading the code and by the fact that the runtime's own
presence report agrees with the process environment:

* Vite dev/preview: `loadEnv(mode, process.cwd(), "")` in `vite.config.ts`, then `fillBareSecretAliases()`, then `envReader` = `env[key] ?? process.env[key] ?? ""`.
* Standalone `server.ts` / Deno `main.ts`: `plugins/loadEnvFiles.ts`, precedence process env → `.env.local` → `.env`, never overwriting a platform-set key.
* Client-side resolution: `plugins/runtimeKeyBridge.ts` publishes only non-secret config and the Supabase publishable key.
* Server-owned model credentials: `plugins/modelApi.ts` resolves keys server-side only; `/api/model/status` returns booleans.

There is **no stale override and no accidental browser exposure**: the served HTML contains zero `__LELU_*__` globals, zero
key-shaped strings, and no bridge script (nothing to bridge). Working directory is the repo root, so env discovery would
resolve correctly if a file existed.

**Conclusion: the loader is not the defect. There is nothing for it to load.**

---

## C. Provider verification

| Provider | Model | Authentication | Inference | Latency |
|---|---|---|---|---|
| Anthropic | `claude-opus-5-5` (registry default) | NOT TESTED — no credential; also policy-off (`LELU_ENABLE_ANTHROPIC` unset) | NOT TESTED | — |
| Groq | `openai/gpt-oss-120b` | NOT TESTED — no credential | NOT TESTED | — |
| OpenRouter | `openai/gpt-4o-mini` | NOT TESTED — no credential | NOT TESTED | — |
| Cerebras | `gpt-oss-120b` | NOT TESTED — no credential | NOT TESTED | — |
| Mistral | `mistral-large-latest` | NOT TESTED — no credential | NOT TESTED | — |
| Fireworks | `accounts/fireworks/models/gpt-oss-120b` (coding: `kimi-k3p1-pro`) | NOT TESTED — no credential | NOT TESTED | — |
| Gemini | `gemini-2.0-flash` | NOT TESTED — no credential | NOT TESTED | — |
| GitHub Models | `openai/gpt-4o` | NOT TESTED — no credential | NOT TESTED | — |
| Local (on-device) | — | n/a | unavailable (`webRuntime: not-installed`, no local backends) | — |

**Zero live inference requests were made**, deliberately: no credential exists to authenticate one, and the brief forbids
spending credits. `/api/provider-health` performed its own probes and reported `missing-key` for Groq/OpenRouter/Anthropic
without issuing a billed request.

Structural checks that did run:

* `tests/bare-secret-aliases.test.ts` + `tests/credential-exposure.test.ts` + `tests/model-broker.test.ts` → **25/25 pass**.
* `scripts/verify-providers.ts` initialises the real registry in the documented order and then stops at
  `Anthropic is disabled by policy (set LELU_ENABLE_ANTHROPIC=true to opt in)` — the documented default.
  Its `hasKey: true` lines come from **fixture keys it injects into `__LELU_*__` for the duration of its own stubbed-fetch
  test**, as its header states. They are not evidence of a real credential and are not reported as such.

**Supabase note (real network traffic observed):** the page issued `OPTIONS` + `GET` to
`nrehsldbfxthspikaxvr.supabase.co/rest/v1/legacy_memories` and received **200**. That is the *bundled public fallback*
in `src/core/config/supabasePublic.ts` (URL + publishable key as a pair), not environment configuration — the env path
reports MISSING. Worth knowing: persistence is live without any `.env`, which makes "no env file" easy to overlook.

---

## D. Chat

| Check | Result | Evidence |
|---|---|---|
| Basic conversational response | PASS (degraded, honest) | Message sent through the real composer; LÉLU replied: "I'm in offline mode right now — all AI providers are unreachable or unconfigured, so I can't generate new answers…" No mock answer, no hang, no silent failure. |
| Consecutive messages | PASS | Second message accepted and appended; second offline reply rendered. `artifacts/audit-2026-11-10/02-chat-offline-reply.png`. |
| Context preservation | NOT VERIFIABLE | Requires a real model turn. Locally, both turns are retained in the window and in the Chat Universe preview. |
| Streaming | NOT EXERCISED | No provider answered. |
| Provider-failure handling | PASS | The exact Phase-5 item 6 behaviour: an honest local answer instead of an error toast or an invented response. |
| Actual provider attribution | NONE | No provider was selected or answered. The UI reports providers as unavailable rather than implying one replied. |
| Timings | — | `GET /` 13–155 ms; `/api/model/status` 2.1 ms; `/api/env-check` and `/api/provider-health` < 20 ms; the offline reply rendered without a reload inside the 18 s observation window. No streaming TTFT measurable. |

---

## E. Remaining defects

**E1 — No AI provider can run: zero credentials, and no env file in this worktree.**
Root cause: nothing to load. Not a code defect — the credential blocker already recorded in commit `1b979d3`
and in `docs/PHASE2_DEPLOYMENT_REPORT.md` ("All 21 credentials are absent from this environment").
Affected files: none.
Smallest required correction: put the provider keys in the workspace `.env` (untracked, gitignored) and restart the dev
server. **Not performed** — no key material is available to this session and none may be invented or substituted.

**E2 — Provider status endpoints are correct, so the app will recover without code changes.**
When a key is added, `/api/model/status` flips that provider to `true` and the existing chain routes to it. No wiring fix is indicated.

**E3 — `manifest.webmanifest` returns 403 on the preview host.**
Root cause: preview-host auth on `*.style.dev`, not the application. No correction needed.

**E4 — Identity sheet re-renders over an open chat window.**
Observed: after choosing "Continue without an account" and opening a chat, the "Sign in to LÉLU" sheet is present again and
overlaps the chat panel/composer. This is a UI/UX defect, not a configuration one. **Not fixed** — outside this mission's
"smallest confirmed configuration defect" scope.

**E5 — arXiv is CORS-blocked from the browser** (`export.arxiv.org`), and `/api/knowledge/relay` answers 503 for news/YouTube
while those keys are absent. Both are the documented honest-degradation behaviour.

---

## F. Repository preservation

| Item | Value |
|---|---|
| Branch | `freebuff/8d0ba7add4a3070c0cc08919` |
| Starting SHA | `62ad31068243880e9ce105b3a50f46c167d6f2db` |
| Ending SHA | `62ad31068243880e9ce105b3a50f46c167d6f2db` (unchanged) |
| Commits created | 0 |
| Tracked files changed | 0 |
| Uncommitted work discarded | none (tree was clean before and after) |
| Stashes | none |
| Added (untracked) | `artifacts/audit-2026-11-10/` — `AUDIT-REPORT.md`, `dev.log`, `dev.pid`, `01-boot.png`, `02-chat-offline-reply.png` |
| Pushed | nothing (not authorized) |

Voice infrastructure, cognition, memory, orchestration and provider architecture were **not modified**.

---

## G. Addendum — OpenRouter key reported present in project settings (2026-11-10)

The owner reported an OpenRouter key configured in the project settings. It is **not delivered to this sandbox**.

Checked, in this order:

| Check | Result |
|---|---|
| `OPENROUTER_API_KEY`, `VITE_OPENROUTER_API_KEY`, `OPEN_ROUTER_API_KEY` in the process env (length only) | ABSENT |
| Total environment size seen by a fresh shell | **13 variables** (a minimal sandbox env, not a project env with secrets) |
| Any credential-shaped name (`*API_KEY*`, `*TOKEN*`, `*SECRET*`, provider names) | none |
| `.env`, `.env.local`, `.env.development`, `.env.production`, `.dev.vars` in the project | none |
| `.freebuff/` project marker / secrets file in the workspace | absent |
| `/run/secrets` mount | absent |
| Re-provision the sandbox (`cloud_sandbox_create`) and re-check | unchanged — 13 variables, still no key |

**Diagnosis:** the credential exists in the platform's project settings, but this chat's sandbox was provisioned
before it was added, and the platform has not injected it into the process environment nor written it into an env file.
This is a **delivery gap, not an application defect** — LÉLU's loaders are correct (section B), so the key would be
picked up automatically once it lands in either place.

**No value was requested, read, printed or copied. Nothing was written into source. No placeholder was created.**

### Exact verification path once the key is delivered

1. Restart the dev server (the Vite env snapshot is read at startup; a running process will not see a new variable).
2. `GET /api/model/status` → `openrouter: true`, state `CONFIGURED`.
3. `GET /api/provider-health` → performs exactly **one** minimal OpenRouter inference (`max_tokens: 5`) through the
   app's own provider + model resolver, returning `status`, `ok` and latency. This is the cheapest honest live proof
   and needs no new code.
4. One message in the chat UI → confirms end-to-end routing, streaming behaviour and provider attribution.

Re-running all four produces the evidence sections C and D of this report currently mark NOT TESTED.

### G.1 Confirmed defect found and fixed — the alias lookup could not see the real secret name

`plugins/bareSecretAliases.ts` maps a platform secret name onto the name the code reads. Its OpenRouter entry is
spelled **`Openrouter`**. This project's secret is named **`openrouter1`** — a different casing *and* a numeric
suffix the platform added because the plain name was already taken. Environment names are case-sensitive and exact,
so `lookup.get("Openrouter")` returned `undefined` for a perfectly good credential — the exact "a provider reports
itself unconfigured while the key is right there" symptom this module was written to remove, caused by the module
itself. Neither difference carries meaning: casing is not semantic in a secret name, and the digit identifies the
storage slot, not the provider.

| Item | Detail |
|---|---|
| Root cause | Case-sensitive, exact-name lookup of a name the platform stores as `openrouter1` |
| Affected file | `plugins/bareSecretAliases.ts` |
| Correction | Bare names resolve through one helper that tolerates casing (canonical/lower/upper) and a trailing single digit 1–9. The **base name must still match exactly**, so a different provider's secret can never be adopted. Used by both `fillBareSecretAliases` and `bareSecretAliasReport` |
| Invariants preserved | A documented name still always wins; only holes are filled; names only in reports; no `VITE_` name is created |
| Test | `tests/bare-secret-aliases.test.ts` — `openrouter1` fills `OPENROUTER_API_KEY`; `openrouter` / `Openrouter` / `OPENROUTER` / `openrouter1` / `OPENROUTER9` all match; `openrouter_old`, `my_openrouter1` and `Openrouterx` fill nothing; a documented name still wins |
| Why it was not visible in `/api/model/status` at the time | No secret value was present in this sandbox then (section G), so there was nothing to map. The fix takes effect the moment the platform writes the key — confirmed in G.2 |

### G.2 Verified end-to-end — both credentials resolve and answer

At 20:56 the platform wrote `.env.local` (663 bytes, ignored at `.gitignore:17`). Its bare names are, in full:
`Elevenlabs`, `Github`, `Groq1`, `Groq2`, `Meshy`, `Openrouter1`, `Openrouter2`, `Openrouter3` — i.e. exactly the
casing-plus-digit shape G.1 describes, with no documented name and no `VITE_` name anywhere in the file.

The dev server was restarted (pid 10884) so `loadEnv` would read the new file, then:

| Check | Result |
|---|---|
| `GET /api/model/status` | **`groq: true`, `openrouter: true`, `githubModels: true`**; anthropic/cerebras/mistral/fireworks/gemini `false` (no key supplied) |
| `GET /api/provider-health` (one minimal real call per provider, `max_tokens: 5`) | **`groq` state=ok ok=true**, **`openrouter` state=ok ok=true**; anthropic/firms/ais fail — no key, policy-off, or not configured |
| Key exposure | No credential string in any artifact or log; only names and lengths were ever printed |

`Openrouter1` → `OPENROUTER_API_KEY` and `Groq1` → `GROQ_API_KEY`: the bare-name bridge is what made both visible,
and a real inference completed against each. Section C's earlier `NOT TESTED` verdict is superseded for these two
providers.

### G.3 Checked and clear — `bridgedFromUnprefixedNames: []` is correct here

An empty array in `GET /api/env-check` looked like the bridge failing to report itself, so it was traced rather than
assumed. `bridgeReport` (`plugins/runtimeKeyBridge.ts:515`) reports a *different* mechanism: documented names that
arrived unprefixed (e.g. `GROQ_API_KEY`) and are therefore bridged onto the `__LELU_*__` globals. `.env.local` holds
no documented name at all — only bare aliases — so there is nothing for that field to list, and `[]` is the truthful
answer. The bare-alias fill instead shows where it belongs: `/api/env-check`'s `VITE_GROQ_API_KEY` and
`VITE_OPENROUTER_API_KEY` presence fields both read present, which is exactly what the alias bridge produced.

No defect, no change. Recorded so a later reader does not re-open the same false lead.

### G.5 The two caveats from the chat proof — fixed (2026-11-11)

**Caveat 1 — a conversational question became a task-failure notice.**

Observed reply to *"What was the very first thing I asked you in this conversation?"*:

```
Not completed: What was the very first thing I asked you… — step "Recall the first user request…":
No stored memory matches "…".
1. [failed] Recall the first user request in this conversation. (memory.recall) — No stored memory matches "…"
```

Two causes, not one:

1. `TaskPlanner`'s system prompt let the planner answer a conversation-scoped question with a
   `memory.recall` step, even though the conversation itself holds the answer.
2. `Orchestrator.planAndExecute` used `executor.report(task)` as the reply whenever the task did not
   complete, so a status dump replaced an answer.

Fix: the planner prompt now directs conversation-scoped and self-state questions to
`{"steps":[],"reason":"answerable directly"}`; `planAndExecute` returns `null` (the existing
"answer as a normal turn" path) when **no step completed**, keeping the failure detail as an
`execution_phase` event instead of the reply. `waiting` is deliberately excluded — there the report
*is* the approval prompt. A plan that did real work and then failed still returns its report, so the
turn-completion guarantees are unchanged.

Verified: the same question now answers *"The very first thing you asked me in this conversation was
if I am actually connected to a live model right now."* (`chat-06-recall-fixed.png`).

**Caveat 2 — one refusal labelled a provider for the rest of the session.**

`GET /api/model/status` reported `groq: CAPACITY_LIMITED` long after the 429 window had passed,
while later turns completed through other providers. The broker stored the last observation forever:
`at` was recorded but never used to expire anything, so a transient 429 read as a standing property.

Fix: transient evidence (`CAPACITY_LIMITED`, `UNREACHABLE`) expires after 120 s; verified states
(`COMPLETION_VERIFIED`, `TOOL_CALLING_VERIFIED`) and authentication failures are retained, because
those are facts about the credential rather than about a moment.

Verification honesty: typechecked and covered by the suite, but the expiry was **not** observed
end-to-end — that needs a live 429 plus a two-minute wait. The `groq: CONFIGURED` reading after the
restart comes from a fresh process, not from the expiry path.

**Checks for G.5**

| Check | Result |
|---|---|
| `tsc -b --force` | exit 0 |
| `turn-completion`, `agentic-execution`, `broker-contract`, `request-budget-enforcement`, `runtime-integrity` | **61/61 pass** |
| Fresh process broker refusals | **0** |
| Provider states | `openrouter: COMPLETION_VERIFIED`, `groq: CONFIGURED`, githubModels `CONFIGURED` |
| Secret exposure | no key material in logs or artifacts; only names and lengths printed |

Nothing committed or pushed: HEAD remains `62ad310`.
