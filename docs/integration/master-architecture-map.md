# Master architecture map

Every new capability is an **adapter behind an existing LÉLU subsystem**. There is
no second orchestrator, no second provider registry, no second agent system.

```
LÉLU CORE  (AIService → AIRuntime → AICore, Brain, MemoryEngine, Personality)
   │
   ├── cognition / ModelRouter / AIProviderRegistry      ── UNCHANGED
   │        └── plugins/modelApi.ts (server broker)      ── UNCHANGED
   │
   ├── SHAMAN  (route → canAssign → AgentRunner)         ── UNCHANGED, now instrumented
   │        ├── Executive Board / Galaxies / Agent Universes / Agent Systems
   │        └── AgentRunner → AgentTask (persisted, attributed, resumable)
   │
   ├── CAPABILITY GATEWAY  ★ new
   │        │  src/core/integration/AdapterRegistry.ts
   │        │  1 request validation → 2 relationship check → 3 policy decision
   │        │  → 4 argument schema → 5 bounded execution → 6 audit + trace
   │        │
   │        ├── ENGINEERING   src/core/engineering/EngineeringOrchestrator.ts
   │        │     ├── backend: local engineering runtime (real, whitelisted)
   │        │     ├── backend: OpenHands        (HTTP, not configured here)
   │        │     ├── backend: OpenCode         (HTTP, not configured here)
   │        │     └── model:    Qwen3-Coder     (NOT registered — see provider-routing.md)
   │        │
   │        ├── VOICE  src/core/voice/adapters/VoiceAdapters.ts
   │        │     ├── VadDetector (adaptive energy VAD; Silero ONNX absent)
   │        │     ├── WhisperAdapter (HTTP; unconfigured here)
   │        │     └── KokoroAdapter (HTTP, chunked, interruptible)
   │        │
   │        ├── MODEL GATEWAY  plugins/integration/services.ts   (health only)
   │        │     ├── LiteLLM  (optional layer BEHIND AIProviderRegistry)
   │        │     └── existing Anthropic / Groq / Fireworks / … providers
   │        │
   │        ├── DURABLE WORK  WorkflowEngine (existing) ; Temporal optional
   │        │
   │        ├── OBSERVABILITY  src/core/observability/Telemetry.ts
   │        │     └── OTLP/HTTP exporter (refuses without a collector)
   │        │
   │        └── SECURITY
   │              ├── policies/lelu/authorization.rego   (real OPA)
   │              ├── src/core/security/policy.ts        (browser reference)
   │              ├── src/core/security/authz/RelationshipStore.ts (OpenFGA shape)
   │              ├── plugins/integration/scanners.ts    (gitleaks/trivy/semgrep)
   │              └── plugins/integration/services.ts    (Infisical probe)
   │
   ├── EXISTING SURFACES  Chat, Cosmos, Genesis, Workspace, Browser, Voice,
   │        Memory, Projects, Self-development, Executive Board
   │
   └── BACKEND  Supabase (auth, data, storage, realtime) ── UNCHANGED
            └── /api/engineer/*  (existing)  +  /api/integration/*  ★ new
```

## Data flows that matter

**An authorised capability call**

```
UI / agent / SHAMAN
  → AdapterRegistry.execute(request)
      → validateExecutionRequest        (identity, action, audit id, timeout)
      → RelationshipStore.check         (owner → device → session → capability)
      → evaluatePolicy | OPA            (eight action classes, autonomy, approval)
      → validateArguments               (the capability's own JSON Schema)
      → adapter.execute(signal)         (timeout + cancellation)
      → audit entry + telemetry span
  → ExecutionResponse { status, result, verification, artifacts, auditCorrelationId }
```

**A real policy decision on the server**

```
POST /api/integration/policy
  → plugins/integration/opa.ts
      → opa eval --data policies/lelu --input <tmp>/input.json data.lelu.authz.decision
  → { decision, engine: "opa"|"reference", reference, agrees }
```

**A real security scan**

```
POST /api/integration/scan
  → plugins/integration/scanners.ts
      → gitleaks detect --no-git --source <workspace-bounded path> --report-path <tmp>
      → trivy fs --format json --scanners vuln,secret <path>
      → semgrep --json --config auto <path>
  → { results[], gatePassed, summary }   // a scanner that did not run FAILS the gate
```

## Permission boundaries

| Boundary | Where it is enforced |
|---|---|
| No anonymous execution | `validateExecutionRequest` + policy `deny_no_identity` |
| Autonomy ceiling | policy `ACTION_MIN_AUTONOMY` (mirrors `AutonomyGate`) |
| Cross-user isolation | policy `deny_cross_user` on WRITE/DELETE with an owner |
| Agent cannot self-elevate | policy `deny_self_elevation` (checked first) |
| Agent cannot ADMINISTER/DEPLOY | policy `deny_agent_action` |
| Device access needs a relationship | `RelationshipStore.sessionMay` + `deny_device_relationship` |
| Sensitive actions need approval | policy `deny_missing_approval`, single-use `ApprovalGate` |
| Credentials never reach an adapter | `sanitizeArguments` + structural trace redaction |
| Scan targets stay in the workspace | `scopedTarget` in `integrationApi.ts` |
| Real project changes need a human grant | existing `EngineeringAuthorization` (unchanged) |

## What deliberately was NOT created

- No second provider registry: LiteLLM sits behind `AIProviderRegistry`.
- No second orchestrator: the orchestrator selects a *coding backend*, not agents.
- No second agent system: SHAMAN still routes and delegates.
- No second workflow engine: Temporal is optional infrastructure.
- No simulated services: absent services report `not_configured`.
