# Session 1, Phase 0: baseline and forensics

## Repository baseline

- **Repo:** lapheezy/leluv1.1
- **Branch:** `claude/avatar-3d-world`
- **Baseline HEAD:** `665f849`. The working tree was clean at the start. No Freebuff pushes in the previous 20 hours.
- **Protected:** everything is committed and pushed. Nothing was reset, stashed or rebased.

## Architecture map

| Area | Files | Status |
|---|---|---|
| Cosmos 3D (procedural Three.js) | `useGenesisScene.ts`, `CosmosSkyBackdrop.tsx`, `GenesisV2Scene3D.tsx` ("Her world") | Renders (screenshots below) |
| Camera commands | `GenesisSurfaceController.tsx` on the `genesis-v2-camera` event | V2 only. No persistent camera store. |
| Home | `home/CosmosHome.tsx`, `home/SpatialNav.tsx` | Renders on phone and desktop |
| Window space | `GenesisModuleHost.tsx`, `GenesisWindowFrame.tsx`, `GenesisCore` (`moveModule`, `resizeModule`, presentation) | Drag and resize work for panels |
| Layout engine | `src/core/workspace/WorkspaceEngine.ts` (grid, split, stack, snapshots) | Exists. Not wired to the Universe. |
| Chat Universe | `chat/universe/*` | Renders on phone and desktop. Routing verified in an earlier session. |
| Conversation state | `MultiChatStore` and `GenesisCore.state.conversations`; sending goes through `GenesisChat.send` via `lelu-universe-send` | Works |
| Tool registry | `src/core/tools/ToolRegistry.ts` and `ToolDispatcher.ts`: **63 tools** | Registered (see list below) |
| Browser | `src/core/browser/BrowserTool.ts` (`browser.read`, `browser.capture`), `GenesisBrowserPanel.tsx` (iframe), the `genesis-browser-goto` event | Two separate paths (see F2) |
| Deterministic commands | `ExplorationController.ts` | Handles "open the browser", scenes and modes only |
| Execution events | `AgentEventBus`, `chat/activityRecorder.ts`, `ChatActivity` card | Real events reach the chat and Universe activity card |
| Notifications | `src/core/notifications/NotificationProvider.ts`, `NotificationRouting.ts` | Exist |
| Self-engineering | `src/core/selfdev/*` (17 modules: `SelfDevelopmentEngine`, `SelfTestRunner`, `SourceAccess`…) | Exist. The home shows a live "Self-study" task. |

**Registered tools:**
- **Chat and memory:** chat, memory.recall/store, chats.list/read/link/merge
- **Research and browser:** research.web, browser.read, browser.capture
- **Avatar:** avatar.companion, avatar.gesture
- **Artifacts and generation:** artifact.read/edit/create, ai.generate
- **Device:** device.camera/microphone/tts/share/clipboard/notifications/storage/haptics
- **Agents and planning:** agent.delegate/status/resume, plan.create, reason.evaluate
- **Cosmos:** cosmos.navigate
- **Self-engineering:** selfdev.analyze
- **GitHub:** github.auth/repos/files/branches/commits/prs
- **Sandbox:** sandbox.read/write/execute
- **Engineering:** engineering.remote, workspace.typecheck/test/build
- **Projects:** project.search/preview/manage/copy/list/read/edit/write/delete/validate/diff/apply/git/commit
- **System and workflows:** system.config, workflow.list/run/author/status

## Before evidence (production build, Playwright, real app)

| Screen | Phone 390×844 | Desktop 1440×900 |
|---|---|---|
| Home | `390x844_1_home.png` | `1440x900_1_home.png` |
| Chat Universe | `390x844_2_universe.png` | `1440x900_2_universe.png` |
| "open github.com/lapheezy" sent | `390x844_3_open_github_request.png` | `1440x900_3_open_github_request.png` |
| After closing the Universe | `390x844_4_after_close.png` | `1440x900_4_after_close.png` |

**Runtime results:**
- `pageerror`: **none** on either size.
- 8 console `ERR_CONNECTION_REFUSED` messages on each run. These are local optional services not running in this sandbox.

## Failure inventory

- **F1, Phase 3:** there is no deterministic URL path. Only the literal "open the browser" is handled in `ExplorationController`. "open GitHub" and pasted URLs go to the model, which may pick `research.web` (a search) rather than navigating.
- **F2, Phase 3, observed:**
  - On phone, LÉLU ran `browser.read` on `github.com/lapheezy` and kept the exact URL ("Opening github.com/lapheezy · Reading the page…").
  - But the visible browser iframe stayed on `https://en.wikipedia.org/`. `browser.read` (server fetch) and the browser panel (iframe) are not connected, so the user never sees the page she reads.
- **F3, observed:** on desktop no reply or activity came within 25 seconds for the same request. The phone run did get a reply, so this is latency or a stalled turn, not routing. Re-test in Phase 2 with the event stream open.
- **F4, Phase 1:** the Universe uses its own opaque background, which hides the live Cosmos. There is no "Floating Cosmos" mode where windows float over the live scene.
- **F5, Phase 1:** Universe chat windows are not window-system modules, so they cannot be dragged or resized and do not exist outside the Universe.
- **F6:** the desktop home hero shows a 3D scene object where LÉLU's face should be, and the weather card is empty until location is granted.
- **F7, Phase 2:** there is no single execution-history view. Events exist (AgentEventBus) but are shown only per turn.

## Phase 1 plan (dependencies in order)

1. **Mode switch.** Add `cosmosMode: "workspace" | "floating"` in `homeStore`. This is the single owner, persisted, with a toggle in the Universe header and the Worlds sheet.
2. **Workspace mode.** Keep the current opaque `.lcu-cosmos` and pause the scene's render loop through the existing visibility hooks, so it costs no GPU.
3. **Floating mode.** Remove `.lcu-cosmos`, keep the scene rendering, and make `.lcu-main` transparent while cards and windows stay solid. The home and nav stay hidden.
4. **Chat windows as modules.** `ChatUniverse` opens `chat:<id>` through `GenesisModuleHost` using the same `GenesisWindowFrame` chrome. This adds drag, resize and z-order, and lets windows survive closing the Universe ("move chats between environments").
5. **Persistence.** Store window geometry in the module state (normalized), and the open set and mode in `homeStore`.
6. **Acceptance.** Switch modes, open and close several windows, close and reopen the Universe with windows still there, reload with state kept, and check mobile at 390×844 and 430×932.

## Gate

The Phase 0 baseline and evidence are recorded and committed. Phase 0 passes.
