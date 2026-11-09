# Repository inventory

Scope of the change: `e7b667b → 1031053` (fast-forward onto the newest Claude
branch) plus this integration work. Nothing was renamed, deleted or migrated.

## Added dependencies

**None.** No `package.json` entry, no lockfile change. Every new module uses the
platform (Node/Bun built-ins, `fetch`, `child_process`) or code already present.
Consequence: `bun.lock` is byte-identical, and no new supply-chain surface was
introduced.

## Modified files

| File | Change | Why it is safe |
|---|---|---|
| `vite.config.ts` | import + mount of `lelu-integration-api` in `configureServer` and `configurePreviewServer` | additive plugin; the handler catches its own errors and ends the response if headers were already sent |
| `server.ts` | import + `middlewares.use("/api/integration", …)` next to the existing `/api/engineer` mount | one mount; unauthenticated GET is status-only, POSTs are origin-gated |
| `.gitignore` | `.tools/` entry | keeps ~260 MB of local binaries out of Git |

Two test files were edited after their first version, to stop the repository
carrying token-shaped literals of its own:
`tests/security-integrations.test.ts`, `tests/telemetry-trace.test.ts`.

No existing source file outside the above was modified. In particular:
`src/core/**` except new files, `agents/**`, `plugins/**` except new files,
`src/app/**`, `supabase/**` and every `.env*` file are untouched.

## New files

**Browser-safe core (`src/`)**

| File | Purpose |
|---|---|
| `src/core/integration/protocol.ts` | capability vocabulary, request/response contracts, validation, argument schema check |
| `src/core/integration/AdapterRegistry.ts` | the single gate: identity → relationships → policy → schema → bounded execution → audit + trace |
| `src/core/security/policy.ts` | reference policy evaluator (browser mirror + differential partner) |
| `src/core/security/authz/RelationshipStore.ts` | OpenFGA-shaped tuples: owner → device → session → capability, expiry, revocation |
| `src/core/observability/Telemetry.ts` | staged spans, parent links, structural redaction, bounded buffer, OTLP export |
| `src/core/engineering/EngineeringOrchestrator.ts` | engine selection, workspace lock, verification rules, outcome history |
| `src/core/voice/adapters/VoiceAdapters.ts` | VAD, whisper/kokoro adapters, chunk planner, transcript merge, benchmark summary |

**Server (`plugins/`, `policies/`)**

| File | Purpose |
|---|---|
| `plugins/integration/opa.ts` | real `opa eval`, per-bundle caching, deny on failure |
| `plugins/integration/scanners.ts` | gitleaks / trivy / semgrep, fail-closed gate, no values in findings |
| `plugins/integration/services.ts` | 10 honest service probes |
| `plugins/integrationApi.ts` | `GET /status`, `POST /policy`, `POST /scan` |
| `policies/lelu/authorization.rego` | the authoritative policy (numbered precedence ladder) |

**Tests (7 files, 58 of the 59 new test cases)**

`tests/integration-spine.test.ts`, `tests/policy-authorization.test.ts`,
`tests/authz-relationships.test.ts`, `tests/telemetry-trace.test.ts`,
`tests/engineering-orchestrator.test.ts`, `tests/voice-adapters.test.ts`,
`tests/security-integrations.test.ts`.

**Scripts and evidence**

`scripts/verify-intelligence-integration.ts`,
`docs/acceptance/intelligence-integration/<timestamp>/` (5 artefacts),
`docs/acceptance/intelligence-integration/live-api-2026-11-06/` (4 artefacts),
`docs/integration/*.md` (this documentation set).

## New services

None deployed. No container, no Cloudflare Worker, no Supabase function, no cron.
The only new runtime surface is a route prefix inside the existing server.

## New environment variables

All **optional**, all server-side, all documented in `ENV_VARS.md`-style tables in
`backend-operations.md`. No variable is required for LÉLU to boot; unset means
`not_configured`, never a crash.

`LELU_OPA_BINARY`, `LELU_GITLEAKS_BINARY`, `LELU_TRIVY_BINARY`,
`LELU_SEMGREP_BINARY`, `LELU_ENGINEER_TOKEN` (reused),
`LELU_ENGINEER_ALLOWED_ORIGINS` (reused), `LITELLM_BASE_URL`, `LITELLM_API_KEY`,
`OPENFGA_API_URL`, `OPENFGA_STORE_ID`, `OPENFGA_MODEL_ID`, `TEMPORAL_ADDRESS`,
`TEMPORAL_HTTP_URL`, `PIPECAT_BASE_URL`, `WHISPER_BASE_URL`, `WHISPER_MODEL`,
`KOKORO_BASE_URL`, `KOKORO_VOICE`, `OPENHANDS_BASE_URL`, `OPENCODE_BASE_URL`,
`INFISICAL_API_URL`, `INFISICAL_TOKEN`, `OTEL_EXPORTER_OTLP_ENDPOINT`.

**No secret value is stored in any file added by this work.**

## Database migrations

**None.** No table, column, policy or RLS rule was created or changed. Audit
entries, relationship tuples and traces are in-memory with hard caps (500 / — /
2000). Persisting them to Supabase is a deliberate future decision, not an
accident of this work.

## Local-only artifacts (gitignored)

`.tools/opa` (1.22.2), `.tools/gitleaks` (8.30.1), `.tools/trivy` (0.76.2) —
~260 MB, never committed. Resolution order for every adapter:
`LELU_<TOOL>_BINARY` → `.tools/<tool>` → `node_modules/.bin` → `PATH`.

## Required deployment steps

1. `bun install --frozen-lockfile`
2. `bun run build`
3. `bun run serve` (Node/Bun runtime; the Deno entry deliberately omits this route)
4. Optionally install `opa`, `gitleaks`, `trivy`, `semgrep` and set their paths.
5. Optionally set any service URL above to turn a `not_configured` into `healthy`.
6. Verify with `GET /api/integration/status` (see `deployment-guide.md`).

## Rollback

`git revert <commit>` — see `rollback-guide.md`. No data to restore.
