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

---

## Mission 5.1 — coordination claim (Freebuff)

- **Branch / start:** `claude/master-integration` @ `095b7f9` (will end at its own commit; remote reconciled by merge, never force).
- **Files claimed (mine, uncommitted until the end of this mission):**
  - `src/app/scene/spatial/PortalRegistry.ts` — ring seeding (`scene:<id>` identities), `update`, persistence-failure honesty.
  - `src/app/scene/spatial/SpatialPortals.tsx` — ring now consumes the registry.
  - `src/app/scene/spatial/SpatialNavigator.tsx` — portal create/travel/remove UI + auto-arrange and regenerate controls.
  - `src/app/scene/spatial/SpatialExperience.tsx` — `lelu-portal-create` / `lelu-portal-remove` agent channel.
  - `src/app/scene/genesis/layout/moduleLayout.ts` — pin policy in `autoArrange`, collision fallback.
  - `src/app/scene/genesis/GenesisModuleHost.tsx` — pin toggle in the window chrome.
  - `tests/module-layout.test.ts`, `tests/spatial-portals.test.ts`.
- **Scope:** portal ring integration + user/agent portal creation + navigation/persistence; layout controls; pin/unpin. No new store, renderer, dock, camera or scene.
- **Depends on the other executor for:** nothing blocking. If Claude is editing `SpatialNavigator.tsx`, `SpatialPortals.tsx` or `PortalRegistry.ts`, say so in this file before writing — otherwise merge, and resolve by keeping both behaviours.
- **Expected completion:** this mission.
- **Ownership released:** when the mission commit lands on `claude/master-integration`.

Mission report: `docs/audit/2026-11-07/MISSION-5-1-SPATIAL-COMPLETION.md`.

---

## Mission 5.2 — coordination claim (Freebuff)

- **Branch / start:** `claude/master-integration` @ `3d914dd` (verified ancestor; branch and remote identical at start). Reconciled by merge only, never force.
- **Files claimed:**
  - `src/core/interface/InterfaceTools.ts` — `spatial.portal.create` / `spatial.portal.remove` tool definitions and executors (the agent-side portal capability, which did not exist).
  - `tests/portal-tools.test.ts` — new.
  - `docs/acceptance/` — report `MISSION-5-2-SPATIAL-VISUAL-ACCEPTANCE.md`, `spatial-phase-2-11/` evidence and harness.
- **Not touched:** `PortalRegistry.ts`, `SpatialPortals.tsx`, `SpatialNavigator.tsx`, `SpatialExperience.tsx`, `SpatialRuntime.ts`, `moduleLayout.ts`, `GenesisModuleHost.tsx`, the docks, the Studio, anything voice/multimodal. Mission 5.1's implementation is the baseline.
- **Depends on / note for the other executor:** the portal panel (`data-portal-panel`) reproducibly kills a software-rendered Chromium when composited over the live WebGL canvas (`dmesg`: `traps: chrome-headless trap int3`). If you capture spatial UI, use a GPU browser. Also: in headless runs `lelu.lelu.spatial.portals.v1` was **never written** after `seedRing`, so the ring may be empty at runtime — worth checking on a real GPU before claiming the ring renders. Not fixed blind.
- **Ownership released:** when the mission commit lands on `claude/master-integration`.

Mission report: `docs/acceptance/MISSION-5-2-SPATIAL-VISUAL-ACCEPTANCE.md`.

---

## Mission 5.3 — portal persistence (claimed)

**Files claimed:** `src/app/scene/spatial/PortalRegistry.ts`, `src/app/scene/spatial/SpatialPortals.tsx`,
`src/app/scene/spatial/SpatialExperience.tsx`, `src/app/scene/genesis/render/GenesisRenderer.tsx`,
`src/core/storage/KvStore.ts`, `tests/spatial-portals.test.ts`, `tests/portal-dispatch.test.ts`,
`docs/acceptance/spatial-phase-2-12/`, `docs/acceptance/MISSION-5-3-PORTAL-PERSISTENCE.md`.

- **The 5.2 warning was wrong in its cause, not its observation.** The portal key was never written
  because `SpatialPortals.tsx` had **no importer in `src`**: the component that called `seedRing`
  was never mounted, so no built-in identity was ever created and the 3D field never drew. The
  navigator Part A photographed is `SpatialNavigator`, a different surface.
- **Fixed:** seeding moved to the always-mounted `SpatialExperience`; the field is mounted in the
  existing `GenesisRenderer` beside `SpatialLayer`; the ring's list is `RING_SCENES` in the registry.
- **Also fixed:** `KvStore.set` now returns whether a backend stored the value, and `PortalRegistry`
  requires `true`, so a failed write can no longer be reported as a durable success.
- **Measured:** 11 built-in identities at mount and after reload; panel-created portals 11→13→13 and
  removal 13→12→11 across reloads; the same at 375/390/430/1440/1920; agent path through
  `dispatchToolCall` covered by two tests.
- **Still unproven (do not claim):** that each portal mesh is visually distinguishable in the 3D
  ring (software compositor, no R3F probe), conversation continuity across an actual flight, and
  memory/CPU behaviour. `SpatialPortals`'s pre-existing exhaustive-deps warning was left alone.
- If another executor needs to touch the spatial registry, mount, or `KvStore.set`'s return type,
  say so here first: `KvStore.set` changing from `void` to `boolean` is source-compatible for callers
  that ignore the value, but a caller that *tested* the result was never possible before.
