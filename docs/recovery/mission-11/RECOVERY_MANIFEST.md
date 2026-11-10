# Mission 11 — Recovery Manifest

**Repository:** `lapheezy/LeluV1.1`
**Consolidated:** 2026-11-10
**Maintained branches:** `main`, `integration/lelu-four-workforce-consolidation`

This manifest is the recovery archive for every branch retired by Mission 11. It records
the SHA of every branch tip examined, how each branch was reconciled, and where any
content that is not carried at its original path can still be recovered.

Machine-readable inventory of all 125 refs (51 remote + 74 local):
[`branch-inventory.tsv`](./branch-inventory.tsv).

---

## 1. Target branches at consolidation

| Branch | SHA at start | SHA at end | Rule |
| --- | --- | --- | --- |
| `main` | `44bdd936892bc989b6b59fd5ecfb9502747e6a58` | unchanged | Canonical production. Not rewritten, not force-pushed, no new commits. |
| `integration/lelu-four-workforce-consolidation` | `9558b7c8b5eb1e6b4a37fa04974787e7b07b3524` | see section 6 | Unified development and integration branch. |

`main` is a strict ancestor of the integration branch (0 commits ahead, 471 behind at the
start), so every production commit is contained in the integration branch. Nothing on
`main` was rewritten or reordered.

## 2. Method

Every branch was examined with the same three tests, in this order:

1. **Ancestry** — `git rev-list --count integration..branch`. Zero means the branch is
   already fully contained; it contributes nothing new and is safe to retire.
2. **Patch equivalence** — `git cherry integration branch`. A `-` line means the commit's
   patch is already present under a different SHA (the "replay onto canonical" pattern
   this repository uses). A branch whose every commit is `-` is superseded.
3. **File-level absence** — for the remaining branches, every path changed on the branch
   side (`git diff integration...branch`) was checked against the integration tree with
   `git cat-file`. Any path present on the branch and absent from the integration branch
   is a candidate for lost work.

A branch was retired only when one of these held:

- it is an ancestor of the integration branch, or
- every unique patch is already present (equivalent replay), or
- every file it contributes already exists in the integration branch (the newer
  implementation was retained), or
- its unique files are preserved in this archive.

No branch was retired on the basis of its name, its age, or its similarity to another
branch.

## 3. Branch lineage map

### 3.1 Claude — acceptance and mission chain

Linear chain, each branch containing its predecessor. All work in this chain was later
replayed onto canonical (`2ecfe4a`, "Connect environment orchestration to canonical
cognition instead of merging an older branch"), which is why the integration branch
carries newer implementations of the same subsystems.

| Branch | Tip SHA | Disposition |
| --- | --- | --- |
| `claude/mission-2-15-spatial-world` | `5daaf69` | superseded (files present) |
| `claude/mission-2-15-1-closure` | `febc5fa` | superseded (files present) |
| `claude/mission-2-15-2-mobile-spatial-closure` | `78815d2` | superseded (files present) |
| `claude/mission-2-15-3-renderer-mobile-validation` | `e618923` | superseded (files present) |
| `claude/mission-2-15-4-mobile-presenter-integration` | `0af24d7` | superseded (files present) |
| `claude/mission-2-15-5-mobile-placement-closure` | `6f0ebb6` | superseded (files present) |
| `claude/mission-2-15-6-mobile-interaction-restoration-closure` | `19ee1fc` | superseded (files present) |
| `claude/mission-5-2-acceptance-evidence` | `47785f4` | superseded (files present) |
| `claude/mission-5-2-acceptance-completion` | `68fd4f9` | superseded (files present) |
| `claude/mission-5-3-spatial-completion` | `47785f4` | superseded (files present) |
| `claude/mission-5-4-spatial-interaction` | `fff0f86` | superseded (all patches present) |
| `claude/mission-5-4b-10-spatial-hardening` | `c7ef650` | superseded (all patches present) |
| `claude/mission-5-4b-11-canonical-integration` | `1569f57` | integrated (ancestor) |
| `claude/mission-5-5-autonomy-activation` | `5619efd` | integrated (ancestor) |
| `claude/mission-5-6-live-autonomy-completion` | `59f9137` | integrated (ancestor) |
| `claude/mission-5-7-provider-resilience-autonomy` | `0b89f54` | integrated (ancestor) |
| `claude/mission-5-8-provider-capability-truthfulness` | `cd0cf3b` | integrated (ancestor) |
| `claude/mission-5-9-live-tool-calling` | `cd0cf3b` | integrated (ancestor) |
| `claude/mission-3-1-live-chat-recovery` | `476a031` | superseded; **51 evidence files restored** |
| `claude/mission-3-2-live-model-tool-execution` | `2690408` | superseded; **65 evidence files restored** |
| `claude/mission-3-3-live-continuity` | `de2687e` | superseded; **81 evidence files restored** |
| `claude/mission-3-4-surface-rendering` | `3e1f4e4` | superseded; **105 evidence files restored** |
| `claude/live-autonomous-activation` | `a2f0e03` | superseded; **13 evidence files restored** |

The mission-3 evidence was the only content in this chain missing from the integration
branch. It is restored at its canonical paths in commit `727ed6a`; the source changes in
the same branches are superseded by the newer canonical implementations
(`EnvironmentOrchestrationEngine`, `EnvironmentTools`, `ToolRegistry`) and were not
re-applied over them.

### 3.2 Claude — master integration and autonomy

| Branch | Tip SHA | Disposition |
| --- | --- | --- |
| `claude/master-integration` / `mission6-canonical-integration` | `fd649b9` | integrated (ancestor) |
| `claude/autonomy-closure` | `a5cfd05` (remote `df11b50`) | integrated (ancestor) |
| `claude/autonomy-closure-consolidated` / `claude/m52-acceptance-completion` | `eb70c98` / `68fd4f9` | integrated (ancestor) |
| `claude/unified-canonical-integration` | `7345ad6` | superseded (files present) |
| `claude/unified-mobile-orchestration-integration` | `7c4a373` | integrated (ancestor) |
| `claude/avatar-3d-world` | `616f251` / local `01c081c` | integrated (ancestor) |
| `claude/open-session-rbwmdw` | `e7b667b` | integrated (ancestor) |
| `claude/open-session-rbwmdw-4210273077145561833` | `b7c2ea0` | superseded (files present) |
| `claude/evolution-board-truthful-status` | `7f912ff` | superseded (files present) |
| `claude/evolution-delegation` | `a985f22` | superseded (files present) |
| `claude/evolution-fix-test-portability` | `98e8e82` | superseded (files present) |
| `claude/evolution-no-tests-in-bundle` | `b1b1d22` | superseded (files present) |
| `claude/env-probe-2` / `claude/env-probe-lelu2` | `bb45648` / `c62d70c` | superseded (files present) |
| `claude/cosmos-chat-experience-z6xja0` | `eb2fac3` | superseded (files present) |
| `claude/gallant-ritchie-v7i0fn` | `ce768e0` | superseded (files present) |
| `claude/lelu-cognitive-audit-unify-ptqyoq` | `44bdd93` | superseded (`main` tip) |
| `claude/lelu-continuous-cognition-92p3jy` | `b81d159` | superseded (files present) |
| `claude/lelu-interface-control-d2sfdl` | `3eccc6d` | superseded (files present) |

### 3.3 Freebuff — sessions, mission work and recovery

| Branch | Tip SHA | Disposition |
| --- | --- | --- |
| `freebuff/b105d19c3d200d49a5558304` | `11ab26e` | superseded; **3 workforce verify/test files archived** |
| `freebuff/972ad39440e4d8489551fcfb` | `6181ad2` | superseded; **18 files archived** (browser sessions, spatial graph) |
| `freebuff/4737-4315072` | `9be834b` | superseded; **34 files archived** (update pipeline, chat gallery, body animation) |
| `freebuff/4737a30149fabb5356a4ea37` | `e0a4a5f` | superseded; **4 files archived** (OG thread startup) |
| `wip/4737-uncommitted-phase7` | `2ea0b93` | superseded; **22 files archived** (WIP scripts/UI) |
| `freebuff/1fb0099bf53a9ab2f6fe75bd` | `1549194` | integrated (ancestor) |
| `freebuff/b51087fe6b0da1c0c7866b8b` | `ab34483` | integrated (ancestor) |
| `freebuff/3f-integrated` | `05e27cb` | integrated (ancestor) |
| `freebuff/avatar-phase1-647768f2` | `616f251` | integrated (ancestor) |
| `freebuff/session3d` / `session3e` / `session3f-integration` | `239a57e` / `72c81a7` | integrated (ancestor) |
| `freebuff/session2-chat-workspace` | `52bdcc9` | integrated (ancestor) |
| `freebuff/claude-redesign-b2d1e41` / `-9067818` | `b2d1e41` / `9067818` | integrated (ancestor) |
| `freebuff/phase-2-2` | `f0e0781` | integrated (ancestor) |
| `freebuff/c7bfbe3f92f6c25709955a7c` (+`f5fd72c2`, `fe72aa70`) | `1d1ed71` | integrated (ancestor) |
| `freebuff/25a94cfdf22ec131e27a4c21` | `ab34483` | integrated (ancestor) |
| `freebuff/25785cf729e762ebe706129c` | `b95d4f7` | integrated (ancestor) |
| `freebuff/647768f2164fc2c9c300f17d` | `44bdd93` | integrated (ancestor) |
| `freebuff/078e3ea38e31040bd9a2dce1` | `791cdfd` | superseded (files present) |
| `freebuff/0806c37…`, `22c92539…`, `3985d767…`, `4afb8d78…`, `b51087fe…`, `e627f15b…` | `e7b667b` | integrated (ancestor) |
| `freebuff-base` | `c110495` | integrated (ancestor, repository root) |
| `freebuff/15f5b4bb…` / `freebuff/ae32bbcd…` / `integration/m10-2-request-integrity` | `d63b353` | **integrated by fast-forward** (Mission 10.2 request integrity) |

### 3.4 Jules

| Branch | Tip SHA | Disposition |
| --- | --- | --- |
| `jules-3488608177676003568-d30852ca` | `7fb4f23` | superseded; **7 report/evidence files restored** |
| `jules-246569610287923701-3250dd82` | `a0458db` | superseded (files present) |

### 3.5 Codelazr

| Branch | Tip SHA | Disposition |
| --- | --- | --- |
| `codelazr/environment-orchestration-session-02-5152285862774985386` | `0a2050c` | superseded (files present) |
| `codelazr/environment-orchestration-session-02-recovered-8798102482818388694` | `59df30f` | superseded (files present) |

### 3.6 Local-only, experimental and verification refs

| Branch | Tip SHA | Disposition |
| --- | --- | --- |
| `backup/pre-avatar-merge` | `fad3bd2` | integrated (ancestor) |
| `backup/session3d-premerge-20261103` | `c2b9f88` | integrated (ancestor) |
| `backup/pre-trace-drop` | `d3eb456` | superseded; 18 trace archives **not restored** (1.2 GB, see section 5) |
| `integration/m10-unified` | `8789dfd` | integrated (ancestor) |
| `integration/m10-1-reconcile` | `087bb9b` | superseded; 1 evidence file restored |
| `perf/concurrency-pass` | `b31af52` | superseded (files present) |
| `phase8/goal-contract` | `2f8509b` | superseded (files present) |
| `lelu-verify/mvqyjv7l` | `ed6ecb8` | verification probe (marker in `tests/README.md`) |
| `lelu-verify/mvqyldvo` | `a2d1089` | verification probe (marker in `tests/README.md`) |
| `should-not-exist` | `44bdd93` | duplicate of `main`; probe branch |

## 4. Preserved content outside its original path

70 source, test and script files from the five retired code branches are stored verbatim
under [`branches/`](./branches/), grouped by source branch and keeping their original
relative paths:

```
docs/recovery/mission-11/branches/<branch>/<original/path>
```

These are archived, not activated. Each belongs to a subsystem the integration branch has
since replaced — `RoomBuilder` → `RoomGenerator`, `AvatarAnimator` → `LeluAnimation` +
`AvatarCommandBus`, `UpdateLifecycle`/`UpdateRuntime`/`plugins/updateApi.ts` →
`GenesisSelfDevPanel` + `ProposalEngineer`, `SpatialGraph` → the portal/spatial runtime,
`meshyApi` → `meshyForgeApi`. Re-applying them over the current tree would reintroduce
obsolete architecture and competing implementations, which Mission 11 explicitly forbids.
They are retained here so nothing is destroyed: any of them can be read, diffed, or
restored with `git show` against the recorded SHA.

To list them: `find docs/recovery/mission-11/branches -type f`.

## 5. Intentional exclusions

- **1.2 GB of browser trace recordings** (`docs/acceptance/spatial-phase-2-5..2-9/traces/*.zip`,
  18 files, tip `d3eb456`) were not restored into the tree. Their reports and JSON
  measurements are already present; the raw recordings are binary captures whose size
  would dominate the repository. They remain recoverable from `d3eb456` while that object
  survives on the remote, and the SHA is recorded here and in the inventory.
- No source, test, configuration or acceptance report was excluded.

## 6. Recovery instructions

Every retired branch can be re-created from the recorded SHA if the object still exists:

```bash
git fetch origin <sha>            # if the object survives on the remote
git branch restore/<name> <sha>   # local restore
```

Content archived in this directory is independent of object survival:

```bash
cp -r docs/recovery/mission-11/branches/<branch>/<path> <target/path>
```

The two maintained branches after consolidation:

- `main` — `44bdd936892bc989b6b59fd5ecfb9502747e6a58` (unchanged)
- `integration/lelu-four-workforce-consolidation` — recorded in
  `docs/missions/MISSION-11-FINAL-CONSOLIDATION.md`
