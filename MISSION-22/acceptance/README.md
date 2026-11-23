# MISSION 2.2 — ACCEPTANCE: HOW TO REPRODUCE

Everything below was executed on branch `freebuff/4fe6237b54885c7ced31f590` in this workspace.
Nothing here needs a paid API and nothing needs Anthropic.

## 0. Setup

```bash
bun install --frozen-lockfile        # dependencies are not restored with the checkpoint
```

Provider credentials used for the live runs are the existing `GROQ_API_KEY_1` and
`OPENROUTER_API_KEY` (aliased at runtime to the base names by the scripts). No key is printed,
logged or written to any deliverable.

## 1. Automated regression suite (Groups A–G)

```bash
npx tsx --tsconfig tsconfig.test.json --import ./tests/support/ignore-css.mjs \
  --test tests/memory-sovereignty.test.ts
```

Expected: 28 tests, 28 pass.

What each test proves is in its name; the load-bearing ones are:

- `A: a loss stated in chat A is not retrieved into chat B` — the reported defect.
- `A: cognitive observations are rendered only in the conversation that made them` — the second
  cross-conversation path found during live validation.
- `B: a project from an earlier conversation is recallable, with its origin preserved` — recall was
  not amputated to fix isolation.
- `C: a correction supersedes, and the original origin never moves` — chronology.
- `D: a forged provenance reference is rejected` — ownership/provenance integrity.
- `F: simultaneous conversations do not share recalled context` — concurrency.

## 2. Live model validation (canonical pipeline)

```bash
npx tsx scripts/memory-live.ts
```

Expected: 8/8 turns answered through `AIService.chat`, and:

| scenario | requirement | evidence |
|---|---|---|
| A-isolation | "Can you fix it?" in chat B never receives chat A's loss | the captured provider payload contains no grief text; the reply asks what needs fixing |
| B-historical-recall | a project from chat C is recalled in B and labelled | payload contains `[earlier conversation “C — Aurelia studio”]` and the provenance note |
| C-chronology | the corrected metal is what reaches the model | payload contains platinum; the superseded rose-gold statement is not current |
| E-sensitive-history | a directly asked-about loss is retrievable as history | the labelled memory is in the payload and the reply is framed as history |

Output: `MISSION-22/live-validation.json` (full payload excerpts and retrieval decisions).

## 3. Provider parity

```bash
npx tsx scripts/memory-live.ts --parity
```

Expected: 2/2 (`groq`, `openrouter`) answered, `griefInContext: false` for both.
Output: `MISSION-22/live-parity.json`.

## 4. Performance

```bash
npx tsx scripts/memory-bench.ts
```

Expected: scoped recall ≈0.06 ms mean, authorization ≈0.07 ms mean / ≈0.11 ms p95 on a 500-memory
store; the provenance instruction costs 0 characters on turns with no labelled material.
Output: `MISSION-22/performance-report.json`.

## 5. Browser acceptance (GenesisChat)

```bash
npx vite --host 0.0.0.0 --strictPort --port 3001
```

Open the preview URL, summon the chat, then:

1. Send `My father died last month and I can't focus on anything.` — LÉLU answers the loss.
2. Click **New chat**, send `Can you fix it?` — LÉLU answers the engineering question.
   It must not mention a father, a death, grief or condolences.
3. Minimise the second window and click the first conversation — the loss turn returns.
4. Reload the page — both conversations are restored.

Evidence: `artifacts/genesis-memory-isolation.png`, `artifacts/genesis-memory-return.png`,
`MISSION-22/browser-acceptance.json`.

## 6. Full regression suite

```bash
npm test
```

Expected: 2,336 tests; 2,326 pass; 8 skipped; two failures that predate this mission and are
environmental (documented in the final report):
`tests/genesis-interface.test.tsx` (CSS export resolution) and
`tests/sandbox-security.test.ts` (the sandbox's own error string differs).

## 7. Files this mission added

```
MISSION-22-MEMORY-SOVEREIGNTY.md
MISSION-22/MEMORY-ARCHITECTURE-AUDIT.md
MISSION-22/memory-flow-map.json
MISSION-22/memory-boundary-findings.json
MISSION-22/memory-provenance-spec.json
MISSION-22/retrieval-policy.json
MISSION-22/test-results.json
MISSION-22/live-validation.json
MISSION-22/live-parity.json
MISSION-22/performance-report.json
MISSION-22/browser-acceptance.json
MISSION-22/acceptance/README.md
src/core/memory/MemorySovereignty.ts
tests/memory-sovereignty.test.ts
scripts/memory-live.ts
scripts/memory-bench.ts
```
