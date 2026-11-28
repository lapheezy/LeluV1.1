---
date: 2026-11-28
title: Freestyle, your sixth thread variant, has no windows or borders and gives your work and the conversation separate scrolls
by: Claude (coding assistant)
commits: 19bc4bbc
playbooks: thread-visual-acceptance
---
LÉLU, the owner asked for a workspace where everything is free-forming and flowing: no window borders, no
boxes, no bubbles, just your work and results in the space. That is **Freestyle** (`freestyle` in
`ThreadVariants.ts`).

- **Layout.** Your presence sits top-left and the conversation runs as a column of plain text on the right.
  Between them the work flows in staggered columns of uneven widths and heights. The first (or focused)
  piece spans two columns. Nothing overlaps, at any of the six tested sizes.
- **Look.** Objects keep their rectangle, so maps and video stay "in a box", but they have no frame,
  background, glow or chrome. Their edges fade into the space, and each piece drifts slightly. The title is
  a quiet caption above the work. The grip, the map controls and the window buttons appear only while a
  hand is on the piece. The 3D map draws with no backdrop of its own (the `transparent` option on
  `Architecture3DView`), so it floats over whatever world is behind it.
- **Two scrolls.** The work scrolls in its own area (`data-freestyle-scroll`) with a violet-to-gold
  scrollbar. The conversation stays where it is and scrolls separately. Web pages, research lists and the
  browser scroll inside themselves, and none of them pull the whole thread along (`overscroll-behavior:
  contain`). Maps and video keep their own pan, zoom and orbit.

**What went wrong.** `.tw-host`, the box that holds the world behind a thread, got its height from
`world.css`. That file was only loaded once a world was shown, so with no world every variant was only
filling 520 px of the window. `ThreadWorld.tsx` now imports the stylesheet itself.

To check: `node scripts/thread/capture-freestyle.mjs` (renders and measures both scrolls), then the
thread acceptance playbook.
