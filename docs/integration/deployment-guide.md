# Deployment guide

## What must exist for each capability to be real

Nothing below is required for LÉLU to keep working — every integration degrades to
a stated state. This table is what to install to move a row from PARTIAL to PASS.

| Capability | Requirement | Where to put it |
|---|---|---|
| OPA policy | `opa` binary (Apache-2.0) | `LELU_OPA_BINARY`, `.tools/opa`, `node_modules/.bin/opa`, or `PATH` |
| Secret scanning | `gitleaks` binary (MIT) | `LELU_GITLEAKS_BINARY`, `.tools/gitleaks`, or `PATH` |
| Dependency scanning | `trivy` (Apache-2.0) **+ a vulnerability DB** | `LELU_TRIVY_BINARY`; allow the DB download or set `TRIVY_CACHE_DIR` to a mirror |
| Static analysis | `semgrep` (LGPL — run as a process, do not link) | `LELU_SEMGREP_BINARY` or `PATH` |
| Model gateway | LiteLLM proxy | `LITELLM_BASE_URL`, `LITELLM_API_KEY` (**server only**) |
| Relationship server | OpenFGA | `OPENFGA_API_URL`, `OPENFGA_STORE_ID`, `OPENFGA_MODEL_ID` |
| Durable workflows | Temporal cluster + workers | `TEMPORAL_ADDRESS`, plus `TEMPORAL_HTTP_URL` for the health probe |
| Voice pipeline | Pipecat service (WebRTC) | `PIPECAT_BASE_URL` |
| Recognition | whisper.cpp server + model | `WHISPER_BASE_URL`, `WHISPER_MODEL` |
| Synthesis | Kokoro server + voice | `KOKORO_BASE_URL`, `KOKORO_VOICE` |
| Coding backends | OpenHands / OpenCode servers | `OPENHANDS_BASE_URL`, `OPENCODE_BASE_URL` |
| Secrets management | Infisical instance | `INFISICAL_API_URL`, `INFISICAL_TOKEN` (**never in Git**) |
| Trace export | OTel collector | `OTEL_EXPORTER_OTLP_ENDPOINT` |
| API hardening | token + origin allowlist | `LELU_ENGINEER_TOKEN`, `LELU_ENGINEER_ALLOWED_ORIGINS` |

## Deploying the API

1. `bun install --frozen-lockfile` (lockfile unchanged by this work).
2. `bun run build`
3. Serve with `bun run serve` (Node/Bun runtime) — this mounts
   `/api/integration/*` alongside the existing `/api/engineer/*`.
4. Verify:

```bash
curl -s localhost:4173/api/integration/status | python3 -m json.tool
# policy.engine should be "opa" when the binary and bundle are present
# each services[].health.state should be healthy / degraded / unavailable / not_configured
```

5. A real decision:

```bash
curl -s -X POST localhost:4173/api/integration/policy \
  -H 'content-type: application/json' \
  -d '{"subject":{"kind":"user","userId":"u1","agentId":null,"sessionId":"s1"},
       "action":"WRITE","resource":{"kind":"file","id":"file:src/App.tsx","ownerId":"u1"},
       "context":{"autonomyLevel":3,"environment":"sandbox"}}' | python3 -m json.tool
```

6. A real scan (workspace-bounded):

```bash
curl -s -X POST localhost:4173/api/integration/scan \
  -H 'content-type: application/json' -d '{"target":".","scanners":["gitleaks"]}'
```

## Hardening a public deployment

- Set `LELU_ENGINEER_TOKEN` and send `x-lelu-token`; `/status` still answers GET so
  a client can discover the requirement.
- Leave `LELU_ENGINEER_ALLOWED_ORIGINS` **unset** unless a different origin must
  call it; if set, name the exact origin and pair it with the token.
- The scan endpoint reads files and runs processes: treat it like the engineering
  runtime, not like a public status page.

## CI (recommended, not yet wired)

```yaml
- run: npx tsc -b --force
- run: bun run test
- run: bun run scripts/verify-intelligence-integration.ts   # writes evidence
- run: opa eval --fail-defined -d policies/lelu --input tests/fixtures/deny.json data.lelu.authz.decision
```

Add `gitleaks detect --no-git` and `trivy fs` as required checks once their
binaries are installed in the runner.

## Deno entry

`main.ts` does **not** mount `/api/integration/*` (the scanners use child
processes, which that entry does not provide). This matches the existing
`selfViewApi` precedent. The Deno runtime therefore reports no scanners rather
than a false green; route integration calls to the Node/Bun runtime.

## Rollback

See `rollback-guide.md`. Every change is additive; a single `git revert` restores
the previous behaviour exactly.

## Verification after deploy

| Check | Expectation |
|---|---|
| `GET /api/integration/status` | `policy.engine` matches what you installed |
| A denied action | `POST /policy` with `action: "ADMINISTER"` as an agent ⇒ `allowed: false` |
| A missing scanner | `POST /scan` with `scanners: ["semgrep"]` on a host without it ⇒ `gatePassed: false` and "did not run" |
| Secrets | no response body contains a key; only names and booleans |
