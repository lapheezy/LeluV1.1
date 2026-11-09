# Intelligence integration — evidence

Generated 2026-11-06T06:26:23.320Z by `scripts/verify-intelligence-integration.ts` in this container.

## What was actually executed

| Check | Result | Source |
|---|---|---|
| OPA binary | available — Version: 1.22.2 | policy-decisions.json |
| Policy cases evaluated | 10 | policy-decisions.json |
| OPA/reference agreement | 10/10 | policy-decisions.json |
| Cases decided by OPA (not the fallback) | 10/10 | policy-decisions.json |
| Gitleaks ran | yes | security-scan.json |
| Gitleaks findings | 74 | security-scan.json |
| Security gate passed | false | security-scan.json |
| SHAMAN classification | engineering | trace.json |
| Services probed | 10 | services.json |
| Services healthy | 0 | services.json |
| Services not configured | 10 | services.json |
| Trace spans | 7 | trace.json |
| Trace stages observed | user_request → core → shaman → tool → model → result → verification | trace.json |

## Service states, as probed

| Service | State | Detail |
|---|---|---|
| LiteLLM model gateway | not_configured | LITELLM_BASE_URL is unset — provider routing uses the existing registry directly. |
| OpenFGA relationship authorization | not_configured | OPENFGA_API_URL is unset — relationship checks use the in-process store. |
| Temporal durable workflows | not_configured | TEMPORAL_ADDRESS is unset — long-running work stays on the in-process workflow engine. |
| Pipecat voice pipeline | not_configured | PIPECAT_BASE_URL is unset — voice uses the existing browser speech engines. |
| whisper.cpp speech recognition | not_configured | WHISPER_BASE_URL is unset — transcription uses the browser recogniser when one exists. |
| Kokoro text-to-speech | not_configured | KOKORO_BASE_URL is unset — speech synthesis uses the browser's own voices (0 in a headless runtime). |
| OpenHands engineering backend | not_configured | OPENHANDS_BASE_URL is unset — engineering runs on the local runtime backend. |
| OpenCode coding engine | not_configured | OPENCODE_BASE_URL is unset — OpenCode is not an available execution backend. |
| Infisical secrets management | not_configured | INFISICAL_API_URL is unset — credentials stay in the existing server environment. |
| OpenTelemetry collector | not_configured | OTEL_EXPORTER_OTLP_ENDPOINT is unset — traces are local only, and the monitor says so. |

## Policy decisions

| Case | Action | Allowed | Approval | Engine | Agrees with reference |
|---|---|---|---|---|---|
| read own file | READ | true | false | opa | true |
| write own file | WRITE | true | false | opa | true |
| write at observe level | WRITE | false | false | opa | true |
| delete without approval | DELETE | false | false | opa | true |
| delete with approval | DELETE | true | true | opa | true |
| administer as agent | ADMINISTER | false | false | opa | true |
| agent self-elevation | READ | false | false | opa | true |
| cross-user write | WRITE | false | false | opa | true |
| device access without relationship | ACCESS_EXTERNAL_DEVICE | false | false | opa | true |
| production deploy without approval | DEPLOY | false | false | opa | true |

## What this evidence does NOT show

- No live model call: this runtime holds no provider credential, so the `agent` and live `model` stages are absent from the trace by design rather than simulated.
- No microphone or speaker: voice adapters are covered by unit tests, not audio.
- Trivy and Semgrep were not run here (no vulnerability DB download / not installed); their adapters report that instead of a clean result.
- No remote OpenFGA, Temporal, LiteLLM, Pipecat, Infisical, OpenHands or OpenCode server is configured, so those services report `not_configured`.
