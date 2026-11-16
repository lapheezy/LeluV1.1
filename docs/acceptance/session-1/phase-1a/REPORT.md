# Session 1, Phase 1A: Cosmos mode switching

- **Baseline:** `fb6e7a8` (Phase 0 accepted).
- **Code commit:** `4a5fb98`.

## Implemented

- **Persisted mode:** `CosmosMode = "workspace" | "floating"`, in `universeModel.ts`, saved in KvStore under `lelu.universe.cosmosMode.v1`. `ChatUniverse` is the single owner. A toggle button in the Universe header switches it (`.lcu-mode`).
- **Workspace mode:**
  - Solid Workspace Universe background.
  - The live scene is paused through the **existing** `SceneRenderBudget.setOccluded("chat-universe", true)`, which sets the frameloop to "never". No new pause system.
- **Floating mode:**
  - The backdrop image is removed and only a vignette remains.
  - The live 3D Cosmos keeps rendering behind solid cards and windows.
- **Switching:** only the CSS attribute and the occlusion flag change. React state, conversations and open windows are untouched.

## Files changed

- `src/app/scene/genesis/chat/universe/universeModel.ts`: `loadCosmosMode`, `saveCosmosMode`
- `src/app/scene/genesis/chat/universe/ChatUniverse.tsx`: mode state, occlusion effect, toggle
- `src/app/scene/genesis/chat/universe/chatUniverse.css`: floating-mode rules

## Acceptance (production build, Playwright, real app)

"Scene moving" means two screenshots of a background region taken 1.5 s apart differ. Paused means they are identical.

| Check | Desktop 1440×900 | Phone 390×844 |
|---|---|---|
| Workspace: scene paused | ✅ moving = false | ✅ moving = false |
| Floating: live scene moving | ✅ moving = true | ✅ moving = true |
| Open chat window survives a switch | ✅ same window, 1 message | ✅ the window reopens with its 1 message |
| Workspace → floating → workspace | ✅ state identical | ✅ |
| Mode persists after reload | ✅ floating after reload | ✅ |
| `pageerror` | none | none |

**Screenshots:**
- **Desktop:** `1440x900_1_workspace.png`, `1440x900_2_floating.png` (live planet and scene objects behind the windows), `1440x900_4_after_reload.png`
- **Phone:** `390x844_1_workspace.png`, `390x844_2_floating.png`, `390x844_3_floating_with_chat.png`, `390x844_4_after_reload.png`

**Defect caught and fixed during 1A:** the first floating build tiled the static galaxy image over the scene, so the live Cosmos was hidden. The fix removes the image completely. Verified in the second desktop screenshot.

## Known, not part of 1A

- **Scene label:** in floating mode a scene label ("Deep Black Space") can show faintly between surfaces. This should be handled with the scene-label layer in Phase 1C.
- **Stalled turn:** a turn's activity card stays on "Working… test" for several minutes. This is the Phase 0 F3 stalled turn, carried to Phase 2 (execution pipeline).
- **Not covered by 1A:** chat windows are still not modules (Phase 1B), and the window does not reopen after a reload (Phase 1B persistence).

## Gate

Phase 1A passes. Both modes work on desktop and phone with no session loss.
