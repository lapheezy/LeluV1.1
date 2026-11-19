# MISSION 22.5 — RELEASE CANDIDATE VERIFICATION

**Date:** 2026-11-19
**Decision:** **BLOCKED — NOT APPROVED FOR CANONICAL PROMOTION** (see §10)

---

## 1. Branches and commits

| Item | Value |
|---|---|
| Canonical branch (workspace starting branch) | `integration/m16-3-wp05-reconciliation` |
| Canonical starting SHA | `543da7c8d7876258869d928648cffa913cd10649` |
| Remote canonical SHA at mission start | `543da7c8d7876258869d928648cffa913cd10649` — identical (verified with `git ls-remote origin`) |
| M22.5 branch that existed at mission start | **None.** No `MISSION-22.5` tree, no M22.5 commit; only `freebuff/m22-2-…` and `freebuff/m22-3-…` exist |
| Candidate branch | `m22.5/learning-integrity-candidate` (created from the canonical SHA, never force-pushed) |
| Verified implementation commit | `e481c2c4ca6f8421528b653d9b06646aad6bc9aa` |
| Final candidate commit | the immediate **child** of `e481c2c4` that adds this report and the other `MISSION-22.5/` evidence. It changes documentation only; its exact SHA is the branch head at delivery and is verifiable with `git ls-remote origin refs/heads/m22.5/learning-integrity-candidate` |
| Working tree | clean after the evidence commit (verified with `git status --porcelain`) |

### Note on the SHA field (stated rather than hidden)

A commit cannot contain its own SHA. The report therefore records the **verified implementation commit** exactly (`e481c2c4`) and identifies the candidate as its documentation-only child. The child's tree contains both the implementation and all evidence, so promoting the branch head promotes both. Anyone requiring a literal head SHA in this file should read the delivery receipt / `git ls-remote`; no other commit in the branch is a candidate.

---

## 2. Ancestry and preserved mission history

```
543da7c8  Replace the 2.1 hair shell with scalp-rooted volumetric locks   ← canonical / starting SHA
   │
   └─ e481c2c4  Carry provenance, keywords and corrections through LÉLU's one memory path
        │
        └─ <head>  Record M22.5 learning-integrity audit and candidate verification
```

- 700 commits are present in this (truncated/shallow) clone; base `f46cb9ae` *"Initial cloud project"*.
- The canonical branch was **not modified** at any point. No force-push, reset, rebase or history rewrite was performed.
- No prior mission commit was dropped: `543da7c8` is a direct ancestor.

---

## 3. Exact files changed

### 3.1 Implementation — `543da7c8..e481c2c4` (8 files, +520 / −16)

| File | Change |
|---|---|
| `src/brain/Brain.ts` | `learn` forwards intent/keywords/provenance; `rememberKnowledge`/`rememberSystem` accept provenance; knowledge context carries it |
| `src/brain/MemoryEngine.ts` | `LearnProvenance` input; provenance merged into create/reinforce/merge/supersede; corrections may match across categories (2-keyword guard) |
| `src/core/AIService.ts` | `consolidate(kind, summary, keywords, provenance?)` |
| `src/core/cognition/ObjectiveLearning.ts` | lessons persist lesson/objective identity and measured confidence |
| `src/core/memory/providers.ts` | local provider carries `attribution` |
| `src/core/router/ResearchResolver.ts` | knowledge memory records sources, query, count, retrieval time, `executionVerified: true` |
| `tests/learning-provenance.test.ts` | **new** — 3 deterministic tests |
| `verify/learning-integrity-acceptance.mjs` | **new** — real-browser acceptance harness |

### 3.2 Evidence — head commit (5 new files)

`MISSION-22.5/learning-integrity-audit.md`, `execution-recording-matrix.md`, `learning-retrieval-verification.md`, `provenance-and-scope-evidence.md`, `release-candidate-verification.md`.

**No unrelated change was introduced.** `package.json` and `bun.lock` were briefly modified by a tooling install and reverted before commit; `git status` is clean of them. No voice, LiveKit, VoxCPM, avatar or canonical file was touched.

---

## 4. Test suite results (all run in this container)

| Check | Command | Result |
|---|---|---|
| Full deterministic suite | `npm test` | **2273 tests, 2263 pass, 2 fail, 8 skipped**, 267 s |
| Learning/execution subset | 12 files, `tsx --test --test-concurrency=1` | **117/117 pass**, 0 fail, 0 skipped |
| Voice deterministic suites | 9 `voice-*` files | **74 tests, 73 pass, 0 fail, 1 skipped** |
| New provenance tests | `tests/learning-provenance.test.ts` | **3/3 pass** |
| Learning acceptance (module-level) | 13 checks | **13/13 pass** |
| Lint | `npm run lint` | **0 errors**, 175 pre-existing warnings |
| Typecheck | `npx tsc -b --force` | **FAIL** — 2 errors in `src/core/perception/FeatureUnderstanding.ts:455` |

### The two full-suite failures are pre-existing

Both reproduce **with this mission's six source files reverted** (`git stash` baseline run):

1. `tests/genesis-interface.test.tsx` — file-level `test failed` (2.4 s). Cause not diagnosed by this mission; unrelated to memory/execution code.
2. `tests/sandbox-security.test.ts` → "network: TCP, UDP, DNS and fetch all fail" — sandbox returned `''` instead of `denied:*`, i.e. host network-namespace behaviour, an environment dependency the test itself documents.

### The typecheck failure is pre-existing and unrelated

```
src/core/perception/FeatureUnderstanding.ts(455,20): error TS18047: 'landmarks.measurements.count' is possibly 'null'.
src/core/perception/FeatureUnderstanding.ts(455,20): error TS2365: Operator '<' cannot be applied to types 'string | number' and 'number'.
```

That file is untouched by this mission. It nevertheless means **`npm run build` cannot succeed at this commit**, which is a release gate in its own right.

---

## 5. Real voice acceptance results

**BLOCKED. Not run.** The mission's revised gate requires a live conversation with actual microphone input, audible output, multiple turns, interruption and recovery.

| Prerequisite | State |
|---|---|
| Headless browser | Playwright Chromium downloaded (114.7 MiB) but **cannot launch**: `error while loading shared libraries: libnspr4.so`; no root, stale apt sources, `libnspr4`/`libnss3` unavailable |
| LiveKit server | **Absent** (`livekit-server` not installed) |
| VoxCPM speech worker | **Absent** — no model, no GPU; worker requires ~11.5 GiB to load |
| Microphone / speaker hardware | **Absent** (cloud container) |
| Provider credentials (Groq Whisper / LLM) | **Absent** |
| Deterministic voice behaviour | 73/73 executed tests pass, 1 skipped |

The prior voice report (`LIVEKIT-VOICE-ACCEPTANCE-REPORT.md`) documents simulated-microphone success in a different container on **2026-11-13** at `claude/lelu-worker-recovery-4fio20`, not in this candidate. It cannot be carried forward as evidence for this commit. **No "voice works" claim is made here.**

---

## 6. Learning-integrity results

| Gate | Result |
|---|---|
| Work-package activity recorded | **Partial** — tasks, tools, decisions recorded; mission/branch/commit and test outcomes are not (documented gaps) |
| Agent and tool activity reconstructable | **Yes** — one execution identity, eight lifecycle stages, redacted reasons |
| Discoveries retain provenance | **Yes after repair** — source, attribution, `executionVerified`, research sources |
| Test outcomes distinct from implementation claims | **Partial** — completion verifier rejects unevidenced claims, but no task-level `tested`/`verified` state |
| Verified information persists | **Yes** — 13/13 acceptance checks, real store code |
| Knowledge retrievable and applicable later | **Yes at input level** — injected into a separate conversation's request; model use not measured |
| Unauthorized cross-conversation retrieval blocked | **Chat-scoped writes blocked (proven)**; multi-user isolation **untested**; user-global recall is by design |
| Corrections and supersession work | **Yes after repair** — one pattern, history retained, unrelated facts preserved |
| Voice-session records associated with the correct conversation | **Verified in code/tests** (`VoiceEngine` passes the active `conversationId`); transcripts lack source/confidence |
| No duplicate/competing learning subsystem | **Yes** — no new store, bus, logger or database; all repairs inside existing owners |

Full detail: [learning-integrity-audit.md](learning-integrity-audit.md), [learning-retrieval-verification.md](learning-retrieval-verification.md).

---

## 7. Known failures and limitations

1. **No M22.5 voice implementation exists in this repository.** The mission premise ("the completed M22.5 branch") does not match the tree; the latest commit was avatar hair work. This candidate contains learning-integrity work only.
2. Live microphone/speaker voice acceptance **not run** (§5).
3. `tsc -b --force` fails on a pre-existing perception type error; build is red.
4. Two full-suite tests fail pre-existing: `genesis-interface` (undiagnosed) and sandbox network isolation (host-dependent).
5. Repository/branch/commit and test-outcome recording are **absent** from the runtime learning ledger.
6. Knowledge memories do not supersede (conversation facts now do); a corrected knowledge item can coexist with its predecessor.
7. Voice transcripts carry no ASR source or confidence.
8. Live model application of retrieved knowledge was not measured; only context injection was.

---

## 8. Outstanding blockers

| Blocker | Needed to clear it |
|---|---|
| Real voice acceptance | Host with Chromium system libraries (or root to install them), LiveKit server, VoxCPM/GPU or ≥16 GiB worker, microphone/speaker, provider credentials |
| Build gate | Fix or explicitly baseline the `FeatureUnderstanding.ts` type error |
| Two suite failures | Diagnose `genesis-interface`; provide a host where sandbox network isolation behaves as the test assumes |
| Mission provenance | Add repository/branch/commit and test-outcome fields to the existing execution ledger (design change, not done here) |
| Multi-user isolation | Configure Supabase and run a two-account scope test |

---

## 9. Deployment / configuration requirements

None were exercised. The changes are in-process TypeScript and need no new service, binding, migration or secret. The browser harness requires a running dev server (default `http://127.0.0.1:5173`) and a launchable Chromium. The voice stack would additionally need the environment variables documented in `deploy/voice/README.md` and `ENV_VARS.md`; **no key or secret was read, written or committed by this mission**.

---

## 10. Decision

### BLOCKED — do not promote

L4 statuses considered:

- **RELEASE CANDIDATE APPROVED** — impossible: the live voice gate was not run, and the build does not compile.
- **CONDITIONALLY APPROVED** — not applicable: the unverified capability is the mission's primary gate, not a non-critical limitation.
- **NOT APPROVED** — partly true: the voice work does not exist in this tree.
- **BLOCKED** — selected: required hardware, services, browser libraries and credentials prevented acceptance.

**Is the latest commit safe to consider for canonical promotion? No.** The implementation commit `e481c2c4` is a genuine, tested improvement to learning provenance and correction handling, but it is not a completed M22.5 voice candidate, the build is red for a pre-existing reason, and real voice acceptance has not run. Production readiness is not claimed.

**Recommended next step:** keep `m22.5/learning-integrity-candidate` as the candidate reference for the learning work; run the full acceptance gate on a host with a working browser and voice stack; resolve the pre-existing type and test failures; only then produce a stamped candidate SHA and promote by fast-forwarding the canonical branch to it, preserving `543da7c8` as its ancestor.

---

## 11. Reproduction

```bash
# dependencies (lockfile is bun.lock; package-lock.json is stale)
bun install --frozen-lockfile

# learning/execution evidence
npx tsx --tsconfig tsconfig.test.json --import ./tests/support/ignore-css.mjs \
  --test --test-concurrency=1 tests/learning-provenance.test.ts \
  tests/objective-evidence.test.ts tests/execution-evidence.test.ts \
  tests/cognition-chat-integration.test.ts tests/memory-model.test.ts \
  tests/memory-safety.test.ts tests/authz-relationships.test.ts \
  tests/workflow-learning.test.ts tests/agent-cognition.test.ts \
  tests/conversation-memory.test.ts tests/interrupted-execution-policy.test.ts \
  tests/runtime-integration.test.ts

# full suite (expect 2263 pass / 2 pre-existing fail / 8 skip)
npm test

# real-browser acceptance (needs a launchable Chromium)
npx vite --host 0.0.0.0 --strictPort --port 5173
node verify/learning-integrity-acceptance.mjs

# exact SHAs
git rev-parse HEAD
git ls-remote origin refs/heads/m22.5/learning-integrity-candidate refs/heads/integration/m16-3-wp05-reconciliation
```
