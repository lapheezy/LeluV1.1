# LÉLU: Claude + Freebuff integration record

This is the shared working file for both agents. Read it before you change anything, and update it with every commit you make.

Claude cannot run alongside Freebuff in real time. Coordination happens through this file and commit history on `claude/avatar-3d-world`. Claude reviews Freebuff's pushed commits each time it is called in and writes findings under "Review log".

## State

- **Branch:** `claude/avatar-3d-world`.
- **Claude's last code commit:** `f9f8e88` (Chat Universe rebuild).
- **This commit:** hides the companion's floating window inside the Universe. It used to cover the chat window.

## What exists (verified by reading the code; "?" means not verified at runtime)

| Subsystem | Where | State | Gap |
|---|---|---|---|
| Cosmos 3D scene | `useGenesisScene.ts` (procedural Three.js), `GenesisV2Scene3D.tsx` ("Her world"), `CosmosSkyBackdrop.tsx` | Renders. Procedural, so there are no environment GLBs in the repo. | The Universe's opaque backdrop hides the live scene. No shared camera state across scenes. |
| Camera commands | `GenesisSurfaceController.tsx` on the `genesis-v2-camera` event | Exists for V2 only | No persistent camera; no pan or zoom on the main Cosmos |
| Window system | `GenesisModuleHost.tsx`, `GenesisWindowFrame.tsx`, and `GenesisCore` (`moveModule`, `resizeModule`, `openModule`, `expandModule`, `minimizeModule`, `closeModule`, `setModulePresentation`) | Drag, resize and presentation all work for panels | The Universe chat window is not a module, so it is fixed in a grid column |
| Layout engine | `src/core/workspace/WorkspaceEngine.ts` (grid / split / stack / auto, lock, snapshots) | Exists | Not wired to the Universe; no free-form saved compositions |
| UI commands LÉLU can issue | `genesis-show-surface`, `genesis-module-presentation`, `genesis-ui-control`, `genesis-set-scene` (events) | Open and present panels | **No move, resize, arrange, layout or camera tool in `ToolRegistry`**, so "move the research window beside my browser" cannot work |
| Avatar | `avatar/LeluCompanion.tsx` (one runtime, 31 clips), `leluverse/assets/characters/lelu_character` (74 GLBs), `avatar.gesture` tool | Works on home (face in the hero host), in chat and in its window | Not inside the Universe. Its `querySelector("[data-lelu-hero-host]")` takes the first match, which is the home's hidden host. |
| Chat Universe | `chat/universe/*` | Grid, art cards, timeline, window tabs, universal composer, dock | Window not movable; carousel basic; composer attachments and voice still go to the chat panel |
| Conversations | `MultiChatStore`, `GenesisChat.send` via `lelu-universe-send` | **Verified:** separate histories, correct routing, a real LÉLU reply streamed into the right window (390×844) | none |

## Ownership (to avoid edit conflicts)

- **Freebuff owns:**
  - `GenesisModuleHost` and `GenesisWindowFrame`
  - `WorkspaceEngine`
  - the new tools in `ToolRegistry` and `ToolDispatcher`
  - the scene and camera files
  - `LeluCompanion`
- **Claude owns (review and small fixes):**
  - `chat/universe/*`
  - `home/*`
  - this file
- **Shared file:** before editing `GenesisInterface.tsx`, add a line here saying so.

## Build order for Freebuff (commit after each step)

1. **Universe windows become real modules.**
   - Register a module kind `chat:<conversationId>` in the module host, using `GenesisWindowFrame` for drag, resize, minimize, maximize and z-order.
   - Remove `.lcu-window` from the CSS grid and render the window through the host instead. `ChatUniverse` keeps `openIds` and calls `genesis.openModule` / `moveModule`.
   - Store each window's position as **normalized viewport coordinates** inside the module state. They are not camera coordinates.
   - Done when: two chat windows are open, each is dragged and resized separately, and both keep their geometry after a reload.
2. **LÉLU in the Universe.**
   - Fix the `LeluCompanion` hero lookup to pick the *visible* host: `[...querySelectorAll('[data-lelu-hero-host]')].find(el => el.offsetParent)`.
   - Add `data-lelu-hero-host` to `.lcu-hero` (it currently shows a portrait image).
   - Map presence to real state. `ExecutiveRuntime` and `activityRecorder` give working / thinking; voice gives listening / speaking.
   - Remove the CSS rule that hides `[data-testid="lelu-companion"]` once she sits inside the header.
3. **Live Cosmos behind the Universe.**
   - Swap the opaque `.lcu-cosmos` for a translucent tint over the running scene. Surfaces stay solid (the `--lcu-glass` tokens), so text stays readable.
   - Persist the camera in one store (`CameraStore`: position, target, zoom) that both scenes read.
   - Add pan and zoom with pointer, wheel and pinch, only on empty space, so window drags never move the camera.
   - Lower the frame rate when the tab is hidden or reduced motion is on.
4. **Spatial tools for LÉLU.**
   - Add `workspace.arrange` (move, resize, group, layout mode), `workspace.save` / `workspace.restore`, `scene.camera` and `scene.appearance`.
   - Dispatch them through the existing `genesis-*` event bus to the `GenesisCore` methods.
   - In "assisted" `uiControl` mode, show a preview and ask for confirmation. Take a `WorkspaceEngine` snapshot before every change so it can be undone.
   - Done when: "Move the research window beside my browser" produces a real move, which can then be undone.
5. **Composer.** Move pending media, files and voice out of `GenesisChat` into a shared `useComposer` hook used by both composers. Do not duplicate the logic.
6. **Customization.** The tokens are already in `chatUniverse.css :root` (`--lcu-*`). Extend them to `.lch` and `.lsn`, persist them in a theme store, and add a settings section that edits them live.
7. **Mobile.**
   - The window becomes a draggable sheet (snap points 45%, 85%, full).
   - Keyboard: use `visualViewport` to lift the composer.
   - Test at 390×844, 393×852 and 430×932.

## Verification Freebuff must attach per step

- A Playwright screenshot at 1440×900 and at 390×844. Swiftshader is slow, so use a screenshot timeout of 150000.
- `pageerror` list (must be empty).
- The test file for anything new.

Starter scripts (not in the repo; Claude's sandbox): `scratchpad/uni2.js` (`SIZE=WxH`). It creates 4 chats, sends to each, opens two windows and logs tabs, target and messages.

## Review log (Claude)

- `01c081c` (Freebuff), live activity card in the Universe window: **OK**. It reads one shared record and does not duplicate subscriptions. Kept in the rebuild.
- `5b64fe1` (Freebuff), "one window chrome": **OK** in direction. Step 1 must reuse that same chrome for chat windows; do not add a third frame.
- Rejected approach, so nobody repeats it: stacking translucent fixed layers over the home. That caused the bleed-through. The Universe owns the screen through grid regions; keep it that way.

## Not verified yet

- The desktop browser run of `f9f8e88` was interrupted before its screenshots.
- Voice in the Universe.
- Camera.
- Movable chat windows (not built).
