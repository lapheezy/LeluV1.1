# LÉLU V1.1 — PHASE 3A report

Cross-studio operational intelligence foundation and engineering activation.
Date **2026-11-06** · branch `claude/master-integration` · commit `fa87541`.

## 1. Repository baseline (verified, not assumed)

| Fact | Value |
|---|---|
| Branch | `claude/master-integration` |
| HEAD before this phase | `2fe14ae` |
| Tree at that HEAD | `c26ba648ec7403e0d33af110da457aa5632eb95a` |
| Working tree | clean |
| Upstream | `origin/claude/master-integration` = `1031053` (ancestor, no divergence) |
| Tests before | **1358 pass, 0 fail, 2 skipped** |
| TypeScript before | exit 0 |
| Tests after | **1390 tests, 1388 pass, 0 fail, 2 skipped**, exit 0 |
| TypeScript after | exit 0 |

The audit confirmed the brief's premise: no `OperationalIntelligence` or
cross-studio service existed. `AdapterRegistry`, `EngineeringOrchestrator`,
`PlanningEngine`, `ExecutiveRuntime`, `Orchestrator`, `policy.ts` and
`RelationshipStore` all exist and were reused, not replaced.

## 2. Architecture map (as found)

```
four studios (Genesis) → /api/integration/{status,security,engineering,voice,traces,policy,scan}
                       → plugins/integration/{services,opa,scanners,state}.ts
                       → src/core (policy, RelationshipStore, Telemetry, orchestrator)
adapters: src/core/integration/AdapterRegistry.ts + protocol.ts  ← the only capability gate
execution: EngineeringOrchestrator → CodingBackend → SandboxRuntime / WorkspaceRuntime
planning: src/core/planning/PlanningEngine.ts                   ← the only planner
```

## 3. New operational intelligence architecture

```
sources (plugins/integration/intelligence.ts)
  ↳ engineering: service probes + orchestrator registrations + GET /api/engineer/status
  ↳ voice:       service probes (whisper/kokoro/pipecat) — audio devices reported unavailable
  ↳ infrastructure: the ten real service probes
  ↳ security:    detectOpa() + scanner presence + last real scan
        ↓ read-only, per-studio timeout, per-studio failure isolation
OperationalCollector (src/core/operational-intelligence/collector.ts)
        ↓
normalized model (model.ts): configured ≠ available ≠ authorized ≠ executable ≠ verified
        ↓
dependency graph (dependencies.ts): declared requirements × observed states
        ↓
OperationalPlanner (planner.ts) → existing PlanningEngine
        ↓
GET /api/integration/intelligence, /explain, POST /intelligence/plan
```

Nothing in `src/core/operational-intelligence/` imports an adapter, the registry
or a node built-in; a test enforces all three.

## 4. Files created

| File | Purpose |
|---|---|
| `src/core/operational-intelligence/types.ts` | `StudioStatus`, `CapabilityStatus`, `DependencyStatus`, `OperationalFinding`, `OperationalSnapshot`, provenance enum |
| `src/core/operational-intelligence/model.ts` | state ladder, normalization, worst-state, readiness, secret redaction |
| `src/core/operational-intelligence/dependencies.ts` | requirement table, graph, missing prerequisites, cycle detection, topological order, impact |
| `src/core/operational-intelligence/collector.ts` | bounded read-only collector with TTL cache and failure isolation |
| `src/core/operational-intelligence/planner.ts` | activation planning over `PlanningEngine` |
| `src/core/operational-intelligence/index.ts` | browser-safe public surface |
| `plugins/integration/intelligence.ts` | the four real studio sources + server entry points |
| `tests/operational-intelligence.test.ts` | 30 tests |

## 5. Files modified

| File | Change |
|---|---|
| `plugins/integrationApi.ts` | three intelligence routes; `publicOrigin()` for honest self-probing |

No studio panel, adapter, orchestrator, planner or policy file was modified.

## 6. API changes (additive only)

| Route | Method | Behaviour |
|---|---|---|
| `/api/integration/intelligence` | GET | the four-studio snapshot; `?refresh=1` bypasses the 15 s cache |
| `/api/integration/intelligence/explain?capability=…` | GET | deterministic, provider-free explanation of one capability |
| `/api/integration/intelligence/plan` | POST | an activation plan; same-origin + token gated; **never executes** |

## 7. Four-studio collection results (live, this VM)

`snapshot-http.json`, 64 ms, 4/4 studios read, 0 failed:

| Studio | State | Capabilities | Note |
|---|---|---|---|
| engineering | `NOT_CONFIGURED` | 6 | no OpenHands/OpenCode configuration, no backend registered |
| voice | `NOT_CONFIGURED` | 6 | no Whisper/Kokoro endpoint; no audio device observable |
| infrastructure | `NOT_CONFIGURED` | 10 | ten real probes, none configured |
| security | `VERIFIED` | 5 | OPA 1.22.2 available, three scanners present, audit live |

Overall readiness **0.222** — 6 of 27 capabilities usable, 21 blocked or
unconfigured. That is the observed truth, not a target.

## 8. Dependency graph results

`explain-openhands-http.json`:

| Requirement | Observed | Verdict |
|---|---|---|
| `engineering.openhands.runtime` | `NOT_CONFIGURED` | **blocking** — OpenHands must answer before a task is dispatched |
| `engineering.workspace.runtime` | `VERIFIED` | satisfied |
| `security.policy.opa` | `VERIFIED` | satisfied |
| `security.scanner.gitleaks` | `AVAILABLE` | satisfied |

Cycle detection, requirement-first ordering and impact counting are covered by
tests (`a→b→a` returns a cycle instead of recursing).

## 9. Engineering discovery results

| Engine | Configured | Registered | Selectable | Real state |
|---|---|---|---|---|
| OpenHands | no (`OPENHANDS_BASE_URL` unset) | no | no | `NOT_CONFIGURED` |
| OpenCode | no (`OPENCODE_BASE_URL` unset) | no | no | `NOT_CONFIGURED` |
| Local runtime | yes (this process serves the API) | no | no | runtime answers, but no `CodingBackend` is registered → cannot dispatch |

A repository on disk was never treated as an installed engine.

## 10. Execution lifecycle results

**Not attributed.** No engine is selectable, so no task could be dispatched.
The lifecycle surface already exists in `EngineeringOrchestrator` (validation →
engine choice → workspace lock → run → verification → approval flag) and was not
duplicated. No task was fabricated to fill this section.

## 11. PlanningEngine integration

`plan-openhands-http.json` for "Prepare yourself to use OpenHands":

- status `AWAITING_APPROVAL`, `approvalRequired: true`
- one step: *Configure `engineering.openhands.runtime`*, `requiresApproval: true`
- `execution.started: false` with an explicit note that planning is not authorization
- the plan is registered in the same `PlanningEngine` (`planningEnginePlanId`)

## 12. Security findings and remediation

Unchanged from Phase 3 (commit `b47a493`): 2 `hardcoded-hmac-key` remediated,
`spawn-shell-true` mitigated by `plugins/commandSafety.ts`, user regex bounded,
72 Gitleaks hits classified as non-credentials, **86 Trivy dependency findings
still open** and deliberately not upgraded in this change. The new module adds
no network surface, no shell, and no secret handling; it redacts credential-shaped
keys before storing anything.

## 13. Test results

- New: **30 tests**, 30 pass (state ladder 8, normalization 3, collector 6, dependency 6, planner 4, architecture 3).
- Targeted run under the repo's own runner (`tsx --test`): 30/30.
- Full suite: **1390 tests, 1388 pass, 0 fail, 2 skipped**, exit 0.
- `npx tsc -b --force`: exit 0.
- No existing test was weakened, skipped or deleted.

## 14. Screenshots and evidence

- `snapshot-http.json`, `explain-openhands-http.json`, `plan-openhands-http.json` — real HTTP responses from the running dev server on port 3013.
- `01-studios-live-third-run.png` — capture attempt of the running app; the browser tab had been replaced by a preview iframe, so no new visual was produced. **No screenshot is claimed for the new intelligence surfaces**, because they have no UI yet (see gate H).
- Prior verified studio captures remain valid in `studios-2026-11-06/`.

## 15. Unavailable capabilities (honest list)

OpenHands execution, OpenCode execution, local dispatch (no backend),
speech recognition, speech synthesis, audio input/output, all ten
infrastructure services, and any plan **execution** step.

## 16. Remaining risks

1. **No chat surface (gate G) and no UI view (gate H)** — the intelligence is reachable only by API today. This is the largest remaining gap against the brief.
2. The requirement table in `dependencies.ts` is hand-declared; a capability added without an edge is reported ready when it may not be.
3. The engineering probe is one HTTP call per collection (15 s TTL); a slow self-probe delays a snapshot by up to 1.5 s.
4. 86 Trivy findings and 1 guarded `spawn-shell-true` remain open.
5. `WorkspaceRuntime` and `SourceAccess` are outside the typechecked graph (pre-existing); touching them breaks `tsc`, which is why the engineering probe is HTTP rather than an import.

## 17. Final commit

`fa875418ea09e3b9368c0d673d6477fb9edf771b` — "Add cross-studio operational
intelligence and an activation planner" (12 files, +2057).

## 18. Tree hash

Recorded in the closing chat report for the final commit of this phase.

## 19. Working-tree status

Clean at the time of writing; **not pushed** — no push authorization was given.

---

## Gate verdicts

| Gate | Verdict |
|---|---|
| A — audit | **DONE** |
| B — typed models | **DONE** |
| C — read-only collector | **DONE** (live, 4/4 studios) |
| D — dependency intelligence | **DONE** (missing, cycle, order, readiness, impact, blocker explanations) |
| E — engine discovery | **DONE for discovery**; execution correctly absent |
| F — execution lifecycle | **NOT ATTRIBUTED** — nothing selectable; existing orchestrator untouched |
| G — PlanningEngine integration | **DONE** (plan only, approval-gated, never executes) |
| H — chat + studio UI | **NOT DONE** |
| I — security/dependency remediation | **ASSESSED, not executed** (86 Trivy findings documented) |
| J — full regression | **DONE** (1390 / 1388 pass / 0 fail) |
