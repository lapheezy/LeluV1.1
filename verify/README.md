# Integration verification harness

Live end-to-end verification of LÉLU's autonomous cognition against a
real browser and a real development runtime. Not part of the app; not
imported by it.

## What it proves

`integration-verification.mjs` drives the real app in Chromium and
checks three things in a single run:

1. **She autonomously continues self-study from her mission.** The
   script observes `SelfStudyEngine` already running after boot and
   watches the cycle counter advance on its own schedule. Phase 1 never
   calls `runCycle()` — `testCalledRunCycle: false` is asserted in the
   output.
2. **Her agents/tools and the real development runtime take part.**
   Reports which agent and tool ran each cycle and where the evidence
   came from, including a source read whose evidence is labelled
   `REAL DEVELOPMENT RUNTIME`. It also asserts the build-time snapshot
   is non-empty, so the fallback can never silently disappear.
3. **Chat reports the state without creating it.** Snapshots cognition,
   sends "LÉLU, what are you thinking about today?", and compares the
   cycle counter and objective identity across the request. Then
   reloads the page and asks again with no in-memory state, proving the
   answer comes from the durable trace.

## Running it

```bash
# 1. an OpenAI-compatible endpoint so a real registered provider can respond
node verify/provider-stub.mjs

# 2. the app, with the EXISTING GitHub Models provider pointed at it
VITE_AI_PROXY_BASE_URL=http://127.0.0.1:8899/chat/completions \
VITE_GITHUB_TOKEN=local-verification-key \
VITE_GITHUB_MODEL=stub-model \
  bun run dev

# 3. the verification
node verify/integration-verification.mjs | tee /tmp/verification.json
```

`provider-stub.mjs` is **not another provider system**. It is a local
HTTP endpoint that an already-registered provider is aimed at through
the existing `VITE_AI_PROXY_BASE_URL` setting, so the real path —
cognition → `AIRuntime.reason` → `ProviderResolver` →
`AIProviderRegistry` → `GitHubModelsProvider` → HTTP → response →
cognition → memory — can be exercised without a paid key. It logs every
request it receives (never the credential) to `/tmp/provider-stub-calls.json`
so the call can be shown to have genuinely left the app.

`diagnose-source-access.mjs` is a focused probe for the source-access
layer: snapshot size, probe stability, and that the same file read with
the runtime up is labelled `development-runtime` while the same read
with the runtime unreachable is labelled `static-snapshot`.

## Authorization boundary

The boundary is verified separately against the standalone runtime
(`bun run serve`) with `LELU_ENGINEER_TOKEN` and
`LELU_ENGINEER_ALLOWED_ORIGINS` set — see the table in `ENV_VARS.md`.
Nothing in this harness disables authentication or authorization.
