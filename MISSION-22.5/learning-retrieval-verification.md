# MISSION 22.5 — LEARNING AND RETRIEVAL VERIFICATION

**Date:** 2026-11-19
**Verified code commit:** `e481c2c4ca6f8421528b653d9b06646aad6bc9aa`
**Subject:** a controlled, non-sensitive discovery carried through LÉLU's real memory path.

---

## 1. The controlled test

| Element | Value |
|---|---|
| Test discovery | `ORCHID-<nonce>` — "My project verification marker is the discovery code ORCHID-…, recorded from the voice-pipeline audit." |
| Chat-scoped control | `VIOLET-<nonce>` — prefixed "For this chat only, …" |
| Correction control | studio `Aurelia<nonce>` + "rose gold", corrected to "platinum, not rose gold" |
| Non-sensitive | invented codenames; no user data, credential or audio |
| Recording path | `MemoryBridge.learn` (the existing post-turn consolidation path) → `Brain.learn` → `MemoryEngine` → `PatternMemory` → `IndexedDBStore` |
| Retrieval path | `Brain.recall` and `MemoryBridge.enrich` (the existing pre-generation path) |
| Separate later task | a newly created conversation with a different id, requested after the first store was discarded |

Nothing in the test writes with a special API. It uses the same methods a normal turn uses.

---

## 2. Commands and raw results

### 2.1 Deterministic suite (repository test)

```bash
npx tsx --tsconfig tsconfig.test.json --import ./tests/support/ignore-css.mjs \
  --test tests/learning-provenance.test.ts
```

```
✔ a caller's provenance is stored with the fact, not dropped
✔ supplied keywords are stored and can carry a later recall
✔ a correction supersedes, keeps history, and records its own provenance
ℹ tests 3  pass 3  fail 0
```

This test substitutes only the disk (`InMemoryPatterns`), not the engine. It exists because the previous provenance test stubbed `Brain.learn`, which proved the bridge *computed* provenance and never that anything stored it.

### 2.2 Full learning/execution set

```bash
npx tsx --tsconfig tsconfig.test.json --import ./tests/support/ignore-css.mjs \
  --test --test-concurrency=1 \
  tests/learning-provenance.test.ts tests/objective-evidence.test.ts \
  tests/execution-evidence.test.ts tests/cognition-chat-integration.test.ts \
  tests/memory-model.test.ts tests/memory-safety.test.ts \
  tests/authz-relationships.test.ts tests/workflow-learning.test.ts \
  tests/agent-cognition.test.ts tests/conversation-memory.test.ts \
  tests/interrupted-execution-policy.test.ts tests/runtime-integration.test.ts
```

```
ℹ tests 117  pass 117  fail 0  skipped 0
```

### 2.3 Controlled acceptance run (real modules, real store code)

The committed browser harness is `verify/learning-integrity-acceptance.mjs`. It could **not** launch in this container: the Playwright Chromium build requires `libnspr4`/`libnss3` and there is no root to install them (`error while loading shared libraries: libnspr4.so`). That is an environment blocker, not a test result.

The identical scenario was therefore run against the same modules with a spec-compliant IndexedDB implementation (`fake-indexeddb`) supplied as the global. It exercises `IndexedDBStore` for real; it does not exercise the browser's IndexedDB engine, and is labelled accordingly.

```bash
npx tsx .verify-learning-node.ts        # harness kept out of the commit (undeclared optional package)
```

Raw output (nonce `NMWO1WN9T`):

```
PASS  the discovery is captured into long-term memory — category=project
PASS  the source of the discovery is preserved — source=lelu-chat
PASS  an unmeasured statement is stored as unverified — executionVerified=false
PASS  a chat-scoped statement is not made long-term memory — patterns=1
PASS  a correction supersedes instead of duplicating — 1 matching pattern(s)
PASS  the correction is the stored answer — Actually, correct that: I work in platinum now, not rose gold. (Superseded earlier statement, kept …)
PASS  the superseded value is kept in history — history=1
PASS  facts the correction did not mention survive it — studio=true
PASS  the discovery survives a fresh Brain instance (real store code) — recalled=1
PASS  it reaches the model request of a later, separate conversation — conversation=4b8a4857-… memories=1
PASS  cross-chat content is labelled rather than silently reused — labelOtherChats present
PASS  the execution stages are all representable — requested/started/succeeded/failed/timed-out/refused/suppressed
PASS  credentials are redacted from execution text — failed with Bearer [redacted] and api_key=[redacted]

13/13 checks passed
```

---

## 3. What each check establishes

| Check | Establishes | Does not establish |
|---|---|---|
| capture | the fact enters long-term memory through the ordinary path | that a model chose to store it |
| source / unverified | provenance and claim-status are **durable**, not computed and dropped | that a downstream prompt respects them (no live model) |
| chat-scoped | a scoped statement never becomes user-global memory | deletion of a pre-existing memory (not requested) |
| correction | one pattern remains, the correction is the answer | that every conceivable phrasing is caught |
| history | the superseded value is preserved | an audit-grade append-only ledger |
| unrelated facts survive | supersession is not deletion | — |
| fresh instance | persistence is real, not process memory | browser IndexedDB behaviour (polyfill used) |
| separate conversation | retrieval is not tied to the recording turn | that a model used it correctly |
| injected | the exact fact reached `request.context` for that turn | that it influenced the reply |
| execution stages | all eight states are representable/validated | that tests/browser acceptance produce a state |
| redaction | credentials do not survive into execution text | that no secret can ever be echoed by a provider |

---

## 4. Why the correction fix was necessary

Before the repair, the real extractor categorised:

- `"My studio is called Aurelia and I work exclusively in 18k rose gold."` → `general`
- `"Actually, correct that: I work in platinum now, not rose gold."` → `experience`

`MemoryEngine.findExisting` required the **same category**, so the correction could never match the fact it corrected. The result was **two competing patterns**: the stale rose-gold fact and the new platinum fact, both retrievable. The engine's own header promises "corrections supersede"; measured, it only did so when the extractor happened to agree.

The repair lets a correction (and only a correction) match across categories, requiring two shared keywords to avoid merging unrelated memories. The controlled run now finds exactly **one** matching pattern, with the old value in `context.history`.

---

## 5. Scope isolation: what was and was not proven

| Scope question | Result |
|---|---|
| Does "for this chat only" stay out of long-term memory? | **Proven** — not persisted, so it cannot be recalled by any chat |
| Does a fact recorded in chat A reach chat B's model request? | **Yes, by design** — long-term memory is user-global; `labelOtherChats` labels content quoted from another chat and instructs LÉLU to name its origin |
| Is cross-chat *retrieval* consent-gated? | Partially — `CrossChatResolver` records an authorization (`linked`/`project`/`asked`) for carried messages; `RelationshipStore` governs shared authz; this mission did not exercise the consent flow end to end |
| Can an unrelated user's memory leak in? | Not tested — this is a single-user local store in this environment; Supabase isolation was not available |
| Is a chat-scoped statement retrievable if the engine is asked directly? | No — it was never written |

The distinction matters: **memory scope is a write-time control plus provenance labelling**, not a per-record conversation filter. Treating that as "unauthorized cross-conversation retrieval is blocked" would overstate the evidence.

---

## 6. Reproducing the full acceptance

1. Install dependencies from the committed lockfile: `bun install --frozen-lockfile`.
2. On a host with a working Chromium (or run `npx playwright install --with-deps chromium` as root):
   ```bash
   npx vite --host 0.0.0.0 --strictPort --port 5173
   node verify/learning-integrity-acceptance.mjs
   ```
   Optional: `LEARNING_NONCE=M22D5` for a fixed, readable codename.
3. The harness prints one `PASS`/`FAIL` line per capability and exits non-zero on any failure.

In this container the browser branch is **blocked**; the equivalent module-level run is section 2.3, with the polyfill caveat stated there.
