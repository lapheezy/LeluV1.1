# M22.2 — acceptance evidence

Everything in this folder is evidence produced by a command that ran. Nothing here is a claim about a check that did not run; where a check could not be performed, the file says so.

## Reproduction

```bash
# 1. The automated boundary tests (M22.2 additions included)
npx tsx --tsconfig tsconfig.test.json --import ./tests/support/ignore-css.mjs \
  --test tests/context-sovereignty.test.ts tests/memory-hardening.test.ts tests/memory-sovereignty.test.ts

# 2. Live concurrency, workspace, snapshot and provider checks
#    (makes real provider calls through AIService.chat; skips cleanly when no
#     provider is configured)
npx tsx --tsconfig tsconfig.test.json scripts/context-sovereignty-live.ts

# 3. Performance
npx tsx --tsconfig tsconfig.test.json scripts/context-sovereignty-bench.ts

# 4. Types
NODE_OPTIONS=--max-old-space-size=3072 npx tsc -p tsconfig.app.json --noEmit

# 5. Full regression
npm test
```

## What each file contains

| File | Produced by | Shows |
| --- | --- | --- |
| `context-sovereignty.test.ts` | run 1 | 19 tests: workspace scoping (W), snapshot scoping (X), the authorization checkpoint (Y) |
| `context-sovereignty-live.ts` | run 2 | sentences the provider actually received, snapshots actually rendered, three conversations in flight |
| `context-sovereignty-bench.ts` | run 3 | measured milliseconds for authorization, workspace reads, 500-node filtering and clean enrichment |
| `implementation/` | copy of the changed sources | the code these results came from |

Result JSON lives one level up, in `MISSION-22.2/`:

- `workspace-observation-audit.json`
- `agent-cognitive-context-audit.json`
- `global-state-audit.json`
- `context-authorization-map.json`
- `concurrency-validation.json`
- `workspace-observation-live.json`
- `agent-cognitive-context-live.json`
- `deletion-validation.json`
- `provider-validation.json`
- `browser-validation.json`
- `performance-report.json`

## Redaction

Provider evidence records booleans and character counts for the payload — whether a specific fact was present, which projects were named, how long the context was — plus the provider name. It does not reproduce a user's message or a full prompt. No credential, key or endpoint token appears in any file.

## Browser and mobile

Not verified. `browser-validation.json` states the blockers (`3D scene saturating automation`, provider quota) and that the mobile requirement remains unmet for lack of a device or emulator. No browser or device acceptance is claimed anywhere in this mission.
