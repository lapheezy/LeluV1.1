# LÉLU — MISSION 5.8
## Provider capability truthfulness, broker contract repair & resilient live execution

**Verdict: MISSION PARTIALLY COMPLETE.** The engineering repairs are done, tested and
verified live (Gates A, B, C). Three gates remain unproven for reasons that are recorded
rather than papered over: no live tool call (D), no live request-budget capture (E), no
after-cycles listener attribution (F), and no live environment lifecycle (G).

### Starting state (verified, not assumed)

| Item | Value |
|---|---|
| Starting branch | `claude/mission-5-7-provider-resilience-autonomy` |
| Starting HEAD (full) | `0b89f54d52708b3e5edf4f808bb6affe423e11fe` |
| Mission branch | `claude/mission-5-8-provider-capability-truthfulness` (base `0b89f54`) |
| Canonical `claude/master-integration` | `ce768e08cebd71eaa05418c5942ad637a8ac0596` — **unchanged** |
| Tree at start | clean, 0 untracked |
| 5.7 evidence | `docs/acceptance/mission-5-7` (20 files) preserved; one file was overwritten by a re-run of the 5.7 listener probe and has been restored with `git checkout --` before commit |
| 5.7 fixes still present | broker-aware GitHub Models guard, `broker-consolidation` regression pin, rung budget, schema scoping, probes, report |

### Gate A — the `200 text/plain "OK"` — **PASS**

The handler is `plugins/modelApi.ts` → `createModelApi(...).handle`, mounted at `/api/model`,
matching `/^\/([A-Za-z0-9_-]+)(\/.*)?$/` and forwarding to `endpoint(provider.endpointId) + rest`.

Attribution was differential, not guessed:

| Request | Result |
|---|---|
| `POST /api/model/githubModels/chat/completions` | 200, `text/plain`, `OK` |
| `POST /api/model/githubModels/nope` | 200, `text/plain`, `OK` |
| `POST /api/model/githubModels` | 200, `text/plain`, `OK` |
| `GET  /api/model/githubModels/chat/completions` | 200, `text/plain`, `OK` |
| `POST /api/model/nosuchprovider/chat/completions` | 404 JSON `No brokered provider …` |

Unknown providers get a structured 404, so the route *is* the broker. Then, directly to the host:

| Direct request | Result |
|---|---|
| `POST https://models.github.ai/inference/chat/completions`, **no credential at all** | 200, `text/plain`, `OK` |
| `GET https://models.github.ai/inference/nope` | 200, `text/plain`, `OK` |
| `POST https://api.groq.com/openai/v1/chat/completions`, no auth | 401 JSON from cloudflare — a real answer |

**The `OK` is the network egress boundary of this environment**, not application code, not a
stub, not a dev fallback, and not a provider passthrough: the host answers 200 `OK` for every
path with or without a credential, while the same egress reaches Groq normally. That boundary
is outside the application's control, so no application change makes GitHub Models answer here.

What *was* inside the application is the real defect this exposed: **the broker treated any 2xx
as a completion.** Repaired in Gate B. GitHub Models is *not* reported as a route repair success.

### Gate B — broker completion contract — **PASS**

*Before:* upstream bytes were forwarded verbatim, so an intercepted `OK` reached the app as a
successful completion.

*After:* on completion routes, a 2xx whose **body is not JSON** (and which is not an event
stream) is refused:

```
HTTP/1.1 502 Bad Gateway
{"ok":false,"code":"BROKER_CONTRACT_VIOLATION","provider":"githubModels",
 "error":"Upstream answered 2xx without a JSON completion; refusing to report it as one.",
 "upstreamStatus":200,"upstreamContentType":"text/plain","upstreamPreview":"OK "}
```

Captured live through the real route. Preserved unchanged: event-stream chunk forwarding,
upstream error statuses (a 401 still reaches the caller as 401), and the rule that no
credential ever appears in a response.

The rule is measured on the body rather than the declared type on purpose: the first draft
keyed on content-type and refused a legitimate `{}` JSON body in the pre-existing Anthropic
broker test. The *rule* was narrowed; the *assertion* was not relaxed.

Outcomes, reported separately as required:
* **success path verified** — Groq `openai/gpt-oss-120b`, 200 `application/json`, real `choices[]`.
* **failure path verified** — GitHub Models, 502 structured and classified.
* **tool-call completion** — not obtained this mission.

Six new tests (`tests/broker-contract.test.ts`) cover: non-completion refused, authenticated
completion passes through, tool calling claimed only from a real tool call, 401 classified,
quota classified, configuration is not capability.

### Gate C — capability reporting — **PASS**

No new subsystem and no probe traffic. The broker records the **last real upstream outcome per
provider** as a by-product of calls it was already serving, so `/status` reports evidence:

```json
{"providers":{"groq":true,…},
 "states":{"anthropic":{"state":"POLICY_DISABLED"},"groq":{"state":"COMPLETION_VERIFIED"},
           "openrouter":{"state":"CAPACITY_LIMITED"},"cerebras":{"state":"UNCONFIGURED"},
           "githubModels":{"state":"CONTRACT_VIOLATION","httpStatus":200,
                           "note":"2xx body was not JSON, so not a completion","at":1794170675126}}}
```

Observed transition, live: `githubModels` went `CONFIGURED` → `CONTRACT_VIOLATION` after one real
attempt; `groq` went `CONFIGURED` → `COMPLETION_VERIFIED` after one real completion.
`providers` booleans are unchanged for compatibility. `TOOL_CALLING_VERIFIED` is set only from a
response body containing `tool_calls`; a text completion can never produce it (pinned by test).
Quota spent on rendering status: **zero**.

### Gate D — fallback and resilience — **PARTIAL**

Unit coverage all green: rung budget 9, broker consolidation 14, schema scoping 8, broker
contract 6. Cooldown/known-rejection exclusion is respected and pinned.

Live: one **genuine completion** from Groq. The second-provider attempt (OpenRouter
`meta-llama/llama-3.1-8b-instruct:free`) returned 404 *"This model is unavailable for free"* —
the free slug was withdrawn upstream. Model identifiers were **not** changed to chase a green
result. Not proven: a live second-provider *tool-calling* fallback, and a within-turn
demonstration that a refused provider does not block the next eligible one.

### Gate E — request budget — **PARTIAL**

`src/core/router/RequestBudget.ts`, called from `ProviderResolver.generateWithTools` at the
moment the tool list is chosen and before any provider call. It reports provider, model, tier,
message count, system/history/prompt bytes, tool count, tool-schema bytes, total bytes, tool
names — and exactly one token-like field, `estimatedTokens`, labelled `estimation:"bytes/4"`.
Nothing is called a token that is not one; no provider usage is invented. Sizes are UTF-8 bytes
(verified: `U+00E9` = 2). No content, arguments or credentials are copied.

Five tests pass, including "six environment tools at FULL", "NONE carries no schemas", "empty
tool list costs no schema bytes". **Not captured in a live turn** — no app chat turn was driven
this mission, so the log line has not been observed in the wild. The single tool list is the one
the provider receives; no parallel registry was added.

### Gate F — listener attribution — **PARTIAL**

Method unchanged (`DOMDebugger.getEventListeners`, grouped by registration source site).
Baseline retained from 5.7: window 63 listeners / 57 sites, document 3 / 3.
**After-cycles capture failed three times** (6, 4 and 3 cycles) with
`Target page, context or browser has been closed` — Chromium terminates on launch in this
session while the dev server is healthy and 8 GB RAM is free. That is a measurement-harness
failure, not an application failure. No leak claim is made.

### Gate G — live environment lifecycle — **BLOCKED**

All seven stages NOT TESTED. No permitted provider offered stable multi-turn tool-calling
capacity in this window: Groq produced exactly one completion with an intermittent daily
allowance, OpenRouter's free slug is withdrawn, GitHub Models is intercepted at the egress
boundary, four providers are unconfigured, Anthropic is excluded by policy. No mock, no scripted
tool call and no manual dispatch was substituted. The environment engine, tool registry,
dispatcher, workspace, portals and Cosmos rendering were not modified.

### Regression

| Check | Result |
|---|---|
| `bunx tsc -b --force` | exit 0 |
| `bun run build` | exit 0 |
| `bun run lint` | exit 0, 0 errors, 133 warnings (same as 5.7) |
| `bun run test` | **1850 tests, 1848 pass, 0 fail, 2 skipped** (5.7: 1839/1839/0/0) |
| Targeted suites | 73 tests, 73 pass |
| Mobile | not re-run (Chromium unavailable); 360×640/375×812/390×844 last PASS in 5.7, 430×932 in 5.6; physical device never used |

The 2 skipped tests are reported as observed: they are not among the 11 added here, and 5.7
reported none.

### Files changed

| File | Change |
|---|---|
| `plugins/modelApi.ts` | completion-contract guard; per-provider evidence; `/status` `states` |
| `src/core/router/RequestBudget.ts` | new: sanitized request/budget descriptor |
| `src/core/router/ProviderResolver.ts` | log the budget at the assembly boundary |
| `tests/broker-contract.test.ts` | new: 6 contract/capability tests |
| `tests/request-budget.test.ts` | new: 5 budget tests |
| `docs/acceptance/mission-5-8/` | 10 evidence files, log, report |

No provider priority, model identifier, credential value, degradation strategy, Stop/cancellation
path or cooldown rule was changed. No duplicate registry, broker, resolver, dispatcher or
environment engine was created.

### Remaining blockers and open defects

1. **GitHub Models is unreachable from this environment** (egress interception). Production may
   behave differently; the broker now fails loudly instead of silently.
2. **No stable live capacity** for a multi-turn tool-calling lifecycle → Gate G blocked.
3. **OpenRouter free slug withdrawn** — a provider-chain decision, deliberately not taken here.
4. **Chromium will not stay alive** in this session → Gate F after-cycles and mobile re-run blocked.
5. **No live tool call this mission** → `TOOL_CALLING_VERIFIED` still unearned by this mission's own
   evidence (5.5 earned it for Groq `openai/gpt-oss-120b`).
6. **2 skipped tests** appeared relative to the 5.7 baseline; unexplained, not suppressed.
7. Rejection state (`unauthorized`) is module-scoped, so a 401 in one broker instance affects all
   instances in the same process. Correct for one server, relevant to any future multi-tenant use.

### Merge readiness

The diff is additive and unit-pinned: one guard, one evidence map, one pure module, one log line,
eleven tests, evidence. It is **safe to merge** on engineering grounds, but Gate G is unproven, so
it does **not** yet certify autonomy. **Not merged** — canonical is untouched pending authorization.
