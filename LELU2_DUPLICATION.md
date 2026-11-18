# LÉLU 2 — duplication manifest

LÉLU 2 is an independent working copy of the LÉLU project. It exists so that
geometric-intelligence experiments can be built, measured and committed **without
touching Claude's active LÉLU work**.

## Isolation

| | |
|---|---|
| Source repository | `lapheezy/LeluV1.1` |
| Source branch | `claude/mission5-lelu-asre-integration-mm6xau` |
| **Source HEAD (recorded)** | `55c89aae19de00251478438346e4a8a6a3d16be8` |
| Source HEAD subject | `docs(lelu): record the fidelity pass and what still does not match` |
| LÉLU 2 branch | `experiment/lelu-2-golden-geometry` |
| LÉLU 2 working directory | `lelu2/` — a linked Git worktree of the same object store |
| LÉLU 2 first commit parent | `55c89aae` (the branch starts exactly at the source HEAD) |

Isolation method:

```bash
git worktree add --detach lelu2 55c89aae19de00251478438346e4a8a6a3d16be8
cd lelu2 && git checkout -b experiment/lelu-2-golden-geometry
```

A linked worktree, not a copy, because:

* Claude's branch, index, working files and generated assets are never checked
  out, reset or written by anything done here;
* the object store is shared, so the duplicate costs ~17 MB of checkout instead
  of a 3 GB second clone, and **no commit of Claude's is ever re-written**;
* LÉLU 2 gets its own HEAD, its own index and its own commit history.

What is shared, deliberately:

* the Git object database (`/workspace/repo.git`) — read-only for us;
* `lelu2/node_modules` is a symlink to the existing dependency tree, so the app,
  Three.js (0.185.1) and the TypeScript toolchain are not duplicated or upgraded.

What is independent:

* every file, generated asset and commit on `experiment/lelu-2-golden-geometry`;
* `artifacts/lelu2/**` (all experiment output);
* `research/sources/**` (acquired upstream repositories, git-ignored).

## Proof the original was not modified

Recorded at duplication time and re-checkable:

```bash
# Claude's branch tip and tree, unchanged:
git -C lelu2 rev-parse claude/mission5-lelu-asre-integration-mm6xau^{commit}
#   => 55c89aae19de00251478438346e4a8a6a3d16be8
git -C lelu2 status --short            # on experiment/… : only LÉLU 2 files
git -C .. log --oneline -1 claude/mission5-lelu-asre-integration-mm6xau
```

No LÉLU 2 commit has `claude/mission5-lelu-asre-integration-mm6xau` as its
parent other than its first commit, and that first commit *is* the source HEAD.

## Inventory of the duplicated baseline

| Area | Tracked files | Notes |
|---|---|---|
| `src/core/asre/**` | part of 981 | her identity, spec, component pipeline, reference provider |
| `scripts/asre/**` | part of 215 | canon build, IoU test, Blender render harness |
| `leluverse/assets/characters/lelu_character/**` | part of 173 | identity.json, 25 reference sheets, wardrobe inventory |
| `services/asre-reconstruct/**` | — | Blender render script used by the render harness |
| `tests/**` | 264 | project test runner (`tsx --test tests/*.test.ts`) |

Not duplicated (regenerable, git-ignored upstream): `node_modules/`,
`resources/cc0/**` (785 MB CC0 library, fetched by `scripts/asre/fetch-cc0.mjs`),
`artifacts/asre/**/*.glb`.

## Checkpoints

Every milestone on this branch is a commit, and each commit is pushed so the work
survives a lost session. See `artifacts/lelu2/report.md` for the milestone list
and the measured results behind each one.
