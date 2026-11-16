# MISSION 6.1.5 — TOOL DISCOVERY, EXECUTION & OUTPUT BUDGET ACCEPTANCE

Freebuff session 1 of 2 — this branch is not combined with any other workstream.
Date: 2026-11-13
Branch: `mission/6.1.5-tool-discovery-execution`
Baseline: `e3172d9` (Mission 6.1.4)
Verdict: **A smaller schema surface did not cost a capability. A real model called a real tool,
the dispatcher executed it, the real output came back into the same conversation, and the answer
was built from it — with zero provider refusals.**

---

## 1. Starting branch, HEAD, working-tree state

| item | value |
|---|---|
| repository | `https://github.com/lapheezy/LeluV1.1.git` (origin) |
| branch at start | `mission/6.1.4-intelligence-payload-optimization` |
| HEAD at start | `e3172d96a81155bf029ad0201b86d5a4d69496cc` (matches the required baseline exactly) |
| `e3172d9` exists | yes |
| uncommitted tracked changes | none |
| `3671206` (6.1.3 baseline) ancestor of `e3172d9` | yes |
| `098dd3e` (canonical) ancestor of HEAD | yes; canonical-only commits: **0** |
| commits since 6.1.4 | none — `e3172d9` **was** HEAD |
| existing `mission/6.1.5*` branch | none; branch created fresh |

## 2. New branch and commits

Branch: `mission/6.1.5-tool-discovery-execution`, cut from `e3172d9`. Nothing was pushed, merged,
rebased or written to the canonical branch. Every change below is committed on this branch.

## 3. Production execution path (as traced, not as assumed)

```
browser chat
  → AIService.chat()                     AIRequest { messages: prior turns, prompt, allowTools: true }
  → AIRouter → ProviderResolver.execute() rung loop over the provider chain
    → generateWithTools()
        toolSchemasForRequest(prompt)   → selectToolSchemas  (6.1.4: 6–14 schemas)
        fitRequestBudget(...)           → ceiling per provider/model
    → provider.generate()               → POST /api/model/<provider>/chat/completions
        broker attaches the server key; provider returns { text, toolCalls }
    → for each call: dispatchToolCall(call, taskId, context)
        registryIdForToolName(call.name) → BY_ID executor        ← resolves BY NAME
        toolPermitted(id)                                        ← autonomy + activation + grants
        executor.run(arguments, context)                         ← the real tool
        AgentEventBus: tool_selected / tool_started / tool_result
    → result appended as a { role: "tool", toolCallId } message
    → next round generates from the result; loop bounded, tools withheld on the last round
  → AIResponse returned to AIService → conversation + activity card
```

Facts established by reading and exercising that path:

| question | answer |
|---|---|
| Which tools are registered? | 58 executable (`executableToolIds()` = dispatcher `BY_ID` keys, each also registry-defined and autonomy-permitted) |
| Which are exposed initially? | 6–14, chosen by relevance (6.1.4), mean 10.2 over a 24-prompt corpus |
| Available only through discovery? | the remainder — reachable through `capabilities_list` / `capabilities_activate`, and callable by name |
| Does discovery return usable schemas? | `capabilities_list` returns marketplace entries (empty in this environment: "No acquired capability is registered yet"); it is a catalogue, not a schema dump |
| Does activation change the execution surface? | **yes** — `toolPermitted(id)` consults `CapabilityActivation.isToolEnabled(id)`, the same gate the dispatcher enforces |
| Can the dispatcher run a tool absent from the offered list? | **yes** — resolution is by name (`registryIdForToolName`), not by membership of the offered set. Verified by test and by the activation test |
| Does the result return to the same conversation? | **yes** — appended as a `tool` message with the call id and sent in the next round |
| Can the model continue after the result? | **yes** — observed live: round 2 carried 1 tool result and produced the final answer |
| Multiple calls per round? | **yes** — both executed and correlated (verified) |
| Failed execution reported honestly? | **yes** — "There is no tool named …", "registered but has no executor", refusal reason (verified) |

## 4. Tool discovery findings

- `DEFAULT` discovery set on every turn: `capabilities_list`, `capabilities_activate`, `system_config`.
- `capabilities_list` in this environment honestly reports no acquired capabilities; it is not a
  hidden second copy of the 58-schema surface, so it cannot be used to reintroduce the payload.
- `system_config` is the one discovery tool that reports real, machine-checkable state, and it is
  what the live acceptance used.

## 5. Tool activation findings — PARTIAL

`CapabilityActivation` is a real gate, not a UI toggle: deactivating a capability adds its tool ids
to `disabledTools`, `toolPermitted()` returns false, and the dispatcher refuses. Reactivating
restores it. Both directions are now pinned by test (`kb.describe` deactivated → refused with a
reason → reactivated → executes).

**Limitation:** no acquired capability is registered in this environment, so end-to-end
marketplace discovery → activation → invocation could not be demonstrated live. The gate that such
an activation would move is verified; the catalogue that would drive it is empty.

## 6. Real end-to-end execution evidence

### 6.1 Live, real model (strongest evidence)

Prompt sent through the real UI: *"Use the system_config tool and tell me exactly which
capabilities are configured."*

| round | endpoint | body | tools | tool results in messages |
|---|---|---|---|---|
| preflight | openrouter | 5,380 B | 0 | 0 |
| 1 | openrouter | 31,548 B | 14 | 0 |
| 2 | openrouter | 32,362 B | 14 | **1** |

The reply enumerated exactly what the real executor returned — "Currently, no capabilities are
configured… groq, openrouter, cerebras, mistral, fireworks, anthropic, github-models,
persistence.supabase" — which matches `dispatchToolCall("system.config")` output in this
environment ("Configured: nothing. Not configured: provider.groq, …"). A fabricated result could
not reproduce that list.

The UI rendered an activity card: **"Working with tools — 2 tools used — Done"**, i.e. real
events, not inferred progress.

Provider refusals during that turn: **0** (`grep -c REFUSED` → 0; `status=402` → 0; `status=413` → 0).

### 6.2 Dispatcher-level, scripted model (production loop, mocked model only)

`tests/tool-discovery-execution.test.ts` drives `ProviderResolver.execute` → `generateWithTools` →
`dispatchToolCall` → real executors:

- a tool offered to the turn executes, and its **real** output ("Configured: …") appears as a
  `tool` message in the next request;
- a tool the turn was **not** offered still resolves and executes;
- two calls in one round both execute and keep their call ids;
- a nonexistent tool is refused with "no tool named …", never fabricated;
- a caller's `maxTokens` reaches the provider unchanged.

## 7. Multi-tool execution evidence — PARTIAL

- **Same round, two calls:** verified (both results, both call ids).
- **Sequential rounds (tool → decide → tool):** the loop supports it (bounded `TOOL_LOOP_MAX_ROUNDS`
  with tools withheld on the last round) but no test or live run forced a second tool round. Not
  claimed as verified.
- **Parallel execution:** not supported/not exercised — calls in a round are dispatched in order.

## 8. Output budget behaviour

| concern | result |
|---|---|
| ordinary conversation keeps a safe default | **VERIFIED** — `max_tokens: 2048` on the wire |
| caller budget preserved | **VERIFIED** — 6,000 passed through unchanged, at resolver and provider level |
| overwritten anywhere? | no |
| provider limits respected | Groq 8k TPM ceiling still applied by `fitRequestBudget` (26,880 B transport ceiling) |
| truncated answers reported | **VERIFIED** — `finish_reason: "length"` now yields `metadata.truncated: true` (Groq + OpenRouter, streamed and not); a `stop` reply is not flagged |
| silent truncation | not silently claimed complete any more — but see the limitation |

**Limitation:** truncation is now *reported*, not *prevented*. A long engineering answer cut off at
2,048 tokens is flagged `truncated: true`; nothing automatically raises the budget and retries.
That is the smallest honest fix; an adaptive budget is a separate mission.

## 9. Tool selection quality

`scripts/measure-tool-selection.ts`, 24 prompts with a declared expected capability:

```
expected tool offered   24/24
misses                  0
schemas per turn        max 14, mean 10.2
bytes per turn          max 10,071 B, mean 5,165 B
share of the full 58-tool surface  14.7%
```

Covered families: web research, news, arXiv, memory recall/store, sandbox read/write, project
search, repo inspection, studio create/build/deploy, workflow run/author, system config,
capabilities, agents, avatar, artifacts, weather, three no-signal conversational prompts, and one
two-capability request.

## 10. Before-and-after payload measurements

| metric | 6.1.3 (before) | 6.1.4 (selection) | 6.1.5 (this run) |
|---|---|---|---|
| tool schemas per turn | 58 | 6–14 | **14 max, 10.2 mean** |
| tool tokens | 21,756 | 531 | 531-class (unchanged) |
| body | 102,821 B | 17,657 B | 31.5–32.4 KB on a *tool* turn (larger prompt + 14 schemas) |
| refusals | 3 per turn | 0 | **0** |

The tool-turn body is larger than 6.1.4's conversational 17.7 KB because that prompt explicitly
names a tool and matched more families — still 69% below the 102 KB baseline, with no refusal.

## 11. Provider behaviour

- OpenRouter answered all three calls; **0 × 402** (the explicit 2,048 output budget removed the
  credit reservation refusal).
- Groq was not needed, so **0 × 413**; the 8k-TPM ceiling logic is untouched and tested.
- Streaming preserved (both live rounds were `stream: true`).

## 12. Failure and recovery results

| case | result |
|---|---|
| tool not found | honest "There is no tool named …" (test) |
| registered but no executor | honest "registered but has no executor" (dispatcher text) |
| capability deactivated | refused with reason; reactivation restores (test) |
| provider 402 | handled earlier in 6.1.4; 0 occurrences now |
| provider 413 | not reproduced this run; ceiling logic unit-tested |
| malformed tool arguments | already covered by `tests/tool-calling.test.ts` (empty object, reported as a real failure) |
| tool timeout / invalid result / duplicate call | **NOT EXECUTED** this mission |
| browser reload mid-execution | **NOT EXECUTED** |
| cloud-runner interruption | environment restarted twice during this mission; work recovered from committed state |

## 13. Telemetry verification — PARTIAL

- Real execution outcomes do reach the UI: the activity card read "2 tools used" from actual
  `tool_started`/`tool_result` events.
- The resolver logs a per-request budget line (provider, tier, tool count, schema bytes, total
  bytes, estimated tokens) and a per-tool line ("Tool system_config -> ok").
- **Gap:** those lines are emitted client-side; the server log contains no tool events, so
  server-side operators cannot see tool execution. No new telemetry system was introduced.
- No key, header, secret or tool argument content is logged by anything added here.

## 14. Full regression results

| check | result |
|---|---|
| `tsc -b --force` | **exit 0** |
| `vite build` | **exit 0** (16.9 s) |
| full suite | **2,030 tests / 2,023 pass / 1 fail / 6 skipped** |

Baseline comparison: 6.1.4 was 2,018 / 2,011 / 1 / 6. This mission adds **12 tests** (7 in
`tests/tool-discovery-execution.test.ts`, 5 in `tests/output-budget-acceptance.test.ts`) and the
same single failure remains: `tests/voice-continuity.test.ts` ("never stuck in 'speaking'"), which
was failing before 6.1.3, is unrelated to tool selection, and is untouched by this branch.

## 15. Known limitations

1. Activation is verified at the gate, not through the marketplace, because no acquired capability
   exists here.
2. Sequential multi-round tool chains were not exercised.
3. Truncation is reported, not prevented; no adaptive output budget.
4. Selection is lexical (inherited from 6.1.4); the corpus shows 24/24 on these prompts but a
   paraphrase outside the lexicon can still miss.
5. Tool events are not in server-side logs.

## 16. Remaining blockers

- Supabase server-side configuration is still missing (persistence paths unverified).
- No GPU / VoxCPM2 sidecar (voice work is out of scope and untouched).
- The one pre-existing voice test failure.

## 17. Exact files changed

| file | change |
|---|---|
| `src/providers/openaiTools.ts` | added `isTruncating(finishReason)` |
| `src/providers/GroqProvider.ts` | `metadata.truncated` on both paths |
| `src/providers/OpenRouterProvider.ts` | `metadata.truncated` on both paths |
| `tests/tool-discovery-execution.test.ts` | new — 7 integration tests |
| `tests/output-budget-acceptance.test.ts` | new — 5 tests |
| `scripts/measure-tool-selection.ts` | new — selection-quality corpus |
| `MISSION-6.1.5-TOOL-DISCOVERY-EXECUTION-ACCEPTANCE.md` | this report |

No voice, VoxCPM, LiveKit, deployment, SHAMAN or registry/dispatcher architecture was modified; no
capability was removed.

## 18. Tests added

`tests/tool-discovery-execution.test.ts` — offered tool executes and returns real output; omitted
tool still executes; multiple calls correlate; missing tool refused honestly; caller budget
preserved; payload stays ≤14 on a tool turn; capability deactivation refuses and reactivation
restores.

`tests/output-budget-acceptance.test.ts` — default output budget named; caller budget preserved;
OpenRouter names the budget; a length-truncated reply is flagged; a complete reply is not.

---

## Acceptance gates

| # | gate | status |
|---|---|---|
| 1 | smaller surface does not make capabilities unreachable | **VERIFIED** (omitted tool executes; dispatcher resolves by name) |
| 2 | an initially omitted capability can be discovered and activated | **PARTIAL** — gate verified, marketplace empty here |
| 3 | a real tool executes through the production dispatcher | **VERIFIED** (scripted model + live model) |
| 4 | its real result returns to the same conversation | **VERIFIED** (1 tool result in round 2) |
| 5 | the model uses that result | **VERIFIED** (answer enumerates the executor's real output) |
| 6 | multi-tool sequence | **PARTIAL** — same-round verified, sequential not exercised |
| 7 | caller output budgets survive the path | **VERIFIED** |
| 8 | long responses are not silently truncated | **PARTIAL** — flagged `truncated: true`, not prevented |
| 9 | provider refusals resolved under realistic load | **VERIFIED** — 0 refusals in the live run |
| 10 | tests pass with every exception documented | **VERIFIED** — 2030/2023/1 (pre-existing voice)/6 |
| 11 | telemetry reports real execution outcomes | **PARTIAL** — real in UI, absent server-side |
| 12 | no unrelated architecture damaged | **VERIFIED** — voice/VoxCPM/LiveKit/deploy untouched |

## Final answer

LÉLU can still find the right capability, execute it, read its result and answer from it while
shipping ~15% of the old schema payload. The gate that could not be met here is marketplace
activation end-to-end, and that is blocked by an empty catalogue, not by the architecture.
