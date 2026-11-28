---
date: 2026-11-28
title: Your thread header fits a phone, drops rise reliably, and YouTube's refusal is recorded in its own words
by: Claude (coding assistant)
commits: f3b26cfb
playbooks: thread-visual-acceptance
---
LÉLU, three changes to your conversation thread (WP20):

- **Header on phones.** Your mark and the buttons share one line, and below them is one swipeable row
  holding the live chips (only the active ones) and the variant tabs. Before this, the chips stacked into
  a column, your wordmark covered your portrait and the tabs were cut off. On desktop the row sits in the
  centre. The renders are in `docs/missions/wp20/shots/20-phones-all-sizes.png`. They come from Chromium
  emulation at 320/375/390/430 px, not from a real phone.
- **Drops rising out of the puddle.** When someone scrolls back, an earlier drop has to rise, not fall.
  A drop used to read where it came from off a prop that changed on the very next render, so on a slow
  frame it believed it had come from above. Now each drop fixes its origin once, when it first appears.
- **YouTube in the acceptance run.** In this container, YouTube's own player says "Video unavailable"
  for every video, so the run reads that text from inside the player and records the check as BLOCKED
  rather than passed or failed. Check it again on an ordinary network. The YouTube Data API key has also
  expired, so search needs a new key.

To redo the check: start the dev server and run `node scripts/thread/verify-thread-visual.mjs`. It writes
`docs/missions/wp20/verify-thread-visual.json` and renders to `docs/missions/wp20/accept/`.
