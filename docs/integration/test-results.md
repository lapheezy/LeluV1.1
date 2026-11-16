# Test results

All results below were produced in this container on **2026-11-06**, by the
commands shown. Nothing was filtered through a pipeline that could hide an exit
status (`TSC_EXIT` is captured with `PIPESTATUS`).

## Suite

| Run | Command | Result |
|---|---|---|
| Baseline (commit `1031053`, before any change) | `bun run test` | **1274 tests, 1272 pass, 0 fail, 2 skipped** |
| Final (after integration work) | `bun run test` | **1332 tests, 1330 pass, 0 fail, 2 skipped** |
| Final (after the four studios + Semgrep/Trivy remediation) | `bun run test` | **1344 pass, 0 fail, 2 skipped** |
| Typecheck | `npx tsc -b --force` | **exit 0** |

The 2 skips are pre-existing and unchanged. The 58 added tests are listed below;
no existing test was modified, skipped or removed.

## New test files

| File | Tests | What it proves |
|---|---|---|
| `tests/integration-spine.test.ts` | 9 | identity/action/audit validation, policy denial recorded, argument schema enforced, credentials stripped, timeout → `timed_out`, cancel → stopped, unknown capability refused |
| `tests/policy-authorization.test.ts` | 12 | the eight action classes, autonomy floors, agent self-elevation, agent ADMINISTER/DEPLOY refusal, device limits, cross-user isolation, approval + production gates |
| `tests/authz-relationships.test.ts` | 7 | device chain grants exactly its capabilities, device isolation, expiry without a job, revocation, org→project implication and no silent promotion |
| `tests/telemetry-trace.test.ts` | 5 | one ordered correlated chain, parent links, failure recorded and rethrown, redaction by key and value shape, export refusal, bounded buffer |
| `tests/engineering-orchestrator.test.ts` | 9 | engine honoured or refused (never substituted), preference order, workspace exclusivity, verification rules, merge needs approval, throwing backend recorded |
| `tests/voice-adapters.test.ts` | 11 | chunk continuity, no mid-word cut, noise resistance, thinking pause, barge-in, transcript merge, honest absence, interruption, median/p95 |
| `tests/integration-studios.test.ts` | 14 | posture is never PASS while a scanner is missing, findings carry rule/file/line and never a secret, verification needs changed files inside allowed paths plus a real test run, panels import no adapter and only `/api/integration/*`, deep links and registration wired |
| `tests/security-integrations.test.ts` | 6 | **real OPA** detected, **15-input matrix parity**, missing bundle refuses, **real gitleaks finds a planted secret without reproducing it**, clean dir scans clean, missing scanner fails the gate |

## Real-binary results (not mocks)

| Tool | Version | Result |
|---|---|---|
| OPA | 1.22.2 | policy compiled; 10/10 evidence cases decided by OPA; 10/10 agreement with the reference; tests compare a 15-input matrix |
| Gitleaks | 8.30.1 | 74 findings on the first scan, **72** after removing this session's own two token-shaped test literals (triaged in `acceptance-report.md`); planted secret found; value never reproduced |
| Trivy | 0.76.2 | **real scan** over `src/` after downloading the DB into `.tools/trivy-cache`: 0 findings |
| Semgrep | 1.184.0 | installed into `.tools/venv` (exposed as `.tools/semgrep`); **real scan** over `src/`: 21 findings (5 medium, 16 info) |

## Live server probe

`docs/acceptance/intelligence-integration/live-api-2026-11-06/` holds real HTTP
responses captured from `vite` on port 5199:

- `GET /api/integration/status` → 200, `runtime=vite-dev`, policy `opa` 1.22.2,
  scanners `{gitleaks: true, trivy: true, semgrep: false}`, 10 services `not_configured`.
- `POST /api/integration/policy` → agent `DEPLOY` denied, `engine=opa`, 138 ms,
  `rules=[deny_agent_action]`, reference agrees.
- `POST /api/integration/scan` → Gitleaks ran, `gatePassed=false`, 72 findings
  (rule/file/line only).

## Evidence artefacts

`docs/acceptance/intelligence-integration/<timestamp>/`:

- `REPORT.md` — summary whose every number is read from the JSON beside it
- `policy-decisions.json` — 10 cases, engine per case, reference comparison
- `security-scan.json` — the real Gitleaks report (rule, file, line; no values)
- `services.json` — 10 probes with real state and detail
- `trace.json` — the correlated chain with spans and attributes

## Not run

| Check | Why |
|---|---|
| Live model completion | no provider credential in this environment |
| Audio capture / synthesis | no microphone or speaker |
| Docker-based scans and sandboxes | Docker daemon unreachable |
| Browser/UI acceptance | **now run** — desktop 1440×900 and mobile 390×844 against the live dev server; see `docs/acceptance/intelligence-integration/studios-2026-11-06/REPORT.md` |
| Mobile device checks | layout verified at a 390×844 viewport in the cloud browser; no physical device or emulator |
| `bun run build` | not needed for these changes; typecheck covers the app graph |
| `verify:*` scripts | many pre-exist as failing in this environment (documented upstream); they were not part of this change |
