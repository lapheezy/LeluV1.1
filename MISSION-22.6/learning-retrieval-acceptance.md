# M22.6 — LEARNING RETRIEVAL ACCEPTANCE (G4)

**Date:** 2026-11-19
**Result:** **18/18 checks passed** against the real `Brain`, `MemoryBridge`, `MemoryEngine`, `PatternMemory` and `IndexedDBStore` code, with a spec-compliant IndexedDB implementation standing in for the browser's.
**Caveat, stated up front:** the browser harness could not launch here, so this is not a real-IndexedDB run. It is the strongest run the environment permits, and it is not presented as browser acceptance.

---

## 1. Method

Unique, non-sensitive markers (`ORCHID-<nonce>`, `VIOLET-<nonce>`, `Aurelia<nonce>`) are moved through the ordinary paths:

- record: `MemoryBridge.learn` (the post-turn consolidation path)
- store: `Brain.learn` → `MemoryEngine` → `PatternMemory` → `IndexedDBStore`
- retrieve: `Brain.recall`, then `MemoryBridge.enrich` for a **new conversation**
- correct: a second natural-language correction
- knowledge: `Brain.rememberKnowledge` twice (original, then correction)

No test-only write API is used.

## 2. Results

| # | Check | Observed |
|---|---|---|
| 1 | The discovery is captured into long-term memory | category `project` |
| 2 | The source of the discovery is preserved | `source=lelu-chat` |
| 3 | An unmeasured statement is stored as unverified | `executionVerified=false` |
| 4 | The recogniser that produced a spoken turn is preserved | `transcriptSource=groq-whisper` |
| 5 | A chat-scoped statement is not made long-term memory | no pattern contains it |
| 6 | A correction supersedes instead of duplicating | 1 matching pattern |
| 7 | The correction is the stored answer | starts "Actually, correct that: I work in platinum…" |
| 8 | The superseded value is kept in history | history ≥ 1 |
| 9 | Facts the correction did not mention survive it | studio name present |
| 10 | A corrected knowledge item replaces the stale one | 1 knowledge pattern |
| 11 | The knowledge correction is what is stored | "…FIELDGLASS, not FIELDNOTE." |
| 12 | The knowledge correction keeps its own provenance | `source=agent:researcher` |
| 13 | The superseded knowledge value is kept in history | history ≥ 1 |
| 14 | The discovery survives a fresh Brain instance | recalled from store |
| 15 | It reaches the model request of a later, separate conversation | injected into `request.context`, different conversation id |
| 16 | All execution stages are representable | 7 stages validated |
| 17 | A declared mission and commit ride on an execution record | `mission=M22.6 commit=<nonce>` |
| 18 | Credentials are redacted from execution text | `Bearer [redacted]`, `api_key=[redacted]` |

Run: `npx tsx .verify-learning-node.ts` (harness kept out of the commit because it needs an undeclared optional package). Deterministic equivalents are committed: `tests/learning-provenance.test.ts` (3), `tests/asr-provenance.test.ts` (3), `tests/knowledge-supersession.test.ts` (7), `tests/execution-mission-scope.test.ts` (3).

## 3. The eight G4 requirements

| Requirement | Status | Evidence |
|---|---|---|
| 1. Record meaningful work | **VERIFIED** | checks 1, 4; existing execution ledger |
| 2. Preserve provenance | **VERIFIED** | checks 2, 3, 4, 12, 17 |
| 3. Distinguish facts from inference | **VERIFIED** | `executionVerified`, `source`, lesson confidence; claim redaction in `MemoryBridge` |
| 4. Retrieve in a later authorized task | **VERIFIED** | checks 14, 15 |
| 5. Apply correctly | **PARTIAL** | the exact fact reaches the model request; no live model was called to show it influenced a reply |
| 6. Respect project/conversation boundaries | **PARTIAL** | chat-scoped writes blocked; user-global recall by design; multi-user isolation untested |
| 7. Correct or supersede outdated information | **VERIFIED** | checks 6–13 |
| 8. Avoid claiming unverified work was completed | **VERIFIED (unit)** | `CompletionVerifier` rejects unevidenced `DONE:`; `executionVerified` records the difference |

## 4. What is still not demonstrated

- Browser IndexedDB persistence (harness existed; Chromium would not start).
- A model actually **using** the retrieved fact in a reply (no live browser turn; would need a provider call through the UI, which is not the same as unit-testing injection).
- Two-user isolation (Supabase not configured).
- Deletion of a memory after supersession.

These are listed as gaps in the release report; none is counted as a pass.
