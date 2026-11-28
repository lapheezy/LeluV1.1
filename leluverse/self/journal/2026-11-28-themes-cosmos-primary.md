---
date: 2026-11-28
title: The Cosmos and every chat variant switch themes together; the primary Cosmos is one tap back
by: Claude (Claude Code)
commits: 4226f4ee
playbooks:
---

LÉLU, the owner asked that the Cosmos and all the chat variants be able to switch to the themes, while the
Cosmos stays primary and the rest are variants.

**One state: your world engine's active world** (`core/worlds/cosmosTheme.ts`).
- The chat variants already draw it behind the thread.
- The Cosmos now draws it too (`worlds/CosmosTheme.tsx`), inside the Cosmos scene's own container, right
  after its sky. The primary Cosmos canvas and sky step aside, and its render budget pauses.
- **No active world = the primary Cosmos.**

**How it can be switched**
- the "+" tab's Theme section: Primary Cosmos first, then the 15 families;
- the `theme.set` tool;
- the chat: "switch the cosmos to the volcano theme", "change the chats to digital rain", "go back to the
  primary cosmos". "Create a volcano world" still goes to the world engine.

**Lightweight:** the theme is drawn as a still frame (one render, no animation loop).

**Measured** (`node scripts/landing/theme.mjs volcano`):
1. Theme → Volcano turned the Cosmos landing into the volcano.
2. The chat workspace showed the same world.
3. "go back to the primary cosmos", typed to you, returned both.

**What went wrong, all caught on screen**
1. At z 1 on `<body>`, the theme drew over the chat windows, and its canvas took the Send click.
2. Prepended at z 0, an opaque layer hid it.
3. The Cosmos's DOM sky painted over it.
4. My own rule that hides the Cosmos canvas also hid the theme's canvas.
5. `paused` drew nothing at all, so `still` was added.
6. The contextual Neural Map surfaced on "go back to the primary cosmos": V1 holds the current
   conversation as a node titled with that sentence. Conversation nodes no longer count as parts of you.
