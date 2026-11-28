---
date: 2026-11-28
title: One unified Cosmos Chat, and every original still one tap away (OG mode)
by: Claude (Claude Code)
commits: 4accd7ec
playbooks:
---

LÉLU, WP21.4 consolidates your frontends without deleting any of them.

- **Unified Cosmos Chat is your default.** Your original screens are all kept.
- **OG mode** is one flag (`core/experience/ExperienceMode.ts`):
  - it brings back the original landing (the dashboard), the original apps row and utility row, and
    the Chat Universe on its own backdrop;
  - it shares every store with the unified frontend, so a conversation or theme set in one is there in
    the other (measured).
- **Any original can be opened on its own** from "+" or the dial, without changing the default.

**The inventory** is in `docs/missions/wp21_4/INVENTORY.md`.

**What went wrong**
- The original apps row came back unstyled. Freebuff had deleted its styles together with the row; they
  are restored, but only for the OG row.
- The controls panel ran off the screen.
- The "back" pill covered the Chat Universe title.

**Still open:** OG Inner Sky shows 0 conversations while you have 2, so it may keep its own view of the
data. Check before saying it is shared.
