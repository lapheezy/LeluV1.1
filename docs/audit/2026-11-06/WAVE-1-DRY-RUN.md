# Wave 1 dry run — `session3d` against `282626d`

**Mode:** scratch worktree `.scratch/wave1`, detached at `282626d`, merging
`freebuff/session3d` (`239a57e`). **No merge commit. No push.** Both source
branches untouched; every change lives in the scratch worktree and is captured
as `evidence/wave-1-dry-run/merge-diff.patch` (1.3 MB).

## Verdict

| Check | Baseline `282626d` | Dry-run merge | Result |
|---|---|---|---|
| `npx tsc -b --force` | 0 errors | **0 errors** | PASS |
| `bun run build` | exit 0 | **exit 0** | PASS |
| `bun run test` | 1455 tests / 1453 pass / 0 fail / 2 skip | **1565 / 1550 / 9 / 6** | **NOT GREEN — 9 failures** |
| Conflict markers / unmerged paths | — | 0 / 0 | resolved |

The merge is type-clean and build-clean, and carries 110 additional tests from
`session3d`. It is **not mergeable yet**: 9 behavioural tests fail, in two
clusters. Stopped before any merge commit, as instructed.

## What was verified first

- `282626d` and `freebuff/session3d` (`239a57e`) both resolve to commit objects.
- Containment re-checked with `git merge-base --is-ancestor`: `b6da3ca…`,
  `3f-integrated`, `session3f-integration`, `session2-chat-workspace`,
  `167b4bf…`, `session3e` → all **YES, inside `session3d`**.
- Worktree audit: **five sibling worktrees are dirty** and were not touched —
  `078e3ea…` (phase-2-2), `3985d76…`, `972ad39…`, `c7bfbe3…`, `fe72aa7…`.
  The last two hold uncommitted `package.json`, `bun.lock` and
  `GenesisCore.tsx`; `3985d76…` holds uncommitted `server.ts`,
  `ToolDispatcher.ts`, `ToolRegistry.ts`. None of that is in `session3d`, so it
  neither entered this merge nor was modified.
- `.scratch/wave1` is a linked worktree; after a runner restart it needed
  `git -c safe.directory=…` per command (no shared git config was written).

## Conflicts and how each group was resolved

20 conflicted paths (the earlier 21 in `BRANCH-OWNERSHIP-MAP.md` counted a
header line; the true count is 20).

### A. Lockfile and project config

| File | Resolution |
|---|---|
| `package.json` | test script = baseline (it is the one the 1455-test baseline runs); dependencies = **union** (`jszip` from baseline, `gsap` from `session3d`) |
| `bun.lock` | baseline, then `bun install` regenerated it against the merged manifest — `gsap` now resolves |
| `.gitignore` | union of both sides' blocks |
| `env.example` | auto-merged, no decision needed |

### B. Server, Vite and plugins — union, nothing dropped

- `server.ts`: the intelligence-integration mount (baseline) **and**
  `createStudioApi().attach(middlewares)` (`session3d`).
- `vite.config.ts`: conflict was whitespace-only; resolved empty.
- `plugins/engineerApi.ts`: imports unioned — `reverifyPassword` (baseline) plus
  `engineerAuthVerdict`, `sendEngineerAuthFailure` (`session3d`).
- `plugins/bareSecretAliases.ts`: **baseline kept**, 7 hunks. `session3d` adds
  `GITHUB_TOKEN` adoption and a `VITE_SUPABASE_PUBLISHABLE_KEY` alias, but its
  own test asserts the ambient token *is* adopted while the baseline test asserts
  it *never* is. That is a behavioural contradiction about secret handling, not
  a formatting clash — the security-preserving side was kept and the alias is
  recorded here for the owner rather than silently merged.

### C. Genesis shell and the two studio models — the real blocker

Resolving the shell hunks file-by-file produced an incoherent tree (71 type
errors): `session3d`'s auto-merged additions reference `layoutIndex`,
`layoutWindowRects`, `manualPlacement`, `autoLayoutModules` and a `"studio"`
panel, none of which exist in the baseline `GenesisCore`/`ModuleHost`.

Taking `session3d`'s shell instead produced **292** errors: the baseline
Creation Studio subsystem (`StudioOps`, `StudioTools`, `StudioReader`,
`StudioExport`, `StudioPreview`, `ChartSvg`, `writers/*`) fails against
`session3d`'s `StudioTypes`.

The collision is essentially **one filename**: `src/core/studio/StudioTypes.ts`
holds two different, incompatible type models —

- baseline: Creation Studio artifacts (documents, decks, workbooks, atlases,
  formats, export specs);
- `session3d`/Session 3C: the software studio (projects, phases, protected
  actions, approvals, deployments).

Each is used by its own file set, and neither compiles the other's modules.

**Resolution applied in the dry run (a proposal, not a decision):**

1. `src/core/studio/StudioTypes.ts` = baseline model.
2. `src/core/studio/StudioProjectTypes.ts` = `session3d`'s model, verbatim
   from `239a57e`.
3. `session3d`'s nine consumers import `StudioProjectTypes`
   (`StudioApprovals`, `StudioAssets`, `StudioEngines`, `StudioLibrary`,
   `StudioMemory`, `StudioPipeline`, `StudioRuntime`, `StudioToolExecutors`,
   `GenesisStudioPanel`).
4. The Genesis shell (`GenesisCore`, `GenesisModuleHost`, `GenesisWindowFrame`,
   `MultiChatTabs`, `GenesisDock`, `GenesisInterface`, `GenesisController`) =
   baseline, which is the single renderer `GenesisInterface` and the existing
   interface tests target. **`session3d`'s grouped dock, module auto-layout and
   spatial portals are therefore NOT in this dry-run tree** — they are the
   contribution that still needs an owner decision.

After that split, typecheck went 94 → 10 → **0**.

Two genuine merge-duplicate bugs were also fixed (independent of ownership):

- `src/core/env/buildEnv.ts` declared `export const IS_DEV` twice; esbuild
  treated it as a fatal transform error, which is what made 29 suites fail to
  load and hid the real state behind "52 failures".
- `useGenesisScene.ts` imported `IS_DEV` twice; `plugins/loadEnvFiles.ts`
  imported `fillBareSecretAliases` twice.

### D. Router, dispatcher and tools

- `src/core/AIRouter.ts`: baseline trace imports plus `asksForStudioChange`.
- `src/core/Bootstrap.ts`: **union of four tool sets** —
  `registerInterfaceTools`, `registerStudioTools`, `registerAtelierTools`
  (baseline) and `registerCosmosTools` (`session3d`).
- `src/core/agentic/AgenticTools.ts`: baseline kept — `session3d` deletes the
  whole `agent.delegate` tool, and losing a capability is not a merge.
- `src/core/tools/ToolDispatcher.ts`: label cases unioned (`studio.*` +
  `atelier.*` from baseline, `cosmos.*` from `session3d`); one `EXECUTORS`
  array feeding one `BY_ID` table, extended with the interface/studio/atelier
  sets. No second dispatch table.

## The 9 remaining failures, by cluster

**Cluster 1 — server autonomy / engineer identity (6 tests).**
"no identity, no level: unauthorized callers are refused for read, change and
apply"; "changing autonomy: confirm is required, raising needs the re-verified
password, lowering does not"; "the level survives a reload and is the same on
another device"; "concurrent changes are serialised"; "changing the real
project: the SERVER level gates request-apply and apply"; "an expired grant is
refused". The unioned `plugins/engineerApi.ts` imports both auth paths; the
merged body evidently takes `session3d`'s path, which does not enforce the
baseline's server-authoritative store. Files: `plugins/engineerApi.ts`,
`plugins/serverAutonomy.ts`, `plugins/engineerIdentity.ts`, `plugins/engineerAuth.ts`.

**Cluster 2 — AIService turn controllers (2 tests).**
"chat() must pass the conversation controller's signal on the AIRequest" and
"AIService creates the per-conversation and per-turn controllers and nothing
else". `src/core/AIService.ts` auto-merged `session3d`'s changes and now has an
extra controller creation pattern; the baseline invariant (one conversation
controller plus one per turn, Stop-safe) is not held by the merged file.

**Cluster 3 — AIRouter source shape (1 test).**
"naming the model's tools keeps device and project keyword resolvers out of the
turn" matches a specific guard expression in `src/core/AIRouter.ts`; the merged
file has both sides' paragraphs and the guard's shape changed.

These are integration defects in the merge, not flaky tests and not provider
quota: the suite needs no network to fail.

## Ownership: unresolved, as predicted

Two decisions are required before a merge commit can exist, and the dry run does
not pretend to make them:

1. **Studio model.** Keep the `StudioTypes` / `StudioProjectTypes` split (both
   subsystems survive), or declare one studio canonical and retire the other.
   The split compiles and keeps every file, so it is the recommended starting
   point.
2. **Genesis shell.** Baseline shell + `session3d`'s dock/layout/portals
   re-applied as a port (recommended: it preserves the single renderer), or
   `session3d`'s shell adopted and the baseline's interface work ported. Either
   way Session 3D must sign off, because its grouped dock and auto-layout are
   what the dry run currently leaves out.

## Exact next tasks, in order

1. Fix cluster 1: make the merged `plugins/engineerApi.ts` enforce the server
   autonomy store for read/change/apply, including confirm + re-verify and
   grant expiry. Re-run `tests/engineer-*` / autonomy suite.
2. Fix cluster 2: restore the single-controller invariant in `AIService.ts`
   (conversation controller + per-turn controller, Stop-safe) while keeping
   `session3d`'s additions.
3. Fix cluster 3: restore the router guard shape or update the assertion with
   the owner's agreement — not by loosening the test silently.
4. Re-run the full suite to 0 failures, then port `session3d`'s dock/layout and
   spatial portals onto the baseline shell, re-running interface tests.
5. Only then ask for the two sign-offs above and create the merge commit.
