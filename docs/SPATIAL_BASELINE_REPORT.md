# LÉLU V1.1 — Spatial modernization baseline (Phase 0)

Written before any product change, from repository inspection and the checks named in each row.
Nothing here is inferred from documentation alone; where a claim could not be verified it says so.

## 1. Branch and HEAD

| Item | Verified value |
|---|---|
| Working branch | `freebuff/session3d` |
| HEAD | `55e6278 Make the merged tree run its own tests again` |
| Merge commit | `345ea76 Merge branch 'freebuff/b6da3caf…' into freebuff/session3d` (30 commits over the pre-merge `c2b9f88`) |
| Safety branch | `backup/session3d-premerge-20261103` at `c2b9f88` |
| Pushed? | **No.** Nothing on this branch has been pushed. |

The branch carries the work of three earlier sessions: Session 3C (Cosmos), Session 3F
(integration, studio engine, cosmos live map) and the avatar/wardrobe line, plus the Session 3D
spatial runtime. The two containing branches were `freebuff/3f-integrated` (17 commits) and
`freebuff/b6da3caf29b9fda0e880006b` (22 commits); both were fast-forward/merge-compatible with
this branch and are now merged. Older lines (`4737-4315072`, `wip/4737-uncommitted-phase7`,
`backup/pre-avatar-merge`, `perf/concurrency-pass`, `phase8/goal-contract`) are 120–170 commits
*behind* this HEAD; they are superseded and were deliberately not merged.

## 2. Other worktrees and stashes

Nine worktrees are registered on the shared bare repository. All but this one are marked
`prunable` and belong to other sessions; **none was touched**. Four stashes exist on unrelated
branches. `stash@{0}` ("session3f preserve 3E dirty tracked work") is still unreviewed — it is the
only one that could hold unshipped 3E content.

## 3. Deployment

No Sites/Wrangler/Vercel manifest exists in this repo. Deployment is documented for a Contabo
host (`deploy/`, `DEPLOY_CONTABO.md`, `CONTABO_DEPLOYMENT.md`) and is driven by `server.ts` + a
Vite build. **The currently deployed commit cannot be determined from this repository** — there is
no build stamp, no deployed-URL record and no CI deployment workflow to read it from. Phase 0's
"identify the running deployment" is therefore an open item that needs the host or the deployment
secret, not code inspection.

## 4. The architecture that already exists (extend, do not recreate)

| Concern | Existing implementation | Verdict |
|---|---|---|
| Spatial runtime | `src/app/scene/spatial/SpatialRuntime.ts` — one state object (scene, camera, transition, lighting, particles, morph, avatar, activeWorkspace, interaction, backend), GSAP-tweened, interrupt/resume/reverse, `window.__leluSpatial` bridge | Keep. This is the single owner the new work must go through. |
| Scene graph | `SpatialScenes.ts` — 13 destinations, each mapped to the real `GenesisPanel` it opens | Keep. Dock groups must be derived from it. |
| Navigation | `SpatialNavigator.tsx` — one flat row: 12 scene chips + core/interrupt/reverse/voice/chat/minimise | **This is the "spatial bar" that fails.** Flat, one row, no groups, no active-app state, no task state. |
| Window geometry | `windowLayout.ts` — pure tiling: 2 columns desktop, 1 phone, extra windows on extra rows; `rectsOverlap()` | Keep as the collision primitive; it caps the working set at whatever fits in rows. |
| Module host | `GenesisModuleHost.tsx` — windows with drag, `manualPlacement`, z-index in the `overlay` layer | Keep. |
| Chat layout | `chat/chatLayout.ts`, `chatFillsScreen()` | Keep. |
| Workspace engine | `src/core/workspace/*` — `AdaptiveLayout.ts` already computes 1–4 columns by width, primary/secondary, split/stack | Keep. `columnCount()` is where the four-surface ceiling lives today. |
| Layers | `src/core/ui/Layers.ts` — scene 0, panel 100, navigation 200, composer 300, overlay 500, modal 600 | Keep. |
| Capability catalogue | `GenesisMobileMenu.tsx` — the authoritative grouped list of real panels (LÉLU / COSMOS / CREATE / RESEARCH / TOOLS / SYSTEM / OG) | Reuse as the availability source; the dock must not invent capabilities. |

## 5. The three protected decisions, as the code stands today

1. **More than four windows** — *not implemented.* `AdaptiveLayout.columnCount()` tops out at 4
   columns; `windowLayout.ts` tiles rows but every window is a full working surface. There is no
   compact-preview tier and no promotion path.
2. **Cosmos portal** — *partially implemented.* `SpatialPortals.tsx` draws portals in the scene and
   `SpatialRuntime.travel()`/`reverse()` preserve state, but there is no miniature live Cosmos
   **inside** the browser workspace, and no transition that connects a miniature to the full
   environment.
3. **Spatial bar** — *fails the brief.* One flat wrap-around row of equally-weighted chips.

## 6. Avatar and 3D

`AVATAR_3D_REPORT.md` documents the approved slot:
`leluverse/assets/characters/lelu_character/rig/v005_faceshapes_mvwaqbim/lelu.glb` (49.5 MB, in
git), with `motion.glb` clips per animation directory, one parser (`LeluBody`) and one driver
(`LeluMotion`/`LeluLife`). The claimed HTTP 404 of the avatar asset could **not** be reproduced or
refuted here: this VM cannot launch a browser (see §8), and no model is served from the app origin
by design (`docs/MODEL_STORAGE_POLICY.md`: `dist/models/` holds no `.glb`). Deciding whether the
deployed build 404s needs the deployed origin's network log, not this worktree.

## 7. Supabase

Two faults were reported: platform secrets written under bare names, and a publishable key for
project `nrehsldbfxthspikaxvr` rather than the one in old docs.

- The bare-secret correction exists and is **in this history**: `ef7e32e` — "Read the platform's
  secret names, so a regenerated `.env.local` cannot leave her dark" — adding
  `plugins/bareSecretAliases.ts` (162 lines), wiring it into `plugins/loadEnvFiles.ts` and
  `vite.config.ts`, with `tests/bare-secret-aliases.test.ts`. It is therefore merged, not lost.
- The browser-side name resolution is `src/core/config/supabaseEnv.ts`
  (`SUPABASE_URL`, `VITE_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_URL`, and
  `SUPABASE_PUBLISHABLE_KEY` + `VITE_` variant).
- **No credential value is present in this worktree, by design.** So the acceptance tests the brief
  lists (sign-in, refresh persistence, RLS, per-table isolation on `user_preferences`, `messages`,
  `ui_state`, `memory_items`) cannot be run here; they need the deployed environment and a real
  account. Any claim that Supabase is connected would be unfounded — it is not claimed.

## 8. Environment limits that shape verification

- Chrome cannot start in this VM: the Playwright build needs `libcups`, `libpango`, `libcairo`,
  `libXi`, `libXrender`, which are absent, and the package index is unreachable after the runner
  restart. **No screenshots are possible from here.** Visual acceptance must happen in an
  environment where a browser runs.
- Typecheck and build do run: `bun run typecheck` → 0, `bun run build` → 0 (✓ 3.2 s).
- The suite runs: 1270 tests, 1256 pass, 14 fail **only in the full run**; those 14 pass when their
  files are run alone (cross-file singleton leakage, pre-existing).

## 9. What this change introduces

Phase 2 (dock information architecture) and Phase 3 (multi-window ceiling) start here, because
every later phase renders through them:

- `src/app/scene/spatial/capabilityGroups.ts` — the dock's groups derived from the real scene
  graph, so no unavailable capability can appear.
- `src/core/workspace/workspaceDeck.ts` — a preview/promote deck: one primary surface, compact live
  surfaces beside it, and a shelf for the rest. No four-window ceiling.
- `SpatialNavigator.tsx` — the flat chip row becomes grouped, density-adaptive and collapsed by
  default on phones.

Phases 4–15 remain open; §3, §6, §7 and §8 name exactly what blocks each.
