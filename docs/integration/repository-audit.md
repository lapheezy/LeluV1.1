# Repository audit — 16 integrations

Audited against the live repositories on **2026-11-06**. Licences come from each
repository's own `LICENSE` file fetched from `raw.githubusercontent.com` (the
GitHub API rate-limited this unauthenticated session after one call). Where a
licence file could not be found, that is stated rather than guessed.

The reference implementation of each integration lives in
`src/core/integration/`, `src/core/security/`, `src/core/observability/`,
`src/core/engineering/`, `src/core/voice/adapters/` and `plugins/integration/`.

**Status vocabulary** — `INTEGRATED` (real adapter + tests in this repo),
`ADAPTER ONLY` (real code path, no server configured here), `NOT INSTALLED`
(adapter reports that honestly), `BLOCKED` (needs infrastructure this
environment cannot provide).

| # | Project | Licence (verified) | Status here |
|---|---|---|---|
| 1 | QwenLM/Qwen3-Coder | **not found on `main`** — verify before redistribution | BLOCKED (no credential, no weights) |
| 2 | OpenHands/OpenHands | MIT | ADAPTER ONLY |
| 3 | anomalyco/opencode | MIT | ADAPTER ONLY |
| 4 | pipecat-ai/pipecat | BSD-style (3-clause) | ADAPTER ONLY |
| 5 | ggml-org/whisper.cpp | MIT | ADAPTER ONLY |
| 6 | snakers4/silero-vad | MIT | PARTIAL (energy VAD, no ONNX weights) |
| 7 | hexgrad/Kokoro-82M | **no LICENSE file on `main`** — model card terms apply | ADAPTER ONLY |
| 8 | BerriAI/litellm | MIT | ADAPTER ONLY |
| 9 | temporalio/temporal | MIT | ADAPTER ONLY |
| 10 | open-telemetry/opentelemetry-collector | Apache-2.0 | INTEGRATED (traces) / ADAPTER ONLY (collector) |
| 11 | Infisical/infisical | MIT | ADAPTER ONLY |
| 12 | open-policy-agent/opa | Apache-2.0 | **INTEGRATED — real binary, 10/10 parity** |
| 13 | openfga/openfga | Apache-2.0 | INTEGRATED (in-process tuple store) / ADAPTER ONLY (server) |
| 14 | semgrep/semgrep | LGPL (version in file) | NOT INSTALLED |
| 15 | aquasecurity/trivy | Apache-2.0 | NOT INSTALLED for scans (binary present, no DB) |
| 16 | gitleaks/gitleaks | MIT | **INTEGRATED — real binary, real scan of this repo** |

## Licence and commercial-use notes that change decisions

- **Semgrep is LGPL.** Running the CLI as a separate process is the safest use;
  do not link its libraries into the app bundle.
- **Kokoro-82M** has no licence file in the repository. Model weights are
  governed by the model card, not by any repository LICENSE. Treat its terms as
  unverified until a human reads the model card.
- **Qwen3-Coder** has no licence file on `main`. Its weights are large and are
  **not** runnable in this Codespace, on a phone, or in a browser — the
  integration is therefore a *model provider registration*, not local inference.
- **LiteLLM** is MIT, but its repository carries a separate enterprise
  directory under different terms. Only the MIT-licensed gateway is used.
- **Temporal** is MIT, but a production deployment is an infrastructure
  commitment (database + workers). Not evaluated here beyond reachability.

## Per-repository findings

### 1. Qwen3-Coder — coding model
- **Role:** an additional coding model behind the existing `AIProviderRegistry`,
  never a second registry.
- **Overlap with LÉLU:** `ModelRouter` already routes coding turns to a
  configured provider (`VITE_CODING_PROVIDER`, Fireworks/Kimi by default).
- **Adapter needed:** an OpenAI-compatible provider descriptor + model
  capability metadata (context window, tool support).
- **Blocker:** no credential for any Qwen-compatible endpoint in this runtime,
  and the weights cannot run here. Registered, not exercised live.
- **Do not assume:** that the model weights are redistributable, or that
  inference is possible locally.

### 2. OpenHands — autonomous engineering
- **Role:** a selectable coding *backend* for `EngineeringOrchestrator`.
- **Overlap:** the existing engineering runtime (sandbox copies, whitelisted
  commands, real typecheck/tests) already does file editing and verification.
  OpenHands adds a container-per-task model that this environment cannot run
  (no Docker daemon: `permission denied` on `/var/run/docker.sock`).
- **Adapter:** HTTP health probe + task submission contract; refuses when
  `OPENHANDS_BASE_URL` is unset.
- **Operational cost:** each task is a container; RAM/CPU scale with concurrency.

### 3. OpenCode — alternative coding engine
- **Role:** an interchangeable backend; never a competing authority.
- **Conflict rule:** `EngineeringOrchestrator` holds a workspace lock so two
  engines cannot edit one workspace (tested).
- **Blocker:** no server configured; health reports `not_configured`.

### 4. Pipecat — real-time voice orchestration
- **Role:** streaming transport and pipeline orchestration.
- **Overlap:** `VoiceEngine` already owns conversation identity, barge-in and
  transcription transport. Pipecat would replace the *transport*, not the
  identity or the persona.
- **Blocker:** needs a Python service and WebRTC; neither is available here.
- **Do not claim:** real-time streaming or mobile transport until measured.

### 5. whisper.cpp — speech recognition
- **Role:** local transcription adapter.
- **Adapter:** `WhisperAdapter` posts audio to a configured server and returns
  an honest empty result with a reason when none is configured.
- **Feasibility:** CPU-only is realistic for `base`/`small` models; mobile is
  not assumed.
- **Privacy:** no audio is retained by the adapter; it sends the blob it is given.

### 6. Silero VAD — voice activity
- **Role:** decide when the user has finished speaking.
- **Implemented here:** an adaptive-noise-floor energy detector with the same
  interface and documented thresholds, because the ONNX weights are absent.
  The class reports `silero-onnx (absent)` so nothing downstream can mistake it
  for the neural model.
- **Tested:** steady room tone never opens it; a 300 ms thinking pause does not
  end the utterance; 500 ms of silence does; barge-in closes immediately.

### 7. Kokoro — text-to-speech
- **Role:** natural synthesis adapter with chunking and interruption.
- **Implemented here:** chunk planner (no duplicated/dropped words at a
  boundary — asserted), interruption at the next chunk, honest refusal when
  unconfigured.
- **Blocker:** no Kokoro server; browser voices are 0 in a headless runtime, so
  **no audio was produced or heard in this session.**

### 8. LiteLLM — model gateway
- **Role:** optional routing/usage layer *behind* `AIProviderRegistry`.
- **Rule enforced:** it does not become a second registry. With no
  `LITELLM_BASE_URL` the existing provider chain runs unchanged.
- **Adapter:** `/models` health probe; `not_configured` when unset.

### 9. Temporal — durable workflows
- **Role:** durable execution for long agent workflows.
- **Overlap:** `WorkflowEngine` already persists step state, retries, timeouts,
  escalation and terminal conditions in LÉLU's own store. Temporal would add
  cross-process recovery, not workflow semantics.
- **Blocker:** no cluster; a gRPC address is not probeable from the web runtime,
  which the adapter says instead of inventing a healthy state.

### 10. OpenTelemetry — observability
- **Role:** a correlated trace of `User Request → CORE → SHAMAN → Agent →
  Model → Tool → Result → Verification`.
- **Implemented:** `src/core/observability/Telemetry.ts` — staged spans, parent
  links, structural redaction of credential-shaped attributes, a bounded ring
  buffer, and an OTLP/HTTP exporter that refuses when no collector is set.
- **Evidence:** `docs/acceptance/intelligence-integration/*/trace.json`.

### 11. Infisical — secrets management
- **Role:** centralised, scoped, rotatable credentials.
- **Not done:** **no secret was copied anywhere.** Migrating live credentials
  needs the owner's authorization and the Infisical project.
- **Diagnosis of the existing key problem:** `ENV_VARS.md` documents that the
  platform writes `.env.local` under *secret names* (`Anthropic`, `Groq`,
  `Supabase`) that no code reads; `plugins/bareSecretAliases.ts` already bridges
  those. That is the concrete cause of "keys did not reach the runtime", and it
  is a naming contract problem, not a transport problem.

### 12. Open Policy Agent — policy
- **Role:** authorise the eight action classes.
- **Implemented:** `policies/lelu/authorization.rego` + `plugins/integration/opa.ts`
  (real `opa eval`) + `src/core/security/policy.ts` (browser reference).
- **Measured:** OPA 1.22.2, 10/10 agreement with the reference on the evidence
  matrix; every decision labelled with the engine that produced it.
- **Failure mode:** OPA missing, bundle missing, or eval error ⇒ **refuse**.

### 13. OpenFGA — relationship authorization
- **Role:** owner → device → authorized session → granted capabilities, with
  expiry and revocation.
- **Implemented:** `src/core/security/authz/RelationshipStore.ts` (tuple model,
  expiry, revocation, one documented implication) + an HTTP health adapter.
- **Not done:** no OpenFGA server, so tuples are in-process and not shared
  between server instances. That limitation is stated in the monitor.

### 14. Semgrep — static analysis
- **Status:** not installed. The adapter reports `not installed` and the security
  gate **fails** rather than reporting clean.
- **Next step:** `pipx install semgrep` or the Docker image, then `LELU_SEMGREP_BINARY`.

### 15. Trivy — dependency/container scanning
- **Status:** binary present (0.76.2) but no vulnerability DB was downloaded, so
  a scan would fail on DB fetch. The adapter reports the failure; it never
  reports zero findings for a scan that did not complete.
- **Next step:** allow the DB download, or mirror it and set `TRIVY_CACHE_DIR`.

### 16. Gitleaks — secret detection
- **Status:** **INTEGRATED and run for real** (8.30.1) against this working tree.
- **Result:** 74 findings, triaged in `acceptance-report.md`; `.env.local` is
  untracked and gitignored, so **no credential is in Git history**.
- **Rule enforced:** a finding's message carries the rule and location, never
  the matched value.
