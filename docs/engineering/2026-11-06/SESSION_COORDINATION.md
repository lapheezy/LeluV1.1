# Session coordination — LÉLU V1.1 (from 2026-11-06)

Integration branch: `claude/master-integration`. Claude integrates and verifies; nothing
reaches the branch without review of the actual diff and a test run.

## Real state of the Freebuff sessions

As of this commit **neither Freebuff session has pushed implementation work** since
`1549194` (07:49 UTC). Claude cannot start, message or observe Freebuff sessions from its
environment; it can only see what they push. The boundaries below are written so future
Freebuff work can be integrated without collisions. Until a session pushes, Claude does the
work in its lane and says so in the commit.

## Lanes

| Lane | Owner | Owns (files) | Must not touch without coordination |
|---|---|---|---|
| Security & backend | Freebuff session 1 | `plugins/requestGuard.ts`, `plugins/safeFetch.ts`, `plugins/browseApi.ts`, `plugins/aiProxyApi.ts`, `plugins/integrationApi.ts`, `plugins/engineerIdentity.ts`, `plugins/serverAutonomy.ts`, `server.ts`, `main.ts`, `supabase/migrations/*`, `scripts/verify-*security*`, `tests/security-*` | `src/app/**` |
| Mobile & performance | Freebuff session 2 | `src/app/scene/genesis/{Surface,useSurface,GenesisScene,GenesisInterface,GenesisChat,GenesisModuleHost,GenesisWindowFrame}.tsx`, `chat/**`, `home/**`, `avatar/**`, Playwright mobile suite (`tests/e2e/**`), `src/app/scene/genesis/SceneRenderBudget.ts` | `plugins/**`, `server.ts`, migrations |
| Integration & verification | Claude | merges, conflict resolution, `docs/audit/**`, `docs/engineering/**`, CI (`.github/workflows/ci.yml`), acceptance reports | — |

Shared files (`src/app/scene/genesis/GenesisCore.tsx`, `vite.config.ts`, `package.json`,
lockfiles) change only in a commit that states why and is reviewed by Claude.

## Rules for a contribution

1. Branch from the current `claude/master-integration` HEAD; state the base commit.
2. One subsystem per commit; tests in the same commit.
3. Push to its own branch (`freebuff/<session>-<topic>`), never to the integration branch.
4. Claude checks out the branch, reads the diff, runs `npm test`, `tsc -b`, the build and the
   lane's live checks, then fast-forwards or merges. Incompatible or untested work is
   returned with the reason.
5. No force-push of shared branches; no reset of another session's work.

## Order and dependencies

1. **Security containment** (this commit) — done by Claude because session 1 has not pushed.
2. **Mobile Chat ownership** (Phase 2) — next; owned by session 2's lane. Depends on nothing
   in (1) except that the browse relay now needs a signed-in user.
3. **Avatar and render performance** (Phase 3) — after (2): both touch Chat lifecycle.

## Claims (2026-11-07)

| Claimed by | Files | For | Since |
|---|---|---|---|
| Claude (released) | `avatar/LeluBody.tsx` (texture fit of the shared model only) | Shared model textures fitted to 2048² (240 → 96 MB per mount). `LeluCompanion.tsx` not changed. Single persistent avatar canvas left to the avatar owner. | `095b7f9` |

Freebuff's lane for these files is unchanged. This claim is narrow and ends with its commit.
Freebuff pushes directly to `claude/master-integration` (rule 3 is not followed in practice),
so each executor fetches and rebases before every push and never force-pushes.

## Step 2 handoff (2026-11-07, Claude)

React Flow and Excalidraw are in, as Creation Studio artifact kinds `graph` and `drawing` (see `docs/architecture/2026-11-07/STEP_2_GRAPH_DRAWING.md`).

Files touched:

- Claude's lane: `src/core/studio/**` and `src/app/scene/genesis/studio/**`.
- Shared files, each for a stated reason:
  - `package.json` / `bun.lock`: the two dependencies.
  - `vite.config.ts`: `optimizeDeps` include, dev only.
  - `AgentEvents.ts` / `TurnActivity.ts`: kind unions.

**Not touched:** the avatar, the navigator and layout, `home/**`.

Open items for Freebuff's lanes:

- App Library tiles do not receive pointer input.
- The navigator panel overlaps workspace windows.
- The library tile clips its cards.
- Touch node-drag in React Flow under emulation needs a physical-device check.

## Claim: Step 3, unified avatar presence (2026-11-07, Claude, from `db988c8`)

The owner directed this step to Claude. The claim covers:

- `src/app/scene/genesis/avatar/LeluCompanion.tsx`: replaced by one persistent presence.
- `src/app/scene/genesis/avatar/LeluCharacter3D.tsx`: a pause control on the existing frame cap.
- Avatar tests.

**Not claimed:** `LeluBody`, `spatialPresence` (used as is), `LeluV2Presence`, the asset pipeline, Home, layout, the navigator.

Step 3 note: one line was changed in `chat/universe/chatUniverse.css` (Freebuff's lane). The rule `html[data-lelu-universe="open"] [data-testid="lelu-companion"] { visibility: hidden }` was removed. It hid the old floating window, and it made the new presence invisible inside the Universe. The `.lch`, `.lch-scrim` and `.lsn` hiding is unchanged.
