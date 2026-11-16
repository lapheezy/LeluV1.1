# Live API evidence — 2026-11-06

**Test ID:** API-LIVE-01..03 · **Environment:** Vite 8.2.0 dev server, port 5199,
8 vCPU / 15 GB / no GPU, headless container · **Client:** curl from the same container.

These are real HTTP responses from the running application server, captured
while it was serving. No response was edited after capture.

## API-LIVE-01 — GET /api/integration/status

- Expected: real probe results, no fabricated health, no secret values.
- Actual: `ok=True`, `runtime=vite-dev`, policy engine `opa`
  available `True` (`Version: 1.22.2`), scanners {'gitleaks': True, 'trivy': True, 'semgrep': False}.
- Services: `litellm=not_configured`, `openfga=not_configured`, `temporal=not_configured`, `pipecat=not_configured`, `whisper=not_configured`, `kokoro=not_configured`, `openhands=not_configured`, `opencode=not_configured`, `infisical=not_configured`, `otel=not_configured`.
- **Result: PASS** — 10/10 remote services honestly report `not_configured`; nothing claims to be healthy.

## API-LIVE-02 — POST /api/integration/policy (deny case)

- Expected: an agent must not be able to DEPLOY, even with a valid approval.
- Actual: `allowed=false`, `rules=["deny_agent_action"]`, `engine="opa"`,
  `durationMs=138`, reference evaluator agrees (`agrees=true`).
- **Result: PASS** — decided by the real OPA binary, and the two engines agree.

## API-LIVE-03 — POST /api/integration/scan (gitleaks)

- Expected: a real scan with a fail-closed gate and no matched values in the output.
- Actual: `gatePassed=False`, `1/1 scanner(s) ran; 72 finding(s). Gate FAILED — findings at or above the threshold.`
  counts={'critical': 0, 'high': 72, 'medium': 0, 'low': 0, 'info': 0, 'unknown': 0}.
- Findings carry rule + file + line only; no secret value appears in the payload.
- **Result: PASS (gate correctly FAILS)** — 72 findings need triage; a failing gate is the
  honest outcome, not a defect in the integration.

## Test 06 observability chain (from the evidence run)

`user_request → core → shaman → tool → model → result → verification`

Seven correlated spans with parent links. The `agent` stage is absent because no
provider credential exists in this environment — the chain records what happened,
not what would have happened.
