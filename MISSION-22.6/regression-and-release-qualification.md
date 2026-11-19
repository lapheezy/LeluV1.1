# M22.6 — REGRESSION AND RELEASE QUALIFICATION

**Date:** 2026-11-19
**Branch:** `freebuff/m22-6-voice-runtime-release-qualification` (from `8aa24ce1`)
**Verdict:** **No regression.** Every suite is green except the same two pre-existing/environmental failures M22.5 recorded. Voice acceptance remains blocked, so this is not a release approval.

---

## 1. Totals against the M22.5 baseline

| Suite | M22.5 baseline | M22.6 | Change |
|---|---|---|---|
| Full suite | 2273 tests · 2263 pass · 2 fail · 8 skip | **2286 · 2276 pass · 2 fail · 8 skip** | **+13 tests, +13 pass**, same 2 failures |
| New M22.6 tests | — | 13 (3 ASR provenance + 7 supersession + 3 mission scope) | all pass |
| Deterministic voice | 73 pass, 1 skip | **77 · 76 pass · 0 fail · 1 skip** | +3 ASR tests, 0 fail |
| Learning/execution targeted | 117/117 (M22.5 file set) | **73/73** (M22.6 file set: learning-provenance, conversation-memory, knowledge-supersession, asr-provenance, execution-evidence, execution-logging, execution-mission-scope, knowledge-relay-security, memory-model, memory-providers, memory-safety) | 0 fail |
| Controlled learning acceptance | 13/13 | **18/18** | +5 checks (ASR provenance, knowledge supersession, mission scope) |
| Typecheck | 2 errors | **0 errors** | fixed |
| Production build | not run in M22.5 | **pass** (22.22 s) | — |
| Lint | 0 errors, 175 warnings | **0 errors, 176 warnings** | no error; one warning-count drift, none in a changed file |

Full-suite arithmetic is exact: 2263 + 13 new = 2276. No test was removed, skipped or weakened.

## 2. The two failures, classified

### 2.1 `tests/genesis-interface.test.tsx` — pre-existing, undiagnosed

Fails as a whole file in ~2.2 s ("test failed" with no assertion detail). It failed identically at the M22.5 candidate and with the M22.5 source changes reverted, and it fails with M22.6 applied. Not in the buildmemory/voice path.

**Classification: pre-existing failure. Not fixed by this mission. Not hidden.**

### 2.2 `tests/sandbox-security.test.ts` → "network: TCP, UDP, DNS and fetch all fail" — environmental

```
AssertionError: The input did not match /^denied:/ . Input: ''
```

The test runs network probes inside the project sandbox and expects each to fail with `denied:`. In this container the probe produced no output at all, so the sandbox helper returned an empty string. The test's own header says the isolation depends on the host (`unshare -rn`); the container does not provide it.

**Classification: environmental. The assertion is correct and was left untouched.**

Nothing else failed. No snapshot was updated, no test file was edited, and no `skip`/`todo` was added.

## 3. Commands run

```bash
npx tsc -b --force                                   # exit 0
bun run build                                        # exit 0 (22.22 s)
npm run lint                                         # exit 0, 176 warnings
npm test                                             # 2286/2276/2/8 in 253 s
npx tsx --tsconfig tsconfig.test.json --import ./tests/support/ignore-css.mjs \
  --test --test-concurrency=1 tests/voice-*.test.ts tests/asr-provenance.test.ts
                                                     # 77/76/0/1
… tests/asr-provenance.test.ts … tests/memory-safety.test.ts
                                                     # 73/73/0/0
npx tsx .verify-learning-node.ts                     # 18/18
```

## 4. Release qualification matrix

| Gate | Status | Note |
|---|---|---|
| Typecheck | **VERIFIED** | 0 errors |
| Production build | **VERIFIED** | exit 0 |
| Lint | **VERIFIED** | 0 errors |
| Full regression | **VERIFIED (no new failures)** | 2 known failures remain |
| Learning integrity (G1–G4) | **VERIFIED** except live-model application | 18/18 acceptance; see G reports |
| Real speech → transcript | **PARTIALLY VERIFIED** | real audio, server broker; not a microphone |
| Live voice conversation | **BLOCKED** | no browser/hardware/TTS |
| Voice output | **BLOCKED** | no engine, no device |
| Voice performance | **PARTIAL** | STT latency measured; live latency unknown |
| Provider/environment readiness | **PARTIAL** | text + Whisper yes; LiveKit/Vox/ElevenLabs no |

## 5. Statement on test integrity

- New tests were **added** (13); none were deleted or relaxed.
- The two failing tests still fail; their assertions were not modified.
- The controlled acceptance uses real module code; only the IndexedDB implementation is polyfilled, and that is disclosed in [learning-retrieval-acceptance.md](learning-retrieval-acceptance.md).
- No mock was promoted to evidence of live audio.
