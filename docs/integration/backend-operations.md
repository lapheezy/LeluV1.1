# Backend operations

## Endpoints added

| Method | Route | What it does |
|---|---|---|
| GET | `/api/integration/status` | real probes: services, OPA availability, scanner binaries, token requirement |
| POST | `/api/integration/policy` | a **real** OPA decision, plus the reference decision and whether they agree |
| POST | `/api/integration/scan` | **real** gitleaks / trivy / semgrep runs, workspace-bounded |

Mounted in:

- `vite.config.ts` — `configureServer` and `configurePreviewServer` (runtime label `vite-dev`)
- `server.ts` — the standalone Node/Bun runtime (label `node-server`)
- **not** `main.ts` (Deno): the scanners use child processes, which the Deno entry
  does not have; the same precedent as `selfViewApi`, and `/status` on that runtime
  would report no scanners rather than a false green.

## Safety model

- **Same-origin only** for POST (`Origin` checked against `Host`); cross-origin is
  refused with 403 unless the origin is in `LELU_ENGINEER_ALLOWED_ORIGINS`.
- **Optional token**: when `LELU_ENGINEER_TOKEN` is set, POSTs must carry
  `x-lelu-token`, and `GET /status` still answers so a client can discover that a
  token is required.
- **Workspace-bounded**: `scopedTarget` resolves the scan path inside the
  workspace root and refuses `..`, absolute escapes and missing paths.
- **No values, ever**: the status payload contains names and booleans; scanner
  findings carry rule + file + line, never the matched secret.
- **Never a rejected handler**: the middleware catches, and if headers were
  already sent it ends the response — the failure mode that once took the dev
  server down.

## Environment variables (names only)

| Name | Side | Purpose | Set here |
|---|---|---|---|
| `LELU_OPA_BINARY` | server | path to `opa` | `.tools/opa` found instead |
| `LELU_GITLEAKS_BINARY` / `LELU_TRIVY_BINARY` / `LELU_SEMGREP_BINARY` | server | scanner paths | `.tools/` found for gitleaks + trivy |
| `LITELLM_BASE_URL`, `LITELLM_API_KEY` | server | model gateway | **unset** |
| `OPENFGA_API_URL`, `OPENFGA_STORE_ID`, `OPENFGA_MODEL_ID` | server | relationship server | **unset** |
| `TEMPORAL_ADDRESS`, `TEMPORAL_HTTP_URL` | server | durable workflows | **unset** |
| `PIPECAT_BASE_URL` | server | voice pipeline | **unset** |
| `WHISPER_BASE_URL`, `WHISPER_MODEL` | server | recognition | **unset** |
| `KOKORO_BASE_URL`, `KOKORO_VOICE` | server | synthesis | **unset** |
| `OPENHANDS_BASE_URL`, `OPENCODE_BASE_URL` | server | coding backends | **unset** |
| `INFISICAL_API_URL`, `INFISICAL_TOKEN` | server | secrets | **unset** |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | server | trace export | **unset** |

No existing variable was renamed or removed. `.env.local` was not modified.

## Reading `/api/integration/status`

```json
{
  "ok": true,
  "runtime": "node-server",
  "tokenRequired": false,
  "policy": { "engine": "opa", "available": true, "version": "Version: 1.22.2" },
  "scanners": { "gitleaks": true, "trivy": true, "semgrep": false },
  "services": [ { "id": "litellm", "health": { "state": "not_configured", "detail": "…" } } ]
}
```

`state` is one of `healthy`, `degraded`, `unavailable`, `not_configured`, and
`contacted` is true only when a network round trip actually happened.

## Operational notes

- The probes are **sequential and bounded** (4 s default) so a status request on a
  dead network returns rather than hanging.
- Traces live in the process that created them; a restart clears the ring buffer.
  Nothing is persisted to Supabase by this work.
- Audit entries are in-memory (500-entry ring); they name the subject, action,
  resource, decision, engine and correlation id.
