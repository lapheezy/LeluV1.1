# MISSION 5.5 — AUTONOMY ACTIVATION & ENVIRONMENT EVOLUTION

Isolated branch, no canonical change, no system rebuilt. The mission found why
LÉLU answered in prose instead of acting, fixed that, and then proved one real
model-selected tool execution — before the only remaining provider ran out of
quota.

## 1. Starting state (verified, not assumed)

| Fact | Value |
|---|---|
| Starting branch | `claude/unified-mobile-orchestration-integration` |
| Starting commit | `7c4a373ddef0b8319f951bc55a88814f77dc06ea` |
| Mission branch | `claude/mission-5-5-autonomy-activation` |
| Canonical | `claude/master-integration` = `ce768e08cebd71eaa05418c5942ad637a8ac0596` (unchanged) |
| Protected base | `1569f57a3891e5b57f150cc21ebc556608513d44` |
| Working tree | clean |

Evidence for 5.4B.9/10/11, 2.15.6 and the unified mission is untouched.

## 2. Gate A — which provider is actually configured

LÉLU resolves credentials through `provider adapter → /api/model/<id>` and the
server attaches the key (`plugins/modelApi.ts`); `plugins/bareSecretAliases.ts`
maps the platform's secret names (`Anthropic`, `Groq`, `Openrouter`, `Github`, …)
onto the names the code reads. That mapping was already present and working —
`[env] bare secret names supplied ANTHROPIC_API_KEY, GROQ_API_KEY,
OPENROUTER_API_KEY, …`.

`GET /api/model/status` → `{anthropic:false, groq:true, openrouter:true,
githubModels:true, cerebras:false, mistral:false, fireworks:false, gemini:false}`.

Verified against the providers' own APIs, server-side, with no value printed:

| Provider | Result |
|---|---|
| **Groq** | `/openai/v1/models` 200, and a real completion returned a real tool call (`environment_compose`, `finish_reason: tool_calls`) |
| OpenRouter | key valid (`/api/v1/key` 200), but completions **429 `free-models-per-day`** |
| Anthropic | `/v1/models` **200** — key valid and tool-capable, but **policy-disabled** (`LELU_ENABLE_ANTHROPIC` unset) |
| GitHub Models | `/user` **401 Bad credentials** — the stored token is unusable |

So the configured provider is **Groq**, model `openai/gpt-oss-120b`. No provider
priority, model id or credential was changed by this mission.

## 3. The actual defect that blocked autonomy

The first real turn through the app produced this, in LÉLU's own logs:

```
Groq refused the request as too large; retrying without the tool schemas.
413 Request too large … tokens per minute (TPM): Limit 8000, Requested 19553
```

Every executable tool schema was being offered on every turn — ~19.5k tokens, of
which the schemas were most of the payload. Groq's budget is 8,000 tokens per
minute. The resolver did what it was designed to do and retried the same request
**without tools**, so the model never had a single tool to choose from. LÉLU did
not lack orchestration; she was handed a request that could not carry any.

**Fix (small, additive, provider-agnostic):** `ToolSchemas.toolSchemasForRequest()`
scopes the offered set per turn. An environment/workspace turn is offered the six
environment tools; every other turn keeps the full derived set exactly as before.
The narrowing is a filter over the existing derived list (registry ∩ executor ∩
gate), never a second tool list. `ProviderResolver` calls it in place of
`toolSchemasForModel()` — one line. Pinned by `tests/tool-schema-scoping.test.ts`
(5 tests), including "fails open" and "never invents a schema".

After the fix, the same instruction produced:

```
[ProviderResolver] Tool environment_compose -> ok        (round 1, ok:true)
```

That is Gate B: the model chose the tool, the dispatcher ran it, the environment
engine returned `ok:true`, and the result went back to the model.

## 4. Gates

| Gate | Status | Evidence |
|---|---|---|
| A Provider discovery & verification | **PASS** | `provider-discovery.json`, `provider-verification.json` |
| B Model-driven tool execution | **PASS** | `tool-execution-traces.json` (`environment_compose -> ok`, round 1) |
| C Autonomous environment construction | **PARTIAL** | construction started by the model's own call; the renderer process died before the DOM could be snapshotted |
| D Self-inspection & correction | **BLOCKED** | no provider quota left |
| E Continuous evolution | **BLOCKED** | same |
| F Cosmos as universal surface | **PARTIAL** | audited; existing systems reused, no new renderer |
| G Agent orchestration | **NOT TESTED** | needs a model |
| H Autonomous memory & reflection | **AUDITED** | see §6 |
| I Browser / repository readiness | **PARTIAL** | BrowserTool + engineering tools exist; egress and GitHub auth blocked |
| J Regression / mobile / rendering | **PASS (code), NOT RE-RUN (mobile)** | see §7 |
| K Complete end-to-end cycle | **BLOCKED** | stopped at provider quota, mid-cycle |

## 5. What stopped it

Groq allowed roughly a dozen calls before returning `429 … tokens per day`; the
chromium renderer also terminated during long turns (two ~3-minute sessions died,
one 80-second session completed). OpenRouter's free allowance is already spent for
the day and the GitHub token is rejected. **Anthropic is the only remaining valid,
tool-capable credential, and enabling it is an operator policy decision**
(`LELU_ENABLE_ANTHROPIC=true`) that this mission deliberately did not make on its
own.

## 6. Correction to an earlier finding

`DailyReflection` *is* wired in this code: `Bootstrap.ts:215` starts it,
`CognitiveLoop.ts:375` calls `runDueReflections` each cycle with contained
failures, and `AgenticTools` exposes a manual reflection tool. The earlier claim
that it is never called is outdated and should not be repeated. No second memory
system was added.

## 7. Regression

| Gate | Result |
|---|---|
| `bunx tsc -b --force` | exit 0 |
| `bun run build` | exit 0 (17.4 s) |
| `bun run lint` | exit 0 — 133 warnings, **0 errors** |
| `bun run test` | exit 0 — **1835 tests, 1833 pass, 0 fail, 2 skipped** (263.7 s) |

The 2 skips are pre-existing. Mobile lifecycle was **not re-run** this mission:
the only source change is tool-schema gating, which touches no rendering, portal,
pointer or persistence path; the four-viewport acceptance at `7c4a373` still
describes this code. Physical-device touch testing was not performed.

## 8. Files changed

- `src/core/tools/ToolSchemas.ts` — per-turn scoping (`scopeToolSchemas`, `toolSchemasForRequest`)
- `src/core/router/ProviderResolver.ts` — offers the scoped set (one line + import)
- `tests/tool-schema-scoping.test.ts` — new, 5 tests

No registry, dispatcher, engine, agent, workspace engine or renderer was added or
duplicated. `registerEnvironmentTools()` remains intentionally uncalled (the ids
are seeded by `ToolRegistry`; calling it would double-register).

## 9. Merge-readiness

**Merge-ready as an integration change; not complete as an autonomy milestone.**
The defect fix is additive, unit-pinned and green on every gate. The autonomy
claim is only half-proven: one genuine model-selected environment construction
executed and returned success, but no complete
UNDERSTAND → … → REMEMBER cycle ran to completion, because the single working
provider ran out of quota mid-flight.

## 10. What is needed next (one decision)

Enable Anthropic (`LELU_ENABLE_ANTHROPIC=true`) — key verified working, 1M-context,
tool-capable — and re-run gates C, D, E, G, H and K. Nothing else is blocking.
