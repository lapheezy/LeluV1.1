# Known limitations

Every item here is a real gap, not a caveat on something that works.

## No user interface

The spec asks for Engineering Studio, Voice Studio, Infrastructure Monitor and a
Security Centre inside Cosmos. **None was built.** The server surface they would
read exists (`/api/integration/status|policy|scan`, the adapter registry, the
trace store), but wiring a Cosmos panel with real data was not done in this
session.

Deliberate consequence: **there are no application screenshots.** The spec forbids
decorative controls and fabricated health indicators, so a panel showing invented
numbers would have been worse than no panel. The evidence is API output and test
results, not UI.

## Qwen3-Coder is not registered

No credential for any Qwen-compatible endpoint exists here, and the weights cannot
run on 8 vCPU / 15 GB / no GPU or on a phone. Registering an always-failing
fallback rung is a regression, so it was not done. Procedure in
`provider-routing.md`.

## Coding backends are not connected

`EngineeringOrchestrator` selects, locks, verifies and records outcomes — tested.
But no task-submission client exists for OpenHands or OpenCode, and the local
backend is not wired to the existing engineering runtime. So the orchestrator can
refuse correctly, and cannot yet do the work itself.

## Security scanning is incomplete

- **Semgrep not installed** → no static analysis.
- **Trivy has no vulnerability DB** → no dependency CVEs.
- The gate therefore reports failure for those scanners, which is correct but
  means "the security gate passes" is **not** a statement anyone can make yet.

## Secrets management is not migrated

No Infisical project, no migration, and **no credential was copied anywhere**.
The existing `.env` / `.env.local` contract is unchanged. The known
"why did my key not arrive" cause is already documented and fixed upstream in
`plugins/bareSecretAliases.ts` (platform writes secret *names* no code reads).

## Policy/relationship limits

- Relationship tuples are **in-process**: another server instance would not see a
  revocation. An OpenFGA server is the fix; the adapter is ready.
- No UI or tool can mint/revoke a device session — only code can.
- `DEPLOY`/`ADMINISTER` require approval, but no production deployment path was
  added, so those actions have no executor yet.

## Voice

- No microphone, speaker, or Kokoro/whisper server: **no audio was produced or
  heard**.
- Silero's neural model is not used; an energy VAD with an adaptive noise floor
  stands in and says so.
- No streaming transport (Pipecat is a health probe only).
- No mobile or desktop device check.

## Observability

- Traces are in-memory per process, bounded at 2000 spans, and lost on restart.
- No OTel collector is configured, so OTLP export is implemented but unexercised.
- No dashboards; the acceptance chain is an artefact, not a screen.

## Engineering verification

- `verify()` trusts the backend's own command records. A backend that lies about
  a test run would pass it. The mitigation is that the local runtime's records
  come from real child processes, and a remote backend must be audited once.
- No branch/worktree creation, no artifact collection beyond what a backend
  reports.

## Platform

- Docker daemon unreachable ⇒ no container isolation, no Trivy image scan, no
  Temporal dev server, no OpenHands sandbox.
- Deno entry (`main.ts`) does not mount the integration API (child processes).
- No CI wiring for scanners; no pre-commit hook.

## Pre-existing, not caused here

- Headless 3D renders at ~2 fps; upstream notes exist.
- The Android APK workflow has failed at the SDK step since 2026-09-16.
- 2 tests are skipped in the suite, as before this work.
