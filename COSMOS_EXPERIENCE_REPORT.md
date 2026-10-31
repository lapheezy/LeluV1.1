# Cosmos & chat experience — Session 3 (Cosmos & Experience Engineering)

Scope: the Genesis interface (chat, dock, tabs, menus), the Cosmos render
loops, and phone/desktop layout. Cognition, providers, the broker (Session 2)
and the avatar/world/Forge pipeline (Session 1) were not modified — only
consumed.

**Base.** Branch `claude/cosmos-chat-experience-z6xja0` is a copy of the newest
commit in the repository, `54f4d61` (Session 1, `claude/avatar-3d-world`), plus
Session 2's newest commit `a37a8ba` (docs only) merged in. Neither session's
branch was written to.

## How the defects were found

The app was driven in Chromium (Playwright) at iPhone 13 (390×664) and
1440×900, with a CPU profile and long-task observer on the open chat. The
phone keyboard was simulated by shrinking the viewport.

## Issue list (priority order) and status

| # | Defect | Cause | Fix | Status |
|---|---|---|---|---|
| 1 | Phone: typing 30 characters timed out after 30 s; chat felt frozen | The full-screen v1 WebGL canvas (and backdrop blur over it) kept rendering at full rate under an opaque chat: 6.3 s of long tasks per 5 s | `SceneRenderBudget`: canvas `frameloop="never"` while a full-screen surface covers it, ~12 fps while typing on phones. Simulation (`EngineTick`) is not governed — the universe keeps evolving | **Fixed, measured:** long tasks 6.3 s → 0.28 s per 5 s; 30 chars typed in 1.1 s |
| 2 | Chat replayed old replies over new ones; constant state churn | `GenesisCore` rebuilt every action on each universe publish (10 Hz) and keystroke. `GenesisChat`'s mount effect depends on `exit` → re-ran → `setDialogue` → new actions → loop | Actions built once (`stateRef` for the live conversation id); `setDialogue` no-ops on the same phase; engine-status poll publishes only on change | **Fixed** |
| 3 | Every chat/dock/panel re-rendered 10×/s | All 40 consumers read one context that includes the 10 Hz universe snapshot | `GenesisStateContext` / `useGenesisState()` (state + actions, no universe). 22 DOM consumers moved to it; `useGenesis()` unchanged for scene code | **Fixed** |
| 4 | No conversation history — one exchange shown, then faded out | By design of the old "floating dialogue" | `GenesisChatTranscript`: scroll-back of the active conversation from `state.messages` (no second store), markdown, user right / LÉLU left; finished exchanges stay; images/surfaces anchored to their reply | **Fixed** |
| 5 | Composer under the iOS keyboard | `100dvh` / fixed-bottom don't shrink for the iOS keyboard (`interactive-widget` unsupported) | Full-screen phone chat sized to `visualViewport` (`useVisualViewport`); no auto-focus on touch; banner/tabs collapse while the keyboard is up | **Fixed** (simulated keyboard; real iOS not tested) |
| 6 | Desktop chat ran off the bottom of the screen | framer-motion's scale animation replaced the inline `translate(-50%,-45%)` | Centre with motion `x`/`y` | **Fixed** — composer at y 601–690 of 900 |
| 7 | Phone: global minimize/palette/fullscreen row covered the chat's title bar (☰ ✕) | Rendered above the chat on every breakpoint | Hidden while the phone chat is open | **Fixed** |
| 8 | Multi-chat tabs floated over the messages | Fixed at `top:56px` of the screen | Rendered inside the chat column (`MultiChatTabs embedded`), scrolls sideways | **Fixed** |
| 9 | OG Core/Chat buttons covered the phone chat | Fixed top-right cluster | Hidden while the phone chat is open; added to the LÉLU menu ("OG INTERFACES") | **Fixed** |
| 10 | Toasts covered the top-right controls | `top:16` | Below the control rows | **Fixed** |
| 11 | Atmosphere HUD sat under the Genesis chip; re-rendered React every frame | `top:12,left:12`, `setState` per rAF | Bottom-left, clear of the dock rail; 4 updates/s, budget-gated | **Fixed** |
| 12 | Phone: no way to see LÉLU's world/avatar while chatting | Full screen was the only mode reachable without dragging (dragging is disabled in full screen) | ◐ title-bar toggle: half sheet with the world above (scene resumes rendering); ⇧ returns to full screen | **Fixed** |
| 13 | Live reply showed raw `**markdown**` | Plain pre-wrap text | Markdown, same as the transcript | **Fixed** |
| 14 | Presence engine + avatar presence bridge restarted on every panel change | Effect depended on `state.activePanel` | Reads `activePanelRef`; runs once per mount | **Fixed** |
| 15 | Slow desktop GPUs could still lag typing | Typing throttle was phone-only | `SceneFrameGovernor` measures frames; > 40 ms sustained → typing pauses the scene on that device | **Fixed** (verified only under software GL) |

## Demonstration

Captured from this branch with the dev server (`npm run dev`), Chromium,
software WebGL. Replies are real LÉLU turns through the Anthropic route.

| | |
|---|---|
| `docs/cosmos-experience/mobile-1-cosmos.jpg` | Phone home: Genesis chip, palette, OG tabs, toast, atmosphere readout and LÉLU pill without overlaps |
| `docs/cosmos-experience/mobile-2-chat-history.jpg` | Phone chat after two turns: history kept, tabs inside the chat, live progress line |
| `docs/cosmos-experience/mobile-3-keyboard.jpg` | Keyboard simulated (viewport 390×360): composer fully visible, banner compacted, tabs stepped aside |
| `docs/cosmos-experience/mobile-4-halfsheet-world.jpg` | ◐ half sheet over the Genesis v2 world (LÉLU "listening"); the scene renders again |
| `docs/cosmos-experience/desktop-1-chat.jpg` | Desktop: the chat window centred and fully on screen over the live Cosmos |

## Not done / not verified

- **Expandable side navigation for chats** (a ChatGPT-style conversation
  sidebar) was not built. Conversations are reachable through the tab strip
  inside the chat and the existing History panel.
- **Avatar.** Session 1's `LeluV2Presence` + `WorldScene` render in the Genesis
  v2 scene and are untouched. No approved Forge model was present in this
  environment, so the avatar mesh itself was not seen on screen; expressions
  and hood up/down are Session 1's and were not exercised from the UI.
- **Real devices.** No physical iPhone/Android; the keyboard is simulated by a
  viewport resize, and Chromium emulation is not Safari.
- **Desktop typing on real GPUs** is unmeasured. Here WebGL is software
  (~1 s/frame at 1440×900): typing took 23 s with the scene live, 0.21 s with it
  paused (the UI's own cost), and 3.8 s with the slow-device rule (#15).
- **Scene components inside the canvases** still read `useGenesis()` and so
  still reconcile at 10 Hz even while the canvas is paused (cheap in
  production, visible in the dev profile).
- The live "echo" of the text being typed (an existing feature) is kept.

## Files

New:
- `src/app/scene/genesis/SceneRenderBudget.ts` — full / reduced / paused store; `allowFrame()` gate for rAF loops
- `src/app/scene/genesis/SceneFrameGovernor.tsx` — `useSceneFrameloop()` (Canvas prop), ~12 fps invalidation, slow-frame detection
- `src/app/scene/genesis/GenesisChatTranscript.tsx` — conversation scroll-back
- `src/app/scene/genesis/useVisualViewport.ts` — visible-area tracking for the keyboard
- `tests/cosmos-chat-experience.test.tsx` — 12 regression tests
- `docs/cosmos-experience/*.jpg` — demonstration screenshots

Modified:
- `GenesisCore.tsx` — stable actions, `GenesisStateContext`/`useGenesisState`, `setDialogue` no-op, change-only status poll
- `GenesisChat.tsx` — transcript, exchanges persist, visual-viewport sizing, budget hooks, embedded tabs, desktop centring, half sheet, compact chrome, markdown live reply
- `GenesisInterface.tsx` — state-only context (universe only in the expand chip), presence effect once per mount, top chrome hidden under the phone chat, tabs moved into the chat
- `GenesisScene.tsx`, `GenesisV2Scene3D.tsx` — governed `frameloop`; HUD throttle/position
- `CosmosSkyBackdrop.tsx`, `VisualInterface.tsx` — rAF loops gated by the budget
- `MultiChatTabs.tsx` — `embedded` mode
- `GenesisDock.tsx`, `GenesisMobileMenu.tsx`, `GenesisNotificationCenter.tsx` — overlap fixes, OG entries in the menu
- `src/index.css` — HUD position, paused composer decorations, transcript markdown
- `useGenesis` → `useGenesisState` only (no behaviour change): `GenesisBrowserPanel`, `GenesisReasoningPanel`, `GenesisSettingsPanel`, `VoiceBridge`, `GenesisHistoryPanel`, `GenesisKnowledgePanel`, `GenesisWorkspace`, `GenesisDiagnosticsPanel`, `DeepLinkIntake`, `GenesisBridge`, `GenesisSurfaceController`, `ProactiveBridge`, `GenesisModuleHost`, `GenesisCommandPalette`, `GenesisMemoryPanel`, `GenesisAvatarPanel`, `LivingSystemUI`

## Integration contracts

**Session 1 (avatar / world).**
- Anything rendered inside a `<Canvas>` may keep using `useGenesis()`. A new
  canvas should take `frameloop={useSceneFrameloop()}` and mount
  `<SceneFrameGovernor />` inside, so it yields to the chat like the v1/v2
  scenes. A canvas that bridges contexts manually (`useContextBridge`) must
  bridge `GenesisStateContext` too if anything inside uses `useGenesisState()`.
- The avatar's state is read from `ForgeClient.world()` (Session 1's API); the
  chat never stores avatar state, so switching scenes or conversations does not
  reset it.

**Session 2 (cognition).**
- The chat sends through the unchanged `Orchestrator.process()` /
  `AIService.chat()` and reads streaming from `AIService.subscribeStream()`.
  Tool progress is the existing `GenesisExecutionTimeline` (AgentEventBus).
- History is `state.messages` of the active MultiChat conversation, filled by
  the existing bridge. No new message store or subscription was added.

**Shared UI.**
- DOM chrome that does not draw the universe should use `useGenesisState()`.
- A full-screen opaque surface should call
  `getSceneRenderBudget().setOccluded(id, true)` while open (and `false` on
  close). A composer should call `noteTyping()` on input and `endTyping()` on
  blur.

## Tests

```sh
npx tsx --tsconfig tsconfig.app.json --test tests/cosmos-chat-experience.test.tsx
```

12 pass. `--tsconfig tsconfig.app.json` supplies the automatic JSX runtime the
components use; without it any `.tsx` test that renders an app component fails
with "React is not defined". `npm test` only globs `*.test.ts`.

The older `tests/genesis-interface.test.tsx` still fails with that flag. The
cause is not the JSX runtime: `GenesisDock.tsx:580` reads Vite's
`import.meta.env.BASE_URL`, which is undefined under Node. That failure existed
before this work and is left as it was.
