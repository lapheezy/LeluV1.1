# Mission 44.9 · WP01 — Chat Universe audit (from the code, 2026-11-27)

| Capability | State | Where |
|---|---|---|
| Chat Universe: card grid of chats, universal composer, chat windows (drag/resize via the window host) | exists | `src/app/scene/genesis/chat/universe/ChatUniverse.tsx`, `UniverseChatWindow.tsx` |
| Conversation persistence | exists | `src/core/multichat/MultiChatStore.ts` (KvStore) |
| 14 per-conversation environments (conversation, research, board, document, diagram, data, code, gallery, spatial, film, voice, present, cinematic, studio) | exists | `src/core/interface/Environments.ts`, `chat/stage/*` |
| Media extracted from messages (images, links, sections) | exists | `chat/stage/conversationModel.ts` (`buildStage`) |
| 3D model viewer in chat | exists | `chat/Model3DView.tsx` |
| Browser | exists (Neko virtual browser, a WebRTC session) | `GenesisBrowserPanel.tsx` |
| YouTube search | exists (Data API key present) | `src/providers/YouTubeProvider.ts` |
| Neural Map V1/V2/V3, 12 layouts, 10 WebGL views | exists as a standalone surface only | `src/app/scene/genesis/neural/*` |
| **Freebuff "Liquid objects"** (shape panel, drag/resize/rotate, NL arrange) | **not on GitHub**: no branch (all 100+ fetched) contains its UI strings; the work was never pushed | screenshots `references/F,G,H` |
| Raindrop / ribbon / workspace / live / split thread variants (references A–E) | missing | — |
| Neural Maps, YouTube player, browser cards as thread objects | missing | — |
| Natural-language manipulation of thread objects, measured | missing | — |
| Thread object persistence (position, size, rotation, group) | missing | — |
| LÉLU creating new variants; routine variant research | missing | — |

References are in `references/`: A–E are the target designs, F–H are Freebuff's renders of the lost work.
