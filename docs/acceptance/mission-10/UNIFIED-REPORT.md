# MISSION 10 — unified branch, Mission 7.2 execution recovery

Branch: `integration/lelu-four-workforce-consolidation`
Base: `df11b50` (autonomy-closure, carrying `f0be65b` + `df11b50`)
Merged: `origin/claude/master-integration` (`fd649b9`) — Claude's canonical stream,
which already contains `claude/avatar-3d-world` as an ancestor.

## What was broken, and what fixed it

`GenesisExecutionTimeline` rendered the consent card, and `ApprovalGate` held the
request durably — but in the Chat Universe the card lived inside `GenesisChat`,
which is mounted `hidden` and returns `null`. The surface people actually use had
no control at all, so a waiting task could never continue.

Two seams closed:
1. `df11b50` — seed pending approvals from `ApprovalGate.pending()`, not only the
   40-event ring buffer.
2. `2050f16` merge / `a5cfd05` — render the same card inside `UniverseChatWindow`,
   reading the same bus and the same gate.

## Measured live (real browser, real provider, nothing stubbed)

Prompt: "Find a maintained open-source library that could improve LÉLU's
typo-tolerant search. Compare relevant candidates, inspect their licenses, and
recommend the best fit."

| Gate | Result | Evidence |
|---|---|---|
| Tools offered via registry ∩ executor ∩ gate | PASS | `tests/repo-workforce-chat.test.ts` 7/7 |
| Model selects the workforce itself | PASS | plan named `repo.research`, `repo.acquire`, `repo.inspect` (`chat-turn1.json`) |
| Approval card visible with Approve + Reject | PASS | DOM captured `✓ Approve`, `✕ Reject`; `awaiting-research.png` |
| Approve clicked by a person, not by code | PASS | `approvals: 2` at 15:33:00Z / 15:33:11Z |
| `repo.research` executes | PASS | 22 `POST /api/acquisition` calls |
| `repo.acquire` clones a real repository | PASS | `acq-typesense-typesense-f7ve8` → `https://github.com/typesense/typesense.git`, ref `v31`, commit `3423e2e0daf335a38135aaf20032ce5664497908`, GPL-3.0 |
| `repo.inspect` returns real repository information | PASS | `tree`/`read` on the clone; licence excerpt read from `LICENSE.txt` |
| `repo.status` returns runtime state | PASS | `{"action":"status"}` in the same turn |
| Tool results return to the model | PASS | `[ProviderResolver] Tool repo_research -> ok`, `{tool: repo_research, ok: true, round: 1}` |
| Path A — plan then `TaskExecutor` dispatch | PASS | `chat-turn1.json` plan + dispatched steps |
| Path B — native provider `tool_calls` | PASS | `ProviderResolver` tool round above (OpenRouter `openai/gpt-4o-mini`) |
| Model's own explanation of the result | PARTIAL | harness captured runtime calls; the reply-text reader was added afterwards (`0b6e245`) |
| No duplicate acquisition | UNPROVEN | later turns cloned other repositories (`acq-adikeshri-tachyon-sdk-fg0db`, `acq-himanshuteotia-politician-speeches-fra22`) for their own objectives; no repeat of `typesense` was observed |

## Checks

| command | result |
|---|---|
| `npx tsc -b --force` | exit 0 |
| `tests/repo-workforce-chat.test.ts` | 7/7, exit 0 |
| `tests/repository-acquisition.test.ts` | 12/12, exit 0 |
| combined run | 19/19, exit 0 |

## Not reconciled

`origin/jules-246569610287923701-3250dd82` (7), `origin/jules-3488608177676003568-d30852ca` (4),
`origin/codelazr/environment-orchestration-session-02-5152285862774985386` (5),
`origin/codelazr/environment-orchestration-session-02-recovered-8798102482818388694` (2)
each conflict with this lineage in the same shared files (`ToolDispatcher.ts`,
`ToolRegistry.ts`, `EnvironmentTools.ts`, `EnvironmentOrchestrationEngine.ts`,
`InterfaceTools.ts`, `Bootstrap.ts`). Merges were attempted and aborted rather than
committed with unresolved markers. Their capability remains absent from the unified
branch until those files are reconciled deliberately.
