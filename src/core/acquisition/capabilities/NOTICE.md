# Acquired capability — fuzzy text search

| Field | Value |
| --- | --- |
| Source | [krisk/Fuse](https://github.com/krisk/Fuse) |
| Commit | `edf2fb608eca0461508d1d71317e6e58309ffada` (v7.6.0-beta.0) |
| License | Apache-2.0 — full text in `LICENSE-Apache-2.0.txt` |
| Acquired | through LÉLU's repository acquisition runtime (`/api/acquisition`) into an isolated workspace |
| Adapted by | Repo Executor, Mission 7 |

## Files adapted

From the source repository's `src/search/bitap/`:

- `index.ts` — `BitapSearch` → `BitapMatcher`
- `search.ts` — the Bitap scan
- `computeScore.ts` — edit-distance/proximity score formula
- `constants.ts` — `MAX_BITS = 32`
- `createPatternAlphabet.ts` — pattern bit mask
- `convertMaskToIndices.ts` — matched ranges

## Changes

1. Ported from Fuse's default exports and global `Config` singleton into one
   dependency-free, strict-TypeScript module with per-call options.
2. LÉLU additions (not present in Fuse, marked in the source):
   tokenised multi-field `fuzzySearch` and `highlightMatch`.
3. Diacritic folding uses `String.prototype.normalize("NFD")` rather than
   Fuse's lookup table.
4. The Bitap algorithm, chunk splitting above 32 characters, match mask
   handling and score formula are unchanged.

## Why this capability

LÉLU's technology knowledge base and capability search had no ranking: a
query either matched a stored string exactly or found nothing. Acquisition
of Fuse's Bitap matcher gives approximate, typo-tolerant ranking that runs
entirely locally (no provider, no network) over the tens to thousands of
records the knowledge base is expected to hold.

Apache-2.0 obligations satisfied: copyright/licence text retained here and
in `LICENSE-Apache-2.0.txt`; modifications stated above.
