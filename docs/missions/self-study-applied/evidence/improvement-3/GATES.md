# Improvement 3: gate results on the final code (2026-11-17 UTC)

Every run below used the Supabase guard (`NODE_OPTIONS=--import tests/support/block-supabase.mjs`).

| Gate | Command | Result |
|---|---|---|
| Full suite | `npm test`, with every model-provider key removed from its environment | **2,333 tests: 2,327 pass, 0 fail, 6 skipped**; 443 s; exit 0 |
| Typecheck | `npm run typecheck` (`tsc -b --force`) | exit 0 |
| Lint | `npm run lint` (oxlint) | exit 0; 0 errors, 179 warnings, all in pre-existing files; changed files clean |
| Build | `npm run build` | exit 0 |
| Bundle | `node scripts/verify-no-tests-in-bundle.mjs dist` | PASS, 1,520 files |

The 6 skipped tests need tools or live services that are absent here. They are the same as before this work:

- `live: token issued, room created, real participant joins`: LIVEKIT_LIVE_ENV not set
- `the real OPA binary and the policy bundle are detected`: opa not present
- `OPA and the reference evaluator agree on every case in the matrix`: opa not present
- `gitleaks finds a planted secret and never repeats its value`: gitleaks not present
- `a clean directory scans clean — and says it actually ran`: gitleaks not present
- `live worker is READY through the pool`: VOXCPM_LIVE_URL not set

**Supabase.** The guard refused 132 requests during the suite. All were `GET /rest/v1/legacy_memories`, the archive provider's boot-time read, and none was sent.

**Model use.** No real provider call was made during the final suite. Every "generated response" in its log comes from an in-process test provider.

**Why the keys were removed.** With provider keys present, this suite makes real model calls: 7 real Groq calls were observed in an earlier run before it was stopped.
