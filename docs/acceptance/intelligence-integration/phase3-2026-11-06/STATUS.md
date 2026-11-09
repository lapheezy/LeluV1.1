# LÉLU V1.1 — Phase 3 status by gate

Date: **2026-11-06** · Branch `claude/master-integration` · base `1549194` (tree `20ea6a4`),
upstream `1031053` (fast-forward, Creation Studio + Atelier intact).

The phase was briefed as nine gates. This file records, per gate, what was actually done
and what was not — the same standard the studios hold themselves to.

| Gate | Status | Evidence |
|---|---|---|
| **A** Repository and architecture audit | **DONE** | `GATE-A-audit.md`; branch/tree/upstream verified; 1358 tests / 0 fail; architecture map + gap list |
| **B** Security findings investigation and remediation | **DONE for investigation + targeted remediation; dependency risk open** | `GATE-B-security-findings.md`; 72 Gitleaks hits classified, 21 Semgrep classified, 86 Trivy classified; 2 findings remediated, 1 mitigated, 10 OPA refusal classes added; retested |
| **C** Engineering engine discovery and safe execution | **NOT STARTED** | blocked: no OpenHands/OpenCode runtime or env var in this VM. A repo is not an installed runtime; nothing to discover truthfully |
| **D** Voice pipeline activation | **NOT STARTED** | blocked: no Whisper/Kokoro/Pipecat service, no microphone or speaker |
| **E** Infrastructure service intelligence | **PARTIAL (pre-existing)** | 10 probes already report `not_configured` with the missing variable and "Network contacted: no"; no new rows were invented |
| **F** Cross-studio operational intelligence | **NOT STARTED** | confirmed absent; must be added without importing adapters (see gap 1 in GATE A) |
| **G** Controlled autonomous planning | **NOT STARTED** | `PlanningEngine` exists; no plan is produced from studio findings yet |
| **H** Genesis/Cosmos + mobile regression | **PARTIAL** | studios remain registered and reachable; captured at 1440×900 and 390×844 (see `REPORT.md` screenshots) |
| **I** Final verification and acceptance | **NOT STARTED** | depends on C–G |

## What was changed in this pass

| File | Change |
|---|---|
| `plugins/commandSafety.ts` | **new** — refuses shell metacharacters, empty and >512-character commands |
| `plugins/nodeAdapters.ts` | command guard before `spawn(..., { shell: true })`; denial reported as a failed command |
| `plugins/denoAdapters.ts` | same guard before `bash -c` |
| `plugins/accessGate.ts` | fixed HMAC salt replaced with a per-process `randomBytes(32)` salt |
| `plugins/selfViewApi.ts` | user-supplied regex bounded to 256 characters |
| `tests/security-hardening.test.ts` | **new** — 14 tests: 4 command-safety, 10 authorization refusal classes |

No studio panel, Genesis window, cosmos renderer, chat or existing voice engine was
modified. `AdapterRegistry` remains the only capability gate.

## What remains, in the order the brief requires

1. **F then G** are the only gates that can be built *without* external services:
   a read-only operational-intelligence module that correlates studio snapshots, and a
   planner that turns findings into an ordered, approval-gated plan. Both must read
   `/api/integration/*`-equivalent server state, never adapters.
2. **C** needs an actually installed engine (`OPENHANDS_BASE_URL` / `OPENCODE_BASE_URL`)
   with a workspace it is allowed to touch.
3. **D** needs Whisper and Kokoro endpoints plus a machine with a microphone; physical
   iPhone Safari validation cannot be claimed from this VM.
4. **Trivy**: a dedicated dependency refresh (`undici`, `nanoid`, `postcss`, `vite`)
   with the build re-verified, rather than an opportunistic bump.
5. **Gitleaks scope**: exclude `.tools/` and `generation_logs/` so the 139 binary hits and
   43 log-id hits stop masking real findings.

## Unchanged guarantees

- Security gate: **FAIL**, honestly (30 working-tree findings at HIGH threshold).
- 0/10 infrastructure services configured, 0/3 engines usable, voice services absent.
- Nothing was marked healthy, available or verified without a real successful run.
