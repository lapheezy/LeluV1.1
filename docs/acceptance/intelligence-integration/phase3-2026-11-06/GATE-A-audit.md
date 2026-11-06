# GATE A — Repository and architecture audit

Date: **2026-11-06** · Phase 3 baseline captured before any Phase 3 code change.

## Repository baseline

| Fact | Value |
|---|---|
| Branch | `claude/master-integration` (switched from `freebuff/1fb0099bf53a9ab2f6fe75bd`) |
| HEAD | `15491948024c7d55a3904224c196ec70211f17f7` — *Expose the integration studios in Genesis and close the scanner gap* |
| Tree | `20ea6a44840eabd44de11f6c81cdd328a8a426a8` |
| Upstream `origin/claude/master-integration` | `10310530fed8b4b3d1f13622bfacc127149154e3` — *Creation Studio in chat and Cosmos; Atelier design-to-files; handoff report* |
| Relationship | `1031053` **is an ancestor** of HEAD (`git merge-base --is-ancestor`), so the branch update is a pure fast-forward: no merge, no conflict, no downgrade |
| Working tree at audit | clean (the studio commit was already pushed) |
| Creation Studio / Atelier | intact — `src/app/scene/genesis/creation/{AtelierFiles,AtelierGeometry,AtelierPackage,AtelierReadback,AtelierStore}.ts` and the handoff evidence directory from `1031053` are present |

## Test baseline (measured, not assumed)

| Check | Command | Result |
|---|---|---|
| Suite | `bun run test` | **1358 pass, 0 fail, 2 skipped** (1344 before GATE B's 14 new tests) |
| Types | `npx tsc -b --force` | **exit 0** |

## Architecture map — what already exists

**The single capability gate**

- `src/core/integration/AdapterRegistry.ts` (455 lines) — validate → relationship → policy → schema → bounded execution → audit + trace. Nothing else may call an adapter.
- `src/core/integration/protocol.ts` — one contract for every adapter: `initialize / healthCheck / capabilities / execute / cancel / shutdown / getStatus / getMetrics`, with identity, timeout, schema and verification fields.

**Server surface**

- `plugins/integrationApi.ts` — 7 routes under `/api/integration/*` (status, engineering, voice, security, policy, scan, traces), span-instrumented.
- `plugins/integration/{opa,scanners,services,state}.ts` — real OPA process, three real scanners, 10 service probes, bounded in-memory state.
- Mounted in both `vite.config.ts` and `server.ts` under `/api/integration`.

**Studios**

- `src/app/scene/genesis/integration/` — `useIntegration.ts`, `StudioShell.tsx` and the four panels.
- Registered in `GenesisCore.tsx` (`eng-studio`, `voice-studio`, `infra-monitor`, `security-center`), `GenesisDock.tsx`, `GenesisInterface.tsx`, `GenesisSettingsPanel.tsx`.
- Panels read only `/api/integration/*`; `tests/integration-studios.test.ts` asserts no adapter import.

**Modules that must NOT be duplicated (Phase 3 findings)**

| Concern | Existing implementation |
|---|---|
| Coding-engine coordination | `src/core/engineering/EngineeringOrchestrator.ts`, `EngineeringWorkspace.ts`, `WorkspaceRuntime.ts`, `SandboxRuntime.ts`, `SandboxFS.ts`, `EngineeringAuthorization.ts`, `GitHubIntegration.ts`, `AnthropicEngineeringAgent.ts` |
| Voice | `src/core/voice/VoiceEngine.ts`, `speechToText.ts`, `transcriptionTransport.ts`, `audioRecorder.ts`, `vadWorklet.ts`, `useVoice.ts`, `adapters/` |
| Planning | `src/core/planning/PlanningEngine.ts` (plans, steps, dependencies, status) |
| Executive/orchestration | `src/core/executive/{ExecutiveBoard,ExecutiveRuntime,SelfDiagnostics}.ts`, `src/core/orchestrator/Orchestrator.ts` |
| Policy / relationships | `src/core/security/policy.ts` + `security/authz/RelationshipStore.ts`, real `policies/lelu` bundle |
| Telemetry | `src/core/observability/Telemetry.ts` |

## Gaps this audit found

1. **No cross-studio intelligence service.** A repo-wide search for `OperationalIntelligence|crossStudio|CrossStudio` returns nothing. The correlation layer Phase 3 §6 requires does not exist and must be added *without* importing adapters.
2. **The studios are read-only.** Nothing in the UI can request an authorized operation; every action path is still direct HTTP.
3. **No execution-lifecycle surface.** `DISCOVERED → … → VERIFIED` is enforced inside `EngineeringOrchestrator` but not exposed to a panel or trace.
4. **No planning endpoint.** `PlanningEngine` exists but no operational plan is produced from studio findings.

## Environment limits (blockers, recorded before implementation)

| Capability | State | Consequence |
|---|---|---|
| OpenHands / OpenCode servers | absent, no env vars | engines stay `NOT CONFIGURED`; must not be faked |
| Whisper / Kokoro / Pipecat | absent | voice pipeline stays unconfigured |
| Microphone / speaker | none in this VM | physical audio cannot be verified |
| Provider credentials | none | no model completion, no live provider health |
| Docker daemon | unreachable | no container-based sandbox |

## Scanner baseline (before GATE B changes)

| Scanner | Ran | Findings |
|---|---|---|
| Gitleaks 8.30.1 | yes (whole tree) | **96** `generic-api-key` across 16 files |
| Semgrep 1.184.0 | yes (`src`, `scripts`, `plugins`) | **21** (1 ERROR, 13 WARNING, 16 INFO across 5 rules) |
| Trivy 0.76.2 (DB present) | yes (`fs`, vuln) | **86** (32 HIGH, 43 MEDIUM, 11 LOW) |

Raw summaries: `gitleaks-summary.json`, `semgrep-summary.json`, `trivy-summary.json` in this directory.
