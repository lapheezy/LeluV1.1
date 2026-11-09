# Phase 0 — forensic baseline

Recorded **2026-11-06** in this container, before any integration code was added.

## Branch and history

| Item | Finding |
|---|---|
| Starting branch | `freebuff/1fb0099bf53a9ab2f6fe75bd`, at `e7b667b` (2026-10-30) |
| Latest Claude branch | `origin/claude/master-integration` at `1031053` (2026-11-06 03:33) — "Creation Studio in chat and Cosmos; Atelier design-to-files" |
| Relationship | `e7b667b` is an **ancestor** of `1031053`; fast-forward was clean (117 commits, 580 files) |
| Action taken | fast-forwarded this branch to `1031053`; **no history rewritten, nothing force-pushed** |
| Concurrent worktrees | 13 other worktrees share `/workspace/repo.git`; `claude/avatar-3d-world` is checked out elsewhere and was left untouched |
| Uncommitted work at start | none (`working tree clean`) |

## Baseline measurements (before changes)

| Check | Result |
|---|---|
| `bun install` | 833 packages, exit 0 (lockfile preserved) |
| `npx tsc -b --force` | exit 0 |
| `bun run test` | **1274 tests, 1272 pass, 0 fail, 2 skipped** |
| Runtime | Node v26.13.0, Bun 1.4.4, Python 3.12.3 |
| Hardware | 8 vCPU, 15 GB RAM, no GPU |
| Docker | client 29.1.3, **daemon unreachable** (`permission denied` on `/var/run/docker.sock`) |
| Network | github.com reachable (200) |
| Provider keys in process env | **none** |
| Local tools | `opa` 1.22.2, `gitleaks` 8.30.1, `trivy` 0.76.2 placed in `.tools/` (gitignored) |
| Microphone / speaker | none |
| Browser | headless only; no audio devices |

## System inventory

| System | Existing status | Existing problems | Planned change | Risk | Verification |
|---|---|---|---|---|---|
| LÉLU CORE / `AIService` | Working, guarded init | none found in this pass | instrument only | low | every existing test still passes |
| SHAMAN (`agents/Shaman.ts`) | Working: route / canAssign / dispatch / resume | no UI for `routeReason`; `ExecutiveBoard.consult()` not wired to dispatch | **preserved**; used read-only in evidence script | low | `tests/shaman-routing.test.ts` (unchanged) |
| Executive Board / Galaxies / Agents | Working, persisted | Cosmos ownership bug already fixed upstream | preserved | low | existing tests |
| `AIProviderRegistry` | Working, priority + cooldown + auth-rejection classification | no gateway abstraction | **preserved**; gateway adapter added *behind* it | low | existing provider tests |
| `ModelRouter` | Working, offline mode, catalog | local slots honestly "not installed" | preserved | low | untouched |
| Engineering runtime (`/api/engineer/*`) | Working: whitelisted commands, workspace copies, apply/rollback | not a multi-engine orchestrator | `EngineeringOrchestrator` added above it | medium | new tests + unchanged old ones |
| `WorkflowEngine` | Working: retries, loops, escalation, persistence | single-process only | preserved; Temporal documented as optional | low | existing tests |
| `ToolRegistry` / `ToolDispatcher` | Working, permissions + approval gate | approval gate not reachable from adapters | registry reuses the same permission vocabulary | medium | new tests |
| Auth / Supabase | Working: session-based identity | — | relationships keyed by the **existing** user id | medium | unit tests |
| Voice (`VoiceEngine`) | Working unit-tested; no device here | no barge-in on real audio (unverifiable) | adapters added behind it | medium | 11 new logic tests |
| Security (`PromptInjectionGuard`, `PersonalityGuard`) | Present | no policy engine, no scanning | OPA + scanners added beside them | medium | real OPA + real gitleaks runs |
| Observability | `ExecutionLogger`, `AgentEventBus` | no correlated trace | `Telemetry` added | low | new tests |
| Cosmos / Genesis / Workspace / Browser | Working | — | untouched | — | existing tests |
| Mobile (Capacitor) | Build config present; APK workflow fails at SDK step upstream | pre-existing | untouched | — | no device available |

## Failures found in the baseline

1. **The 2 skipped tests** are pre-existing (`skipped 2` before and after).
2. **No provider credential** in this runtime, so live model calls cannot be
   verified here. This is an environment limitation, recorded rather than worked
   around.
3. **Docker daemon unavailable**, so no container-based integration (OpenHands
   sandbox, Trivy container scan, Temporal dev server) can be demonstrated.
4. **Pre-existing security posture**: 74 Gitleaks findings in the working tree,
   triaged in `acceptance-report.md`. `.env.local` is untracked and gitignored;
   it is not in Git history (`git log --all -- .env.local` returns nothing).

## What was preserved by construction

Nothing was renamed, replaced or deleted. The integration work is **additive**:
new files under `src/core/integration`, `src/core/security`, `src/core/observability`,
`src/core/voice/adapters`, `src/core/engineering/EngineeringOrchestrator.ts`,
`plugins/integration*`, `policies/`, plus tests. The only edits to existing files
are two imports and one middleware mount in `vite.config.ts` and `server.ts`.

## Verification of "no regression"

Run after all changes, on the same machine:

- `npx tsc -b --force` → exit 0
- `bun run test` → **1332 tests, 1330 pass, 0 fail, 2 skipped** (1274 → 1332: 58
  new tests; the original 1272 still pass)

The baseline and the result use the same command, so the comparison is
like-for-like. No test was skipped, weakened or removed to achieve this.
