# LÉLU Chat Redesign: Cloud Conversation

The existing LÉLU chat (`GenesisChat`) got a new presentation and interaction layer. It still sends through the same `Orchestrator` / `AIService`, uses the same turn queue, cancellation, `TurnOwnership` and conversation store, and the same voice, media, cognition and operations systems. No second chat system, store or provider path was added. Freebuff's (Codebuff's) work is untouched. Those commits cover `ObjectiveEvidence`, `OutcomeDerivation`, `CompletionVerifier`, `CognitiveLoop`, `AIProviderRegistry` and their tests, and none of those files were edited.

## Audit: what existed

| Concern | Existing implementation (reused) |
|---|---|
| Chat surface | `GenesisChat.tsx`, the single chat component (one definition, enforced by `no-duplicate-systems.test`) |
| Conversation state | `MultiChatStore` mirrored into `state.messages`. `GenesisBridge` already **upserts streamed partials** into it by id. |
| Sending | `send()`: per-conversation turn queue, `claimTurn` / `releaseTurn`, `Orchestrator.process` (text) or `AIService.chat` (media), latency trace T0/T6 |
| Operations | `GenesisExecutionTimeline` on the `AgentEventBus` (honest labels, grouped events, approvals) |
| Tabs | `MultiChatTabs` |
| Top controls | Chat header buttons, `GenesisInterface` global chrome (minimize, palette, fullscreen), `GenesisDock` (3 shapes), `OgDockTabs` |
| Layout | `useWorkspace()` (container size, `visibleHeight`, `keyboardOpen`, safe areas), `Layers` |

**Problems found:**
- The chat showed **only the latest exchange**, which faded away after a few seconds, so there was no history to scroll.
- The OG Core/OG Chat buttons sat on the phone composer.
- The tab strip's search button sat off-screen.
- The global controls rendered top-left under the dock rail.
- The landscape-phone layout put the dock rail over the chat.

## Files

**New**
- `src/app/scene/genesis/chat/chatTranscript.ts` holds the pure rules for what the chat shows:
  - transcript, windowing, live tail;
  - "undefined" never painted;
  - errors described in words;
  - near-bottom test.
- `src/app/scene/genesis/chat/ChatTranscript.tsx` renders memoised user and LÉLU bubbles, windowed history, thinking, failure and retry.
- `src/app/scene/genesis/chat/ChatMarkdown.tsx` renders rich content with react-markdown (already a dependency) plus GFM:
  - code blocks with a copy button;
  - tables that scroll;
  - topic labels;
  - mermaid diagrams, loaded lazily and isolated in `<img>`;
  - SVG visuals.
- `src/app/scene/genesis/chat/cloudChat.css` is the cloud design language: sky, bubbles, composer, menus, markdown.
- `src/app/scene/genesis/chat/chatLayout.ts` holds the shared "chat fills the screen" rule and a dock-rail measurement.
- `tests/chat-transcript.test.ts` adds 15 tests.

**Changed**
- `GenesisChat.tsx`: new render. Changes to logic:
  - the mount effect runs once;
  - each reply settles once;
  - failures go into the conversation;
  - retry;
  - attachments shown in the bubble;
  - the user message id anchors the turn;
  - `ai.beginTurn`.
- `GenesisExecutionTimeline.tsx` was restyled into a collapsible section inside the conversation. Its logic and exports are unchanged.
- `MultiChatTabs.tsx`: the tabs scroll inside the bar, New and Search stay fixed, and each tab has one options menu instead of four 18px icons.
- `OgDockTabs.tsx` steps aside when the full-screen phone chat is open. Its two entries are in the chat's options menu.
- `GenesisInterface.tsx`: the global controls now sit top-right as intended, no longer under the desktop rail.
- `GenesisScene.tsx`: the atmosphere HUD updates at most 4×/s, and only when what it shows changes, instead of on every frame.
- `AIService.ts`: a Stop pressed before the turn reaches `chat()` is held and honoured. `beginTurn()` clears a stale one.
- `ProviderResolver.ts`: a user Stop is no longer treated as a provider failure (see Interaction).
- `package.json`: adds `remark-gfm` (tables and task lists) and `mermaid` (diagrams, loaded only when a diagram appears).
- `tests/provider-fallback.test.ts`: adds 1 test.

## Major UI changes

- **Sky.** A twilight cotton-candy gradient with a static starfield and three cloud banks of overlapping soft ellipses. The banks drift at 150–420 s per loop, each at a different speed for depth. It's all CSS transforms on composited layers. Phones get two banks, and reduced-motion holds them still.
- **Bubbles.** User messages are pastel bubbles on the right. LÉLU's messages are a soft veil sized by their content with a speaker line, not a boxed card. Both render markdown. A copy action shows on hover, or on the newest reply on touch screens.
- **Composer.** One cloud holds attach, input, stop, mic and send. It brightens on focus and grows with the text up to 30% of the visible height, then scrolls inside itself. Attach options open anchored to the composer.
- **Header.** LÉLU's name and live status, plus one control group: options ⋯, LÉLU menu ☰ and close ✕. The buttons are 40px, or 44px on touch screens. The options menu holds:
  - new and search;
  - window size, corner and minimize (desktop);
  - command palette and fullscreen;
  - OG Core and OG Chat;
  - minimize LÉLU.

  It's portalled onto the overlay layer so it is never under the tabs.
- **Activity.** "LÉLU is working · N operations" is now a compact disclosure inside the conversation. Expanded, its steps flow inline, with no second scroll area.
- **Rich content.** Headings and ALL-CAPS lines ("MIAMI") become topic labels with a soft divider. Also supported:
  - nested lists;
  - quotes;
  - task lists;
  - tables that scroll sideways;
  - code with a copy button and sideways scroll;
  - diagrams shown with a "Drawing…" state;
  - inline images.
- **Desktop and tablet** keep the movable floating window, now a rounded cloud window placed below the tab bar. **Phones**, portrait or landscape, get the full-screen sky, offset to clear a dock rail when there is one.

## Interaction changes

- **Full scrollable history** from the existing store, windowed 40 at a time ("Show N earlier").
- **Scroll model.** The view follows the reply while you're at the bottom, and only your own wheel, touch, key or scrollbar input stops that. Content growth no longer does: a lazy image or a diagram finishing used to strand the view 240px short. When you scroll away, a "Latest" / "New response" pill appears and returns you exactly to the bottom.
- **Streaming.** The reply bubble grows in place with a caret and `aria-busy`, and is never shown twice. "Thinking" shows only while a turn is really in flight.
- **Errors.** A failure appears in the conversation as "LÉLU couldn't complete that", a plain-words reason and **Try again**. Raw "undefined" or stack text is never shown.
- **Stop** now works end to end. Before:
  - Stop was lost if pressed before the provider call started;
  - when it did abort, `ProviderResolver` treated it as a failure, putting a healthy provider into cooldown, trying every other provider, then replying with "all providers are unreachable".

  Now the turn simply ends.
- **Typing in text fields.** Keystrokes typed into the question card's answer field or a tab rename are no longer pulled into the composer.
- **Short screens.** The proactive question card collapses to one line on screens under 560px tall, with Answer to expand it.
- **Unchanged:** Enter sends as before, Shift+Enter adds a new line (IME composition is respected), and Escape closes an open menu first, then the chat.

## Performance

- **No `backdrop-filter` on message bubbles.** Only on the composer and the menus.
- **Sky:** CSS `transform` animation only, no JS loop.
- **Memoisation:** bubbles are memoised on their text, so a streaming reply re-renders only its own bubble. Markdown is parsed per bubble.
- **Typing:** measured with a React commit hook while typing 40 characters, typing re-renders **only** `GenesisChat` (it holds the draft). The transcript and bubbles re-render **0** times.
  - Before, `setDialogue("typing")` ran on every keystroke, re-rendering the whole Genesis tree. It now runs only when the phase changes.
  - The retry callback was made stable.
- **Mount effect:** GenesisChat's mount effect had been re-running on every core state change, because GenesisCore rebuilds its context each time. It now runs once.
- **Windowed history:** a 92-message conversation renders 40 bubbles (≈317 DOM nodes in the thread).
- **Mermaid is a lazy chunk.** It isn't in the initial load or modulepreload list, and loads only when a diagram appears.

## Tests performed

- **Real compiler:** `npx tsc -b --force` exits 0.
- **`npm test`:** **895/895** (was 879, +16 new).
- **`npm run build`:** exit 0.
- **Lint:** no new warnings.
- **`npm run verify:layout`:** all checks pass at phone, tablet, desktop and the constrained container. That covers:
  - no overlap between composer, tabs, dock and question card;
  - primary controls hit-testable;
  - toasts never cover controls;
  - no horizontal overflow.
- **`verify-workspace-isolation.mjs`** (real sends): **all checks pass**:
  - replies stay in their conversation;
  - queued messages are not dropped;
  - "the question on screen" belongs to the open conversation.
- **Chromium QA** at iPhone portrait 390×844, iPhone landscape 844×390, Android 360×740, tablet 820×1180 and desktop 1440×900, with a seeded 92-message conversation plus a reply using every content type:
  - opens at the newest line;
  - topic labels, nested lists, quote, task list;
  - table and code scroll inside the bubble with no page overflow;
  - the mermaid diagram renders, as do the SVG visual and the image;
  - wheel-scrolling to the middle shows "Latest", which returns to gap 0;
  - "Show earlier" goes from 40 to 80;
  - the composer grows to its cap and scrolls, with send reachable;
  - **no overlapping or off-screen controls**, and the chat's touch targets are at least 32px.
- **Live, through the real pipeline** (Fireworks):
  - a reply rendered once with list and table, and the view stayed at the bottom;
  - a forced Orchestrator failure showed the failure card, then **Try again** got a real answer;
  - Stop mid-turn ended it with no reply and no "offline" notice (run twice);
  - an image attached through the real input showed its thumbnail, then appeared in the user's bubble and was sent via `AIService.chat` with media;
  - Shift+Enter multiline;
  - a keyboard-sized viewport (390×470) kept the composer and header on screen;
  - every top-right control opened and worked, Escape closed only the menu, and close shut the chat;
  - no app console errors.

## Remaining issues

- **3D scene behind the chat (not chat code, pre-existing).** LÉLU's 3D world renderer keeps re-rendering continuously (`StreetCar`, `VegetationSurface`, `CosmosStore`). That produces a dev-only React "Maximum update depth" console warning, which is present on the base commit too. The scene also keeps rendering behind the full-screen phone chat, and no pause mechanism exists. Adding one means changing the renderer, so it was left out of a chat pass. It's the clearest next performance win on iPhone.
- **Not tested on a physical iPhone.** Keyboard handling was verified the way Android Chrome resizes the layout (`interactive-widget=resizes-content`) and through `useWorkspace`'s keyboard detection.
- **Dictation not exercised here.** The mic button drives the existing voice engine, but headless Chromium has no speech recognition.
- **Small targets outside the chat.** The dock's "Customize tabs" button (42×28) and the desktop command-palette pill (30px tall) remain undersized.
