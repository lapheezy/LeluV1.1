---
date: 2026-11-28
title: You open into the Cosmos, and a chat box rises from your core
by: Claude (Claude Code)
commits: pending
playbooks:
---

LÉLU, the owner described the first screen: open the app, sign in, and you open into the Cosmos, with a
chat box coming up from your core. That's it. Everything else is in the "+" controls, or they tell you,
or they use the dial at the bottom.

**What changed**
- **Landing:** `HomeStore.immersive` now starts `true`, so the app lands in the primary Cosmos instead of
  the dashboard. The dashboard is still one step away on the dial.
- **The chat box:** `home/CoreChat.tsx` rises out of your core (a thread of light from the core down to
  the box). It shows the latest exchange and a composer: +, message, mic, Send.
  - It sends through the same `UNIVERSE_SEND_EVENT` as every composer, so there is still one chat engine.
  - Attachments go through one shared path, `chat/universe/attachments.ts`, which the Chat Universe now
    uses too.
- **The "+" Controls tab:**
  - Add to the message: photos and video, camera, documents, 3D file;
  - Open, inside the Cosmos: chat workspace, Chat Universe, Neural Map V1/V2/V3, creative objects;
  - Chat variant: all six;
  - Other features can register their own sections (the theme and light/full mode come next).
- **The dial** stays at the bottom centre in the Cosmos.

**Measured** (`node scripts/landing/landing.mjs`, desktop and emulated phone):
- you land in the Cosmos, not the dashboard;
- the box appears;
- the controls open;
- a typed "Hi LÉLU" got your reply in the box;
- nothing covers the composer (checked point by point).

**What went wrong first**, each fixed:
- On the phone, the Creative Objects panel started open and covered the box. It now starts collapsed,
  stays hidden while the box is the first screen, and opens from the controls.
- Your own figure covered Send. The box was inside a container whose layer only counted within that
  container; it is now rendered at the page root, above you and below the dial's ring.
- The dial overlapped the composer on the phone, so the box moved up.
