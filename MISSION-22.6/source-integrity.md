# Source and branch integrity

## What was found before any change

| Item | Value | How it was checked |
|---|---|---|
| Working tree at start | clean | `git status --porcelain` returned nothing |
| HEAD at start | `12d2407` "Record M22.5 mission commit hashes" | `git log --oneline -8` |
| M22.5 implementation commit | `42a3606` "Leave proof of a deletion, then clean what still quotes it" | same log |
| M22.5 hash-record commit | `12d2407` | same log |
| M22.5 remote ref | `refs/heads/freebuff/m22-5-historical-memory-residue` = `12d24071bc318b2153ad64e6d49bb218b39c2713` | `git ls-remote --heads origin` — **identical to local HEAD** |
| M22.5 evidence | `MISSION-22.5/` present, unmodified | `ls`, later `git status` |
| M22.4 baseline | `e7521b9` (branch `freebuff/m22-4-memory-deletion-browser-verification`) | local branch list, remote ref `e7521b9a62f7e9118fd6ccce1567c6c15d8b8fa8` |
| Canonical branch | `main` = `44bdd936892bc989b6b59fd5ecfb9502747e6a58` | `git merge-base --is-ancestor`: `main` **is** an ancestor of `12d2407` |
| Integration branch | `integration/m16-3-wp05-reconciliation` = `543da7c8d7876258869d928648cffa913cd10649` | merge-base with M22.5 is `aa8b1bd`; `12d2407` is **not** an ancestor of it |

### The canonical-branch finding, stated plainly

There are two long-lived lines. The M22 lineage descends from `main`
(`44bdd93`). The integration branch has its own history (`aa8b1bd`) and does
**not** contain M22.4 or M22.5. So:

- `main` is the lineage this work extends;
- `integration/m16-3-wp05-reconciliation` cannot receive M22.6 by fast-forward —
  it would need a merge or a cherry-pick, which this mission is **not authorised**
  to perform;
- no merge, no pull request, no rewrite, no canonical push was made.

This is recorded as a promotion caveat, not a defect: the user requested an
isolated branch and independent verification, and that is what exists.

## The isolated branch

```
baseline commit : 12d2407
branch          : m22.6/memory-integrity-deletion-propagation
created with    : git branch m22.6/... 12d2407   (no working-tree carry-over)
```

`freebuff/m22-5-historical-memory-residue` and all M22.4/M22.5 evidence remain
untouched and independently recoverable. The M22.6 branch is the only branch
that received commits from this mission.

## What changed, by file

New:

- `src/core/memory/DeletionGuard.ts`
- `src/core/memory/MemoryHealing.ts`
- `tests/memory-integrity.test.ts`
- `MISSION-22.6/` (this evidence package)

Extended:

- `src/core/memory/DeletionLedger.ts` — index builder, `recordMany`, `discard`,
  `signature`, throwing writes.
- `src/core/memory/ResidueMigration.ts` — report v2, cursor validation,
  per-project isolation, write-failure honesty, dispositions store, preview
  stripping, single-pass index, no per-project store re-read.
- `src/brain/Brain.ts` — fingerprint-before-removal, conversation + reset
  tombstones, `memoryIds`.
- `src/brain/PatternMemory.ts` — recall filter, machine-write refusal,
  tombstoned-id restore refusal, `previewForgetByConversation`.
- `src/core/cognition/CognitiveContext.ts` — checkpoint/name/self-model scrub.
- `src/core/MemoryBridge.ts` — context gate + dialogue-turn gate.
- `src/core/cognition/ProjectIntent.ts`, `CognitiveLoop.ts`, `OutcomeDerivation.ts`,
  `src/core/cosmos/CosmosInspector.ts` — checkpoint text scrubbed at the four other
  places it becomes an objective, proposal, evidence step or scene description.
- `src/core/Bootstrap.ts` — `memory-integrity` step (scheduled, non-blocking).
- `src/core/AIService.ts` — integrity status, heal-now, cloud-mirror delete.
- `src/core/persistence/SupabasePersistence.ts` — `forgetMemory(id)`.
- `src/app/scene/genesis/GenesisMemoryPanel.tsx` — automatic-healing line and an
  honest message when a deletion could not be recorded.

Not touched: `docs/missions/MISSION-22.4-*.md`, `docs/missions/MISSION-22.5-*.md`,
`MISSION-22.4/`, `MISSION-22.5/`, and every test that existed before this mission.

## Commit discipline

Commits are made on `m22.6/memory-integrity-deletion-propagation` only, and the
remote ref is verified with `git ls-remote` after pushing (see `commit.txt`).
