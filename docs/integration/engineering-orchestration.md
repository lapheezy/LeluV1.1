# Engineering orchestration

## Division of authority

```
user / LÉLU CORE
      │  objective
      ▼
   SHAMAN.route()          WHO: picks an agent, records why (unchanged)
      │
      ▼
EngineeringOrchestrator    WITH WHAT: engine, workspace, verification
      │
      ├── local   — the existing engineering runtime (sandbox copies,
      │             whitelisted typecheck/test/build, apply + rollback)
      ├── openhands — HTTP backend (OPENHANDS_BASE_URL)
      └── opencode  — HTTP backend (OPENCODE_BASE_URL)
```

No coding agent gets unrestricted access to LÉLU's infrastructure:
`AdapterRegistry` still requires a policy decision for every capability call, and
the live project remains protected by `EngineeringAuthorization` (a human grant
bound to a signed-in identity, 15-minute TTL, not model-reachable).

## Selection rules

1. An explicit `task.engine` is honoured **only if that engine is usable**.
   Otherwise the outcome is a refusal naming the real state — never a quiet
   substitution.
2. With no explicit engine, preference order is `openhands → opencode → local`,
   skipping any backend that is not healthy/degraded.
3. A backend that throws becomes a recorded failure with its message, not an
   exception.

## Isolation and coordination

- Work happens in a **workspace id**; the orchestrator holds a lock per workspace
  (`activeLocks()`), so two engines cannot edit one workspace at once. Tested.
- The lock is released in a `finally`, including on failure.
- Branch/worktree creation is the backend's job (local runtime already supports
  sandbox copies + apply/rollback). This session did not add git worktree
  creation; see the gap below.

## Verification — the only definition of done

`verify(task, result)` returns `verified: true` only when **all** of these hold:

| Check | Why |
|---|---|
| `backend_reported_success` | the backend's own `ok` |
| `changes_within_allowed_paths` | a bounded change set, no drive-by edits |
| `tests_ran` | a recorded test command actually ran |
| `tests_passed` | `failed === 0` and `passed > 0` |
| `other_commands_succeeded` | no non-test command failed |

Anything less is `verified: false` with the specific missing check. A merge or
deploy is **never** implied: `needsApproval` is true whenever `requiresMerge` is
set or verification failed.

## What is real here, and what is not

| Capability | State |
|---|---|
| Orchestrator selection, locking, verification, outcome history | **implemented + tested** (10 tests) |
| Local engineering backend | exists in the repo (engineering runtime); the orchestrator's backend wiring to it is **not** done this session |
| OpenHands / OpenCode backends | **health adapter only**; no task-submission client was written |
| Branch/worktree creation | **not implemented** |
| Artifact collection (screenshots, diffs) | modelled in `BackendRunResult.artifacts`; no collector written |

This is a PARTIAL integration, stated plainly: the coordination, security and
verification logic is real and proven; the remote backends are not connected
because no server exists in this environment to connect to.
