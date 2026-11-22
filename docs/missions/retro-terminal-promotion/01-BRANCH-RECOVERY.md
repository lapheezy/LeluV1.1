# 01 · Branch recovery

Mission 22.12, Retro Terminal canonical promotion. All refs were fetched from `origin` before any change.

## Heads at the start

| Ref | Commit | Verified |
|---|---|---|
| `integration/lelu-four-workforce-consolidation` (canonical, remote) | `904d254bc5233f9129dbbbaab3024cefc877488a` | Matches the stated baseline `904d254` |
| canonical, local | none at the start; created from `origin/…` at `904d254` | — |
| `claude/sharp-knuth-l3d7i3` (Retro Terminal source) | `1ff382995bff220cf15bb9f5cf6583dad6fbdcde` | Matches the stated source `1ff3829` |
| `claude/cosmos-integration-audit-t9ouny` (audit checkpoint) | `b291a885921c09d630a70f8dbc8b4d814ff3eb7c` | Matches the stated checkpoint `b291a885` |

## Ancestry

- **Retro Terminal.** `merge-base(canonical, source)` is `904d254`, which is the canonical head. The source is exactly one commit ahead: `1ff3829` ("Retro Terminal: a customizable Infinite Cosmos layout with the Terminal Appearance Studio"). Canonical has no commits that the source lacks. No later source commits exist.
- **Audit branch.** `merge-base(canonical, audit)` is `6bf290e`, which is older. The audit branch is built on the M15.3 line (`f290716` and its ancestors). That line is **not** in canonical: canonical has 45 commits the audit branch lacks, and the audit branch has about 37 that canonical lacks. Only two of them belong to the audit:
  - `7510070`: the code. It covers first-paint sky, navigation reaching the camera, one flight at a time, two tests and a browser harness.
  - `b291a88`: the full-suite figure in the report.
- **Audit files on canonical.** The four source files the audit touches are byte-identical on canonical and on the audit's parent `f290716`, except `CosmosLayer.tsx`. There, canonical has 22 more lines: the placement-hazards effect (`CosmosObjectStore.setHazards`) from M17.3.

## Integration strategy

1. **Checkpoint.** The local tag `checkpoint/m22.12-pre-promotion-904d254` was set on `904d254`. Both source branches stay untouched on `origin`.
2. **Retro Terminal.** A fast-forward of canonical to `1ff3829` (`git merge --ff-only`). This is the exact verified commit with no rewrite, and its history is preserved.
3. **Camera-following navigation.** Only `7510070` was cherry-picked (`-n`). The M15.3 line underneath it was not merged; that would be an unrelated, unreviewed promotion. `CosmosLayer.tsx` auto-merged and keeps canonical's hazards effect (verified at lines 15 and 739). `b291a88` changes only the audit report's test count, and the report is carried as is.
4. On top of that, the promotion's own corrections (WP03–WP05) went in as one integration commit.
