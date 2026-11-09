# Branch ownership and commit ancestry map

Baseline: **`fd463c0`** (owner decision, 2026-11-06). Preserved without change:
`aacfa5c` (reconciliation) and `96988db` (provider evidence). Nothing pushed,
nothing merged, no production Supabase touched.

This map is measured, not inferred: every count below comes from
`git rev-list --left-right --count`, `git diff --name-only <merge-base>...<branch>`
and `git worktree list --porcelain`.

---

## 1. The 16 worktrees

| # | Worktree | Branch | HEAD | State |
|---|---|---|---|---|
| 1 | `/workspace/repo.git` | — (bare) | — | object store |
| 2 | `chats/078e3ea38e31040bd9a2dce1` | `freebuff/phase-2-2` | `514af36` | live |
| 3 | `chats/0806c3785852eb3063e48b25` | `freebuff/3f-integrated` | `05e27cb` | **prunable** |
| 4 | `chats/167b4bf50af49d39b2714564` | `freebuff/session3f-integration` | `72c81a7` | **prunable** |
| 5 | `chats/1fb0099bf53a9ab2f6fe75bd` | `claude/master-integration` | `96988db` | live (this chat) |
| 6 | `chats/25a94cfdf22ec131e27a4c21` | `freebuff/25a94cfdf22ec131e27a4c21` | `ab34483` | **prunable** |
| 7 | `chats/3985d767525c1732891c7557` | `freebuff/3985d767525c1732891c7557` | `e7b667b` | live |
| 8 | `chats/4737a30149fabb5356a4ea37` | `freebuff/4737-4315072` | `9be834b` | **prunable** |
| 9 | `chats/4afb8d78527864f08a25bc0b` | `claude/avatar-3d-world` | `01c081c` | **prunable** |
| 10 | `chats/647768f2164fc2c9c300f17d` | `freebuff/avatar-phase1-647768f2` | `616f251` | live |
| 11 | `chats/972ad39440e4d8489551fcfb` | `freebuff/972ad39440e4d8489551fcfb` | `6181ad2` | live |
| 12 | `chats/b3932de2ab1a5ded84ceb494` | `freebuff/b3932de2ab1a5ded84ceb494` | `5d6963d` | **prunable** |
| 13 | `chats/b51087fe6b0da1c0c7866b8b` | `freebuff/b51087fe6b0da1c0c7866b8b` | `e7b667b` | **prunable** |
| 14 | `chats/b6da3caf29b9fda0e880006b` | `freebuff/b6da3caf29b9fda0e880006b` | `3eb2a8d` | **prunable** |
| 15 | `chats/c7bfbe3f92f6c25709955a7c` | `freebuff/c7bfbe3f92f6c25709955a7c` | `1d1ed71` | live |
| 16 | `chats/f5fd72c27d798f6a37727e99` | `freebuff/f5fd72c27d798f6a37727e99` | `1d1ed71` | live |
| 17 | `chats/fe72aa703ebdd4246d09affe` | `freebuff/fe72aa703ebdd4246d09affe` | `1d1ed71` | live |

Eight worktrees are **prunable**: their gitdir points at a directory that no
longer exists. Pruning deletes the registration, not the commits — the branch
refs survive. It also destroys any *uncommitted* file left in those paths, so
**no prune before reading each one's `git status`**, and that is a per-owner
action, not an integration step.

## 2. The nine branches with unintegrated work

`ahead` = commits on the branch not in `fd463c0`; `behind` = commits in
`fd463c0` not on the branch. Divergence point is the merge base.

| Branch | Merge base | Ahead | Behind | Commits | Files changed |
|---|---|---|---|---|---|
| `session3d` | `c2b9f88` | 32 | 75 | 32 | 182 |
| `3f-integrated` | `c2b9f88` | 17 | 75 | 17 | 158 |
| `session3f-integration` | `c2b9f88` | 15 | 75 | 15 | 112 |
| `167b4bf…` (Session 3E) | `c2b9f88` | 15 | 75 | 15 | 112 |
| `b6da3ca…` | `c2b9f88` | 22 | 75 | 22 | 73 |
| `session2-chat-workspace` | `c2b9f88` | 12 | 75 | 12 | 62 |
| `phase-2-2` | `1549194` | 9 | 11 | 9 | 217 |
| `4737-4315072` | `4315072` | 9 | 196 | 9 | 58 |
| `972ad39…` | `1031053` | 3 | 13 | 3 | 31 |

**Most of the "nine branches" are one branch's history.** `session3d`'s log
contains `3f-integrated`'s head `05e27cb`, `b6da3ca`'s head `3eb2a8d` and its
merge `345ea76`, and `session3f-integration`'s head `72c81a7`. `3f-integrated`
in turn merges `52bdcc9` (`session2-chat-workspace`'s head) via `4e85af0`.
`167b4bf…`, `session3e` and `session3f-integration` are three names for the
same commit `72c81a7`.

Verified with `git merge-base --is-ancestor`, not inferred from titles:
`b6da3ca…`, `3f-integrated`, `session3f-integration`, `session2-chat-workspace`
and `167b4bf…` all report **YES — contained in `session3d`**. `fd463c0` is
contained in neither `session3d` nor `phase-2-2` (both diverge from `c2b9f88`
and `1549194` respectively), so wave 1 is a true two-way merge.

Consequence: **`session3d` is the superset tip** of six of the nine branches.
Merging it once carries their work; merging any of them separately afterwards
is a no-op or a conflict for nothing. That is the single most useful fact in
this map.

`phase-2-2`, `4737-4315072` and `972ad39…` are *not* contained and are
genuinely separate lines.

## 3. File-group ownership

Counts are how many of the nine branches touch the file. Groups are owned by
the branch that must resolve them, and that must be confirmed by the session
that wrote them.

### 3.1 Build and deployment — **cross-cutting, nobody owns it alone**

`vite.config.ts` (8), `server.ts` (8), `package.json` (7), `.gitignore` (7),
`.github/workflows/ci.yml` (7), `env.example` (6), `deploy/*` (6 each:
`Dockerfile`, `docker-compose.yml`, `nginx.conf`, `Caddyfile`, `lelu.service`),
`plugins/loadEnvFiles.ts` (6), `plugins/bareSecretAliases.ts` (6).

Every branch that added a plugin or an env var edited these. They are the
conflict surface of any merge, and they are mechanical: resolve by taking the
union of registrations, then re-run the suite. **Owner: the integration
session** (this one), with each branch's author confirming its plugin line
survived.

### 3.2 Genesis renderer and shell — **Session 3D vs Session 2**

`src/app/scene/genesis/GenesisInterface.tsx` (7),
`GenesisCore.tsx` (7), `GenesisDock.tsx` (6), `GenesisChat.tsx` (5),
`GenesisCosmosPanel.tsx` (5), `src/app/scene/genesis/**` (19 files in
`session3d`, 13 in `3f-integrated`, 11 in `4737-4315072`, 5 in `972ad39…`).

`session3d` owns the grouped dock and the scene shell; `session2-chat-workspace`
owns the chat/workspace surface inside it; `4737-4315072` owns the phone-panel
behaviour and presence animation that touches the same shell. **These three
cannot be merged without their owners saying which component instance is
canonical.** Priority-1 reconciliation item.

### 3.3 Avatar

`src/core/avatar/Avatar3DReconstructor.ts` (7), `CompanionStore.ts` (6),
`leluverse/assets/characters/lelu_character/**` (6).

`session3d` (truthful asset resolution), `b6da3ca` (coat bound to the
skeleton, already inside `session3d`), `avatar-phase1` (frame-based chat
windows), `claude/avatar-3d-world` (universe window). One avatar pipeline must
win; the others become consumers. **Owner to confirm: Session 3D.**

### 3.4 Cosmos, spatial and world

`src/core/cosmos/*` (7 branches, 5 files each: `SpatialObjects`,
`CosmosTools`, `CosmosNavigation`, `CosmosLiveMap`, `CosmosInspector`,
`CosmosFocus`, `CosmosAutonomy`), `src/app/scene/genesis/cosmos/*` (5),
`src/core/spatial/**` (18 files, `phase-2-2` only), `src/core/world/**`
(`972ad39…`, `4737-4315072`).

`session2-chat-workspace` made Cosmos operate the real LÉLUVERSE;
`phase-2-2` extends the spatial core with typed links and world-to-world
edges; `972ad39…` adds the same idea at the world layer. **Owner: Session 2
for `core/cosmos`, the phase-2 spatial session for `core/spatial`.**

### 3.5 Chat/workspace lifecycle and tools

`src/core/workspace/WorkspaceAPI.ts` (5), `src/core/tools/ToolDispatcher.ts`
(6), `ToolRegistry.ts` (5), `src/app/scene/genesis/chat/*` (6 files,
`4737-4315072`), `src/core/multichat/*` (`4737-4315072`).

**Owner: this chat** — the provider chain and the chat turn lifecycle are the
work I am already holding (see §5).

### 3.6 Voice

`src/core/voice/elevenLabsTts.ts` (6), `VoiceEngine.ts` (6),
`plugins/voiceApi.ts` (6). **Owner: Session 2.**

### 3.7 Studio and templates

`src/core/studio/**` (12 files in `3f-integrated`, 10 in
`session3f-integration`, 10 in `session3d`), `studio/templates/application`
(5), `studio/templates/website`. **Owner: Session 3F.**

### 3.8 Acceptance evidence

`docs/acceptance/spatial-phase-2-*/screenshots` (127 PNGs across five
folders, `phase-2-2` only), `artifacts/browser-evidence/**` (`972ad39…`).
Binary, additive, conflict-prone only if the same run is redone. Merge with
`-X ours` on evidence folders **only** where both sides are the same run —
otherwise take the newer capture set whole.

## 4. Integration sequence

Each wave is one merge commit plus its own verification commit. No wave starts
before the previous wave's suite is green on the merged tree.

| Wave | Branch | Why now | Gate before commit |
|---|---|---|---|
| 0 | `claude/master-integration` (`96988db`) | reliability + reconciliation + chat-lifecycle fix | focused suites, `tsc -b --force`, `bun run build` |
| 1 | `session3d` | superset of `3f-integrated`, `session3f-integration`, `167b4bf`, `b6da3ca`, `session2-chat-workspace` | full suite on merged tree; §3.1 build files resolved; dock/renderer owner sign-off |
| 2 | `phase-2-2` | spatial core + acceptance evidence; needs wave 1's chat surface | full suite; spatial tests; screenshots kept whole |
| 3 | `4737-4315072` | presence/animation + phone panels, on wave 1's shell | full suite; phone-width manual check |
| 4 | `972ad39…` | smallest; world links depend on phase-2 spatial types | full suite |
| — | `25a94cf…`/`b51087f…`, `c7bfbe3…`/`f5fd72c…`/`fe72aa7` | secret-name and autonomy work, independent of the scene | own wave, owner-driven |
| — | `backup/*`, `perf/concurrency-pass`, `phase8/goal-contract`, `wip/4737-*` | historical or superseded | **do not merge** |

Wave 1 is the only risky one, and it is one merge instead of six because of
§2.

### 4.1 Measured conflict set (dry run, no tree change)

`git merge-tree --write-tree HEAD session3d` → **21 conflicted paths of 182**,
no working tree touched. They are exactly the groups §3.1 and §3.2 predicted,
plus two the map had not called out (`GenesisController.tsx`,
`src/core/AIRouter.ts`):

```
.gitignore                                    package.json
bun.lock                                      plugins/bareSecretAliases.ts
plugins/engineerApi.ts                        server.ts
src/app/scene/genesis/GenesisChat.tsx         src/app/scene/genesis/GenesisController.tsx
src/app/scene/genesis/GenesisCore.tsx         src/app/scene/genesis/GenesisModuleHost.tsx
src/app/scene/genesis/GenesisWindowFrame.tsx  src/app/scene/genesis/MultiChatTabs.tsx
src/core/AIRouter.ts                          src/core/Bootstrap.ts
src/core/agentic/AgenticTools.ts              src/core/studio/StudioTypes.ts
src/core/tools/ToolDispatcher.ts              tests/bare-secret-aliases.test.ts
tests/chat-surface.test.ts                    vite.config.ts
```

Two of them are my own files (`GenesisChat.tsx`, `ToolDispatcher.ts`) because
wave 0 changed the turn semantics they depend on — which is why wave 0 and the
lifecycle fix land before wave 1, not beside it.

## 5. The chat lifecycle bug (Priority 2, independent of provider quota)

Reported: after a successful multi-tool execution the conversation stalls.

Cause, in `src/core/router/ProviderResolver.ts`:

1. `PROVIDER_RUNG_BUDGET_MS` (12 s) is armed per provider attempt and passed
   into `generateWithTools`, so it spans the **whole tool loop**, not one
   provider call. A product-creation turn runs several rounds, each with a
   tool; it exceeds 12 s while doing real work.
2. The deadline aborts the signal mid-round. `executeRung` converts that to a
   plain `Error` ("timed out"), so it is indistinguishable from a provider
   failure.
3. `execute()` catches it and **falls through to the next provider with the
   original `messages` and `tools`** — replaying every tool already executed.
4. When the chain is exhausted the user gets the offline notice, so the turn
   looks stuck after tools that genuinely succeeded.

Fix, in the same file:

- the rung deadline is now a **stall watchdog**: every provider round that
  returns and every tool that finishes re-arms it, so a working turn is
  bounded by the tool loop's own budget (8 min / 40 rounds) while a silent
  provider is still cut at 12 s;
- a user Stop is checked **before** the deadline, so a Stop is never settled
  as a timeout;
- if an attempt already ran tools and then fails, the chain **does not fall
  through**. The turn ends naming what ran, with
  `toolLoopStopped: "provider-failed-after-tools"` and `partial: true`.

Locked by two new tests in `tests/provider-rung-budget.test.ts`: a multi-round
turn exceeding one rung budget completes, and a rung that ran a tool is never
replayed on the next provider.

## 6. Unresolved blockers

1. **Owner confirmation** for §3.2 (which chat/renderer instance is canonical)
   and §3.3 (one avatar pipeline). Merging without it is the collision the
   directive forbids.
2. **No live generation**: Groq daily allowance ~454 tokens left, OpenRouter
   resets 2026-11-07T00:00:00Z, Anthropic no credit. Renderer, scene, chat UI,
   workspace and mobile layout work does **not** depend on this and can
   proceed in parallel — its verification is DOM/visual, not completion text.
3. **Browser automation is broken in this VM** (Playwright fails with
   `The property 'options.mode' must be one of: 'strip'. Received 'transform'`;
   `preview_evaluate` is ~10 s). Visual evidence for wave 2–3 needs a working
   browser session or real-device captures from the owning session.
4. **iPhone evidence** requires a real device; the emulated viewports
   (390×844, 393×852, 430×932) are not device evidence and must not be
   reported as such.
5. **8 prunable worktrees**: inspect each `git status` before any prune, or
   uncommitted work in those paths is lost.

## 7. Exact next implementation task

The dry run in §4.1 is done. The next implementation step is to resolve those
21 paths in a **scratch worktree** (never this one, never `session3d`'s), in
this order: `package.json`/`bun.lock`/`.gitignore`/`env.example` (union of
registrations, then reinstall from the merged lock), `vite.config.ts` +
`server.ts` + `plugins/*` (union of plugin registrations), then the six
`Genesis*` shells and `ToolDispatcher` against the §5 turn semantics, then
the two test files. Prove `tsc -b --force`, the full suite and `bun run build`
green on the merged tree **before** any merge commit on the baseline.

The chat lifecycle fix in §5 lands first, as its own commit, because it
changes the turn semantics that wave 1's chat surface builds on.
