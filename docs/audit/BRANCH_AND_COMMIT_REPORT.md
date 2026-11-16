# BRANCH AND COMMIT REPORT

Captured 2026-11-06 from the local worktree of `lapheezy/LeluV1.1`.
All counts come from `git rev-list --left-right --count origin/main...<branch>` and `git diff --shortstat`.

## 1. Integration line

`origin/main` — tip `44bdd93` ("Record what the test suite actually measures, and correct a count I did
not measure"). The audit branch `freebuff/078e3ea38e31040bd9a2dce1` contains it
(`git merge-base --is-ancestor origin/main HEAD` → true) at `e7b667b`.

`origin/HEAD` is not set in this clone, so the default branch is inferred from `origin/main` being the
merge base of every other line and from `.github/workflows/ci.yml` triggering on `main`. **Inference, not
a GitHub API lookup** — the repository's GitHub default-branch setting was not queried by this audit.

## 2. Remote branches already merged into main (3)

`origin/main` itself, `origin/should-not-exist`, and `origin/claude/lelu-cognitive-audit-unify-ptqyoq`
(the merge is visible in main: `9492b78 Merge the cognitive-audit branch: server-owned credentials win,
its work survives`).

## 3. Remote branches NOT merged into main (15) — the real risk surface

| Branch | Ahead | Behind | Files changed vs main | Last commit |
|---|---|---|---|---|
| `origin/claude/master-integration` | 236 | 0 | 1290 (+168466 / −5390) | `1031053` Creation Studio in chat and Cosmos; Atelier design-to-files; handoff report |
| `origin/claude/cosmos-chat-experience-z6xja0` | 210 | 0 | 1156 (+143582 / −5365) | (Cosmos chat experience line) |
| `origin/claude/avatar-3d-world` | 207 | 0 | 1178 (+148589 / −5099) | `616f251` Phase 1: ship the frame-based chat windows the gate verified |
| `origin/claude/open-session-rbwmdw` | 119 | 0 | 793 (+109278 / −5069) | `e7b667b` LÉLU 3D Forge checkpoint (identical to this worktree's HEAD) |
| `origin/claude/lelu-interface-control-d2sfdl` | 23 | 0 | 132 (+18903 / −564) | interface-control line |
| `origin/claude/evolution-*` (4 branches) | small | 0 | — | Board status / delegation / test portability / bundle hygiene |
| `origin/claude/env-probe-2`, `env-probe-lelu2`, `origin/lelu-verify/*`, `origin/freebuff/b51087…` | small | 0 | — | probes and verification runs |

**Every unmerged branch is strictly ahead of main (0 behind).** They are not stale forks of an old main;
they each contain all of main plus their own work. That makes them cheap to review but expensive to merge
into each other.

## 4. Local branches (46 in `git branch`)

Notable non-remote locals, all read-only for this audit:

- `backup/pre-avatar-merge`, `backup/session3d-premerge-20261103` — explicit safety snapshots of an avatar
  merge that already happened. Keep.
- `freebuff/*` (≈30) — per-session worktrees from earlier Freebuff sessions, several checked out in other
  chats (`+` marker). **They may be live. Do not touch, rebase or delete them.**
- `phase8/goal-contract`, `perf/concurrency-pass`, `wip/4737-uncommitted-phase7`,
  `freebuff/session2-chat-workspace`, `freebuff/session3d`, `freebuff/session3e`,
  `freebuff/session3f-integration`, `freebuff/3f-integrated` — historical workstreams.

Remote branches checked out in other worktrees (`+` in `git branch -a`): `origin/claude/avatar-3d-world`
equivalent local, `freebuff/1fb0099…`, `freebuff/25a94c…`, `freebuff/3f-integrated`, `freebuff/4737-4315072`,
`freebuff/972ad3…`, `freebuff/avatar-phase1-647768f2`, `freebuff/b3932de…`, `freebuff/b51087…`,
`freebuff/b6da3c…`, `freebuff/c7bfbe…`, `freebuff/f5fd72…`, `freebuff/fe72aa…`, `freebuff/session3f-integration`.
These are other sessions' working copies. Treat as concurrent developers.

## 5. Recent history themes on main

Reading the last 20 commits of `main` and this branch's tip:

1. **Self-improvement / measurement honesty** — ~20 consecutive commits about LÉLU measuring her own UI
   against real captures, catching her own false "met" verdicts, and fixing capture defects
   (double-counting covered controls, state-dependent defects, provider outage during verification).
2. **Credential brokering** — `2d9e0fa`/`b13e92c`: the server broker owns every remote model credential;
   every Supabase path pointed at the real schema.
3. **3D Forge / Meshy checkpoint** at `e7b667b` — server-side image-to-3D pipeline, Phase 1B references,
   costed jobs awaiting approval. This is the newest work and is **incomplete by its own commit message**
   ("awaiting approval").
4. **Cosmos/chat redesign** and **engineering chain** reports in `docs/`.

## 6. Unfinished work visible in the tree

- `leluverse/forge/ledger.json` + `leluverse/assets/characters/lelu_character/` (references, identity,
  manifests) — an asset pipeline mid-flight, gated on a paid Meshy key.
- `phase2-earthcore-planetexplorer-unify (1).diff` at repo root — an unapplied unification diff.
- `cleanup-probe-rows.sql` — a cleanup statement for persistence-verification probe rows, still needed.
- Two failing tests in a clean clone (Playwright browser absence) — see `MASTER_REPOSITORY_AUDIT.md` §6.

## 7. Merge / conflict policy for this project

1. This project's work happens on `freebuff/078e3ea38e31040bd9a2dce1` (and, for the Device Bridge, in a
   separate repository). No merges into `main` are performed by this session.
2. `claude/avatar-3d-world` and `claude/master-integration` are **not** merged, rebased, or cherry-picked.
   They overlap the exact files this project touches (Genesis scene, avatar, chat surface). Merging them is
   an owner decision, not an agent decision.
3. File ownership for this project, chosen to avoid those lines:
   - new directories only: `src/core/spatial/`, `src/core/devicebridge/`, `docs/audit/`, `docs/architecture/`,
     `docs/acceptance/`;
   - additive edits, small and localized: `src/core/avatar/AvatarPresenceBridge.ts`,
     `src/core/router/ToolResolver.ts`, `src/core/browser/BrowserTool.ts`,
     `src/app/scene/genesis/GenesisDevicePanel.tsx`, `plugins/nekoApi.ts`, `src/core/native/**`.
4. Any change that would require editing `GenesisCore.tsx`, `GenesisWindowFrame.tsx`, `App.tsx`,
   `AIService.ts` or `GenesisV2Scene3D.tsx` is treated as a **conflict checkpoint**: stop, report, ask.

## 8. Ownership report cadence

A branch/integration note is appended here after each phase (`§9`, `§10`, …) recording: phase, branch,
commits made, files touched, and any overlap discovered with a concurrent line.
