# Multi-Chat Universe: handoff for Freebuff

- **Repo:** lapheezy/leluv1.1
- **Branch:** `claude/avatar-3d-world`
- **Claude started at:** `fafc58a`. Work landed in `aa242b8`, `4641d81`, `f274c82` and this commit.
- **Before you start:** verify every claim below yourself. Do not trust this report blindly.

## Files

### Reused, not rebuilt

- `src/core/multichat/MultiChatStore.ts`: conversations, archive, pins, linkedIds and unread, all from stored timestamps.
- `GenesisCore`: `state.conversations`, `activeConversationId`, `switchConversation`, `createConversation` and `unarchiveConversation`.
- `GenesisChat.send`: the existing send path, reached through `retry(text)`. Streaming, the per-conversation turn queue, steering and persistence all come from it.

### Added

- **`src/app/scene/genesis/chat/universe/universeModel.ts`**: pure data model.
  - Previews, `gridOrder`, `recentOrder` and `timelineMarkers`.
  - Grid order is the user's own: pins first, then store order. There is no topic sorting.
  - Timeline markers use real `createdAt` and message timestamps only.
  - `contextReferences`: tiered shared-context references (current, today, yesterday, week, older). It returns IDs only and never copies messages.
  - Per-chat appearance, saved in KvStore under `lelu.universe.appearance.v1`.
  - `autoVisual`: a gradient placeholder.
- **`.../universe/ChatUniverse.tsx` and `chatUniverse.css`**: the overlay (z-index 480).
  - Header with counts and toggles for grid, carousel and archived chats, plus a + button for a new chat.
  - 24H / 7D / 30D timeline.
  - Glass window grid: 2 columns on phones, 3 at 700px and up, 4 at 1100px and up.
  - Tapping a chat opens it as a mid-size window. Tapping outside or pressing Escape returns to the overview. An Expand button switches to full screen.
  - One universal composer showing "To: <chat>".
  - Recent dock along the bottom, with a button that opens the carousel.
  - Per-chat thumbnail: upload an image, hide it, or go back to automatic.
  - Hides `.lch`, `.lch-scrim` and `.lsn` while open (`html[data-lelu-universe=open]`).
- **`tests/chat-universe-model.test.ts`**: 4 tests, all passing.

### Wired up

- `GenesisInterface.tsx` renders `<ChatUniverse/>`.
- `home/homeActions.launch("chat")` dispatches `lelu-open-universe`, so the home Chat tile opens the Universe.
- `GenesisChat.tsx` listens for `lelu-universe-send` `{text, conversationId}`. It sends only when that conversation is the store's active one.

## Verified (production build, iPhone 13 viewport, Playwright)

- The Universe opens from the home Chat tile.
- I created two chats and sent "Universe test A" and "Universe test B" from the universal composer.
- Each chat holds only its own message.
- Reopening A shows "To: Universe test A" and only A's history.
- Grid showed 4 windows, the dock 5 items, and the timeline 9 real markers.
- No horizontal overflow and no page errors.

## Not verified

- LÉLU's replies appearing in the window. No model provider was configured in the test environment, so no reply came back.
- Desktop.
- The on-screen keyboard. The layout uses `100dvh`, but it was not tested on a device.

## Not implemented: Freebuff's next steps, in order

1. **Composer:**
   - Attachments, video, files and URLs. Right now Paperclip and Mic close the Universe and open the single chat panel.
   - Bring in `GenesisChat`'s composer pieces (pendingMedia/pendingFiles, voice/live) or move the send logic out into a shared hook. Do not duplicate it.
2. **Streaming in the window:** the window renders `conversation.messages`, so check that live deltas appear (GenesisBridge upserts on every delta). Show the activity and tool card for the active turn.
3. **Carousel:**
   - Currently a CSS scroll-snap strip with tilt.
   - Add a real "centred = selected" behaviour using IntersectionObserver, swipe momentum and left/right buttons.
   - Collapse back into the dock.
4. **Timeline:**
   - Tapping a marker should select that chat.
   - Add per-chat start and last-used labels and a calendar range.
5. **Conversation imagery:** replace `autoVisual` with subject-aware images from existing image capabilities or saved assets. User overrides already win.
6. **Shared context:**
   - Feed `contextReferences()` into `CrossChatResolver` and `ContextProvenance` in `src/core/multichat`.
   - Feed DailyRecord, DailyReflection and PersonalityMemoryProvider into the prompt context, keeping source provenance.
   - Load content only for the references chosen. Never merge histories.
7. **Voice:** keep one voice session. On switch, retarget the active conversation and make sure no reply lands in the wrong chat (TurnOwnership).
8. **Mobile:**
   - Keyboard test on a real device (visualViewport).
   - Desktop: 4–8 windows, and draggable mid-size windows using the existing module host.
9. **Organisation:** user categories exist only as `tags` and `projectId`. Add a UI for them that changes nothing automatically.
10. **External providers and tools:** add entry points in the composer that reuse the existing permission and provider configuration.

## Known issues

- The header counts can be cut off on very narrow phones.
- "Active" means `processing` from the store.
- Archived chats are unarchived when selected. Confirm this is the behaviour you want.
