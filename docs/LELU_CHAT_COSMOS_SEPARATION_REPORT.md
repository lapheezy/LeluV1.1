# LÉLU V1.1 — Chat / Cosmos separation and crash audit

Branch `claude/open-session-rbwmdw`. Everything below was measured in a real
browser (Playwright / Chromium on the Vite dev server) or by the test suite.
Nothing in cognition, memory, agents, tools, providers or Cosmos was removed.

## Root causes

| # | Finding | Evidence |
|---|---------|----------|
| A | **On a phone, chat was a window painted over a live 3D world.** The v1 scene (R3F canvas, CosmosSkyBackdrop, CosmosPhaseHUD), VisualInterface and CosmosOverview all kept rendering under the full-screen chat. | 390×844, chat open and idle: **2 fps**, ~8.6 s of native WebGL work per 8 s sample (CPU profile, `(program)`), `page.evaluate` taking 3–15 s, a composer tap timing out after 20 s. This main-thread starvation is the phone "crash/freeze". |
| B | **The AI bridges lived inside the v1 scene.** `GenesisBridge`, `ProactiveBridge` and `VoiceBridge` were mounted only in `GenesisV1Workspace`, so in Gen V2 / the System scene replies were not written back, and no scene could be dropped for chat. | Source: GenesisScene.tsx. |
| C | **Typing was a global cognition event.** Each keystroke set `GenesisCore.dialogue = "typing"`, which re-rendered the whole Genesis tree, raised the 3D Core's interaction energy, and — typed while a reply was running — overwrote `"processing"`, so the Core looked idle mid-turn. | Source: GenesisChat onChange, materials/GenesisCore `interactionEnergy`. |
| D | **Closing chat unmounted it mid-turn.** The turn queue, live turn, Stop control and stream subscription belonged to the unmounted instance; the reopened chat did not know a turn was running, and its mount effect reset the phase to "listening". | Source: GenesisInterface mount condition, GenesisChat refs. |
| E | **Landscape phones got a tablet dock rail beside the full-screen chat** (844 px wide ⇒ "tablet"), and `useDockInset` pushed the chat over by the rail's width. | Source: GenesisDock `useBreakpoint`, chatLayout. |
| F | **Toasts covered the phone transcript** (notification layer z 400 over chat at z 100). | verify:layout at 390×844. |
| G | **The error boundary could loop and could print "undefined"**: a thrown `undefined` left `state.error` falsy, so it re-rendered the child that threw; its fallback was a black "GENESIS CRASH" box with nothing to press. | Source: GenesisErrorBoundary. |

The first "floating window" frame seen on open ([6,13,378,819]) was the
framer-motion `scale: 0.97` entry, not a layout race (390 × 0.97 = 378).

## Fixes

- **Explicit surfaces** — `src/app/scene/genesis/surface/Surface.ts` (pure) and `useSurface.ts`:
  HOME / CHAT / WORKSPACE / AGENT / NOTIFICATIONS, and `chatOwnsScreen = phone viewport && chat`.
- **Router** (GenesisScene): while chat owns the screen no scene is rendered (V1, System, Gen V2),
  and no CosmosOverview. Going Home renders Cosmos again. The bridges moved to router level.
  The Core, cognition and EngineTick keep running; only the picture stops.
- **Interface**: in chatOwnsScreen, no VisualInterface and no top chrome; the dock is told and takes its
  phone shape (menu only, no rail/pill). `useDockInset` is removed — the inset is always 0.
- **Chat**:
  - Typing is composer-local; no `setDialogue("typing")` anywhere in the chat.
  - Closing hides the chat (`display: none`) instead of unmounting it. While hidden it takes no keys, marks no question seen, and raises no "new reply" badge.
  - Re-showing keeps a running turn's phase.
  - Phone layout is edge to edge (`left/right 0`, `100vw × 100dvh`, safe areas as padding). With the keyboard open it is exactly the visible area, starting at `visualViewport.offsetTop` (new `visibleTop` in Workspace metrics). The entry animation does not scale on full screen.
- **Notifications**: while chat owns the screen nothing is toasted; each notification is recorded in the
  Chats panel inbox (NotificationProvider, silent) instead.
- **Errors**: `ChatErrorBoundary` logs the real error (console with component stack, Sentinel `chat_error`) and offers "Reopen the conversation" (a fresh mount) or "Go home". `GenesisErrorBoundary` keeps a separate `failed` flag, and `thrownMessage()` never yields "undefined". Turn failures already go through `describeFailure()` (no raw "undefined").

## Results

| Measure (390×844, chat open) | Before | After |
|---|---|---|
| Animation frames / s | 2 | 61 |
| Long tasks during a streamed reply (24 s) | ~150, ~150 s total | 0 |
| Composer focus / click | 13.4 s / timeout 20 s | 8 ms / 56 ms |
| Canvases mounted under chat | 2 | 0 |

**Crash probe** (390×844, real provider): send, three rapid sends, new chat + switch mid-turn,
Chats panel, close chat mid-stream → Home → reopen, landscape send, portrait, 16 Home↔Chat
cycles (each remounting the WebGL scene). No page errors, no error-boundary fallback, no
"undefined" in the transcript; the reply that finished while hidden was there on reopen.

**`npm run verify:mobile-chat`** (new) — iPhone 390×844 / 844×390, Android 360×740 / 740×360:
68/68 PASS. Per viewport it checks:
- Cosmos renders at Home;
- chat covers exactly the viewport, with no canvas, v1 workspace, HUD, overview or toast under or over it;
- every sampled point belongs to the chat or its tab bar;
- the composer is on screen, including with the keyboard open (shorter viewport) and after rotation;
- typing leaves Cosmos unrendered, at 61 fps;
- Home brings Cosmos back 4/4 times, and the draft survives;
- no page errors.

**verify:layout** — all pass. At phone the provoked failure is now asserted to be in the inbox
with no toast layer; tablet/desktop still measure a real toast. **verify:workspace** — all pass.

**Unit**: `tsc -b --force` clean; `npm test` 953/953 (15 new in `tests/chat-surface.test.ts`);
`npm run build` OK; `oxlint` exit 0 (warnings only, none new).

## Remaining issues

- Real iOS Safari / Android Chrome were not available here. The keyboard was simulated by shrinking
  the viewport; the iOS `visualViewport.offsetTop` path is unit-tested, not device-tested.
- Desktop: the hidden chat now stays mounted and re-renders with Genesis state changes while closed
  (React work only, no layout or paint). It is not measured as a problem, but it is new work.
- Leaving Home for chat on a phone, then returning, re-creates the WebGL context each time. 16 cycles
  showed no errors or context warnings, but it costs a scene start-up on return.
- The tab bar is still a separate fixed element under the chat header, not a slide-in drawer.
  The Chats panel is the drawer.
- Console noise that is environmental: missing `VITE_*` provider keys, `ERR_CONNECTION_REFUSED`
  for an absent local service, and a three.js `THREE.Clock` deprecation.
