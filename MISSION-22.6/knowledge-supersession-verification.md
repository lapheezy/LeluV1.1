# M22.6 — KNOWLEDGE SUPERSESSION VERIFICATION (G3)

**Date:** 2026-11-19
**Status:** **VERIFIED** for knowledge and conversation facts, including corrections whose extractor category differs. Deletion after supersession was **not exercised** (no delete path was called).

---

## 1. The defect

Two separate problems existed; M22.5 fixed only the first.

1. **Conversation facts:** a correction categorised differently from the original (e.g. `general` → `experience`) could not match it, so the stale fact and its correction both remained. Fixed in M22.5 by allowing corrections to match across categories with two shared keywords.
2. **Knowledge items:** `Brain.persistLayer` was append-only. It de-duplicated *identical* text and otherwise added a new pattern, so a corrected discovery permanently coexisted with the stale one and both were retrievable. **Fixed in M22.6.**

## 2. The rule now applied

`findKnowledgeToSupersede(candidates, incoming)` (exported from `src/brain/Brain.ts`, pure) selects an existing item only when **all** hold:

- the new write is phrased as a correction (`looksLikeCorrection`, the same marker set the conversation engine uses) **or** is explicitly flagged with `supersedes: true` **or** carries a `supersedesKey`;
- the candidate has the **same memory type** (`knowledge`/`system`) and **same category**;
- the content is not identical (identical text stays on the de-duplication path);
- and either **two shared keywords** (after lower-casing, ignoring words ≤ 3 chars) **or** the same explicit `supersedesKey`;
- the identity seed (`lelu-identity-foundation`) is never selected.

When selected, `persistLayer` updates that pattern in place:

- `response` becomes the correction, `prompt` its first 120 chars;
- old text is appended to `context.history` (last 8) and `context.corrected` is stamped;
- the new provenance is merged (`source`, `attribution`, `supersedesKey`, …);
- keywords and importance are unioned/maxed; confidence is reset to 1; `updatedAt` moves.

Unrelated facts are therefore added alongside, never merged, and the old value is preserved as history rather than deleted.

## 3. Tests

`tests/knowledge-supersession.test.ts` — **7/7 pass**:

1. a correction replaces the knowledge item it corrects;
2. a correction with only one shared word is not treated as the same fact;
3. an explicit shared `supersedesKey` is enough on its own;
4. without a correction marker or explicit flag, nothing is superseded (an addition is not a correction);
5. a system memory never supersedes a knowledge one;
6. the identity seed is never replaced;
7. identical text is left to ordinary de-duplication.

Conversation corrections remain covered by `tests/learning-provenance.test.ts` and `tests/conversation-memory.test.ts`.

## 4. Controlled acceptance (real store code)

Four checks in the M22.6 acceptance run, against the real `Brain`/`PatternMemory` with an IndexedDB polyfill:

| Check | Observed |
|---|---|
| a corrected knowledge item replaces the stale one | **1** knowledge pattern (was 2 before the repair) |
| the knowledge correction is what is stored | `Correction: the archive migration target is FIELDGLASS, not FIELDNOTE.` |
| the knowledge correction keeps its own provenance | `source=agent:researcher` |
| the superseded knowledge value is kept in history | history length ≥ 1 |

Combined conversation checks in the same run: one pattern after correction; `platinum` is the answer; `Aurelia<nonce>` (unmentioned by the correction) survives; history retained.

## 5. Matrix against the mission's requested cases

| Case | Result |
|---|---|
| Same-category correction | PASS (conversation + knowledge) |
| Different-category correction | PASS (M22.5 fix; covered by `learning-provenance` and the acceptance run) |
| Contradictory facts | PASS — correction wins, old text kept in history |
| Unrelated facts | PASS — no shared-two-keyword match ⇒ added separately |
| Repeated observations | PASS — identical text de-duplicated; lessons count observations separately |
| Explicit user correction | PASS — correction markers |
| Agent-derived correction | PASS — `supersedes: true` + `supersedesKey` (provenance `agent:researcher` verified) |
| Supersession retrieval | PASS — retrieving returns the corrected single item |
| Deletion after supersession | **NOT VERIFIED** — no delete was requested or invoked in this mission |

## 6. Honest limits

- Keyword overlap is lexical, not semantic. A correction that shares fewer than two words and names no key will be stored as a new item. That is a deliberate false-negative bias: wrongly merging unrelated knowledge is worse than keeping two items.
- `persistLayer` searches via `PatternMemory.search`, whose scoring is word-overlap based; a correction with entirely new vocabulary may not surface its target.
- There is no embeddings-based contradiction detector, and none was invented.
