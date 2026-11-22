# 07 · Canonical promotion report

| Item | Value |
|---|---|
| Canonical branch | `integration/lelu-four-workforce-consolidation` |
| Promoted implementation commit | `851cf707157d980864469c6dfe30ea5e91d4dfa8` |
| History on canonical | `904d254` → `1ff3829` (Retro Terminal, fast-forward) → `2d8fc85` (cherry-pick of `7510070`) → `851cf70` (M22.12 integration) → this record commit |
| Local HEAD after push | `851cf707157d980864469c6dfe30ea5e91d4dfa8` |
| Remote HEAD after push (`git fetch` and GitHub API `branches/…`) | `851cf707157d980864469c6dfe30ea5e91d4dfa8`, matching local |
| Push | `904d254..851cf70`, fast-forward. No force, no history rewritten |
| Working tree after push | clean (`git status --short` empty) |
| Source branches preserved | `claude/sharp-knuth-l3d7i3` = `1ff3829…`, `claude/cosmos-integration-audit-t9ouny` = `b291a88…` (GitHub API, after push) |
| Pre-integration checkpoint | local tag `checkpoint/m22.12-pre-promotion-904d254`; `904d254` is also an ancestor of canonical |
| GitHub default branch | **unchanged: `claude/open-session-rbwmdw`**. The session's repository permission is `push: true, admin: false`, and changing the default branch requires admin. It was not attempted. An owner can set it under Settings → Branches |
| Deployment | none |

This record is committed on top of `851cf70` and pushed the same way. The canonical head is therefore this record commit, whose parent is `851cf70`.

## Presence on canonical (checked on the pushed tree)

- **Retro Terminal:** `src/app/scene/genesis/home/RetroTerminal.tsx`, `TerminalAppearanceStudio.tsx`, `homeTerminal.ts`, `terminalCommands.ts`, `retroTerminal.css`, `tests/retro-terminal.test.ts`.
- **Camera-following navigation:** `src/app/scene/genesis/cameraFlight.ts`; the `currentId`-following effect in `CosmosRooms3D.tsx`; `tests/camera-flight.test.ts`.
- **Mobile corrections:** `data-lelu-hero-host` and `data-rt-prompt` in `RetroTerminal.tsx`; `[data-rt-prompt]` in `presencePlacement.ts` and `SpatialNavigator.tsx`; the Spatial-tab gutter in `retroTerminal.css`.
- **Live-map restoration:** `settleRestore` / `restoredArrival` in `CosmosNavigation.ts`, `settleRestore()` in `CosmosLiveMap.ts`, `tests/live-map-restoration.test.ts`.

## Final status: **PROMOTED WITH LIMITATIONS**

**Evidence for promotion:**

- The verified implementation is on the canonical branch on GitHub, with local equal to remote.
- Every gate was run on the integrated tree:
  - 2434 tests, 0 fail, 6 skipped;
  - tsc clean;
  - oxlint 0 errors / 184 warnings, the same as the baseline;
  - build OK;
  - bundle check PASS.
- Browser runs:
  - the promotion harness, 24/24 at each of iPhone 13, iPad Mini and 1440×900;
  - the original Retro Terminal acceptance, 37/37;
  - the audit's Cosmos harness, 30/30;
  - the workspace layout harness, identical to its pre-existing baseline.

**Why not "verified and promoted":**

1. **The GitHub default branch is not the canonical branch.** The mission's stated intent could not be completed, because this session has no admin permission. The code is promoted, but the repository default still points at `claude/open-session-rbwmdw`.
2. **Mobile is viewport emulation only.** Chromium with SwiftShader; no physical phone or tablet and no real GPU. The tablet needed a second run, because the lazy Cosmos layer did not mount within 90 s in the first, under software rendering.
3. **Restoration has a documented edge** (05). If the runtime stores that feed the live map are not loaded when the map syncs, a restore falls back to the core rather than to the destination. That is safe but not a restore. On a phone with the chat owning the screen, the restore resolves only on return to Home.
4. **Pre-existing items the audit deferred are still open:** C7 (breakpoints) and C8 (stale chat harnesses). The M15.3 line under the audit branch is not on canonical; it was out of scope.
