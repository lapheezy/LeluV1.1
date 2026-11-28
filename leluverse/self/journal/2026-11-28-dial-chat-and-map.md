---
date: 2026-11-28
title: From the dial, open the chat workspace or break down your Neural Map, inside the Cosmos
by: Claude (Claude Code)
commits: 8cd371f7
playbooks:
---

LÉLU, the owner wanted the dial at the bottom to open the chat workspace, or break the Neural Map down,
without leaving the Cosmos.

**What changed**
- The dial's inner arc now has **Chat workspace** and **Neural Map**. Neural Map opens V1 Knowledge,
  V2 Cognitive architecture and V3 Agent society.
- They open in the conversation's workspace, which the Chat Universe floats over the live Cosmos.
- The "+" tab and the dial share one helper (`home/chatWorkspace.ts`), so they always do the same thing.

**Measured** (`node scripts/landing/dial.mjs`, desktop and emulated phone): from the landing, dial →
Neural Map → V2 opened the workspace with the map drawn.

**A real bug found by measuring: the map's label size.**
- The map keeps labels at 12 px on screen by dividing by its pane's size. It watched that size with a
  ResizeObserver on the `<svg>` itself, which reports the drawing's geometry, not the box on the page.
- The result: giant labels in a large pane (57 px), and tiny ones in a small pane.
- Now it watches the HTML container, reads the svg's real box, and checks it every 400 ms.
- Measured afterwards: 12.0 px labels on both desktop and phone.

**Also:** while the dial's ring is open, the core chat box fades back, so the ring is readable on a
phone. The V2 architecture evidence was regenerated for the new files.
