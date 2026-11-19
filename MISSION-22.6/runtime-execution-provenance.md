# M22.6 — RUNTIME EXECUTION PROVENANCE (G1)

**Date:** 2026-11-19
**Status:** **PARTIALLY VERIFIED** — the existing execution ledger can now carry mission, work package, repository, branch and commit, and every record produced under a declared scope does. The app itself has no repository context, so ordinary user turns record none. That limit is stated, not hidden.

---

## 1. The gap M22.5 reported

`ExecutionRecord` answered *what ran* (tool, task, path, stage, duration, redacted reason). It could not answer *which mission and which commit this work belongs to*. M22.5 recorded that as a gap rather than inventing fields.

## 2. What was added, and why it is not a second ledger

The canonical ledger is still `ExecutionEvidence` → `AgentEventBus` → `ExecutionTelemetry` → `/api/execution/events`. The change is a field on the record that already exists:

```ts
export interface MissionScope {
  id: string;            // "M22.6"
  workPackage?: string;  // "G1"
  repo?: string;         // "lapheezy/LeluV1.1"
  branch?: string;       // "freebuff/m22-6-voice-runtime-release-qualification"
  commit?: string;       // 40-char SHA
}
```

- `setMissionScope(scope | null)` / `currentMissionScope()` live in `src/core/tools/ExecutionEvidence.ts` — the module that already owns identity and lifecycle.
- `ToolDispatcher.dispatchToolCall` copies the declared scope onto every record it creates (`...(mission ? { mission } : {})`).
- `sanitizeExecutionRecord` validates and truncates each field, so a browser cannot inject an unbounded or malformed mission block.
- `formatExecutionLine` prints `mission=… wp=… commit=<12>` next to the existing fields.

No table, queue, bus, store or database was added; records still travel the same path and the endpoint still accepts no arguments.

## 3. Why the app cannot fill this by itself

A browser tab does not know its repository, branch or commit. Reading them from a build-time constant would be a guess about the running code, not an observation. The honest design is therefore:

- **A runner that knows the revision declares it once.** A mission harness, CI job, or developer tool calls `setMissionScope` before work starts; every tool invocation it triggers is attributable to that commit.
- **An ordinary user session declares nothing**, and the field is absent. Absence is a true statement ("unknown"), not a false one.

## 4. Evidence

| Check | Result |
|---|---|
| `tests/execution-mission-scope.test.ts` | **3/3 pass** — no scope ⇒ no field; a declared scope survives sanitisation and appears in the log line; the scope is copied, so callers cannot mutate provenance |
| Controlled acceptance | mission id, work package, branch and commit rode on a sanitized execution record (`mission=M22.6 commit=NMWO339TK`) |
| Credential redaction | unchanged and still enforced (`Bearer [redacted]`, `api_key=[redacted]`) |
| Existing execution tests | `tests/execution-evidence.test.ts` passes |

Reconstruction now possible for a declared run: mission → work package → task → agent/tool → stage → duration → failure reason → **repository/branch/commit**.

## 5. What is still missing

1. **No caller inside the product.** The capability is a contract, not an automatic behaviour. Until a harness or CI sets the scope, records carry no mission block.
2. **No test-outcome primitive.** A test name/result is still not an execution record; only tool invocations are. Recording tests would need a first-class "verification" record type, which this mission did not invent.
3. **Sub-task ids exist** (`stepId`) but are not linked to a work-package tree.
4. **Retention** is unchanged: the ledger is bounded (15 minutes / 60 entries); durable reconstruction still depends on the server log and mission evidence.

These are recorded, not papered over.
