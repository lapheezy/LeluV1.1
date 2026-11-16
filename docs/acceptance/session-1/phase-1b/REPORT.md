# Session 1, Phase 1B: persistent, draggable, resizable chat windows

- **Branch:** `claude/avatar-3d-world`
- **Commits:**
  - `aae182b`: integration
  - `e39201d`: two regressions found by screenshots, fixed
  - the commit holding this report: core geometry fix and evidence

## 1B.1 Architecture integration: PASS

No new window manager. A conversation window is the module `chat:<conversationId>` in the existing `GenesisModuleHost` and `GenesisCore` module system.

- **`GenesisModuleHost.tsx`:** one `chatWindow` renderer draws every `chat:*` window. Drag, resize, viewport bounds, raise, minimize, expand and close are the existing frame's. The title comes from the conversation. It exposes `--lelu-z` so stacking order can be lifted without being lost.
- **`GenesisCore.tsx`:**
  - Chat windows never become `activePanel`, so the home and Universe state are untouched.
  - They open "inline" (floating, draggable) on every width.
  - **Existing bug fixed:** `openModule`, `expandModule`, `minimizeModule` and `restoreModule` rebuilt the module entry and dropped `position`, `size` and `zIndex`, despite the comment saying geometry survives presentation changes. They now keep it.
- **`chat/universe/ChatWindow.tsx`:**
  - `ChatWindowBody` is a view of an existing MultiChatStore conversation. It never creates one. It shows the live activity card and an input that sends through GenesisChat's single send path (`lelu-universe-send`), so there is one writer per chat.
  - `ChatWindowPersistence` restores and saves the layout.
- **`chat/universe/chatWindowLayout.ts`:** saves layout only (KvStore `lelu.chatwindows.v1`): presentation, position, size, stacking and active chat. Transcripts stay in MultiChatStore and are not duplicated.
- **`chat/universe/ChatUniverse.tsx`:**
  - The open set comes from the `chat:*` modules, one source of truth. The private inline window was removed.
  - Opening a chat opens or raises its managed window.
  - The front-most window is the universal composer's target.
  - The thumbnail control moved to the header so it is not lost.
- **`GenesisInterface.tsx`:**
  - Registers the renderer and persistence.
  - `openModuleIds` excludes chat windows, so they no longer summon GenesisChat as a second view.
- **`surface/useSurface.ts`:** chat windows float and never "own the screen".
- **`chat/universe/chatUniverse.css`:** window body styles. Stacking: above the home outside the Universe, and above the Universe inside it, both keeping the host's order.

## Interaction evidence (real pointer events, production build)

The test script is `interaction-test.js` (in this folder). Results of the final runs:

| Check | Desktop 1440×900 | Phone 390×844 |
|---|---|---|
| One managed window per chat (no duplicates) | ✅ | ✅ |
| Drag by the title bar | ✅ (88,76) → (308,196) | ✅ (8,242) → (8,132) |
| Resize by the corner | ✅ 622×482 → 762×572 | ✅ 376×508 → 368×388 |
| Focus and stacking: B to front, then A | ✅ title-bar click | ✅ via the dock (on a phone windows stack full-width) |
| Composer targets the front-most window | ✅ | ✅ |
| Workspace ↔ Floating keeps geometry | ✅ | ✅ |
| Windows stay open outside the Universe | ✅ 2 windows, above the home | ✅ |
| Returning to the Universe: no duplicates | ✅ | ✅ |
| Old GenesisChat view appears | ✅ no | ✅ no |
| Reload restores position and size | ✅ (308,196,762,572) | ✅ (8,132,368,388) |
| Reload restores minimized state | ✅ B stays minimized | ✅ |
| Transcript preserved after reload | ✅ (LÉLU's reply streamed into window A) | ✅ |
| `pageerror` | none | none |

**Screenshots** (`1440x900_*`, `390x844_*`):
1. `_1_managed_windows`
2. `_2_dragged_resized`
3. `_3_floating_with_windows`
4. `_4_windows_outside_universe`
5. `_5_after_reload`

**Defects found by screenshots and fixed during 1B:**
1. A window showed as a second view of the same chat (`e39201d`).
2. Windows sat under the home (`e39201d`).
3. Every window was forced to one z-index, so raising did nothing (`--lelu-z`).
4. Geometry was dropped on reopen (core fix).

## 1B.4 regression: one open defect

- **Phone, outside the Universe:** LÉLU's companion mini-window (bottom-right) overlaps the lower window's send button (`390x844_4_windows_outside_universe.png`). It is an avatar-placement versus window-geometry conflict. **Assigned to Phase 1C:** the companion must avoid the managed windows' rectangles.
- **Not 1B, unchanged:** the "Working… test" stalled turn (Phase 2) and the faint "Deep Black Space" scene label (Phase 1C).

## Remaining for Phase 1C

1. Companion avoids chat-window rectangles on phone (the defect above).
2. Scene-label bleed in Floating mode.
3. The Windows sheet and SpatialNav show `chat:*` windows; check their labels.
4. Full regression at 390×844 and 1440×900, both modes, with the full test suite.
